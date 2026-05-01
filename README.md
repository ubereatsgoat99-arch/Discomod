# Discord Moderation & Utility Bot

A feature-rich Discord bot built with **discord.js v14**, designed for moderation, spam detection, AI-based analysis, and server automation tools.

This bot includes advanced systems such as message monitoring, violation tracking, exile/timeout mechanics, and optional AI-powered detection (Claude API).
Originally made for MonkeyVerseYT's server, but extended the use for everyone anyways.

---

## 🚀 Features

### 🔒 Moderation System
- Violation tracking per user
- Automatic punishment escalation
- Temporary exile system
- Configurable thresholds

### 🛡️ Anti-Spam Protection
- Message flood detection (time-window based)
- Duplicate message detection
- Emoji spam detection
- Adjustable sensitivity settings

### 🚨 Scam / Exploit Detection
- Link pattern monitoring
- Suspicious content flagging system

### 🤖 AI Detection (Optional)
- Powered by Anthropic Claude API
- Detects potentially harmful or suspicious messages
- Toggleable via configuration

### ⚙️ Server Configuration
- Per-guild configurable settings via `/setup`
- Fallback defaults included
- Role and channel customization support

---

## 📦 Requirements

- Node.js v18+
- Discord bot token
- Discord application with intents enabled:
  - Guilds
  - GuildMessages
  - MessageContent
  - GuildMembers
  - DirectMessages (optional)

---

## 🛠️ Installation

Install dependencies:

```bash
npm install 
```

## Setup

After that, copy the example environment file:

```bash
cp .env.example .env
```
Then fill in your values:

DISCORD_TOKEN=your_token_here
ANTHROPIC_API_KEY=your_key_here

and then run:

```bash
node start
```

Have a lovely moderation bot hosting, dm me at my discord user: 1427299411049840640 for bugs that you found, and with that have a lovely day!
Send me friend request to my discord: https://www.discord.com/users/1427299411049840640 for discussing, constructive feedback is very much welcomed!

## Credit

If you use this project, please give credit to the original author, aka me, CyberNovaX

