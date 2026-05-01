# Discord Moderation & Utility Bot

A feature-rich Discord bot built with **discord.js v14**, designed for moderation, spam detection, AI-based analysis, and server automation tools.

This bot includes advanced systems such as message monitoring, violation tracking, exile/timeout mechanics, and optional AI-powered detection (Claude API).
Originally made for AmineGuy's Discord Server (https://discord.gg/HdgpfgrVsn), but extended the use for everyone anyways

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
Fill in the .env with your own Discord Bot token and Claude API key and then run

```bash
node start
```
`
