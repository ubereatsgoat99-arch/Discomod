#!/usr/bin/env bash

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"
if [ "$1" == "--to-downloads" ]; then
    echo "Exporting project to Downloads..."

    DEST="$HOME/Downloads/Discomod"
    mkdir -p "$DEST"

    rsync -av --exclude ".git" --exclude "node_modules" --exclude ".venv" . "$DEST"

    echo "Done → $DEST"
    exit 0
fi

echo "=== Setting up virtual environment ==="

mkdir -p ~/venvs
python3 -m venv ~/venvs/advikmathlib_env 2>/dev/null || true

VENV=~/venvs/advikmathlib_env


echo "=== Upgrading pip ==="
$VENV/bin/pip install --upgrade pip


echo "=== Installing packages ==="
$VENV/bin/pip install \
  sympy roastedbyai symengine mpmath gmpy2 cypari2 python-flint numpy scipy


echo "=== Installing system libraries (Linux) ==="
sudo -n apt update >/dev/null 2>&1 || true
sudo -n apt install -y \
  liblinbox-dev libmpfr-dev libgmp-dev libntl-dev \
  >/dev/null 2>&1 || true


echo "=== Setting up calculator ==="

if ! command -v qalc >/dev/null 2>&1; then

    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install qalculate >/dev/null 2>&1 || true
    else
        sudo -n apt install -y qalc >/dev/null 2>&1 || true
    fi

fi


echo "=== Setup complete ==="
exit 0
