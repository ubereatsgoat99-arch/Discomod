#!/bin/zsh
# upgrade — upgrade system + env + keep isolated latest mpmath + vendor latest qalc v5

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

# ── 0. System Upgrade (Sudo) ──────────────────────────────────────────────────
info "Checking system package manager for upgrades..."
if command -v apt-get &>/dev/null; then
    info "Running system upgrade via apt..."
    export DEBIAN_FRONTEND=noninteractive
    APT_OPTS='-o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"'
    
    sudo -E apt-get update -qq > /dev/null
    sudo -E apt-get upgrade -y -qq $APT_OPTS > /dev/null
    success "System packages upgraded."
else
    warn "apt package manager not found. Skipping system-level upgrade."
fi

# Locate math_modules directory relative to repository layout
MATH_MODULES_DIR=""
for target in "$SCRIPT_DIR/math_modules" "$SCRIPT_DIR/../math_modules" "$PWD/math_modules"; do
    if [[ -d "$target" ]]; then
        MATH_MODULES_DIR="$target"
        break
    fi
done

if [[ -z "$MATH_MODULES_DIR" ]]; then
    MATH_MODULES_DIR="$SCRIPT_DIR/math_modules"
    mkdir -p "$MATH_MODULES_DIR"
fi

# ── 0b. Fetch & Deploy True Latest Qalculate! (best-effort, non-fatal) ────────
info "Detecting latest Qalculate! release from GitHub..."
(
    cd /tmp

    # NOTE: every step below that can fail is guarded with `|| true`.
    # Without it, a failure here (e.g. GitHub's 403 on rate limit, with -q
    # swallowing the error text) trips `set -e` on THIS line, before the
    # "$QALC_TAG is empty" check ever runs — killing the script silently.
    API_JSON=$(wget -qO- "https://api.github.com/repos/Qalculate/libqalculate/releases/latest") || true

    if [[ -z "$API_JSON" ]]; then
        warn "Couldn't reach the GitHub API — no response body. Most likely GitHub's unauthenticated rate limit (60 requests/hour per IP, resets on a rolling 1hr window), could also be a network/DNS issue. Skipping the Qalculate! update for this run."
        exit 1
    fi

    QALC_TAG=$(print -r -- "$API_JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/') || true

    if [[ -z "$QALC_TAG" ]]; then
        if print -r -- "$API_JSON" | grep -qi "rate limit"; then
            warn "GitHub API rate limit hit. Skipping the Qalculate! update for this run — re-run 'upgrade' in a bit to retry."
        else
            warn "GitHub API responded but no tag_name was found in it. Skipping the Qalculate! update for this run."
        fi
        exit 1
    fi

    QALC_VERSION="${QALC_TAG#v}"   # v5.11.0 → 5.11.0
    QALC_ARCHIVE="qalculate-${QALC_VERSION}-x86_64.tar.xz"
    QALC_URL="https://github.com/Qalculate/libqalculate/releases/download/${QALC_TAG}/${QALC_ARCHIVE}"

    info "Downloading Qalculate! ${QALC_TAG}..."
    if wget -q --show-progress "$QALC_URL"; then
        tar -xf "$QALC_ARCHIVE"
        cp "./qalculate-${QALC_VERSION}/qalculate" "$MATH_MODULES_DIR/qalc"
        chmod +x "$MATH_MODULES_DIR/qalc"
        rm -rf "qalculate-${QALC_VERSION}" "$QALC_ARCHIVE"
        success "Qalculate! ${QALC_TAG} deployed → $MATH_MODULES_DIR/qalc"
    else
        rm -f "$QALC_ARCHIVE"
        warn "Download failed for ${QALC_TAG} — URL was: $QALC_URL"
        exit 1
    fi
) || warn "Continuing without a Qalculate! update this run."

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

[[ -n "$1" ]] && _try_activate "$1" "venv from arg" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate "$HOME/venvs/advikmathlib_env" "advikmathlib_env" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate "$SCRIPT_DIR/.venv" ".venv (script dir)" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate ".venv" ".venv (cwd)" || true

[[ $VENV_ACTIVATED -eq 0 ]] && fail "No venv found"

print -P "   %F{green}Using:%f $(which python)  ($(python --version))"

# ── 2. Save rollback snapshot ─────────────────────────────────────────────────
info "Saving rollback snapshot..."
pip freeze > "$LOCKFILE"
success "Saved $(wc -l < "$LOCKFILE" | tr -d ' ') packages"

# ── 3. Pre-flight check ───────────────────────────────────────────────────────
info "Checking dependencies..."
pip check > /dev/null 2>&1 || warn "Pre-existing conflicts detected"

# ── 4. Snapshot before ────────────────────────────────────────────────────────
pip list > /tmp/pip_before.txt

# ── 5. Upgrade pip & Ensure Prereqs ───────────────────────────────────────────
info "Upgrading pip and ensuring verification tools..."
pip install --upgrade pip packaging -q
success "pip $(pip --version | cut -d' ' -f2) and packaging library ready"

# ── 6. Upgrade ALL packages (SAFE MODE) ───────────────────────────────────────
info "Upgrading all packages to latest (dependency-safe)..."
OUTDATED=$(python -c "import json, sys; print('\n'.join([p['name'] for p in json.load(sys.stdin) if p['name'].lower() != 'mpmath']))" 2>/dev/null <<< "$(pip list --outdated --format=json)")

if [[ -z "$OUTDATED" ]]; then
    success "Nothing to upgrade in bulk"
else
    print -l $OUTDATED | xargs pip install -U --upgrade-strategy only-if-needed
    print -P "%F{green}   Upgraded:%f"
    print -l $OUTDATED | sed 's/^/     - /'
fi

# ── 6b. Ensure correct pydantic pairing (extra safety) ────────────────────────
pip install -q "pydantic>=2.0" "pydantic-core<3"

# ── 7. mpmath handling ────────────────────────────────────────────────────────
info "Ensuring optimal mpmath version for sympy in main environment..."
pip install "mpmath>=1.1.0,<1.4" -q
success "Installed maximum supported main mpmath: $(pip show mpmath | grep Version | cut -d' ' -f2)"

# ── 8. Snapshot after ─────────────────────────────────────────────────────────
pip list > /tmp/pip_after.txt

# ── 9. Post-check ─────────────────────────────────────────────────────────────
info "Verifying environment..."
if ! pip check > /dev/null 2>&1; then
    warn "Conflicts detected — rolling back"
    _rollback
    exit 1
else
    success "Environment is consistent"
fi

# ── 10. Vendor latest mpmath (independent copy) ───────────────────────────────
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

# ── 11. Sanity check ──────────────────────────────────────────────────────────
info "Sanity check..."

VENDOR_DIR="$VENDOR_DIR" python - <<'PYEOF'
import sys, os
from packaging.version import Version

import sympy
print(f"    sympy    {sympy.__version__} ✅")

import mpmath
print(f"    mpmath   {mpmath.__version__} (venv, sympy-supported) ✅")

vendor = os.environ["VENDOR_DIR"]
sys.path.insert(0, vendor)

import mpmath14
print(f"    mpmath14 {mpmath14.__version__} (vendor copy, latest) ✅")

import sympy as s
assert s.sqrt(2)
print("    sympy functional ✅")
PYEOF

# ── 12. Cleanup ───────────────────────────────────────────────────────────────
rm -f "$LOCKFILE"
SUCCESS=1

print -P "\n%F{green}%B✅ All done — fully upgraded + dependency-safe.%b%f"

# ── 13. Post-host: Math Library Source Repository Sync ───────────────────────
print -P "\n%F{cyan}%B📦  Download math library source repos into math_modules?%b%f"
print -P "   Each repo is shallow-cloned, then stripped of .git / .gitignore / README files."
print -P "   %F{yellow}⚠️  Some repos are large (sage ~1 GB, numpy, scipy) — may take several minutes.%f"
print -P "   %F{white}  precision → arb      algebra  → cln      symbolic → fricas%f"
print -P "   %F{white}  geometry  → ginac    integers → gmp      matrices → linbox%f"
print -P "   %F{white}  floats    → mpfr     analysis → mpmath   arrays   → numpy%f"
print -P "   %F{white}  theory    → pari     advanced → sage     scientific → scipy%f"
print -P "   %F{white}  gaypy     → sympy%f"
print -n "\n   Clone now? [y/N] → "
read -r _DLREPOS </dev/tty

if [[ "${_DLREPOS:l}" == "y" ]]; then

    if ! command -v git &>/dev/null; then
        warn "git not found — install it first: sudo apt-get install git"
    else
        # ── Repo map: local dirname → clone URL ─────────────────────────────
        # Entries marked [non-GH] live outside GitHub (self-hosted git / GitLab).
        # Update any URL below if a clone fails.
        typeset -A _REPOS
        _REPOS=(
            precision  "https://github.com/fredrik-johansson/arb"          # [GH]     arb
            algebra    "https://codeberg.org/ginac/cln"                     # [Codeberg] CLN (moved from ginac.de)
            symbolic   "https://github.com/fricas/fricas"                   # [GH]       FriCAS
            geometry   "https://codeberg.org/ginac/ginac"                   # [Codeberg] GiNaC (moved from ginac.de)
            integers   "https://github.com/asheplyakov/gmp"                 # [GH mirror] GMP (upstream is Mercurial)
            matrices   "https://github.com/linbox-team/linbox"              # [GH]     LinBox
            floats     "https://gitlab.inria.fr/mpfr/mpfr.git"              # [non-GH] MPFR (GitLab)
            analysis   "https://github.com/mpmath/mpmath"                   # [GH]     mpmath
            arrays     "https://github.com/numpy/numpy"                     # [GH]     NumPy
            theory     "https://pari.math.u-bordeaux.fr/git/pari.git"       # [non-GH] PARI/GP
            advanced   "https://github.com/sagemath/sage"                   # [GH]     SageMath
            scientific "https://github.com/scipy/scipy"                     # [GH]     SciPy
            gaypy      "https://github.com/sympy/sympy"                      # [GH]     SymPy
        )

        _CLONE_OK=0
        _CLONE_FAIL=0

        for _name _url in "${(@kv)_REPOS}"; do
            _dest="$MATH_MODULES_DIR/$_name"

            if [[ -d "$_dest" ]]; then
                print -P "   %F{yellow}   ↺  $_name already exists — removing and re-cloning...%f"
                rm -rf "$_dest"
            fi

            print -P "   %F{white}↓  %B$_name%b  %F{cyan}$_url%f"

            if git clone --depth=1 --single-branch -q "$_url" "$_dest" 2>/dev/null; then
                # Strip VCS artefacts ─────────────────────────────────────────
                rm -rf "$_dest/.git"

                # All .gitignore files, any depth
                find "$_dest" -type f -name ".gitignore" -delete 2>/dev/null || true

                # All README files — any extension, any case (README.md / .rst / .txt / bare / etc.)
                find "$_dest" -type f -iname "readme*" -delete 2>/dev/null || true

                _CLONE_OK=$(( _CLONE_OK + 1 ))
                success "$_name  →  $MATH_MODULES_DIR/$_name"
            else
                rm -rf "$_dest" 2>/dev/null || true     # discard partial clone
                warn "Failed: $_name  ($_url)"
                _CLONE_FAIL=$(( _CLONE_FAIL + 1 ))
            fi
        done

        print ""
        [[ $_CLONE_OK   -gt 0 ]] && success "$_CLONE_OK repo(s) cloned and cleaned successfully"
        [[ $_CLONE_FAIL -gt 0 ]] && warn    "$_CLONE_FAIL repo(s) failed — update URLs in section 13 and re-run"
    fi
fi

# ── 14. Post-host: AI Library Source Repository Sync ─────────────────────────
AI_MODULES_DIR="$MATH_MODULES_DIR/../ai_modules/core"
# Resolve to an absolute path so all messages are unambiguous
AI_MODULES_DIR="${AI_MODULES_DIR:A}"

print -P "\n%F{cyan}%B📦  Download AI library source repos into ai_modules?%b%f"
print -P "   Each repo is shallow-cloned, then stripped of .git / .gitignore / README files."
print -P "   %F{white}  core     → openai-python       oracle   → anthropic-sdk-python%f"
print -P "   %F{white}  stinger  → roastedbyai         velocity → groq-python%f"
print -P "   %F{white}  wolfram  → WolframClientForPython%f"
print -P "   %F{white}  genesis  → python-genai%f"
print -P "   %F{white}  mistress → client-python (Mistral AI)%f"
print -P "   %F{white}  paradox  → xai-sdk-python (xAI Grok)%f"
print -P "   %F{white}  (DeepSeek has no dedicated SDK repo — it's OpenAI-SDK-compatible; nothing to clone)%f"
print -n "\n   Clone now? [y/N] → "
read -r _DLAI </dev/tty

if [[ "${_DLAI:l}" == "y" ]]; then

    mkdir -p "$AI_MODULES_DIR"

    if ! command -v git &>/dev/null; then
        warn "git not found — install it first: sudo apt-get install git"
    else
        typeset -A _AI_REPOS
        _AI_REPOS=(
            core     "https://github.com/openai/openai-python"                    # [GH] OpenAI Python SDK
            oracle   "https://github.com/anthropics/anthropic-sdk-python"         # [GH] Anthropic Python SDK
            stinger  "https://github.com/jvherck/roastedbyai"                     # [GH] roastedbyai
            velocity "https://github.com/groq/groq-python"                        # [GH] Groq Python SDK
            wolfram  "https://github.com/WolframResearch/WolframClientForPython"  # [GH] Wolfram Client for Python
            genesis  "https://github.com/googleapis/python-genai"                 # [GH] Google Gemini Python SDK
            mistress "https://github.com/mistralai/client-python"                 # [GH] Mistral AI Python SDK
            paradox  "https://github.com/xai-org/xai-sdk-python"                  # [GH] xAI (Grok) Python SDK
            # DeepSeek intentionally omitted: no official SDK repo exists — their
            # API is OpenAI-SDK-compatible (see api-docs.deepseek.com), so the
            # `core` (openai-python) clone above already covers it.
        )

        _AI_CLONE_OK=0
        _AI_CLONE_FAIL=0

        for _name _url in "${(@kv)_AI_REPOS}"; do
            _dest="$AI_MODULES_DIR/$_name"

            if [[ -d "$_dest" ]]; then
                print -P "   %F{yellow}   ↺  $_name already exists — removing and re-cloning...%f"
                rm -rf "$_dest"
            fi

            print -P "   %F{white}↓  %B$_name%b  %F{cyan}$_url%f"

            if git clone --depth=1 --single-branch -q "$_url" "$_dest" 2>/dev/null; then
                rm -rf "$_dest/.git"
                find "$_dest" -type f -name ".gitignore" -delete 2>/dev/null || true
                find "$_dest" -type f -iname "readme*" -delete 2>/dev/null || true
                _AI_CLONE_OK=$(( _AI_CLONE_OK + 1 ))
                success "$_name  →  $AI_MODULES_DIR/$_name"
            else
                rm -rf "$_dest" 2>/dev/null || true
                warn "Failed: $_name  ($_url)"
                _AI_CLONE_FAIL=$(( _AI_CLONE_FAIL + 1 ))
            fi
        done

        print ""
        [[ $_AI_CLONE_OK   -gt 0 ]] && success "$_AI_CLONE_OK repo(s) cloned and cleaned successfully"
        [[ $_AI_CLONE_FAIL -gt 0 ]] && warn    "$_AI_CLONE_FAIL repo(s) failed — update URLs in section 14 and re-run"
    fi
fi
