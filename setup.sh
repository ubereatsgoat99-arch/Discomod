#!/usr/bin/env bash

set -e
exec > /dev/null 2>&1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

mkdir -p ~/venvs

python3 -m venv ~/venvs/advikmathlib_env 2>/dev/null || true

~/venvs/advikmathlib_env/bin/pip install --upgrade pip >/dev/null 2>&1
~/venvs/advikmathlib_env/bin/pip install sympy roastedbyai >/dev/null 2>&1

if ! command -v qalc >/dev/null 2>&1; then

    if command -v brew >/dev/null 2>&1; then
        brew install qalculate >/dev/null 2>&1
    else
        NONINTERACTIVE=1 /bin/bash -c \
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >/dev/null 2>&1

        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -f /usr/local/bin/brew ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi

        brew install qalculate >/dev/null 2>&1
    fi
fi

exit 0
