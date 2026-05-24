#!/usr/bin/env bash

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

chmod +x superqalc superqalc_onefile superqalc_tower 2>/dev/null || true

echo "=== Installing packages ==="
npm install

echo ""
echo "=== Setting up .env ==="

# Create .env if it doesn't exist
cp -n .env.example .env 2>/dev/null || true

# Mandatory inputs
echo ""
echo "=== Required Configuration ==="

read -p "Discord Token: " DISCORD_TOKEN
read -p "Anthropic API Key: " ANTHROPIC_API_KEY
read -p "Wolfram API: " WOLFRAM_APPID
read -p "Groq API Key: " GROQ_API_KEY
read -p "Client ID: " CLIENT_ID

# Optional inputs
echo ""
echo "=== Optional Configuration ==="
echo "Type 'skip' if you don't know what you're doing."

read -p "Python Venv: " PYTHON_BIN
read -p "Calc Path: " QALCULATE_PATH

# Helper function
set_env() {
    KEY=$1
    VALUE=$2

    if grep -q "^${KEY}=" .env; then
        sed -i'' "s|^${KEY}=.*|${KEY}=${VALUE}|" .env
    else
        echo "${KEY}=${VALUE}" >> .env
    fi
}

# Required vars
set_env "DISCORD_TOKEN" "$DISCORD_TOKEN"
set_env "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
set_env "WOLFRAM_APPID" "$WOLFRAM_APPID"
set_env "GROQ_API_KEY" "$GROQ_API_KEY"
set_env "CLIENT_ID" "$CLIENT_ID"

# Optional vars
if [[ "$PYTHON_BIN" != "skip" && -n "$PYTHON_BIN" ]]; then
    set_env "PYTHON_BIN" "$PYTHON_BIN"
fi

if [[ "$QALCULATE_PATH" != "skip" && -n "$QALCULATE_PATH" ]]; then
    set_env "QALCULATE_PATH" "$QALCULATE_PATH"
fi

echo ""
echo "=== .env configured successfully ==="

echo ""
echo "=== Installing upgrade command ==="

echo "You may be prompted for your sudo password..."

# Make update_env.zsh executable
chmod +x update_env.zsh

# Copy to /usr/local/bin as 'upgrade'
sudo cp update_env.zsh /usr/local/bin/upgrade

echo "Upgrade command installed! You can now run 'upgrade' from anywhere."

echo ""

# Run upgrade immediately
echo "=== Running upgrade ==="
upgrade

echo ""

read -p "Run the bot now? (y/n): " RUN_BOT

if [[ "$RUN_BOT" == "y" || "$RUN_BOT" == "Y" ]]; then
    npm start
else
    echo "Aight, Goodluck"
fi
