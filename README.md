# Discord Moderation & Utility Bot

A feature-rich Discord bot built with **discord.js v14**, designed for moderation, spam detection, AI-based analysis, and server automation tools.

This bot includes advanced systems such as message monitoring, violation tracking, exile/timeout mechanics, and optional AI-powered detection (Claude API).
Originally made for MonkeyVerseYT's server, but extended the use for everyone anyways.

Oh yea also this bot can be hosted using GitHub codespace easily so you can abuse that shi
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
- Powered by some AIs
- Detects potentially harmful or suspicious messages
- Toggleable via configuration

### ⚙️ Server Configuration
- Per-guild configurable settings via `/setup`
- Fallback defaults included
- Role and channel customization support

### 🤖 AI Roasts and Conversations
- Powered by Groq/Chatgpt
- Can split into messages
- Toggleable via configuration

### 🧮 Math Calculators
- Powered by very powerful math modules
- Can split into messages
- Supports arbitary-preceision
- Can show every digit

---

## 📦 Requirements

- Node.js 
- Discord bot token
- API Keys as mentioned in the .env file
- Ofc having python installed
- All the files inside here (do not trim out any, shit will break)
- Your damn brain
- Discord application with intents enabled:
  - Guilds
  - GuildMessages
  - MessageContent
  - GuildMembers
  - DirectMessages (optional)

---

## 🛠️ Installation

This project has a bunch of paths, so do the follwoing(no need to if ur in github codespace with my forked repo):

```bash
git clone https://github.com/xenostopic-cyber/Discomod
cd Discomod
```
After that just do this:

```
chmod +x setup.sh
./setup.sh
```

Fill out your shit which it asks you to do, and go mad!
Occasionally also upgrade your system pip in case stuff breaks and if it's serious jst ask AI to set up your stuff 🥀

Have a lovely moderation bot hosting, dm me at my discord user: 1350576056393797743 for bugs that you found, and with that have a lovely day!
Send me friend request to my discord: https://www.discord.com/users/1350576056393797743 for discussing, constructive feedback is very much welcomed!

## Credit

If you use this project, please give credit to the original author, aka me, CyberNovaX (Xenostopic)
Oh ya also: [Invite the Bot](https://discord.com/oauth2/authorize?client_id=1494250614123659294&permissions=8&integration_type=0&scope=bot+applications.commands) in case you wanna use the bot!

## 📄 License 
- License: AGPL v3
- NOTICE file: see `/NOTICE`
