#!/bin/zsh
# advik-upgrade — upgrade env + keep isolated latest mpmath

set -e
set -o pipefail

SCRIPT_DIR="${0:A:h}"

# ── helpers ───────────────────────────────────────────────────────────────────
info()    { print -P "\n%F{cyan}🔹 $1%f"; }
success() { print -P "%F{green}   ✅ $1%f"; }
warn()    { print -P "%F{yellow}   ⚠️  $1%f"; }
fail()    { print -P "%F{red}   ❌ $1%f"; exit 1; }

# ── rollback trap ─────────────────────────────────────────────────────────────
LOCKFILE="/tmp/advik_pip_lock_$$.txt"
ROLLED_BACK=0
SUCCESS=0

_rollback() {
    if [[ $SUCCESS -eq 0 && $ROLLED_BACK -eq 0 && -f "$LOCKFILE" ]]; then
        ROLLED_BACK=1
        print -P "\n%F{red}%B💥 Failure detected — rolling back...%b%f"
        pip install -q -r "$LOCKFILE" --force-reinstall 2>/dev/null && \
            print -P "%F{green}   Rollback complete.%f" || \
            print -P "%F{yellow}   Rollback may be incomplete — check $LOCKFILE%f"
    fi
}
trap '_rollback' ERR

# ── 1. Activate venv ──────────────────────────────────────────────────────────
VENV_ACTIVATED=0

_try_activate() {
    local venv_path="$1"
    local label="$2"
    if [[ -f "$venv_path/bin/activate" ]]; then
        info "Activating $label..."
        source "$venv_path/bin/activate" || fail "Failed to activate $label"
        VENV_ACTIVATED=1
        return 0
    fi
    return 1
}

[[ -n "$1" ]] && _try_activate "$1" "venv from arg"
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate "$HOME/venvs/advikmathlib_env" "advikmathlib_env" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate "$SCRIPT_DIR/.venv" ".venv (script dir)" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate ".venv" ".venv (cwd)" || true

[[ $VENV_ACTIVATED -eq 0 ]] && fail "No venv found"

print -P "   %F{green}Using:%f $(which python)  ($(python --version))"

# ── 2. Save rollback snapshot ─────────────────────────────────────────────────
info "Saving rollback snapshot..."
pip freeze > "$LOCKFILE"
success "Saved $(wc -l < $LOCKFILE | tr -d ' ') packages"

# ── 3. Pre-flight check ───────────────────────────────────────────────────────
info "Checking dependencies..."
pip check || warn "Pre-existing conflicts detected"

# ── 4. Snapshot before ────────────────────────────────────────────────────────
pip list > /tmp/pip_before.txt

# ── 5. Upgrade pip & Ensure Prereqs ───────────────────────────────────────────
info "Upgrading pip and ensuring verification tools..."
pip install --upgrade pip packaging -q
success "pip $(pip --version | cut -d' ' -f2) and packaging library ready"

# ── 6. Upgrade ALL packages (with dynamic mpmath adjustment) ──────────────────
info "Upgrading all packages to latest..."

# Exclude mpmath from the bulk upgrade list to prevent dependency resolver crashes
OUTDATED=$(python -c "import json, sys; print('\n'.join([p['name'] for p in json.load(sys.stdin)]))" 2>/dev/null <<< "$(pip list --outdated --format=json)" | grep -vE "^mpmath$")

if [[ -z "$OUTDATED" ]]; then
    success "Nothing to upgrade in bulk"
else
    echo "$OUTDATED" | xargs pip install -U -q
    print -P "%F{green}   Upgraded:%f"
    echo "$OUTDATED" | sed 's/^/     - /'
fi

# Dynamically force-install the absolute highest version of mpmath that sympy allows
info "Ensuring optimal mpmath version for sympy in main environment..."
pip install "mpmath>=1.1.0,<1.4" -q
success "Installed maximum supported main mpmath: $(pip show mpmath | grep Version | cut -d' ' -f2)"

# ── 7. Snapshot after + diff ──────────────────────────────────────────────────
info "Changes:"
pip list > /tmp/pip_after.txt
diff /tmp/pip_before.txt /tmp/pip_after.txt || true

# ── 8. Post-check ─────────────────────────────────────────────────────────────
info "Verifying environment..."
if ! pip check; then
    warn "Conflicts detected — rolling back"
    _rollback
    exit 1
else
    success "Environment is consistent"
fi

# ── 9. Vendor latest mpmath (independent copy) ────────────────────────────────
if [[ "$SCRIPT_DIR" == "/usr/local/bin" || "$SCRIPT_DIR" == "/bin" || "$SCRIPT_DIR" == "/usr/bin" ]]; then
    VENDOR_DIR="$PWD/_vendor_mpmath"
else
    VENDOR_DIR="$SCRIPT_DIR/_vendor_mpmath"
fi

info "Vendoring latest mpmath to $VENDOR_DIR..."
rm -rf "$VENDOR_DIR"
pip install mpmath --target="$VENDOR_DIR" --no-deps -q
mv "$VENDOR_DIR/mpmath" "$VENDOR_DIR/mpmath14"
success "Vendored mpmath → mpmath14"

# ── 10. Sanity check ──────────────────────────────────────────────────────────
info "Sanity check..."

VENDOR_DIR="$VENDOR_DIR" python - <<'PYEOF'
import sys, os
from packaging.version import Version

import sympy
print(f"   sympy    {sympy.__version__} ✅")

import mpmath
print(f"   mpmath   {mpmath.__version__} (venv, sympy-supported) ✅")

vendor = os.environ["VENDOR_DIR"]
sys.path.insert(0, vendor)

import mpmath14
print(f"   mpmath14 {mpmath14.__version__} (vendor copy, latest) ✅")

# ensure sympy still works
import sympy as s
assert s.sqrt(2)
print("   sympy functional ✅")
PYEOF

# ── 11. Cleanup ───────────────────────────────────────────────────────────────
rm -f "$LOCKFILE"
SUCCESS=1

print -P "\n%F{green}%B✅ All done — fully upgraded + dual mpmath ready.%b%f"
