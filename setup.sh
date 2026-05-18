#!/usr/bin/env bash

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "=== Installing packages ==="
npm install

echo ""
echo "=== Setting up .env ==="
cp -n .env.example .env 2>/dev/null || true

read -p "DISCORD_TOKEN: " DISCORD_TOKEN
read -p "ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
read -p "WOLFRAM_APPID: " WOLFRAM_APPID
read -p "GROQ_API_KEY: " GROQ_API_KEY

sed -i'' "s|DISCORD_TOKEN=.*|DISCORD_TOKEN=$DISCORD_TOKEN|" .env
sed -i'' "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY|" .env
sed -i'' "s|WOLFRAM_APPID=.*|WOLFRAM_APPID=$WOLFRAM_APPID|" .env
sed -i'' "s|GROQ_API_KEY=.*|GROQ_API_KEY=$GROQ_API_KEY|" .env

echo ""
read -p "Run the bot now? (y/n): " RUN_BOT

if [[ "$RUN_BOT" == "y" || "$RUN_BOT" == "Y" ]]; then
    npm start
else
    echo "Aight, Goodluck"
fi
