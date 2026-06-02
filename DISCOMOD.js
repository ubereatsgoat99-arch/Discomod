'use strict';

const roastBattles = new Map();
const slashSessions = new Map();
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SKYNET V7 — BLOX FRUITS ULTRA GUARDIAN                                     ║
// ║  Professional-grade Discord moderation bot                                   ║
// ║  Features: trades · services · items · swords · bosses · enchants ·          ║
// ║  haki · fighting styles · guns · accessories · quests · sea events ·         ║
// ║  races · pain/lightning upgrades · begging · account trading ·               ║
// ║  spam detection · AI detection · appeals system · exile system ·             ║
// ║  slash commands · setup wizard · immunity management · logging               ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

'use strict';
require('dotenv').config();

// ══════════════════════════════════════════════════════════
//  PATCH: GLOBAL CRASH PROTECTION
//  Prevents ANY unhandled error from silently killing the bot.
// ══════════════════════════════════════════════════════════
process.on('uncaughtException', (err, origin) => {
    console.error(`\n[CRASH GUARD] uncaughtException — origin: ${origin}`);
    console.error(err);
    // Do NOT exit; let the bot keep running unless it's a truly fatal state.
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH GUARD] unhandledRejection at:', promise);
    console.error('[CRASH GUARD] Reason:', reason);
});
process.on('warning', (warning) => {
    console.warn('[CRASH GUARD] Node Warning:', warning.name, warning.message);
});
process.on('multipleResolves', (type, promise, reason) => {
    // Only log; never throw — some libs trigger this harmlessly.
    console.warn(`[CRASH GUARD] multipleResolves (${type}):`, reason);
});
// ══════════════════════════════════════════════════════════

const {
    Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits,
    REST, Routes, SlashCommandBuilder, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, Collection, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    MessageFlags,
    Partials,
} = require('discord.js');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mathMod = require('./math_commands');
const yaml = require('js-yaml');
const Database = require('better-sqlite3');
const { OpenAI } = require('openai');

// ══════════════════════════════════════════════════════════
//  CONFIGURATION — overridden by /setup
// ══════════════════════════════════════════════════════════
const TOKEN     = process.env.DISCORD_TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';

// ══════════════════════════════════════════════════════════
//  STARTUP VALIDATION — graceful failures, no hard throws
// ══════════════════════════════════════════════════════════
(function validateStartup() {
    const errors   = [];
    const warnings = [];

    if (!TOKEN)     errors.push('DISCORD_TOKEN is missing or empty in .env');
    if (!CLIENT_ID) errors.push('CLIENT_ID is missing or empty in .env');

    // API key warnings (non-fatal — subsystems soft-disable themselves later)
    if (!process.env.ANTHROPIC_API_KEY) warnings.push('ANTHROPIC_API_KEY not set — Claude AI disabled');
    if (!process.env.GROQ_API_KEY)      warnings.push('GROQ_API_KEY not set — Groq AI disabled');
    if (!process.env.OPENAI_API_KEY)    warnings.push('OPENAI_API_KEY not set — OpenAI AI disabled');
    if (!process.env.WOLFRAM_APPID)     warnings.push('WOLFRAM_APPID not set — /wolf command may fail');

    // Required files check
    const requiredFiles = ['math_commands.js'];
    for (const f of requiredFiles) {
        if (!fs.existsSync(path.join(__dirname, f)))
            warnings.push(`Required file missing: ${f}`);
    }

    // Executable availability check (non-fatal)
    const exeChecks = [
        { env: 'QALCULATE_PATH', fallback: path.join(__dirname, 'math_modules', 'qalc'), label: 'qalc' },
        { env: null, fallback: path.join(__dirname, 'superqalc_onefile'), label: 'superqalc_onefile' },
        { env: null, fallback: path.join(__dirname, 'superqalc_tower'),   label: 'superqalc_tower' },
    ];
    for (const { env, fallback, label } of exeChecks) {
        const p = (env && process.env[env]) ? process.env[env] : fallback;
        if (!fs.existsSync(p)) warnings.push(`Executable not found: ${label} (${p}) — related commands may fail`);
    }

    console.log('\n[STARTUP] ══════ SKYNET V7 — Subsystem Validation ══════');
    if (warnings.length) {
        for (const w of warnings) console.warn(`[STARTUP] ⚠  ${w}`);
    } else {
        console.log('[STARTUP] ✅ All optional subsystems look good.');
    }

    if (errors.length) {
        for (const e of errors) console.error(`[STARTUP] ❌ FATAL: ${e}`);
        console.error('[STARTUP] Cannot start bot — fix the above errors in your .env file.\n');
        process.exit(1);
    }
    console.log('[STARTUP] ✅ Core env vars present — proceeding with login.\n');
})();

// Fallback channel / role IDs (overridden per-guild via /setup)
const DEFAULT_TARGET_CHANNEL_ID   = '1417395956357267516';
const DEFAULT_SERVICES_CHANNEL_ID = '1417396221362049085';
const DEFAULT_GAMES_HUB_ID        = '1416126451589316679';
const DEFAULT_EXILED_ROLE_ID      = '1423350765711261797';
const DEFAULT_REDIRECT_EMOJI_ID   = '1125321969932451841';

const BOT_CODED_BY_ID = '1427299411049840640';

// ══════════════════════════════════════════════════════════
//  SUPERUSER — complete, un-bypassable authority
//  Only BOT_CODED_BY_ID has this. They can do anything,
//  including actions blocked for admins/mods (e.g. self-
//  unexile, self-unwarn, self-clearviolations, etc.)
// ══════════════════════════════════════════════════════════
function isSuperUser(id) { return String(id) === BOT_CODED_BY_ID; }

const VIOLATION_THRESHOLD  = 3;
const EXILE_DURATION_MINS  = 45;
const SPLIT_MESSAGE_TTL    = 90;
const FUZZY_THRESHOLD      = 0.72;
const SHORT_MIN_LEN        = 5;

// Spam detection config
const SPAM_WINDOW_MS   = 6000;   // 6-second rolling window
const SPAM_MSG_LIMIT   = 5;      // 5+ msgs in window = spam
const SPAM_DUPE_LIMIT  = 3;      // 3+ identical msgs = spam
const SPAM_EMOJI_LIMIT = 15;     // 15+ emojis in one message

// Scam / exploit detection config
const SCAM_LINK_WINDOW = 220;

// AI detection config (Claude API)
const AI_API_URL    = 'https://api.anthropic.com/v1/messages';
const AI_MODEL      = 'claude-haiku-4-5-20251001';
const AI_ENABLED    = true; // set true + add ANTHROPIC_API_KEY env var to enable
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
// PATCH: soft-disable instead of crash — allows bot to start without Claude key
// (will fall back to Groq/OpenAI if available, or disable AI chat gracefully)
if (AI_ENABLED && !ANTHROPIC_KEY) {
    console.warn('[STARTUP] WARNING: AI is enabled but ANTHROPIC_API_KEY is missing. Claude provider disabled; will fall back to Groq/OpenAI if keys are present.');
}
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

const BOT_START_TS = Date.now();

// ── Terminal command counters ─────────────────────────────────────────────────
const CMD_STATS = { slash: 0, message: 0 };
function logCmdStats(type, name) {
    CMD_STATS[type]++;
    const upSecs = Math.floor((Date.now() - BOT_START_TS) / 1000);
    const h = Math.floor(upSecs / 3600);
    const m = Math.floor((upSecs % 3600) / 60);
    const s = upSecs % 60;
    const upStr = `${h}h ${m}m ${s}s`;
    const prefix = type === 'slash' ? '⚡ [SLASH]' : '💬 [MSG]';
    console.log(`${prefix} ${name.padEnd(24)} | slash: ${CMD_STATS.slash}  msg: ${CMD_STATS.message}  uptime: ${upStr}`);
}
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════
//  AI CHAT SYSTEM (ported from main.py)
//  - Uses config/config.yaml + config/instructions.txt
//  - Persists active channels + ignored users in config/bot_data.db (sqlite)
//  - Triggers on keywords/mentions/replies, with hold-conversation + batching
// ══════════════════════════════════════════════════════════
const AI2_BASE_DIR = path.dirname(path.resolve(process.argv[1] || __filename));
function ai2ResourcePath(rel) {
    return path.join(AI2_BASE_DIR, rel);
}
function ai2LoadConfig() {
    const p = ai2ResourcePath('config/config.yaml');
    if (!fs.existsSync(p)) return null;
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const cfg = yaml.load(raw);
        try {
            const oid = cfg?.bot?.owner_id;
            if (typeof oid === 'number' && (!Number.isSafeInteger(oid) || String(oid).includes('e+'))) {
                const m = raw.match(/^\s*owner_id\s*:\s*([0-9]{15,25})\s*$/m);
                if (m && m[1]) {
                    cfg.bot = cfg.bot || {};
                    cfg.bot.owner_id = m[1];
                }
            }
        } catch {}
        return cfg;
    } catch {
        return null;
    }
}
// ══════════════════════════════════════════════════════════
//  BLOX FRUITS KNOWLEDGE BASE — injected into ALL AI models
//  (Claude / Groq / OpenAI) as their default system prompt
//  when no custom instructions.txt is present.
// ══════════════════════════════════════════════════════════
const BF_KNOWLEDGE_SYSTEM_PROMPT = `You are SKYNET, an expert AI assistant embedded in a Blox Fruits Discord server moderation bot. You have complete knowledge of Blox Fruits (the Roblox game) including all fruits, swords, bosses, items, trading, services, mechanics, and meta.

== FRUITS (Devil Fruits) ==
Common: Rocket, Spin, Chop, Spring, Bomb, Smoke, Spike, Flame, Kilo
Uncommon: Ice, Sand, Dark, Eagle, Diamond
Rare: Light, Rubber, Ghost, Magma, Quake, Buddha (Buda), Love, Creation, Spider, Sound
Legendary: Phoenix, Portal, Rumble, Lightning, Pain, Blizzard, Gravity, Mammoth, T-Rex (TRex), Dough, Shadow, Venom
Mythical: Gas, Spirit, Tiger, Yeti, Kitsune, Control, Dragon, Leopard

Awakened fruits (most valuable in trading): Dragon, Leopard, Kitsune, Control, Dough, Shadow, Venom, Spirit, Yeti, Tiger, Gas, Buddha, Rumble, Phoenix, Portal, Blizzard, Mammoth, T-Rex, Lightning, Pain, Gravity

Permanent fruits (perms) are obtained via Robux gamepass and are highly tradeable. Fruit notifier is a paid gamepass that shows when a fruit spawns.

Pain Fruit Upgrades: Infernal Endurance, Agony Surge, Torment Conductor, Spectral Assimilation
Lightning Fruit Upgrades: Predator Circuit Breaker, Capacitor Overload Test, Conductor's Resonance

Chromatic/Skin variants (rare cosmetics): Chromatic Bomb, Chromatic Diamond, Chromatic Pain, Chromatic Portal, Chromatic Empyrean, Chromatic Eagle, Chromatic Lightning, Chromatic Dragon, Nuclear Bomb Skin, Thermite Bomb Skin, Azura Bomb Skin, Celebration Bomb Skin, Torment Pain Skin, Super Spirit Pain Skin, Frustration Pain Skin, Sadness Pain Skin, Celestial Pain Skin, Green Lightning Skin, Red Lightning Skin, Yellow Lightning Skin, Blue Portal Skin, Divine Portal Skin, Purple Lightning Skin, Eclipse Draco Skin, Ember Dragon Skin, Empyrean Skin, Snow White Aura, Pure Red Aura, Winter Sky Aura, Fiend Yeti Mutation, Werewolf Tiger Mutation

== GAMEPASSES / PERKS ==
Dark Blade (Yoru), 2x Money, 2x Mastery, 2x Boss Drops, Fast Boats, Fruit Notifier, Werewolf
These are purchased with Robux and are tradeable as "perms". Dark Blade / Yoru is one of the most traded items.

== SWORDS ==
Mythical/Legendary (most valuable): Cursed Dual Katana (CDK), Dark Blade (Yoru), Hallow Scythe (HS), True Triple Katana (TTK), Dragonheart, Tushita, Yama, Midnight Blade, Rengoku, Canvander
Rare: Buddy Sword, Bisento, Koko, Fox Lamp, Saddi, Wando, Shisui, Shark Anchor, Spikey Trident, Warden's Sword, Dual-Headed Blade, Gravity Cane
Common: Saber, Pole, Dark Dagger, Jitte, Longsword, Pipe, Soul Cane, Trident, Flail, Iron Mace, Shark Saw, Triple Katana, Twin Hooks, Cutlass, Dual Katana, Katana

== BOSSES (for service/boss kill requests) ==
First Sea: Greybeard, Order, Vice Admiral, Saber Expert, Warden, Chief Warden, Swan, Gorilla King, Bobby, The Saw, Mob Leader
Second Sea: Darkbeard, Jeremy, Fajita, Wysper, Thunder God, Magma Admiral, Fishman Lord, Cyborg, Ice Admiral, Diamond, Don Swan, Smoke Admiral, Awakened Ice Admiral, Kilo Admiral
Third Sea: Tide Keeper, Stone, Island Empress, Captain Elephant, Beautiful Pirate, Longma, Cake Queen, Soul Reaper, Indra, Katakuri, Yeti
Raid Bosses: Cake Prince, Dough King, Tyrant of the Skies, Leviathan, Sea Beast, Unbound Werewolf
Story Items: God's Chalice, Fist of Darkness

== ACCESSORIES ==
Black Cape, Pink Coat, Marine Cap, Swordsman Hat, Tomoe Ring, Top Hat, Vice Admiral Coat, Cool Shades, Black/Blue/Red Spikey Coat, Choppa, Warrior Helmet, Dark Coat, Ghoul Mask, Swan Glasses, Zebra Cap, Heart Shades, Valkyrie Helm, Bandanna, Hunter Cape, Bear Ears, Golden Sunhat, Holy Crown, Lei, Musketeer Hat, Pale Scarf, Pilot Helmet, Pretty Helmet, Jaw Shield, Cupid's Coat, Cupid's Top Hat, Party Hat, 50B Party Hat, Holiday Cloak, Santa Hat, Elf Hat, Peppermint Helmet, Kitsune Mask, Kitsune Ribbon, Leviathan Crown, Leviathan Shield, Terror Jaw, Monster Jaw, Sanguine Cloak, Dino Hood, T-Rex Skull, Coven Witch Hat, Pumpkin Mask, Divine Cloak, Celestial Helmet, Oni Helmet, Uzoth's Cloak, Dojo Belt, Headband

== FIGHTING STYLES ==
Combat, Dark Step, Electric, Water Kung Fu, Dragon Breath, Superhuman (SH), Sharkman Karate (SMK), Electric Claw (EC), Dragon Talon (DT), Sanguine Art (SA)
Awakened versions of fighting styles are highly valuable for services/trades.

== GUNS ==
Slingshot, Flintlock, Musket, Refined Slingshot, Refined Flintlock, Refined Musket, Dual Flintlock, Cannon, Acidum Rifle, Bazooka, Kabucha, Serpent Bow, Bizarre Rifle, Soul Guitar

== ENCHANTS (sword enchantments) ==
Sharpness, Hardening, Precision, Vampiric, Elemental, Haste, Critical, Curse, Masterpiece, Rage, Sharpshooter, Strong Grip, Unreal, Sea Blessing, Agile, Deadly, Piercing, Siphon, Lucky, Fortune, Beast, Cool, Efficient

== HAKI COLORS ==
Soda Orange, Yellow Sunshine, Slimy Green, Lizard Green, Blue Jeans, Plump Purple, Fiery Rose, Heat Wave, Absolute Zero, Snow White, Pure Red, Winter Sky, Rainbow Savior

== RACES ==
Human, Mink, Shark, Ghoul, Angel, Cyborg, Draco
Race V2/V3/V4 upgrades require Trials and are offered as a service. Race Reroll lets you change race.

== SEA EVENTS ==
Sea Beast, Ship Raid, Rumbling Waters, Pirate Raid, Factory Raid, Ghost Ship, Terror Shark, Piranhas, Fishman Commando, Fishman Scout, Electric Recluse, Leviathan, Rough Sea, Mirage Island, Frozen Outpost, Haunted Shipwreck, Prehistoric Island, Kitsune Island

== QUESTS ==
Saber Expert, Alchemist Quest, Arowe Quest, Bartilo's Mission, Citizen's Quest, Hungry Man Quest, Shipwright Quest, Trial of Water, Trial of Speed, Trial of the King, Trial of Carnage
CDK Quest Chain: Pain and Suffering, Haze of Misery, Fear the Reaper, Sense of Duty, The Hunter, Soulless
TTK Quest Chain: Legendary Sword Dealer, buy Wando/Shisui/Saddi (2M Beli each), Mastery 300, Mysterious Man Fusion

== TRADING META & COMMON TERMS ==
WTT = Want to Trade | WTB = Want to Buy | WTS = Want to Sell | W2T = Want to Trade | LF = Looking For
WFL = Win/Fair/Loss (trade value judgement) | MM = Middleman | Perm = Permanent fruit (via Robux)
Stock fruits = fruits that can be obtained in-game for free (low value vs. perms)
Fruit value tiers (approx, meta shifts): Kitsune > Dragon > Leopard > Control > Dough > Venom > Spirit > Shadow > Yeti > Tiger > Gas > Buddha (awk) > etc.
Notifier is often traded since it reveals fruit spawns. Dark Blade/Yoru = extremely common trade item.
Account trading = selling/buying entire Roblox accounts (against ToS, must be redirected to #account-trading or removed per server policy)
Begging = asking for free fruits/items/Robux with no trade offer
Services = helping another player (boss kills, raids, mastery grinding, race V4 trials, CDK/TTK quests, material farming, etc.)

== COMMON ABBREVIATIONS YOU WILL SEE ==
db/dk = dark blade | db = darkbeard (boss) | sb = sea beast | levi = leviathan | cdk = cursed dual katana | ttk = true triple katana | hs = hallow scythe | sh = superhuman | ec = electric claw | dt = dragon talon | sa = sanguine art | bf = blox fruits | rng = rengoku | tush = tushita | ya = yama | perm = permanent | notif/notifier = fruit notifier | gp = gamepass | v4 = race v4 | awk = awakened | 2x = 2x money or mastery gamepass

== SERVER RULES YOU ENFORCE ==
- Trading must happen in the designated trades channel(s)
- Service requests (boss kills, raids, grinding) must go in the services channel
- Bot commands must be used in the games hub / commands channel
- Account trading/selling is strictly prohibited (or goes in a dedicated channel)
- Begging for free items is not allowed
- Scam links and suspicious URLs are auto-deleted
- Spam and duplicate messages are monitored

Always be helpful, concise, and knowledgeable about Blox Fruits when responding to server members. If someone asks about trade values, provide general guidance while noting values fluctuate with updates. If someone asks about how to get a fruit/sword/item, explain the in-game method clearly.`;

// ── General assistant prompt — used by default unless !bloxmode on is set ──
const GENERAL_ASSISTANT_PROMPT = `You are a helpful, knowledgeable AI assistant embedded in a Discord server. Answer questions clearly and accurately on any topic — coding, math, science, general knowledge, casual chat, and more. Be concise, friendly, and helpful. Do not restrict yourself to any specific game or topic unless the user brings one up.`;

function ai2LoadInstructions() {
    const p = ai2ResourcePath('config/instructions.txt');
    if (!fs.existsSync(p)) return GENERAL_ASSISTANT_PROMPT;
    try {
        const txt = fs.readFileSync(p, 'utf8');
        // If the file is empty or whitespace, fall back to general assistant prompt
        return txt.trim() ? txt : GENERAL_ASSISTANT_PROMPT;
    } catch { return GENERAL_ASSISTANT_PROMPT; }
}
function ai2SaveInstructions(text) {
    const p = ai2ResourcePath('config/instructions.txt');
    try { fs.writeFileSync(p, String(text || ''), 'utf8'); } catch {}
}

const ai2Config = ai2LoadConfig();
const ai2State = {
    enabled: !!ai2Config,
    prefix: String(ai2Config?.bot?.prefix || '!'),
    ownerId: String(ai2Config?.bot?.owner_id || ''),
    trigger: String(ai2Config?.bot?.trigger || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
    disableMentions: !!ai2Config?.bot?.disable_mentions,
    allowDm: !!ai2Config?.bot?.allow_dm,
    allowGc: !!ai2Config?.bot?.allow_gc,
    helpEnabled: !!ai2Config?.bot?.help_command_enabled,
    realisticTyping: !!ai2Config?.bot?.realistic_typing,
    antiAgeBan: !!ai2Config?.bot?.anti_age_ban,
    batchMessages: !!ai2Config?.bot?.batch_messages,
    batchWaitTimeSec: Number(ai2Config?.bot?.batch_wait_time || 0) || 0,
    holdConversation: !!ai2Config?.bot?.hold_conversation,
    replyPing: !!ai2Config?.bot?.reply_ping,
    openaiModel: String(ai2Config?.bot?.openai_model || 'gpt-4o-mini'),
    groqModel: String(ai2Config?.bot?.groq_model || 'llama-3.1-70b-versatile'),
    claudeModel: String(ai2Config?.bot?.claude_model || 'claude-haiku-4-5-20251001'),
    errorWebhook: String(ai2Config?.notifications?.error_webhook || ''),
    ratelimitNotifications: !!ai2Config?.notifications?.ratelimit_notifications,
    paused: false,
    activeProvider: 'groq', // 'groq' | 'openai' | 'claude' — configurable via /aimodel
    instructions: ai2LoadInstructions(),
    activeChannels: new Set(),
    ignoredUsers: new Set(),
    activeConversations: new Map(),
    messageHistory: new Map(),
    messageQueues: new Map(),
    processing: new Set(),
    userMessageBatches: new Map(),
    userMessageCounts: new Map(),
    userCooldowns: new Map(),
};

const AI2_DB_PATH = ai2ResourcePath('config/bot_data.db');
let ai2Db = null;
function ai2InitDb() {
    if (!ai2State.enabled) return;
    try {
        const cfgDir = ai2ResourcePath('config');
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
    } catch {}
    try {
        ai2Db = new Database(AI2_DB_PATH);
        ai2Db.exec('CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY)');
        ai2Db.exec('CREATE TABLE IF NOT EXISTS ignored_users (id INTEGER PRIMARY KEY)');
    } catch {
        ai2Db = null;
    }
}
function ai2DbAll(sql, params) {
    try {
        if (!ai2Db) return Promise.resolve([]);
        return Promise.resolve(ai2Db.prepare(sql).all(params || []) || []);
    } catch {
        return Promise.resolve([]);
    }
}
function ai2DbRun(sql, params) {
    try {
        if (!ai2Db) return Promise.resolve(false);
        ai2Db.prepare(sql).run(params || []);
        return Promise.resolve(true);
    } catch {
        return Promise.resolve(false);
    }
}
async function ai2LoadDbState() {
    if (!ai2Db) return;
    const ch = await ai2DbAll('SELECT id FROM channels');
    ai2State.activeChannels = new Set((ch || []).map(r => Number(r.id)).filter(n => Number.isFinite(n)));
    const ig = await ai2DbAll('SELECT id FROM ignored_users');
    ai2State.ignoredUsers = new Set((ig || []).map(r => String(r.id)));
}

let ai2Client = null;
let ai2Model = null;
function ai2InitClient(forceProvider) {
    if (!ai2State.enabled) return;
    const provider = forceProvider || ai2State.activeProvider || 'groq';
    const openaiKey = process.env.OPENAI_API_KEY || '';
    const groqKey   = process.env.GROQ_API_KEY   || '';
    if (provider === 'claude') {
        // Claude uses Anthropic API via fetch — no OpenAI client needed
        if (ANTHROPIC_KEY) {
            ai2Client = null; // flag: use Claude fetch path
            ai2Model  = ai2State.claudeModel;
            ai2State.activeProvider = 'claude';
            return;
        }
        // fallback chain: groq → openai
        if (groqKey) {
            ai2Client = new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' });
            ai2Model  = ai2State.groqModel;
            ai2State.activeProvider = 'groq';
            return;
        }
        if (openaiKey) {
            ai2Client = new OpenAI({ apiKey: openaiKey });
            ai2Model  = ai2State.openaiModel;
            ai2State.activeProvider = 'openai';
            return;
        }
    } else if (provider === 'openai') {
        if (openaiKey) {
            ai2Client = new OpenAI({ apiKey: openaiKey });
            ai2Model  = ai2State.openaiModel;
            ai2State.activeProvider = 'openai';
            return;
        }
        // fallback to groq if no openai key
        if (groqKey) {
            ai2Client = new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' });
            ai2Model  = ai2State.groqModel;
            ai2State.activeProvider = 'groq';
            return;
        }
    } else {
        // default: groq
        if (groqKey) {
            ai2Client = new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' });
            ai2Model  = ai2State.groqModel;
            ai2State.activeProvider = 'groq';
            return;
        }
        if (openaiKey) {
            ai2Client = new OpenAI({ apiKey: openaiKey });
            ai2Model  = ai2State.openaiModel;
            ai2State.activeProvider = 'openai';
            return;
        }
    }
    ai2Client = null;
    ai2Model  = null;
}

async function ai2WebhookLog(message, error) {
    const url = ai2State.errorWebhook;
    if (!url) return;
    if (!ai2State.ratelimitNotifications && !message) return;
    const desc = message
        ? `Message: \`${String(message.content || '').slice(0, 1800)}\`\nError: \`${String(error || '')}\``
        : `Error: \`${String(error || '')}\``;
    const payload = { username: 'AI Selfbot', embeds: [{ title: 'AI Selfbot Error', description: desc, color: 0xED4245, timestamp: new Date().toISOString() }] };
    // PATCH: add timeout so webhook failures never block execution
    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 8000);
        try {
            await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
        } finally {
            clearTimeout(tid);
        }
    } catch {}
}

function ai2SplitResponse(response, maxLen = 1900) {
    const lines = String(response || '').split(/\r?\n/);
    const chunks = [];
    let cur = '';
    for (const line of lines) {
        const nextLen = (cur ? (cur.length + 1) : 0) + line.length;
        if (nextLen > maxLen) {
            if (cur.trim()) chunks.push(cur.trim());
            cur = line;
        } else {
            cur = cur ? `${cur}\n${line}` : line;
        }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
}
function ai2AntiAgeBan(text) {
    return String(text || '').replace(/(?<!\d)([0-9]|1[0-2])(?!\d)|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, '\u200b');
}
function ai2EscapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AI2_CONVERSATION_TIMEOUT_MS = 150000;
const AI2_SPAM_MESSAGE_THRESHOLD = 5;
const AI2_SPAM_TIME_WINDOW_MS = 10000;
const AI2_COOLDOWN_DURATION_MS = 60000;
const AI2_MAX_HISTORY = 15;

class Mutex {
    constructor() {
        this._locked = false;
        this._queue = [];
    }
    locked() { return this._locked; }
    acquire() {
        if (!this._locked) {
            this._locked = true;
            return Promise.resolve();
        }
        return new Promise((resolve) => this._queue.push(resolve));
    }
    release() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            next();
        } else {
            this._locked = false;
        }
    }
    async runExclusive(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

const ai2ProcessingLocks = new Map();

function ai2Sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ai2WaitForMessage(authorId, channelId, timeoutMs) {
    return new Promise((resolve) => {
        const handler = (msg) => {
            try {
                if (!msg || !msg.author || !msg.channel) return;
                if (String(msg.author.id) !== String(authorId)) return;
                if (String(msg.channel.id) !== String(channelId)) return;
                if (String(msg.content || '').startsWith(ai2State.prefix)) return;
                clearTimeout(timer);
                client.off('messageCreate', handler);
                resolve(msg);
            } catch {}
        };
        const timer = setTimeout(() => {
            client.off('messageCreate', handler);
            resolve(null);
        }, Math.max(0, timeoutMs || 0));
        client.on('messageCreate', handler);
    });
}

function ai2ShouldIgnoreMessage(message) {
    return message.author?.bot || ai2State.ignoredUsers.has(String(message.author.id));
}
function ai2IsTriggerMessage(message) {
    const content = String(message.content || '');
    const lc = content.toLowerCase();
    const mentioned = !!(client.user && message.mentions?.users?.has(client.user.id)) && !lc.includes('@everyone') && !lc.includes('@here');
    const repliedTo = !!(message.reference?.messageId && message.mentions?.repliedUser?.id === client.user?.id);
    const isDm = message.channel?.type === ChannelType.DM && ai2State.allowDm;
    const isGc = message.channel?.type === ChannelType.GroupDM && ai2State.allowGc;
    const convKey = `${message.author.id}-${message.channel.id}`;
    const last = ai2State.activeConversations.get(convKey) || 0;
    const inConversation = ai2State.holdConversation && (Date.now() - last) < AI2_CONVERSATION_TIMEOUT_MS;
    const contentHasTrigger = ai2State.trigger.some(k => k && new RegExp(`\\b${ai2EscapeRegex(k)}\\b`, 'i').test(lc));
    if (contentHasTrigger || mentioned || repliedTo || isDm || isGc || inConversation) {
        ai2State.activeConversations.set(convKey, Date.now());
    }
    return contentHasTrigger || mentioned || repliedTo || isDm || isGc || inConversation;
}

// ── Claude (Anthropic) chat generation — uses fetch since Claude has its own API format ──
async function ai2GenerateResponseClaude(prompt, instructions, history) {
    if (!ANTHROPIC_KEY) return "Sorry, ANTHROPIC_API_KEY is not set.";
    // PATCH: AbortController with 30s timeout to prevent hanging forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
        const messages = [];
        if (history && Array.isArray(history)) {
            for (const h of history) {
                if ((h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
                    messages.push(h);
            }
        }
        messages.push({ role: 'user', content: String(prompt || '') });
        const body = {
            model: ai2State.claudeModel,
            max_tokens: 1024,
            system: String(instructions || ''),
            messages,
        };
        const res = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': ANTHROPIC_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
            // PATCH: handle 429 rate-limit gracefully
            if (res.status === 429) {
                console.warn('[AI/Claude] Rate limited (429). Will retry on next request.');
                return "Sorry, I'm rate-limited right now. Please try again in a moment.";
            }
            throw new Error(data?.error?.message || `HTTP ${res.status}`);
        }
        return String(data?.content?.[0]?.text || "Sorry, I couldn't generate a response.");
    } catch (e) {
        if (e?.name === 'AbortError') {
            console.warn('[AI/Claude] Request timed out after 30s.');
            return "Sorry, the AI took too long to respond. Please try again.";
        }
        await ai2WebhookLog(null, e);
        return "Sorry, I couldn't generate a response.";
    } finally {
        clearTimeout(timeoutId);
    }
}

async function ai2GenerateResponse(prompt, instructions, history) {
    ai2InitClient();
    // Claude uses its own API format — delegate to dedicated function
    if (ai2State.activeProvider === 'claude') {
        return await ai2GenerateResponseClaude(prompt, instructions, history);
    }
    if (!ai2Client || !ai2Model) return "Sorry, I couldn't generate a response.";
    try {
        const msgs = [{ role: 'system', content: String(instructions || '') }];
        if (history && Array.isArray(history)) {
            for (const h of history) {
                if (!h) continue;
                if ((h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') msgs.push(h);
            }
        }
        msgs.push({ role: 'user', content: String(prompt || '') });
        // PATCH: race against a 30s timeout so we never hang on slow providers
        const completionPromise = ai2Client.chat.completions.create({ model: ai2Model, messages: msgs });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 30000));
        const r = await Promise.race([completionPromise, timeoutPromise]);
        return String(r?.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.");
    } catch (e) {
        if (e?.message === 'AI_TIMEOUT') {
            console.warn('[AI/OpenAI-Groq] Request timed out after 30s.');
            return "Sorry, the AI took too long to respond. Please try again.";
        }
        // PATCH: handle 429 rate-limits gracefully
        const status = e?.status || e?.response?.status;
        if (status === 429) {
            console.warn('[AI/OpenAI-Groq] Rate limited (429).');
            return "Sorry, I'm rate-limited right now. Please try again in a moment.";
        }
        await ai2WebhookLog(null, e);
        return "Sorry, I couldn't generate a response.";
    }
}

async function ai2GenerateAndReply(message, prompt, history) {
    const response = await ai2GenerateResponse(prompt, ai2State.instructions, history);
    let chunks = ai2SplitResponse(response);
    if (chunks.length > 3) chunks = chunks.slice(0, 3);
    for (const chunk0 of chunks) {
        let chunk = chunk0;
        if (ai2State.disableMentions) chunk = chunk.replace(/@/g, '@\u200b');
        if (ai2State.antiAgeBan) chunk = ai2AntiAgeBan(chunk);
        try {
            if (ai2State.realisticTyping) {
                await new Promise(r => setTimeout(r, 1000 * (10 + Math.floor(Math.random() * 21))));
                await message.channel.sendTyping().catch(()=>{});
                const cps = 5 + Math.random();
                await new Promise(r => setTimeout(r, Math.max(400, Math.floor((chunk.length / cps) * 1000))));
            }
            if (message.channel?.type === ChannelType.DM) {
                await message.channel.send(chunk).catch(()=>{});
            } else {
                await message.reply({ content: chunk, allowedMentions: { repliedUser: !!ai2State.replyPing } }).catch(()=>{});
            }
            const convKey = `${message.author.id}-${message.channel.id}`;
            ai2State.activeConversations.set(convKey, Date.now());
        } catch (e) {
            await ai2WebhookLog(message, e);
        }
    }

    if (ai2State.holdConversation && ai2State.batchWaitTimeSec > 0) {
        const channelId = String(message.channel.id);
        const authorId = String(message.author.id);
        const start = Date.now();
        while ((Date.now() - start) < (ai2State.batchWaitTimeSec * 1000)) {
            const remainingMs = (ai2State.batchWaitTimeSec * 1000) - (Date.now() - start);
            if (remainingMs <= 0) break;
            const followUp = await ai2WaitForMessage(authorId, channelId, remainingMs);
            if (!followUp) break;
            const q = ai2State.messageQueues.get(channelId) || [];
            q.push(followUp);
            ai2State.messageQueues.set(channelId, q);
        }
        if ((ai2State.messageQueues.get(String(message.channel.id)) || []).length) {
            ai2ProcessQueue(String(message.channel.id));
        }
    }
    return response;
}

async function ai2ProcessQueue(channelId) {
    const cid = String(channelId);
    if (!ai2ProcessingLocks.has(cid)) ai2ProcessingLocks.set(cid, new Mutex());
    const lock = ai2ProcessingLocks.get(cid);
    if (!lock) return;
    await lock.runExclusive(async () => {
        const q = ai2State.messageQueues.get(cid) || [];
        while (q.length) {
            const msg = q.shift();
            // Re-validate: if the channel was removed from active channels while
            // this message was waiting in the queue, skip it silently.
            const qChId = String(msg.channel?.id || '');
            const qStillActive = ai2State.activeChannels.has(Number(qChId)) || msg.channel?.type === ChannelType.DM;
            if (!qStillActive) continue;
            const key = `${msg.author.id}-${msg.channel.id}`;
            const hist = ai2State.messageHistory.get(key) || [];
            const prompt = String(msg._ai2CombinedContent || msg.content || '');
            // Guard: silently drop oversized prompts (including batched messages
            // that individually passed the 250-char check but exceeded it when combined).
            if (prompt.trim().length > 250) continue;
            hist.push({ role: 'user', content: prompt });
            while (hist.length > AI2_MAX_HISTORY) hist.shift();
            ai2State.messageHistory.set(key, hist);
            const resp = await ai2GenerateAndReply(msg, prompt, hist.slice(0, -1));
            hist.push({ role: 'assistant', content: String(resp || '') });
            while (hist.length > AI2_MAX_HISTORY) hist.shift();
            ai2State.messageHistory.set(key, hist);
            if (ai2State.batchMessages && ai2State.batchWaitTimeSec > 0) {
                await ai2Sleep(Math.max(0, Math.floor(ai2State.batchWaitTimeSec * 1000)));
            }
        }
        ai2State.messageQueues.set(cid, q);
    });
}

async function ai2HandleChatMessage(message) {
    if (!ai2State.enabled || ai2State.paused) return false;
    if (ai2ShouldIgnoreMessage(message) && String(message.author.id) !== String(ai2State.ownerId)) return false;
    if (!message.content || String(message.content).startsWith(ai2State.prefix)) return false;
    if (!ai2IsTriggerMessage(message)) return false;

    const userId = String(message.author.id);
    const now = Date.now();
    const cdEnd = ai2State.userCooldowns.get(userId) || 0;
    if (now < cdEnd) return true;
    const arr = ai2State.userMessageCounts.get(userId) || [];
    const filtered = arr.filter(t => now - t < AI2_SPAM_TIME_WINDOW_MS);
    filtered.push(now);
    ai2State.userMessageCounts.set(userId, filtered);
    if (filtered.length > AI2_SPAM_MESSAGE_THRESHOLD) {
        ai2State.userCooldowns.set(userId, now + AI2_COOLDOWN_DURATION_MS);
        ai2State.userMessageCounts.set(userId, []);
        return true;
    }

    const channelId = String(message.channel.id);
    const isActive = ai2State.activeChannels.has(Number(channelId)) || message.channel?.type === ChannelType.DM;
    if (!isActive) return false;

    // Silently drop messages that exceed the 250-char limit so the AI never
    // generates the "User input is too long" error reply.
    if (String(message.content || '').trim().length > 250) return true;

    if (ai2State.batchMessages) {
        const batchKey = `${userId}-${channelId}`;
        const batch = ai2State.userMessageBatches.get(batchKey) || { messages: [], start: now };
        batch.messages.push(message);
        ai2State.userMessageBatches.set(batchKey, batch);
        if (batch.messages.length === 1) {
            setTimeout(() => {
                const b = ai2State.userMessageBatches.get(batchKey);
                ai2State.userMessageBatches.delete(batchKey);
                if (!b || !b.messages.length) return;
                const seen = new Set();
                const uniq = [];
                for (const m of b.messages) {
                    const c = String(m.content || '');
                    if (!seen.has(c)) { seen.add(c); uniq.push(m); }
                }
                const combined = uniq.map(m => String(m.content || '')).join('\n');
                const replyTo = uniq[uniq.length - 1];
                replyTo._ai2CombinedContent = combined;
                const q = ai2State.messageQueues.get(channelId) || [];
                q.push(replyTo);
                ai2State.messageQueues.set(channelId, q);
                ai2ProcessQueue(channelId);
            }, Math.max(0, Math.floor(ai2State.batchWaitTimeSec * 1000)));
        }
        return true;
    }

    const q = ai2State.messageQueues.get(channelId) || [];
    q.push(message);
    ai2State.messageQueues.set(channelId, q);
    ai2ProcessQueue(channelId);
    return true;
}

// ══════════════════════════════════════════════════════════
//  CENTRALIZED SAFE INTERACTION HELPERS (module-level)
//  Prevents InteractionAlreadyReplied, Unknown Interaction,
//  expired interaction edits, double replies, and race conditions.
// ══════════════════════════════════════════════════════════
function isInteractionExpired(interaction) {
    // Discord interactions expire after 15 minutes; tokens expire after 3s without deferral.
    // We use a conservative 14-minute check.
    try {
        const created = interaction?.createdTimestamp || Date.now();
        return (Date.now() - created) > 14 * 60 * 1000;
    } catch { return false; }
}

async function safeDefer(interaction, opts = {}) {
    try {
        if (interaction.deferred || interaction.replied) return true;
        if (isInteractionExpired(interaction)) return false;
        await interaction.deferReply(opts);
        return true;
    } catch (e) {
        if (!String(e?.message || '').includes('Unknown Interaction'))
            console.warn('[safeDefer] error:', e?.message || e);
        return false;
    }
}

async function safeReply(interaction, payload) {
    try {
        if (isInteractionExpired(interaction)) return false;
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload);
            return true;
        }
        await interaction.reply(payload);
        return true;
    } catch (e) {
        const msg = String(e?.message || '');
        if (!msg.includes('Unknown Interaction') && !msg.includes('already been acknowledged'))
            console.warn('[safeReply] error:', msg);
        return false;
    }
}

async function safeEditReply(interaction, payload) {
    try {
        if (isInteractionExpired(interaction)) return false;
        await interaction.editReply(payload);
        return true;
    } catch (e) {
        const msg = String(e?.message || '');
        if (!msg.includes('Unknown Interaction') && !msg.includes('Invalid Webhook Token'))
            console.warn('[safeEditReply] error:', msg);
        return false;
    }
}

// Legacy alias used throughout the file
const safeEdit = safeEditReply;

async function safeFollowUp(interaction, payload) {
    try {
        if (isInteractionExpired(interaction)) return false;
        await interaction.followUp(payload);
        return true;
    } catch (e) {
        const msg = String(e?.message || '');
        if (!msg.includes('Unknown Interaction') && !msg.includes('Invalid Webhook Token'))
            console.warn('[safeFollowUp] error:', msg);
        return false;
    }
}

// Wraps an entire slash-command execution with a timeout fallback
async function withCommandTimeout(interaction, fn, timeoutMs = 25000) {
    const timer = setTimeout(async () => {
        try { await safeFollowUp(interaction, { content: '⏳ This command is taking longer than expected. Please try again.', flags: MessageFlags.Ephemeral }); } catch {}
    }, timeoutMs);
    try {
        return await fn();
    } catch (e) {
        console.error('[commandTimeout] uncaught error in command handler:', e);
        try { await safeReply(interaction, { content: '❌ An error occurred while running this command.', flags: MessageFlags.Ephemeral }); } catch {}
    } finally {
        clearTimeout(timer);
    }
}
// ══════════════════════════════════════════════════════════

class PyWorker {
    constructor() {
        this.proc = null;
        this.pending = new Map();
        this.nextId = 1;
        this.buf = '';
    }

    start() {
        if (this.proc) return;
        const workerCode = `
import sys, os, json
sys.set_int_max_str_digits(0)

# ── Isolated mpmath 1.4.1 from _vendor_mpmath/mpmath14 ───────────────────────
# Sympy requires mpmath<1.4 so it stays on 1.3.0 in the venv.
# We load 1.4.1 from the vendor directory into MPMATH so the rest of the bot
# (gaypy / mpmath_eval) always gets the newer version.
_VENDOR_MPMATH_DIR = os.path.join(r'${__dirname}', '_vendor_mpmath')
if os.path.isdir(_VENDOR_MPMATH_DIR) and _VENDOR_MPMATH_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_MPMATH_DIR)
try:
    import mpmath14 as mpmath          # 1.4.1 — folder renamed from mpmath → mpmath14
    MPMATH_OK  = True
    MPMATH_VER = getattr(mpmath, '__version__', '?')
except Exception:
    try:
        import mpmath                  # fallback: whatever is in the venv
        MPMATH_OK  = True
        MPMATH_VER = getattr(mpmath, '__version__', '?')
    except Exception:
        MPMATH_OK  = False
        MPMATH_VER = 'unavailable'
        mpmath     = None
# ─────────────────────────────────────────────────────────────────────────────

try:
    import sympy
    SYMPY_OK = True
except Exception:
    SYMPY_OK = False

try:
    from roastedbyai import Conversation, Style
    ROAST_OK = True
except Exception:
    ROAST_OK = False

_convos = {}

def _reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\\n")
    sys.stdout.flush()

for line in sys.stdin:
    line=line.strip()
    if not line:
        continue
    try:
        req=json.loads(line)
        rid=req.get('id')
        method=req.get('method')
        params=req.get('params') or {}

        if method=='ping':
            _reply({'id': rid, 'ok': True, 'result': {'sympy': SYMPY_OK, 'roast': ROAST_OK, 'mpmath': MPMATH_OK, 'mpmath_ver': MPMATH_VER}})
            continue

        if method=='mpmath_eval':
            if not MPMATH_OK or mpmath is None:
                _reply({'id': rid, 'ok': False, 'error': 'mpmath not available in python env'})
                continue
            expr = str(params.get('expression', ''))
            prec = max(1, int(params.get('precision', 50)))  # unlimited — mpmath supports arbitrary precision
            try:
                mp = mpmath.mp.clone()
                mp.dps = prec
                ns  = {'mpmath': mpmath, 'mp': mp, '__builtins__': {}}
                r   = eval(expr, ns)
                _reply({'id': rid, 'ok': True, 'result': str(r), 'mpmath_ver': MPMATH_VER})
            except Exception as ex:
                _reply({'id': rid, 'ok': True, 'result': f"mpmath Error: {ex}", 'mpmath_ver': MPMATH_VER})
            continue

        if method=='sympy_eval':
            if not SYMPY_OK:
                _reply({'id': rid, 'ok': False, 'error': 'sympy not available in python env'})
                continue
            expr=str(params.get('expression',''))
            try:
                e=sympy.sympify(expr)
                r=sympy.simplify(e)
                _reply({'id': rid, 'ok': True, 'result': str(r)})
            except Exception as ex:
                _reply({'id': rid, 'ok': True, 'result': f"SymPy Error: {ex}"})
            continue

        if method=='python_exec':
            import io, traceback as _tb
            code=str(params.get('code',''))
            buf=io.StringIO()
            globs={'__builtins__': __builtins__}
            if MPMATH_OK and mpmath is not None:
                globs['mpmath'] = mpmath   # 1.4.1 from _vendor_mpmath
            locs={}
            def _print(*args, **kwargs):
                sep=kwargs.get('sep',' ')
                end=kwargs.get('end','\\n')
                buf.write(sep.join(str(a) for a in args)+end)
            globs['print']=_print
            locs['print']=_print
            try:
                exec(compile(code,'<gaypy>','exec'),globs,locs)
                out=buf.getvalue()
                if not out.strip() and 'result' in locs:
                    out=str(locs['result'])
                _reply({'id': rid, 'ok': True, 'result': out or '(No output)'})
            except Exception as ex:
                _reply({'id': rid, 'ok': True, 'result': f"Error:\\n{_tb.format_exc()}"})
            continue

        if method=='roast_start':
            if not ROAST_OK:
                _reply({'id': rid, 'ok': False, 'error': 'roastedbyai not available in python env'})
                continue
            style=params.get('style') or None
            st = getattr(Style, style, None) if style else Style.default
            convo=Conversation(st)
            cid=str(params.get('convoId') or rid)
            _convos[cid]=convo
            _reply({'id': rid, 'ok': True, 'result': {'convoId': cid}})
            continue

        if method=='roast_send':
            if not ROAST_OK:
                _reply({'id': rid, 'ok': False, 'error': 'roastedbyai not available in python env'})
                continue
            cid=str(params.get('convoId') or '')
            msg=str(params.get('message') or '')
            convo=_convos.get(cid)
            if not convo:
                _reply({'id': rid, 'ok': False, 'error': 'unknown convoId'})
                continue
            try:
                resp=convo.send(msg)
                _reply({'id': rid, 'ok': True, 'result': resp})
            except Exception as ex:
                _reply({'id': rid, 'ok': False, 'error': str(ex)})
            continue

        if method=='roast_kill':
            cid=str(params.get('convoId') or '')
            if cid and cid in _convos:
                try:
                    del _convos[cid]
                except Exception:
                    pass
            _reply({'id': rid, 'ok': True, 'result': True})
            continue

        _reply({'id': rid, 'ok': False, 'error': 'unknown method'})
    except Exception as ex:
        _reply({'id': locals().get('rid', None), 'ok': False, 'error': str(ex)})
`;
        const venvPy = process.env.PYTHON_BIN
            || path.join(__dirname, '.venv', 'bin', 'python');
        const pythonExe = (venvPy && fs.existsSync(venvPy)) ? venvPy : 'python3';
        this.proc = spawn(pythonExe, ['-u', '-c', workerCode], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.proc.stdout.on('data', (d) => this._onData(d));
        // PATCH: log stderr instead of silently dropping it
        this.proc.stderr.on('data', (d) => {
            const msg = d.toString('utf8').trim();
            if (msg) console.error(`[PyWorker/stderr] ${msg}`);
        });
        this.proc.on('exit', (code) => {
            console.warn(`[PyWorker] process exited (code=${code}); rejecting ${this.pending.size} pending request(s)`);
            this.proc = null;
            for (const [, p] of this.pending) {
                try { p.reject(new Error('PyWorker exited')); } catch {}
            }
            this.pending.clear();
            // PATCH: auto-restart after a short delay so math commands recover
            setTimeout(() => {
                try { this.start(); } catch (e) {
                    console.error('[PyWorker] auto-restart failed:', e);
                }
            }, 2000);
        });
        this.proc.on('error', (e) => {
            console.error('[PyWorker] spawn error:', e);
            this.proc = null;
            for (const [, p] of this.pending) {
                try { p.reject(e); } catch {}
            }
            this.pending.clear();
        });
    }

    _onData(d) {
        this.buf += d.toString('utf8');
        let idx;
        while ((idx = this.buf.indexOf('\n')) !== -1) {
            const line = this.buf.slice(0, idx).trim();
            this.buf = this.buf.slice(idx + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            const id = msg.id;
            const pending = this.pending.get(id);
            if (!pending) continue;
            this.pending.delete(id);
            // PATCH: clear the per-request timeout timer before resolving/rejecting
            if (pending.timer) clearTimeout(pending.timer);
            if (msg.ok) pending.resolve(msg.result);
            else pending.reject(new Error(String(msg.error || 'PyWorker error')));
        }
    }

    // PATCH: added timeoutMs param (default 60 s). Requests that exceed the
    // timeout are rejected and the worker is killed + auto-restarted so no
    // future command ever hangs permanently.
    request(method, params, timeoutMs = 60000) {
        this.start();
        const id = this.nextId++;
        const payload = { id, method, params: params || {} };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!this.pending.has(id)) return;
                this.pending.delete(id);
                console.error(`[PyWorker] request "${method}" id=${id} timed out after ${timeoutMs}ms — killing worker`);
                reject(new Error(`PyWorker request "${method}" timed out`));
                // Kill the hung process — the exit handler will auto-restart it
                try { if (this.proc) { this.proc.kill('SIGKILL'); } } catch {}
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.proc.stdin.write(JSON.stringify(payload) + '\n');
            } catch (e) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(e);
            }
        });
    }
}

const pyWorker = new PyWorker();
pyWorker.start();

function chunkCodeBlock(text) {
    const wrapStart = '```\n';
    const wrapEnd = '\n```';
    const maxChunk = 2000 - wrapStart.length - wrapEnd.length;
    const s = String(text || '(No output)');
    const out = [];
    for (let i = 0; i < s.length; i += maxChunk) {
        out.push(wrapStart + s.slice(i, i + maxChunk) + wrapEnd);
    }
    return out.length ? out : [wrapStart + '(No output)' + wrapEnd];
}

async function sendLongToMessage(channel, text) {
    for (const c of chunkCodeBlock(text)) {
        await channel.send(c).catch(()=>{});
    }
}

async function sendLongToInteraction(interaction, text) {
    const chunks = chunkCodeBlock(text);
    const first = chunks.shift();
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: first });
        } else {
            await interaction.reply({ content: first });
        }
    } catch {
        try { await interaction.followUp({ content: first }); } catch {}
    }
    for (const c of chunks) {
        try { await interaction.followUp({ content: c }); } catch {}
    }
}

async function superqalcOnefile(expression) {
    return new Promise((resolve) => {
        const p = spawn('./superqalc_onefile', [String(expression || '')], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d.toString('utf8')));
        p.stderr.on('data', (d) => (err += d.toString('utf8')));
        p.on('close', (code) => {
            if (code === 0) return resolve(out.trim() || '(No output)');
            resolve((err || out || 'Error running superqalc_onefile.').trim());
        });
        p.on('error', (e) => resolve(`Error: ${e.message}`));
    });
}

async function superqalcTower(expression) {
    return new Promise((resolve) => {
        const p = spawn('./superqalc_tower', [], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d.toString('utf8')));
        p.stderr.on('data', (d) => (err += d.toString('utf8')));
        p.on('close', (code) => {
            if (code === 0) return resolve(out.trim() || '(No output)');
            resolve((err || out || 'Error running superqalc_tower.').trim());
        });
        p.on('error', (e) => resolve(`Error: ${e.message}`));
        try { p.stdin.write(String(expression || '')); } catch {}
        try { p.stdin.end(); } catch {}
    });
}

const WOLFRAM_APPID = process.env.WOLFRAM_APPID || '';
const QALCULATE_PATH = process.env.QALCULATE_PATH || path.join(__dirname, 'math_modules', 'qalc');

async function qalcEval(expression) {
    return new Promise((resolve) => {
        const p = spawn(QALCULATE_PATH, ['-e', String(expression || '')], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        p.stdout.on('data', (d) => (out += d.toString('utf8')));
        p.stderr.on('data', (d) => (err += d.toString('utf8')));
        p.on('close', () => resolve((out.trim() || err.trim() || '(No output)')));
        p.on('error', (e) => resolve(`Error running qalc: ${e.message}`));
    });
}

async function wolframQuery(input) {
    if (!WOLFRAM_APPID) return 'Error: WOLFRAM_APPID is not set in .env';
    try {
        const url = new URL('http://api.wolframalpha.com/v2/query');
        url.searchParams.set('input', String(input || ''));
        url.searchParams.set('appid', WOLFRAM_APPID);
        url.searchParams.set('output', 'JSON');
        const res = await fetch(url.toString());
        const data = await res.json();
        const pods = data?.queryresult?.pods || [];
        for (const pod of pods) {
            const t = String(pod?.title || '').toLowerCase();
            if (['result', 'solution', 'exact result', 'definite integral'].includes(t)) {
                return String(pod?.subpods?.[0]?.plaintext || 'No answer found.');
            }
        }
        if (pods.length) return String(pods?.[0]?.subpods?.[0]?.plaintext || 'No answer found.');
        return 'No answer found.';
    } catch (e) {
        return `Error contacting Wolfram Alpha: ${e.message}`;
    }
}

const AI_MAX_REQ_PER_MIN = 18;
const AI_QUEUE_CONCURRENCY = 1;

function formatDuration(ms) {
    ms = Math.max(0, Number(ms) || 0);
    const s = Math.floor(ms / 1000);
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    parts.push(`${hrs}h`);
    parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

// ── Flexible duration parser → returns minutes ──────────────────────────────
// Supports: 30s / 30sec / 30secs / 30second / 30seconds
//           10m / 10min / 10mins / 10minute / 10minutes (default unit)
//           2h  / 2hr  / 2hrs  / 2hour  / 2hours
//           1d  / 1day / 1days / 1week / 1w
//           Plain integers are treated as minutes (backwards-compatible).
// Returns null if unparseable.
function parseDuration(str) {
    if (str == null) return null;
    const s = String(str).trim().toLowerCase();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)?$/);
    if (!m) return null;
    const val = parseFloat(m[1]);
    if (!isFinite(val) || val <= 0) return null;
    const unit = m[2] || 'm';
    switch (unit) {
        case 's': case 'sec': case 'secs': case 'second': case 'seconds':
            return Math.max(1, Math.round(val / 60));
        case 'm': case 'min': case 'mins': case 'minute': case 'minutes':
            return Math.max(1, Math.round(val));
        case 'h': case 'hr': case 'hrs': case 'hour': case 'hours':
            return Math.max(1, Math.round(val * 60));
        case 'd': case 'day': case 'days':
            return Math.max(1, Math.round(val * 1440));
        case 'w': case 'week': case 'weeks':
            return Math.max(1, Math.round(val * 10080));
        default:
            return Math.max(1, Math.round(val));
    }
}
// ─────────────────────────────────────────────────────────────────────────────

const _aiQueues = new Map();
function getAiQueue(guildId) {
    const k = String(guildId || 'global');
    const e = _aiQueues.get(k) || { chain: Promise.resolve(), inFlight: 0, times: [] };
    _aiQueues.set(k, e);
    return e;
}
function aiRateLimitOk(guildId) {
    const e = getAiQueue(guildId);
    const now = Date.now();
    e.times = e.times.filter(t => now - t < 60000);
    _aiQueues.set(String(guildId || 'global'), e);
    return e.times.length < AI_MAX_REQ_PER_MIN;
}
async function withAiQueue(guildId, fn) {
    const e = getAiQueue(guildId);
    const run = async () => {
        while (e.inFlight >= AI_QUEUE_CONCURRENCY) {
            await new Promise(r => setTimeout(r, 120));
        }
        e.inFlight++;
        try {
            e.times.push(Date.now());
            return await fn();
        } finally {
            e.inFlight--;
        }
    };
    e.chain = e.chain.then(run, run);
    _aiQueues.set(String(guildId || 'global'), e);
    return e.chain;
}

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function buildCommandListEmbeds(title, items, gs) {
    const lines = (items || []).map(x => `• **${x.name}** — ${x.desc}`);
    const chunks = chunkArray(lines, 20);
    const embeds = chunks.map((c, idx) => {
        const e = new EmbedBuilder()
            .setTitle(chunks.length > 1 ? `${title} (${idx + 1}/${chunks.length})` : title)
            .setColor(0x5865F2)
            .setDescription(c.join('\n') || 'None')
            .setTimestamp();
        const ft = footerText(gs);
        if (ft) e.setFooter({ text: ft });
        return e;
    });
    return embeds.length ? embeds : [new EmbedBuilder().setTitle(title).setColor(0x5865F2).setDescription('None').setTimestamp()];
}

const MESSAGE_COMMANDS_LIST = [
    { name: '!botinfo', desc: 'Show bot ownership / credits.' },
    { name: '!botstatus', desc: 'Show current server configuration (admin).'},
    { name: '!uptime', desc: 'Show bot uptime information.' },
    { name: '!messagecommandslist', desc: 'List all message commands.' },
    { name: '!slashcommandslist', desc: 'List all slash commands.' },
    { name: '!diagnose', desc: 'Run a diagnostic check of bot permissions/config (admin).'},
    { name: '!config', desc: 'Config export/import/backup/restore (admin).'},
    { name: '!case', desc: 'Case system: view/list/note/void (mods/admin).'},
    { name: '!policypreset', desc: 'Apply a policy preset strict|balanced|soft|monitor (admin).'},
    { name: '!dashboard', desc: 'Open the admin dashboard (admin).'},
    { name: '!appeal', desc: 'Appeal system: submit (users), review via buttons (mods/admin).'},
    { name: '!policymode', desc: 'Set policy mode enforce/monitor (admin).'},
    { name: '!policyset', desc: 'Set per-category policy action (admin).'},
    { name: '!policystatus', desc: 'Show policy configuration (admin).'},
    { name: '!setowner', desc: 'Set bot owner shown in botinfo (admin).'},
    { name: '!clearowner', desc: 'Clear bot owner shown in botinfo (admin).'},
    { name: '!setfooter', desc: 'Set embed footer text (admin).'},
    { name: '!clearfooter', desc: 'Clear embed footer text (admin).'},
    { name: '!botinfopublic', desc: 'Set whether /botinfo is public or ephemeral (admin).'},
    { name: '!linkmode', desc: 'Set link intelligence mode strict/medium/off (admin).'},
    { name: '!linkaction', desc: 'Set action for scam/link detections (admin).'},
    { name: '!verifygate', desc: 'Enable/disable & config verify gate (admin).'},
    { name: '!timeoutconfig', desc: 'Enable/disable & set timeout minutes (admin).'},
    // ── Math & Calculation ──────────────────────────────────────────────────
    { name: '!calc', desc: 'Calc CLI expression evaluator (multi-line: keep sending; type Evaluate to run).' },
    { name: '!wolf', desc: 'Online math / science query (multi-line supported).' },
    { name: '!supercalc', desc: 'Run superqalc_onefile expression engine (multi-line supported).' },
    { name: '!supertower', desc: 'Run superqalc_tower expression engine (multi-line supported).' },
    { name: '!gaypy', desc: 'Execute Python code — mpmath 1.4.1 pre-imported as `mpmath`, sympy available (multi-line supported).' },
];

const SLASH_COMMANDS_LIST = [
    { name: '/botinfo', desc: 'Show bot ownership / credits.' },
    { name: '/botstatus', desc: 'Show current server configuration (admin).'},
    { name: '/uptime', desc: 'Show bot uptime information.' },
    { name: '/messagecommandslist', desc: 'List all message commands.' },
    { name: '/slashcommandslist', desc: 'List all slash commands.' },
    { name: '/diagnose', desc: 'Run a diagnostic check of bot permissions/config (admin).'},
    { name: '/config', desc: 'Config export/import/backup/restore (admin).'},
    { name: '/case', desc: 'Case system: view/list/note/void (mods/admin).'},
    { name: '/policypreset', desc: 'Apply a policy preset strict|balanced|soft|monitor (admin).'},
    { name: '/dashboard', desc: 'Open the admin dashboard (admin).'},
    { name: '/appeal', desc: 'Submit an appeal (users) or review (mods/admin).'},
    { name: '/policymode', desc: 'Set policy mode enforce/monitor (admin).'},
    { name: '/policyset', desc: 'Set per-category policy action (admin).'},
    { name: '/policystatus', desc: 'Show policy configuration (admin).'},
    { name: '/setowner', desc: 'Set bot owner shown in botinfo (admin).'},
    { name: '/clearowner', desc: 'Clear bot owner shown in botinfo (admin).'},
    { name: '/setfooter', desc: 'Set embed footer text (admin).'},
    { name: '/clearfooter', desc: 'Clear embed footer text (admin).'},
    { name: '/botinfopublic', desc: 'Set whether /botinfo is public or ephemeral (admin).'},
    { name: '/linkmode', desc: 'Set link intelligence mode strict/medium/off (admin).'},
    { name: '/linkaction', desc: 'Set action for scam/link detections (admin).'},
    { name: '/verifygate', desc: 'Enable/disable & config verify gate (admin).'},
    { name: '/timeoutconfig', desc: 'Enable/disable & set timeout minutes (admin).'},
    // ── Math & Calculation ──────────────────────────────────────────────────
    { name: '/calc', desc: 'Calc CLI expression evaluator (multi-line: keep sending; type Evaluate to run).' },
    { name: '/wolf', desc: 'Online math / science query (multi-line supported).' },
    { name: '/supercalc', desc: 'Run superqalc_onefile expression engine (multi-line supported).' },
    { name: '/supertower', desc: 'Run superqalc_tower expression engine (multi-line supported).' },
    { name: '/gaypy', desc: 'Execute Python code — mpmath 1.4.1 pre-imported as `mpmath`, sympy available (multi-line supported).' },
    { name: '/mpmath', desc: 'Evaluate an mpmath 1.4.1 expression with arbitrary precision (unlimited dps). e.g. mpmath.sqrt(2) with precision=100.' },
];

function getCategoryPolicy(gs, category) {
    const cat = String(category || '').toLowerCase();
    const raw = gs?.categoryPolicies?.[cat];
    const policy = (raw && typeof raw === 'object') ? raw : {};
    let action = String(policy.action || '').toLowerCase();
    if (!action) {
        if (cat === 'scam') action = String(gs.linkAction || 'warn').toLowerCase();
        else action = 'warn';
    }
    if (!['warn','delete','timeout','exile','log'].includes(action)) action = 'warn';

    let minutes = Number(policy.minutes || 0);
    if (!minutes || minutes < 0) minutes = 0;
    if (cat === 'scam' && !minutes) minutes = gs.timeoutMinutesScam || 60;
    if (cat === 'spam' && !minutes) minutes = gs.timeoutMinutesSpam || 10;
    if (cat === 'command' && !minutes) minutes = gs.timeoutMinutesCommand || 5;
    if (cat === 'trade' && !minutes) minutes = gs.timeoutMinutesTrade || 5;
    if (cat === 'service' && !minutes) minutes = gs.timeoutMinutesService || 5;
    if (cat === 'beg' && !minutes) minutes = gs.timeoutMinutesTrade || 5;
    if (cat === 'acctrade' && !minutes) minutes = gs.timeoutMinutesScam || 60;

    return { action, minutes: Math.min(10080, minutes) };
}

async function handlePolicyViolation(message, data, gs, category, details) {
    const cat = String(category || '').toLowerCase();
    const { action, minutes } = getCategoryPolicy(gs, cat);

    if (gs.enforcementMode === 'monitor' || action === 'log') {
        const embed = new EmbedBuilder()
            .setTitle('🧪 Monitor Mode — Policy Hit')
            .setColor(0x00B3FF)
            .addFields(
                { name: 'Category', value: cat, inline: true },
                { name: 'Policy Action', value: action, inline: true },
                { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: false },
                { name: 'Channel', value: `<#${message.channel.id}> (${message.channel.id})`, inline: false },
                { name: 'Reason', value: String(details?.reason || 'Policy trigger'), inline: false },
                { name: 'Message', value: String(message.content || '').slice(0, 800) || '(no text)', inline: false },
            )
            .setTimestamp();
        await sendLog(message.guild, data, embed);
        return { mode: 'monitor', action };
    }

    if (action === 'timeout') {
        return await applyConfiguredAction(message, data, gs, {
            action: 'timeout',
            title: details?.title,
            color: details?.color,
            reason: details?.reason,
            footerLabel: details?.footerLabel,
            ttlMs: details?.ttlMs,
            timeoutMins: minutes,
            redirectChannelId: details?.redirectChannelId,
        });
    }

    return await applyConfiguredAction(message, data, gs, {
        action,
        title: details?.title,
        color: details?.color,
        reason: details?.reason,
        footerLabel: details?.footerLabel,
        ttlMs: details?.ttlMs,
        redirectChannelId: details?.redirectChannelId,
    });
}
const GAMES_HUB_CHANNELS = new Set([
    '1416126451589316679','1416378429795991653','1416448183080583228',
    '1416834855810895973','1416835306874867713','1416860441073811477',
    '1416863662085505065','1416867540017348758','1416868781405245460',
    '1417084523325296704','1417123448190275635',
]);

// ══════════════════════════════════════════════════════════
//  DATA PERSISTENCE
// ══════════════════════════════════════════════════════════
const BASE_DIR  = path.dirname(path.resolve(process.argv[1] || __filename));
const DATA_FILE = path.join(BASE_DIR, 'skynet_data.json');
const BACKUP_DIR = path.join(BASE_DIR, 'skynet_backups');

function ensureBackupDir() {
    try { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
}

function listBackupFiles() {
    ensureBackupDir();
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => /^skynet_data\.(\d{8}_\d{6})\.json$/.test(f))
            .sort()
            .reverse();
        return files;
    } catch { return []; }
}

function makeBackupName(ts = Date.now()) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `skynet_data.${stamp}.json`;
}

function createBackupFile(sourcePath = DATA_FILE) {
    ensureBackupDir();
    try {
        if (!fs.existsSync(sourcePath)) return null;
        const dest = path.join(BACKUP_DIR, makeBackupName());
        fs.copyFileSync(sourcePath, dest);
        return dest;
    } catch { return null; }
}

function rotateBackups(maxKeep = 25) {
    const files = listBackupFiles();
    if (files.length <= maxKeep) return;
    for (const f of files.slice(maxKeep)) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {}
    }
}

function safeWriteJsonAtomic(filePath, obj) {
    // Use a unique tmp filename per call to prevent race conditions when
    // multiple async handlers call saveData concurrently. A shared .tmp
    // path causes ENOENT on rename if another call already renamed it away.
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const json = JSON.stringify(obj, null, 2);
    try {
        fs.writeFileSync(tmp, json, 'utf8');
        fs.renameSync(tmp, filePath);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch {}
        throw e;
    }
}

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return makeDefaultData();
    try {
        const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return Object.assign(makeDefaultData(), d);
    } catch {
        const backups = listBackupFiles();
        for (const b of backups) {
            try {
                const d = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, b), 'utf8'));
                return Object.assign(makeDefaultData(), d);
            } catch {}
        }
        return makeDefaultData();
    }
}

const LINK_SHORTENERS = new Set([
    'bit.ly','tinyurl.com','t.co','goo.gl','rebrand.ly','ow.ly','buff.ly','cutt.ly','shorturl.at',
    'is.gd','v.gd','soo.gd','adf.ly','shorte.st','bc.vc','qr.ae','rb.gy','soo.gd',
    't.ly','lnkd.in','cli.re','s.id','tiny.cc','trib.al','bl.ink','fur.ly','cutt.us',
    'kutt.it','po.st','snip.ly','yourls.org','vzturl.com','tiny.one','1url.com','2u.pw',
    '4url.cc','7.ly','acortaurl.com','bc.vc','bit.do','bitly.com','budurl.com','chilp.it',
    'clck.ru','da.gd','dwarfurl.com','easyurl.net','fwdurl.net','go2l.ink','href.li',
    'iplogger.org','iplogger.com','grabify.link','leancoding.co','stopify.co','freegiftcards.co',
    'linktr.ee','bio.link','campsite.bio','beacons.ai','solo.to',
]);

const LINK_SHORTENERS_EXTRA = new Set([
    'short.gy','short.io','short.cm','t2m.io','shrtco.de','shrtco','shrtfly','flylink','fly.link',
    'clk.sh','clk.ink','clk.im','clk.re','clk.to','clk.wtf','clik.cc','clik.pw','clik.pw',
    'surl.li','surl.im','surl.me','surl.lt','surl.mx','surl.tv','surl.nu','surl.ch',
    'rb.gy','rebrand.ly','rb.gy','rb.gy',
    'tiny.one','tinyurl.is','tinyurl.cc','tiny-url.info','tinyurl.link','tinyurl.co',
    'bitly.is','bitly.link','bitly.cx','bitly.ws','bitly.rs','bitly.tl',
    'lnk.to','lnk.page','lnk.bio','lnk.fi','lnk.at','lnk.sk','lnk.click','lnk.do','lnk.ee','lnk.in',
    'shorturl.me','shorturl.fm','shorturl.co','shorturl.ai','shorturl.io','shorturl.link',
    'urlz.fr','ur.ly','urlr.me','urlr.io','urlr.app','urlr.cc','urlr.co',
    'u.to','u.pw','u.nu','u.cx','u.rs','u.tf','u.do','u.gd',
    'zpr.io','zipurl.io','zipurl.co','zipurl.cc','zipurl.me','zipurl.link',
    'go2l.ink','go2l.co','go2l.link','go2l.site','go2l.app',
    'tr.ee','tr.ee','tr.ee',
    'safelinks.protection.outlook.com','aka.ms',
    'discord.gg','discord.com/invite','discordapp.com/invite',
]);

const SUSPICIOUS_TLDS = new Set([
    'xyz','top','tk','gq','cf','ml','ga','icu','click','link','pw','work','zip','mov','lol','fun','live','life',
    'support','help','center','claim','gift','rewards','win','winner','promo','giveaway','free','vip',
    'site','online','store','shop','cloud','app','website','space','today','world','digital','team','pro',
    'best','monster','stream','download','party','security','verify','verification',
]);

const SCAM_DOMAIN_BLACKLIST = new Set([
    'discord-gift.com','discord-gift.net','discord-gifts.com','discord-nitro.com','discord-nitro.net','discordnitro.com','discordnitro.net',
    'discord-giveaway.com','discord-giveaway.net','discordgiveaway.com','discordapp-nitro.com','discordappnitro.com',
    'dlscord.com','dIscord.com','discrod.com','discorcl.com','discod.com','discorb.com','disc0rd.com','dicsord.com','dicord.com','discor-d.com',
    'roblox-free.com','robloxfree.com','robux-free.com','robuxfree.com','rbx-free.com','rbxfree.com','robux-generator.com','robuxgen.com',
    'bloxfruits-free.com','bloxfruit-free.com','bloxfruitsfree.com','bloxfruitfree.com','bloxfruits-rewards.com','bloxfruitsrewards.com',
    'free-nitro.com','freenitro.com','nitro-free.com','nitrofree.com','nitro-gift.com','nitrogift.com',
    'steamnitro.com','steam-gift.net','steamgift.net','steam-giveaway.com','steamgiveaway.com',
    'verify-discord.com','verifydiscord.com','discord-verify.com','discordverify.com','verification-discord.com','verificationdiscord.com',
    'roblox-verify.com','robloxverify.com','verify-roblox.com','verifyroblox.com','verification-roblox.com','verificationroblox.com',
    'claim-discord.com','claimdiscord.com','claim-robux.com','claimrobux.com','claim-roblox.com','claimroblox.com',
    'get-robux.com','getrobux.com','get-free-robux.com','getfreerobux.com','get-robux-now.com','getrobuxnow.com',
    'robux-now.com','robuxnow.com','robux-now.net','robuxnow.net','robuxnow.xyz','robux-now.xyz',
    'blox-fruits.com','bloxfruits-game.com','bloxfruitsgame.com','bloxfruits.vip','bloxfruits.pro','bloxfruits.top','bloxfruits.xyz',
    'roblox.support','roblox-help.support','roblox-verify.support','discord.support','discord-help.support','discord-verify.support',
    'linkvertise.app','loot-links.app','lootlinks.app','work-ink.app','workink.app','ouo.press','ouo.io','shrinkme.io','shrinkearn.com',
    'freegiftcards.co','freegiftcard.co','giftcardfree.co','giftcardsfree.co','giftcard-claim.co','giftcardclaim.co',
    'iplogger.com','iplogger.org','grabify.link','leancoding.co','stopify.co','2no.co','ps3cf.com','gyazo.in',
    'discordgift.site','discordgift.online','discordgift.store','discordgift.shop','discordgift.cloud','discordgift.app',
    'discordnitro.site','discordnitro.online','discordnitro.store','discordnitro.shop','discordnitro.cloud','discordnitro.app',
    'robloxgift.site','robloxgift.online','robloxgift.store','robloxgift.shop','robloxgift.cloud','robloxgift.app',
    'robuxgift.site','robuxgift.online','robuxgift.store','robuxgift.shop','robuxgift.cloud','robuxgift.app',
    'freerobux.site','freerobux.online','freerobux.store','freerobux.shop','freerobux.cloud','freerobux.app',
    'freeperm.site','freeperm.online','freeperm.store','freeperm.shop','freeperm.cloud','freeperm.app',
    'bloxfruitperm.site','bloxfruitperm.online','bloxfruitperm.store','bloxfruitperm.shop','bloxfruitperm.cloud','bloxfruitperm.app',
    'bloxfruitsperm.site','bloxfruitsperm.online','bloxfruitsperm.store','bloxfruitsperm.shop','bloxfruitsperm.cloud','bloxfruitsperm.app',
    'nitroclaim.site','nitroclaim.online','nitroclaim.store','nitroclaim.shop','nitroclaim.cloud','nitroclaim.app',
    'verifyclaim.site','verifyclaim.online','verifyclaim.store','verifyclaim.shop','verifyclaim.cloud','verifyclaim.app',
    'rewardclaim.site','rewardclaim.online','rewardclaim.store','rewardclaim.shop','rewardclaim.cloud','rewardclaim.app',
    'promoclaim.site','promoclaim.online','promoclaim.store','promoclaim.shop','promoclaim.cloud','promoclaim.app',
    'giveawayclaim.site','giveawayclaim.online','giveawayclaim.store','giveawayclaim.shop','giveawayclaim.cloud','giveawayclaim.app',
    'freeroblox.site','freeroblox.online','freeroblox.store','freeroblox.shop','freeroblox.cloud','freeroblox.app',
    'robloxclaim.site','robloxclaim.online','robloxclaim.store','robloxclaim.shop','robloxclaim.cloud','robloxclaim.app',
    'robuxclaim.site','robuxclaim.online','robuxclaim.store','robuxclaim.shop','robuxclaim.cloud','robuxclaim.app',
    'discordclaim.site','discordclaim.online','discordclaim.store','discordclaim.shop','discordclaim.cloud','discordclaim.app',
    'nitrogift.site','nitrogift.online','nitrogift.store','nitrogift.shop','nitrogift.cloud','nitrogift.app',
    'discord-nitro.xyz','discord-nitro.top','discord-nitro.click','discord-nitro.link','discord-nitro.pw',
    'discord-gift.xyz','discord-gift.top','discord-gift.click','discord-gift.link','discord-gift.pw',
    'robux-gift.xyz','robux-gift.top','robux-gift.click','robux-gift.link','robux-gift.pw',
    'roblox-gift.xyz','roblox-gift.top','roblox-gift.click','roblox-gift.link','roblox-gift.pw',
    'bloxfruits-gift.xyz','bloxfruits-gift.top','bloxfruits-gift.click','bloxfruits-gift.link','bloxfruits-gift.pw',
    'bloxfruit-gift.xyz','bloxfruit-gift.top','bloxfruit-gift.click','bloxfruit-gift.link','bloxfruit-gift.pw',
    'verify-nitro.xyz','verify-nitro.top','verify-nitro.click','verify-nitro.link','verify-nitro.pw',
    'verify-discord.xyz','verify-discord.top','verify-discord.click','verify-discord.link','verify-discord.pw',
    'verify-roblox.xyz','verify-roblox.top','verify-roblox.click','verify-roblox.link','verify-roblox.pw',
    'claim-nitro.xyz','claim-nitro.top','claim-nitro.click','claim-nitro.link','claim-nitro.pw',
    'claim-robux.xyz','claim-robux.top','claim-robux.click','claim-robux.link','claim-robux.pw',
    'claim-roblox.xyz','claim-roblox.top','claim-roblox.click','claim-roblox.link','claim-roblox.pw',
    'free-robux.xyz','free-robux.top','free-robux.click','free-robux.link','free-robux.pw',
    'free-perm.xyz','free-perm.top','free-perm.click','free-perm.link','free-perm.pw',
    'free-perms.xyz','free-perms.top','free-perms.click','free-perms.link','free-perms.pw',
    'bloxfruits-free.xyz','bloxfruits-free.top','bloxfruits-free.click','bloxfruits-free.link','bloxfruits-free.pw',
    'bloxfruit-free.xyz','bloxfruit-free.top','bloxfruit-free.click','bloxfruit-free.link','bloxfruit-free.pw',
    'gift-claim.xyz','gift-claim.top','gift-claim.click','gift-claim.link','gift-claim.pw',
    'reward-claim.xyz','reward-claim.top','reward-claim.click','reward-claim.link','reward-claim.pw',
    'promo-claim.xyz','promo-claim.top','promo-claim.click','promo-claim.link','promo-claim.pw',
    'nitro-promo.xyz','nitro-promo.top','nitro-promo.click','nitro-promo.link','nitro-promo.pw',
    'robux-promo.xyz','robux-promo.top','robux-promo.click','robux-promo.link','robux-promo.pw',
    'bloxfruits-promo.xyz','bloxfruits-promo.top','bloxfruits-promo.click','bloxfruits-promo.link','bloxfruits-promo.pw',
    'discord-promo.xyz','discord-promo.top','discord-promo.click','discord-promo.link','discord-promo.pw',
    'discord-verify.xyz','discord-verify.top','discord-verify.click','discord-verify.link','discord-verify.pw',
    'roblox-verify.xyz','roblox-verify.top','roblox-verify.click','roblox-verify.link','roblox-verify.pw',
    'robux-verify.xyz','robux-verify.top','robux-verify.click','robux-verify.link','robux-verify.pw',
]);

const SCAM_OR_EXPLOIT_PHRASES = [
    'free perm','free perms','free gamepass','free gp','free fruit notifier','free dark blade','free yoru',
    'free robux','free rbx','free roblox','robux generator','robux gen','rbx gen','free vip','free ps',
    'free private server','free priv server','free script','free exploit','free hacks','free hack',
    'claim reward','claim rewards','claim prize','claim your prize','claim your reward','you won','winner',
    'giveaway winner','congratulations you won','congrats you won','limited time reward','limited time offer',
    'verify to claim','verify to get','verify for reward','verification required','complete verification',
    'click this link','click the link','tap this link','open this link','check this link','use this link',
    'join my server','join this server','join for reward','join for robux','join to claim','join to get',
    'dm me for link','dm for link','message me for link','pm for link','send me for link',
    'cheap perms','cheap perm','cheap gamepass','cheap gp','cheap fruit','cheap fruits',
    'sell perms cheap','selling perms cheap','selling perm cheap','perms for cheap','perm for cheap',
    'discount perms','discount perm','discount gamepass','discount gp','discount fruit notifier',
    'trusted middleman','mm service','middleman service','use my middleman','i am middleman',
    'dupe','duplication','duplicating','dupe method','dup method','fruit dupe','item dupe','dupe glitch',
    'exploit','expl0it','exploits','executor','executer','injector','inject','injection','dll',
    'script','scr1pt','scripts','auto farm','autofarm','auto-farm','auto click','autoclick','macro',
    'hack','hacks','hacker','cheat','cheats','cheating','mod menu','modmenu','modded',
    'synapse','scriptware','krnl','fluxus','delta executor','evon','hydrogen','electron','codex',
    'pastebin.com','paste.ee','hastebin.com','rentry.co','rentry','git.io','raw.githubusercontent.com',
    'download now','download here','download link','install this','install now','update required',
    'security update','account compromised','your account is hacked','reset password here',
    'steam gift card','gift card','nitro gift','free nitro','discord nitro','nitro giveaway',
    'verify your account','verify account','verify now','verification bot',
    'trade scam','scam alert','not a scam','legit','100% legit','trusted','vouch','vouches',
    'click to verify','click verify','verify by clicking','click to claim',
    'free cash','free money','cashapp','paypal','venmo','crypto','bitcoin','btc','eth','ethereum',
    'send first','you go first','i go second','no middleman needed',
    'refund','chargeback','refunded','refunding','insurance','insured trade',
    'account verification','age verification','human verification','captcha verification',
    'roblox support','roblox admin','roblox staff','discord staff','discord admin',
    'report to roblox','ban wave','banwave','ban wave incoming',
    'free access','free whitelist','whitelist','whitelisted','key system','get key',
    'key link','keysite','linkvertise','linkvertise.com','loot-links','lootlinks',
    'work.ink','workink','adshrink','shrinkme','shrinkearn','ouo.io','ouo.press',
    'safelink','safe link','safelinks','safe-links','short link','shortlink',
    'give me your cookie','roblosecurity','roblo security','rbx cookie','cookie logger',
    'cookie log','cookie grab','cookie grabber','token grab','token grabber',
    'ip grab','ip grabber','grab ip','ddos','dox','doxx','doxxing',
    'invite tracker','fake invite','phishing','phish','phisher','phishing link',
    'steamcommunity.com/gift','discord.gift','discordapp.gift','nitro.gift',
    'bloxfruits script','blox fruits script','bloxfruits exploit','blox fruits exploit',
    'bloxfruits hack','blox fruits hack','bloxfruits cheats','blox fruits cheats',
    'free awakened','free awakening','awaken for free','awakened for free',
    'free carry for payment','pay first for carry','send payment first',
    'free perm if you click','perm giveaway link','gamepass giveaway link',
    'verification link','verify link','verification website','verify website',
    'official giveaway','official reward','official prize',
    'limited reward','limited prize','limited giveaway',
    'check my bio for link','link in bio','bio link','linktree',
    'follow this link','open the website','open website','visit this site','visit site',
    'http://','https://','www.',
];

const INTENT_PHRASE_EXTRA2 = [
    "wtt","wtb","wts","w2t","trade","trading","swap","swapping","sell","selling","buy","buying",
    "offer","offers","taking offers","accepting offers","dm offers","dm me offers","pm offers","message offers",
    "my offer is","my offers are","my offer:","my offers:","offer:","offers:",
    "have","i have","i got","i have:","i got:","have:","got:",
    "h:","got:","have:","lf:","wtt:","wtb:","wts:",
    "for trade","for trading","up for trade","up for trading","trade only","trades only",
    "trade me","dm me to trade","dm to trade","pm to trade","message me to trade","dms open",
    "serious offers","no lowballs","no low offers","no clown offers","no trash offers","no bad offers",
    "good offers only","best offer wins","highest offer","highest offers",
    "looking to trade","looking 2 trade","looking for trade","looking for offers","looking for good offers",
    "seeking offers","searching offers","seeking trade","searching trade",
    "anyone trade","anyone trading","anybody trade","anybody trading","any1 trade","any1 trading",
    "who trade","who trades","who trading","who wants to trade","who wanna trade",
    "does anyone have","does any1 have","anyone have","any1 have","who has",
    "i need","i want","need","want","lf","looking for","searching for","seeking",
    "in return","in exchange","in exchange for","exchange for","swap for","trade for",
    "my fruits for","my fruit for","my perm for","my perms for","my gamepass for","my gp for",
    "my dark blade for","my yoru for","my notifier for","my fruit notifier for",
    "perm for","perms for","gamepass for","gp for","db for","yoru for","notifier for",
    "2x mastery for","2x money for","fast boats for",
    "trading perms","trading perm","selling perms","selling perm","buying perms","buying perm",
    "trading gamepass","trading gp","selling gamepass","selling gp","buying gamepass","buying gp",
    "trading dark blade","selling dark blade","buying dark blade","trading yoru","selling yoru","buying yoru",
    "trading notifier","selling notifier","buying notifier","trading fruit notifier","selling fruit notifier","buying fruit notifier",
    "lowball","low ball","low-ball","low offers","low offer","lowball offers","lowball offer",
    "overpay","over pay","over-pay","op","op for","i overpay","i op","op offers",
    "underpay","under pay","under-pay","up","up for","i underpay","up offers",
    "value","values","value check","valuecheck","wfl","l","w","fair trade","fair offer","unfair trade",
    "trade value","fruit value","perm value","gp value","gamepass value",
    "dm me","dms","dm","pm","msg","message me",
    "no scam","not scam","legit trade","trusted trade","mm","middleman","use mm","use middleman",
    "trade in dms","trading in dms","dm trade","pm trade",
    "quick trade","fast trade","instant trade","now trade","trade now",
    "trade post","trade posting","trading post","offer post","offer posting",
    "need buyer","need seller","buyer","seller","buying","selling",
    "bulk trade","bundle trade","bundle","bundles","set trade","set of",
    "i add","i can add","add on","adds","adding","i can add on",
    "small adds","big adds","good adds","adds depending","adds dep",
    "looking for perm","looking for perms","lf perm","lf perms","lf gamepass","lf gp",
    "lf dark blade","lf yoru","lf notifier","lf fruit notifier",
    "lf kitsune","lf dragon","lf leopard","lf dough","lf control","lf portal","lf rumble","lf buddha","lf blizzard","lf mammoth","lf trex","lf t-rex","lf spirit","lf venom","lf shadow",
    "have kitsune","have dragon","have leopard","have dough","have control","have portal","have rumble","have buddha","have blizzard","have mammoth","have trex","have t-rex","have spirit","have venom","have shadow",
    "trading kitsune","trading dragon","trading leopard","trading dough","trading control","trading portal","trading rumble","trading buddha","trading blizzard","trading mammoth","trading trex","trading t-rex",
    "selling kitsune","selling dragon","selling leopard","selling dough","selling control","selling portal","selling rumble","selling buddha","selling blizzard","selling mammoth","selling trex","selling t-rex",
    "buying kitsune","buying dragon","buying leopard","buying dough","buying control","buying portal","buying rumble","buying buddha","buying blizzard","buying mammoth","buying trex","buying t-rex",
    "wfl?","wfl","w/f/l","w f l","win or lose","win/lose","win lose","win or loss",
    "is this a w","is this a l","is this fair","fair?","fair trade?","fair offer?",
    "value check","valuecheck","vc","v/c","price check","pricecheck","pc","p/c",
    "how much is","how much for","what is it worth","what's it worth","whats it worth",
    "what is the value","whats the value","what's the value","value of",
    "overpay","over pay","op","op offer","op offers","i overpay","i op","op for",
    "underpay","under pay","up","up offer","up offers",
    "lowball","low ball","no lowball","no lowballs","dont lowball","don't lowball",
    "no low offers","no low offer","no lowballs pls","no lowballs plz",
    "best offer wins","highest offer wins","taking best offers","taking best offer",
    "serious trades only","trade offers only","dms for trade","dm for trade","pm for trade","msg for trade",
    "dm me to trade","pm me to trade","message me to trade","trade in dms","trade in dm",
    "trade me in dms","trade me in dm","dms open for trade","dm open for trade",
    "lf offers","taking offers","offer in dms","offers in dms","offers in dm",
    "trading for overpay","selling for overpay","buying for cheap","selling cheap","cheap sale",
    "trade value check","perm value check","fruit value check","gp value check","gamepass value check",
    "wtt for overpay","wts for overpay","wtb cheap","wtt fair","wts fair","wtb fair",
    "adds","add","i add","i can add","small adds","big adds","good adds","adds depending",
    "no adds","no add","without adds","no adds needed",
    "looking for perms","looking for perm","lf perms","lf perm","lf perm offers","perm offers",
    "perm trade","perm trades","perm trading","perm swap",
    "gamepass trade","gamepass trades","gp trade","gp trades","gp trading","gamepass trading",
    "trade perms","trade perm","trade gamepass","trade gp","trade dark blade","trade yoru","trade notifier",
    "sell perm","sell perms","sell gamepass","sell gp","sell dark blade","sell yoru","sell notifier",
    "buy perm","buy perms","buy gamepass","buy gp","buy dark blade","buy yoru","buy notifier",
    "need buyer","need buyers","need seller","need sellers",
    "sell fast","trade fast","quick trade","instant trade","trade now","need trade now",
    "post offers","offer post","trade post","trading post","trade listing","offer listing",
];

const SCAM_OR_EXPLOIT_PHRASES_EXTRA = [
    'free perms in bio','perm in bio','perms in bio','link in bio for perms','bio has perms','bio has link',
    'check profile for link','check my profile for link','profile link','profile has link',
    'use code for free','redeem code for free','redeem this code','claim code','claim promo code',
    'claim your robux','claim your rbx','claim your nitro','claim your gift','claim your prize now',
    'limited redeem','limited redemption','redeem now','redeem quickly','redeem fast',
    'free perm generator','perm generator','gamepass generator','gift generator','nitro generator',
    'roblox generator','blox fruits generator','bloxfruits generator',
    'verify with blox fruits','verify with roblox','verify with discord',
    'verification page','verification portal','verify portal','verification site',
    'support ticket link','contact support link','appeal ban link','unban link',
    'login to claim','log in to claim','sign in to claim','sign-in to claim','signin to claim',
    'login required','log in required','sign in required','signin required','authentication required',
    '2fa required','two factor required','two-factor required',
    'enter your password','enter password','reset password','password reset','reset your password',
    'session expired','session has expired','session timeout','account locked',
    'your account will be banned','account will be banned','ban incoming','ban soon',
    'appeal here','appeal link','appeal using link','appeal on website',
    'discord staff here','discord admin here','official discord staff',
    'roblox staff here','official roblox staff',
    'private message me for link','dm me the word','dm me "link"','dm me "free"','dm me "perm"',
    'say "claim" to get link','say claim to get link','comment claim for link',
    'type claim for link','type verify for link','type free for link',
    'paste this in browser','copy paste in browser','copy and paste in browser',
    'copy paste link','copy and paste link',
    'open safari and paste','open chrome and paste','open browser and paste',
    'download executor','download exploit','download script','download hacks',
    'install executor','install exploit','install script','install hacks',
    'inject now','injector download','injector link','dll download',
    'key system link','get key link','key linkvertise','key linkvertise.com',
    'linkvertise key','lootlinks key','workink key','ouo key',
    'free perm if verify','free perm if you verify','free perm if you join',
    'free perm if you click','free perm if you sign in','free perm if you login',
    'free robux if you verify','free robux if you click','free robux if you login',
    'free nitro if you verify','free nitro if you click','free nitro if you login',
    'nitro gift link','nitro gift links','nitro links','discord gift link',
    'discord nitro link','discord nitro links',
    'steam gift link','steam gift links',
    'rate my profile link','rate my server link',
    'new update required click','new update click link','update your discord',
    'update your roblox','update roblox now','roblox update required',
    'blox fruits update required','bloxfruits update required',
    'free perm giveaway link','free perms giveaway link',
    'free gamepass giveaway link','free gp giveaway link',
    'free fruit notifier giveaway link',
    'fake vouch','vouch me','vouch for me','vouch thread','vouching',
    'trusted seller','trusted buyer','trusted trade','trusted trader','trusted service',
    'no scam','not scam','not a scam legit','legit no scam',
    'proof in link','proof link','proof video link',
    'screenshots in link','screenshot link','video in link','clip in link',
    'limited time only click','limited time only link',
    'account verification link','age verification link','human verification link',
    'captcha verification link','complete captcha to claim',
    'complete captcha to verify','complete captcha now',
    'enter username and password','enter user and pass','enter login details',
    'enter roblosecurity','enter .roblosecurity','paste your cookie',
    'send your cookie','send cookie','send token','send your token',
    'token logger','discord token logger','roblox cookie logger',
    'ip logger','ip grabber link','grabify link','ipgrabber link',
    'shortened link','shorten link','short link',
    'free perm link','free perms link','free robux link','free nitro link',
    'claim link','verify link','redeem link',
    'blox fruits private script','blox fruits paid script','blox fruits script download',
    'blox fruits exploit download','blox fruits executor',
    'free script hub','script hub','exploit hub','executor hub',
    'delta download','evon download','krnl download','fluxus download','hydrogen download','electron download',
    'synapse x download','scriptware download',
    'pastebin script','rentry script','hastebin script','github raw script',
    'free admin','admin panel','admin access','staff access',
    'give me your login','give me your password','send password',
    'log in here','login here','sign in here','signin here',
    'roblox login here','discord login here',
    'verify your discord','verify your roblox',
    'bypass verification','verification bypass','bypass captcha',
    'free perm if you complete','free perm after verification',
    'reward after verification','prize after verification',
    'claim after verification','claim post verification',
    'click verify to claim','click verify to get reward',
    'click to get free','click to get reward','click to receive reward',
    'tap to get free','tap to claim reward',
    'visit to get free','visit to claim',
    'trusted link','safe link','safe website','official website',
    'new official site','official mirror','mirror site',
    'mirror link','backup link','alt link',
    'join to win','join to get free','join for free',
    'invite reward','invite rewards','invite to claim',
    'referral reward','referral rewards','referral link',
    'refer friends to get','refer to get reward',
    'free perm for invite','free perm for referral',
    'giveaway ends soon','giveaway ends now','ends soon click',
    'winner announced click','winner announced link',
];

const SCAM_OR_EXPLOIT_PHRASES_EXTRA2 = [
    'free perm right now','free perms right now','instant free perm','instant free perms','free perm instantly','free perms instantly',
    'free perms giveaway','free perm giveaway','free perm event','free perms event','free perm drop','free perms drop',
    'claim your perm','claim your perms','claim perm now','claim perms now','claim perm here','claim perms here',
    'free fruit notifier link','free notifier link','notifier giveaway link','fruit notifier giveaway link',
    'free dark blade link','dark blade giveaway link','yoru giveaway link','free yoru link',
    'free 2x mastery link','free 2x money link','free fast boats link','free gamepass link','free gp link',
    'perm link','perms link','gamepass link','gp link','robux link','nitro link','gift link',
    'free perm just click','free perms just click','just click the link','just click link','click and claim',
    'verify and claim','verify then claim','verify then get','verify and get','verify to redeem','redeem after verify',
    'free perm after join','free perm after you join','free perms after join','free perms after you join',
    'join then claim','join then verify','join then redeem','join and claim','join and verify','join and redeem',
    'join our discord','join our server','join this discord','join this server now','join this now',
    'official giveaway link','official reward link','official claim link','official redeem link',
    'discord verification required','discord verify required','roblox verification required','roblox verify required',
    'verify your email','verify email','verify your phone','verify phone','phone verification','email verification',
    'confirm your account','confirm account','confirm to claim','confirm to verify',
    'security check required','security check','account security check','complete security check',
    'anti bot verification','anti-bot verification','anti bot check','human check required','human check',
    'complete survey to claim','complete survey to get','survey required to claim','survey required',
    'complete offer to claim','complete offer to get','offer required to claim','offer required',
    'download app to claim','download app to get','install app to claim','install app to get',
    'turn off antivirus','disable antivirus','disable anti virus','turn off anti virus',
    'run as admin','run as administrator','open powershell','open command prompt','open terminal and paste',
    'paste into cmd','paste into powershell','paste in terminal','paste this command',
    'open this file','open the file','run this file','run the file','execute file',
    'download zip','download rar','download exe','download dmg','download apk','download ipa',
    'download .exe','download .zip','download .rar','download .apk',
    'install extension','browser extension required','chrome extension required','install chrome extension',
    'install this extension','install my extension','install our extension',
    'discord qr code','scan qr','scan qr code','qr code login','login using qr',
    'steam login','steam sign in','steam signin','steam verification',
    'roblox login','roblox sign in','roblox signin','roblox verification',
    'discord login','discord sign in','discord signin','discord verification',
    'account verification','verify account','account verify','verify now',
    'free nitro gift','free nitro gifts','nitro gifts','nitro gift','discord nitro gift',
    'gift nitro','gifted nitro','nitro claimed','nitro claim',
    'steam gift','steam gifts','steam gift card','steam gift cards','steam wallet code','wallet code',
    'apple gift card','itunes gift card','google play gift card','play store gift card',
    'crypto airdrop','airdrop claim','claim airdrop','free crypto','free btc','free eth',
    'metamask','wallet connect','connect wallet','connect your wallet',
    'support team link','support link','contact admin link','contact mod link',
    'staff application link','staff app link','mod application link','mod app link',
    'appeal ban link','appeal mute link','appeal timeout link','appeal suspension link',
    'ban appeal link','mute appeal link','timeout appeal link',
    'report here link','report link','submit report link',
    'verify in dms','verify in dm','dm verification','dm verify',
    'send me a dm for verification','dm me for verification','dm me to verify',
    'drop your username and password','drop your login','send login info',
    'send your email and password','send your user and pass','send your username and password',
    'send your 2fa code','send the 2fa code','send the code',
    'give me the code','give me your code','tell me the code',
    'cookie required','send cookie to verify','send cookie to claim',
    'token required','send token to verify','send token to claim',
    'roblosecurity required','send roblosecurity','send .roblosecurity',
    'roblosecurity cookie','roblox cookie','discord token',
    'profile verification link','profile verify link','verify profile link',
    'vouch here link','vouch link','vouch thread link','proof link in bio',
    'trust me link','trusted link in bio','trusted proof link',
    'anti scam link','antiscam link','safe link check',
    'go to my website','visit my website','my website link','website in bio',
    'short link in bio','shortened link in bio','bitly in bio','tinyurl in bio',
    'linkvertise in bio','lootlinks in bio','workink in bio','ouo in bio',
    'lootlinks.com','loot-links.com','work.ink','linkvertise.com','linkvertise',
    'captcha required','captcha check','captcha verify','captcha verification',
    'verify captcha','complete captcha','complete the captcha',
    'click verify button','press verify button','press verify',
    'open verification page','open verification site','open verify page',
    'free private server link','free ps link','private server link',
    'free vip server link','vip server link',
    'download script from link','script download link','exploit download link','executor download link',
    'script in description','script in desc','script in bio',
    'raw github script','github raw link','github raw',
    'pastebin raw','rentry raw','hastebin raw',
    'new exploit update','exploit update','executor update',
    'urgent update required','urgent update','update required now',
    'fix your account click','fix account click','unlock account click',
    'account disabled click','account banned click','account compromised click',
    'verification failed click','verification failure click',
    'limited offer click','limited offer link','limited gift click','limited gift link',
    'free perm promo','free perm promotion','free perm promotional',
    'free nitro promo','free nitro promotion','free nitro promotional',
    'robux promo','robux promotion','robux promotional',
    'giveaway promo link','giveaway promotion link','promo giveaway link',
    'click for free perms','click for free perm','click for free robux','click for free nitro',
    'tap for free perms','tap for free perm','tap for free robux','tap for free nitro',
    'visit for free perms','visit for free perm','visit for free robux','visit for free nitro',
    'free perm site','free perm website','free perm web',
    'discord nitro site','discord nitro website','nitro giveaway site',
    'robux site','robux website','robux giveaway site',
    'blox fruits site','blox fruits website','blox fruits giveaway site',
    'bloxfruits site','bloxfruits website','bloxfruits giveaway site',
];

// Extensions that are media file types, not TLDs — never treat these as domain extensions
const MEDIA_FILE_EXTENSIONS = new Set([
    'gif','png','jpg','jpeg','webp','mp4','mov','avi','mkv','webm','mp3',
    'wav','ogg','flac','aac','m4a','pdf','zip','rar','7z','tar','gz',
    'txt','json','xml','csv','html','htm','css','js','ts','py','java',
    'rb','go','rs','cpp','c','h','cs','php','sh','bat','md','log',
]);

function extractDomains(text) {
    const domains = [];
    // First pass: extract full domains from https?:// URLs — these are authoritative
    const raw = (text.match(/https?:\/\/[^\s)\]"']+/gi) || []);
    const urlDomains = new Set();
    for (const u of raw) {
        const m = u.match(/^https?:\/\/([^\/\s?#:]+)(?::\d+)?/i);
        if (m && m[1]) {
            const d = m[1].toLowerCase().replace(/^www\./, '');
            domains.push(d);
            urlDomains.add(d);
        }
    }
    // Second pass: bare domains (e.g. "discord.gg/abc" without https)
    const bare = (text.match(/(?:^|[^a-z0-9\/])([a-z0-9][a-z0-9\-]{0,60}\.[a-z]{2,})(?![a-z0-9])/gi) || [])
        .map(m => m.replace(/^[^a-z0-9]+/i, '').toLowerCase());
    for (const b of bare) {
        // Skip if TLD is a media/file extension — it's a filename, not a domain
        const tld = b.split('.').pop();
        if (MEDIA_FILE_EXTENSIONS.has(tld)) continue;
        // Skip if this bare match is just a partial sub-string of a URL domain already captured
        // e.g. "cdn.discordapp" is already covered by "cdn.discordapp.com"
        const isPartialOfUrlDomain = [...urlDomains].some(ud => ud === b || ud.endsWith('.' + b));
        if (isPartialOfUrlDomain) continue;
        domains.push(b);
    }
    return [...new Set(domains)];
}

function detectScamOrExploit(cleanText, rawText, guildAllowlist) {
    const t = cleanText;
    const ns = t.replace(/[\s_]/g,'');
    // Combine the hard-coded safe list with any domains the guild admin has explicitly allowed
    const _safeList = guildAllowlist && guildAllowlist.length
        ? [...COMMON_ALLOWED_DOMAINS, ...guildAllowlist]
        : COMMON_ALLOWED_DOMAINS;

    for (const phrase of SCAM_OR_EXPLOIT_PHRASES) {
        const p = phrase.toLowerCase();
        if (p.length < 4) continue;
        const pc = p.replace(/[\s_]/g,'');
        if (pc.length >= 6 && ns.includes(pc)) return { hit: true, reason: `Matched phrase: ${phrase}` };
        if (t.includes(p)) return { hit: true, reason: `Matched phrase: ${phrase}` };
    }

    for (const phrase of SCAM_OR_EXPLOIT_PHRASES_EXTRA) {
        const p = phrase.toLowerCase();
        if (p.length < 4) continue;
        const pc = p.replace(/[\s_]/g,'');
        if (pc.length >= 6 && ns.includes(pc)) return { hit: true, reason: `Matched phrase: ${phrase}` };
        if (t.includes(p)) return { hit: true, reason: `Matched phrase: ${phrase}` };
    }

    for (const phrase of SCAM_OR_EXPLOIT_PHRASES_EXTRA2) {
        const p = phrase.toLowerCase();
        if (p.length < 4) continue;
        const pc = p.replace(/[\s_]/g,'');
        if (pc.length >= 6 && ns.includes(pc)) return { hit: true, reason: `Matched phrase: ${phrase}` };
        if (t.includes(p)) return { hit: true, reason: `Matched phrase: ${phrase}` };
    }

    const domains = extractDomains(rawText || t);
    for (const d of domains) {
        // Skip any domain in the hard-coded safe list OR the guild's explicit /link allow list
        if (domainInList(d, _safeList)) continue;
        if (LINK_SHORTENERS.has(d)) return { hit: true, reason: `Suspicious link shortener: ${d}` };
        if (LINK_SHORTENERS_EXTRA.has(d)) return { hit: true, reason: `Suspicious link shortener: ${d}` };
        if (SCAM_DOMAIN_BLACKLIST.has(d)) return { hit: true, reason: `Blacklisted scam domain: ${d}` };
        const parts = d.split('.').filter(Boolean);
        const tld = parts.length ? parts[parts.length-1] : '';
        if (tld && SUSPICIOUS_TLDS.has(tld)) return { hit: true, reason: `Suspicious domain TLD: .${tld}` };
        if (/discord\.gift|discordapp\.gift|nitro\./i.test(d)) return { hit: true, reason: `Suspicious gift domain: ${d}` };
        if (/roblox|rbx|blox|bloxfruits|bloxfruit|discord|nitro/i.test(d) && /(free|gift|verify|claim|reward|promo|giveaway|generator)/i.test(d))
            return { hit: true, reason: `Brand+scam keyword domain pattern: ${d}` };
    }

    if ((rawText || '').length) {
        const r = rawText.toLowerCase();
        if (r.includes('http') && /v+e+r+i+f+y+|c+l+a+i+m+|g+i+v+e+a+w+a+y+/i.test(r)) return { hit: true, reason: 'Verification/giveaway + link pattern' };
        if (/r+o+b+l+o+x+\.?c+o+m/i.test(r) && /(free|claim|verify|generator)/i.test(r)) return { hit: true, reason: 'Roblox domain + scam keyword pattern' };
    }

    return { hit: false };
}


const TRIALS_CORE_WORDS = [
    'trial','trials','trails','trail','tril','trils','tials','trilas','triles','traiIs','trai1s','triaIs',
    'v4trial','v4trials','v3trial','v3trials','v2trial','v2trials','v4 trials','v3 trials','v2 trials',
    'race trial','race trials','race v4 trial','race v4 trials','racev4trial','racev4trials',
];
const TRIALS_HELP_VERBS = [
    'help','helping','assist','assisting','carry','carrying','boost','boosting','run','running','do','doing',
    'need','needing','want','wanting','wanna','wana','looking','searching','seeking','lf','lfg','lft','l4',
    'join','joining','team','party','squad','group','crew','duo','trio','quad',
    'anyone','someone','some1','any1','who','who can','can anyone','can any1',
    'need help','need carry','need a carry','need someone','need ppl','need people','need person',
    'help me','help with','help for','help to','help pls','help plz','help please',
];
const TRIALS_RECRUITMENT_HEADS = [
    'looking for','looking 4','l00king for','lookin for','lookin 4','searching for','seeking','need',
    'need a','need some','need few','need more','need extra','recruiting','recruit','gathering','forming',
    'building a team','making a team','assembling a team','forming a squad','making a squad',
    'anyone wanna','anyone want to','anyone can','anyone able to',
    'who wants to','who wanna','who can',
    'need teammates','need team mates','need teammates for','need players for','need people for',
];
const TRIALS_PEOPLE_WORDS = [
    'ppl','people','person','persons','player','players','member','members','guy','guys','man','men',
    'teammate','teammates','team mate','team mates','partner','partners',
    'carry','carries','carrier',
];
const TRIALS_NUMBER_WORDS = [
    '1','2','3','one','two','three','1x','2x','3x','1 more','2 more','3 more',
    'one more','two more','three more','need 1','need 2','need 3',
    'need one','need two','need three',
    'lf1','lf2','lf3','lfg1','lfg2','lfg3','lf 1','lf 2','lf 3',
];
const TRIALS_CONTEXT_WORDS = [
    'race','races','angel','human','mink','shark','ghoul','cyborg','draco',
    'v4','v3','v2','awakening','awaken','awakend','awakened',
    'mirror fractal','mirage','blue gear','gear','trial room','temple of time','temple',
    'full moon','fm','moon','night','server hop','hop','hopping',
    'private server','ps','priv server','vip',
    'time','timer','cooldown','cd',
    'turn','my turn','your turn','first turn','second turn','third turn',
    'payment','pay','paid','tips','tip','fee','beli','robux',
];

const TRIALS_STRICT_PHRASES = [
    'help with trials',
    'help with trial',
    'help with v4 trials',
    'help with v4 trial',
    'help me with trials',
    'help me with v4 trials',
    'need help with trials',
    'need help with v4 trials',
    'can anyone help with trials',
    'can anyone help with v4 trials',
    'who can help with trials',
    'who can help with v4 trials',
    'anyone help with trials',
    'anyone help with v4 trials',
    'need carry for trials',
    'need carry for v4 trials',
    'looking for people for trials',
    'looking for ppl for trials',
    'looking for 1 people for trials',
    'looking for 2 people for trials',
    'looking for 3 people for trials',
    'looking for 1 people for trails',
    'looking for 2 people for trails',
    'looking for 3 people for trails',
    'looking for one people for trials',
    'looking for two people for trials',
    'looking for three people for trials',
    'looking for one people for trails',
    'looking for two people for trails',
    'looking for three people for trails',
    'need 1 for trials',
    'need 2 for trials',
    'need 3 for trials',
    'need one for trials',
    'need two for trials',
    'need three for trials',
    'lf 1 for trials',
    'lf 2 for trials',
    'lf 3 for trials',
    'lfg for trials',
    'lfg v4 trials',
    'v4 trials help',
    'v4 trial help',
    'trial help',
    'trials help',
    'help trials',
    'help v4 trials',
    'carry trials',
    'carry v4 trials',
    'need trials',
    'need v4 trials',
    'doing trials',
    'doing v4 trials',
    'running trials',
    'running v4 trials',
    'anyone doing trials',
    'anyone doing v4 trials',
    'anyone running trials',
    'anyone running v4 trials',
    'who running trials',
    'who running v4 trials',
    'who doing trials',
    'who doing v4 trials',
    'need people for v4 trials',
    'need ppl for v4 trials',
    'need 1 for v4 trials',
    'need 2 for v4 trials',
    'need 3 for v4 trials',
    'looking for 1 for v4 trials',
    'looking for 2 for v4 trials',
    'looking for 3 for v4 trials',
    'recruiting for v4 trials',
    'recruiting for trials',
    'forming for v4 trials',
    'forming for trials',
    'building a team for v4 trials',
    'building a team for trials',
    'temple of time trials',
    'full moon trials',
    'mirage trials',
    'blue gear trials',
    'server hop for trials',
    'ps trials',
    'private server trials',
];

const TRIALS_STRICT_PHRASES_EXTRA = [
    'help w trials','help w trial','help w v4 trials','help w v4 trial','help w v3 trials','help w v2 trials',
    'help for trials','help for v4 trials','help to trials','help to v4 trials','help me trials','help me v4',
    'need help trials','need help v4','need help v4 trial','need help v4 trials','need help v3 trials','need help v2 trials',
    'lf trials','lf v4 trials','lf v4 trial','lfg trials','lfg v4','lfg v4 trial','lfg v4 trials',
    'looking for trials','looking for v4','looking for v4 trials','looking for v4 trial',
    'searching for trials','searching for v4 trials','seeking trials','seeking v4 trials',
    'need ppl v4 trials','need people v4 trials','need person v4 trials','need members v4 trials','need guys v4 trials',
    'need ppl trials','need people trials','need person trials','need members trials','need guys trials',
    'need 1 v4 trials','need 2 v4 trials','need 3 v4 trials','need 1 trials','need 2 trials','need 3 trials',
    'need one v4 trials','need two v4 trials','need three v4 trials','need one trials','need two trials','need three trials',
    'need 1 more v4 trials','need 2 more v4 trials','need 3 more v4 trials',
    'need one more v4 trials','need two more v4 trials','need three more v4 trials',
    'need 1 more trials','need 2 more trials','need 3 more trials',
    'need one more trials','need two more trials','need three more trials',
    'who for v4 trials','who for trials','anyone for v4 trials','anyone for trials',
    'who can do v4 trials','who can do trials','can anyone do v4 trials','can anyone do trials',
    'who can run v4 trials','who can run trials','anyone run v4 trials','anyone run trials',
    'who can carry v4 trials','who can carry trials','anyone carry v4 trials','anyone carry trials',
    'hosting trials','hosting v4 trials','host trials','host v4 trials','need host trials','need host v4 trials',
    'fm trials','full moon trials','fm v4','full moon v4','fullmoon trials','fullmoon v4',
    'mirage trials','mirage v4','mirage island v4','mirage island trials',
    'blue gear v4','bluegear v4','blue gear trials','bluegear trials',
    'mirror fractal v4','mirror fractal trials','mirrorfractal v4','mirrorfractal trials',
    'temple of time v4 trials','temple of time trials','temple time v4','temple time trials',
    'trial room v4','trial room trials','trialroom v4','trialroom trials',
    'serverhop v4 trials','server hop v4 trials','server hop trials','serverhop trials',
    'ps v4 trials','private server v4 trials','vip v4 trials','priv server v4 trials',
    'angel v4 trials','human v4 trials','mink v4 trials','shark v4 trials','ghoul v4 trials','cyborg v4 trials','draco v4 trials',
    'angel trials','human trials','mink trials','shark trials','ghoul trials','cyborg trials','draco trials',
    'v4 help','v4 carry','v4 run','v4 service',
    'race v4 help','race v4 carry','race v4 run','race v4 service',
    'help with race v4','help with race v4 trials','need help race v4','need help race v4 trials',
    'looking for race v4','looking for race v4 trials','lf race v4','lf race v4 trials',
    'need more for v4','need more for v4 trials','need more for trials',
    'need teammate for v4 trials','need teammates for v4 trials','need teammate for trials','need teammates for trials',
    'need partner for v4 trials','need partners for v4 trials','need partner for trials','need partners for trials',
    'join for v4 trials','join for trials','join v4 trials','join trials',
    'team for v4 trials','team for trials','party for v4 trials','party for trials','squad for v4 trials','squad for trials',
];

// ══════════════════════════════════════════════════════════
//  BOT CLIENT
// ══════════════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
    ],
    // BUG FIX: Partials are required for the bot to receive DMs and DM-based
    // button interactions (appeal buttons sent to exiled users).
    // Without these, Discord silently drops DM events.
    partials: [Partials.Channel, Partials.Message],
});

function detectTrialsOrTrialsRecruitment(cleanText) {
    const t = cleanText;
    const ns = t.replace(/[\s_]/g,'');
    const hasTrialWord = /(?<![a-z])t+r+i+a+l+s*(?![a-z])/.test(t) || /(?<![a-z])t+r+a+i+l+s*(?![a-z])/.test(t);
    if (!hasTrialWord) return false;

    for (const phrase of TRIALS_STRICT_PHRASES) {
        const p = phrase.toLowerCase().replace(/[\s_]/g,'');
        if (p.length >= 8 && ns.includes(p)) return true;
    }

    for (const phrase of TRIALS_STRICT_PHRASES_EXTRA) {
        const p = phrase.toLowerCase().replace(/[\s_]/g,'');
        if (p.length >= 8 && ns.includes(p)) return true;
    }

    for (const cw of TRIALS_CORE_WORDS) {
        const c = cw.toLowerCase().replace(/[\s_]/g,'');
        if (c.length >= 4 && ns.includes(c)) {
            for (const v of TRIALS_HELP_VERBS) {
                const vc = v.toLowerCase().replace(/[\s_]/g,'');
                if (vc.length >= 2 && ns.includes(vc) && Math.abs(ns.indexOf(c) - ns.indexOf(vc)) <= 120) return true;
            }
            for (const h of TRIALS_RECRUITMENT_HEADS) {
                const hc = h.toLowerCase().replace(/[\s_]/g,'');
                if (hc.length >= 4 && ns.includes(hc) && Math.abs(ns.indexOf(c) - ns.indexOf(hc)) <= 160) return true;
            }
            for (const n of TRIALS_NUMBER_WORDS) {
                const nc = n.toLowerCase().replace(/[\s_]/g,'');
                if (nc.length >= 1 && ns.includes(nc) && Math.abs(ns.indexOf(c) - ns.indexOf(nc)) <= 160) {
                    for (const pw of TRIALS_PEOPLE_WORDS) {
                        const pc = pw.toLowerCase().replace(/[\s_]/g,'');
                        if (pc.length >= 2 && ns.includes(pc) && Math.abs(ns.indexOf(pc) - ns.indexOf(nc)) <= 60) return true;
                    }
                    return true;
                }
            }
            for (const ctx of TRIALS_CONTEXT_WORDS) {
                const xc = ctx.toLowerCase().replace(/[\s_]/g,'');
                if (xc.length >= 2 && ns.includes(xc) && Math.abs(ns.indexOf(c) - ns.indexOf(xc)) <= 120) return true;
            }
        }
    }

    if (/(?:help|carry|run|doing|do|need|lf|lfg|looking|searching|join|team|partner|who|anyone)[\s\W_]{0,12}(?:with|for|to)?[\s\W_]{0,12}(?:v2|v3|v4)?[\s\W_]{0,12}(?:trial|trials|trails)/i.test(t)) return true;
    if (/(?:v2|v3|v4)[\s\W_]{0,8}(?:trial|trials|trails)/i.test(t)) return true;

    const num = '(?:1|2|3|one|two|three)';
    const ppl = '(?:ppl|people|person|members|guys|players|mates|man|men)';
    if (new RegExp(`(?:looking[\\s\\W_]{0,6}for|need|lf|lfg|searching|recruiting|need[\\s\\W_]{0,6}${ppl}|need[\\s\\W_]{0,6}${num})[\\s\\W_]{0,12}${num}?(?:[\\s\\W_]{0,10}${ppl})?[\\s\\W_]{0,12}(?:for|to|4|with)?[\\s\\W_]{0,12}(?:v2|v3|v4)?[\\s\\W_]{0,12}(?:trial|trials|trails)`, 'i').test(t)) return true;

    if (ns.includes('helpwithtrials') || ns.includes('helpwithtrial') || ns.includes('helpwithv4trials') || ns.includes('helpwithv4trial')) return true;
    if (ns.includes('lookingfor1peoplefortrials') || ns.includes('lookingfor2peoplefortrials') || ns.includes('lookingfor3peoplefortrials')) return true;
    if (ns.includes('lookingfor1peoplefortrails') || ns.includes('lookingfor2peoplefortrails') || ns.includes('lookingfor3peoplefortrails')) return true;
    return false;
}

function detectRaidOrDungeonRecruitment(cleanText) {
    const t = (cleanText || '').toLowerCase();
    const ns = t.replace(/[\s_]/g,'');

    const raidWord = /\b(?:raid|raids|riad|riads)\b/i;

    const hasTarget =
        raidWord.test(t) ||
        /\bdungeons?\b/i.test(t) ||
        /\bdungeon\b/i.test(t) ||
        /\bdunegon\b/i.test(t) ||
        /\bchallenge\b/i.test(t) ||
        /\bnormal\s*dungeons?\b/i.test(t) ||
        /\bhard\s*dungeons?\b/i.test(t) ||
        /\bchallenge\s*dungeons?\b/i.test(t) ||
        /\bnormal\s*raids?\b/i.test(t) ||
        /\bhard\s*raids?\b/i.test(t) ||
        /\bchallenge\s*raids?\b/i.test(t);

    if (!hasTarget) return false;

    if (/(?:host|hosting|carry|carrying|run|running|doing|do|need|lf|lfg|looking)[\s\W_]{0,14}(?:for|to|4|with)?[\s\W_]{0,14}(?:people|ppl|players|members|guys)?[\s\W_]{0,14}(?:who\s*wanna\s*join|wanna\s*join|want\s*to\s*join|to\s*join|join)?[\s\W_]{0,14}(?:raid|raids|riad|riads|normal\s*raid|hard\s*raid|challenge\s*raid|dungeon|dungeons|dunegon|normal\s*dungeon|hard\s*dungeon|challenge\s*dungeon)/i.test(t)) return true;

    if (ns.includes('lookingforpeopleforraid') || ns.includes('lfpeopleforraid') || ns.includes('lookingforpplforraid') || ns.includes('lfpplforraid')) return true;
    if (ns.includes('lookingforpeoplefordungeon') || ns.includes('lfpeoplefordungeon') || ns.includes('lookingforpplfordungeon') || ns.includes('lfpplfordungeon')) return true;

    if (ns.includes('hostingraid') || ns.includes('hostraid') || ns.includes('carryraid') || ns.includes('carryingraid')) return true;
    if (ns.includes('hostingdungeon') || ns.includes('hostdungeon') || ns.includes('carrydungeon') || ns.includes('carryingdungeon')) return true;

    // "hosting levi" / "host levi" — explicit leviathan hosting
    if (/\b(?:host|hosting)\s+levi(?:athan|than|atan|thn)?\b/i.test(t)) return true;

    // "hosting <any boss>" / "host <any boss>" — dynamic check against all boss names & aliases
    if (/\b(?:host|hosting)\b/i.test(t)) {
        const allBossNames = [
            ...BOSSES,
            ...Object.keys(BOSS_ALIASES),
            ...Object.values(BOSS_ALIASES),
        ];
        const nsNoSpace = ns;
        for (const bossRaw of allBossNames) {
            const b = String(bossRaw).toLowerCase().replace(/[\s_\-']/g, '');
            if (b.length < 3) continue;
            // Check no-space concat: "hosting" + boss or "host" + boss
            if (nsNoSpace.includes('hosting' + b) || nsNoSpace.includes('host' + b)) return true;
            // Check spaced/loose pattern
            if (new RegExp(`\\b(?:host|hosting)[\\s\\W_]{0,10}${b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`, 'i').test(ns.replace(/[\s_]/g, '') === nsNoSpace ? t : t)) return true;
        }
    }

    // added difficulty + join combos (no-space)
    if (ns.includes('whowannajoinraid') || ns.includes('whowannajoindungeon')) return true;
    if (ns.includes('normalraid') || ns.includes('hardraid') || ns.includes('challengeraid')) return true;
    if (ns.includes('normaldungeon') || ns.includes('harddungeon') || ns.includes('challengedungeon')) return true;

    return false;
}

function isGamesHubChannelId(channelId, gs) {
    const id = String(channelId || '');
    if (!id) return false;
    if (GAMES_HUB_CHANNELS && GAMES_HUB_CHANNELS.has(id)) return true;
    // Multi-channel support: check the gamesHubIds array first
    if (Array.isArray(gs?.gamesHubIds) && gs.gamesHubIds.length > 0) {
        if (gs.gamesHubIds.includes(id)) return true;
    }
    const conf = String(gs?.gamesHubId || DEFAULT_GAMES_HUB_ID || '');
    return conf ? id === conf : false;
}

function getStrictness(gs) {
    const v = Number(gs?.regexStrictness ?? 5);
    if (!Number.isFinite(v)) return 5;
    return Math.max(1, Math.min(10, v));
}

function strictnessHasBypassMode(gs, min = 9) {
    return getStrictness(gs) >= min;
}

/**
 * Returns the AI confidence threshold scaled by regexStrictness.
 * Higher strictness = lower threshold = flags more aggressively.
 */
function getAiConfidenceThreshold(gs) {
    const s = getStrictness(gs);
    if (s <= 2) return 0.97;
    if (s <= 4) return 0.93;
    if (s <= 6) return 0.90;
    if (s <= 8) return 0.82;
    return 0.72;
}

/**
 * Returns true if the guild has completed /setup (channels have been configured).
 * When false, ALL redirect checks are skipped — only scam/spam/begging/acctrade run.
 */
function isServerSetup(gs) {
    return !!(gs?.serverSetupComplete);
}

/**
 * Marks the server as configured (channels saved). Does NOT enable any detections.
 * All detections remain off until /setup completeset is run.
 */
function applySetupRedirects(gs) {
    gs.serverSetupComplete = true;
    // NO detections are enabled here — use /setup completeset to turn everything on.
    // capsSpamEnabled, stretchSpamEnabled, noAffiliationEnabled are always manual only.
    if (gs.noAffiliationEnabled === undefined) gs.noAffiliationEnabled = false;
}

/**
 * Called by /setup completeset.
 * Enables ALL detections except capsSpamEnabled, stretchSpamEnabled, noAffiliationEnabled —
 * those three must always be turned on manually.
 */
function applyAllDetections(gs) {
    gs.serverSetupComplete    = true;
    gs.checksEnabled          = true;
    gs.tradeRedirectEnabled   = true;
    gs.serviceRedirectEnabled = true;
    gs.commandRedirectEnabled = true;
    gs.spamWarnEnabled        = true;
    gs.begWarnEnabled         = true;
    gs.scamWarnEnabled        = true;
    gs.accTradeWarnEnabled    = true;
    gs.scamEnabled            = true;
    gs.linkPolicyEnabled      = true;
    gs.emojiSpamEnabled       = true;
    gs.dupeSpamEnabled        = true;
    gs.scanEditsEnabled       = true;
    // ── Manual-only (NOT enabled by /setup completeset) ──────────────
    // capsSpamEnabled      — manual only (/capsconfig on)
    // stretchSpamEnabled   — manual only (/stretchconfig on)
    // noAffiliationEnabled — manual only (/noaffiliation enable)
    // zalgoEnabled         — manual only (/zalgoconfig enabled:true) — too aggressive by default
    // invitePolicyEnabled  — manual only (/invitepolicy on) — too aggressive by default
    // attachmentPolicyEnabled — manual only (/attachmentpolicy on) — too aggressive by default
    // timeoutEnabled       — manual only (/timeout enable) — too aggressive by default
    // aiEnabled            — manual only (requires API key setup)
}

// ══════════════════════════════════════════════════════════
//  1v1 / PvP SPLIT-MESSAGE TRACKER
//  "who wanna 1v1" alone → tracked; if next msg says "blox fruits" → flag
//  "who wanna 1v1 in bf" in single msg → flag immediately
// ══════════════════════════════════════════════════════════
const pvpSplitTracker = new Map(); // key: `${guildId}:${userId}` → { ts: timestamp }
const PVP_SPLIT_TTL   = 90_000;   // 90 seconds (matches SPLIT_MESSAGE_TTL)

// Regex: matches 1v1/pvp/duel challenge phrased as "who wanna ..." style invites
const ONE_V_ONE_INVITE_RE = /\bwho\s+(?:wanna?|wants?\s+to|can|is\s+down(?:\s+to)?|tryna?|is)\s+(?:1\s*[vV]\s*1|1vs1|one\s*[vV]\s*one|pvp|duel)\b/i;
// Regex: a message that IS just a 1v1 invite + optionally trailing punctuation/emoji, with no BF context
const ONE_V_ONE_SOLO_RE  = /^[\s\S]{0,20}(?:who\s+(?:wanna?|wants?\s+to|can|is\s+down(?:\s+to)?|tryna?|is)\s+(?:1\s*[vV]\s*1|1vs1|one\s*[vV]\s*one|pvp|duel))[\s\S]{0,30}$/i;
// Regex: Blox Fruits context — game name mentioned
const BF_PVP_CONTEXT_RE  = /\b(?:bf|blox\s*fruits?|bloxfruits?)\b/i;

function recordPvpSplit(guildId, userId) {
    pvpSplitTracker.set(`${guildId}:${userId}`, { ts: Date.now() });
}
function getPvpSplit(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const e   = pvpSplitTracker.get(key);
    if (!e) return false;
    if (Date.now() - e.ts > PVP_SPLIT_TTL) { pvpSplitTracker.delete(key); return false; }
    return true;
}
function clearPvpSplit(guildId, userId) {
    pvpSplitTracker.delete(`${guildId}:${userId}`);
}
setInterval(() => {
    const now = Date.now();
    for (const [k, e] of pvpSplitTracker) {
        if (now - (e.ts || 0) > PVP_SPLIT_TTL * 2) pvpSplitTracker.delete(k);
    }
}, 120_000);

function buildFuzzyTokenPattern(token, strictness) {
    const t = String(token || '').toLowerCase();
    const base = t.replace(/[\s\-']/g, '');
    if (!base) return '';
    if (strictness <= 2) return escapeRegex(base);

    const parts = [];
    for (const ch of base) {
        let cls = escapeRegex(ch);
        if (strictness >= 7) {
            if (ch === 'a') cls = '(?:a|4)';
            else if (ch === 'e') cls = '(?:e|3)';
            else if (ch === 'i') cls = '(?:i|1|!)';
            else if (ch === 'o') cls = '(?:o|0)';
            else if (ch === 's') cls = '(?:s|5)';
            else if (ch === 't') cls = '(?:t|7)';
            else if (ch === 'g') cls = '(?:g|9)';
        }
        const rep = strictness >= 9 ? '{1,4}' : '{1,2}';
        parts.push(`${cls}${rep}`);
    }
    const sep = strictness >= 10 ? '[^a-z0-9]{0,4}' : (strictness >= 8 ? '[^a-z0-9]{0,2}' : '[^a-z0-9]{0,1}');
    return parts.join(sep);
}

function makeIntentTargetBypassRegex(gs, intentWords, target) {
    const strict = getStrictness(gs);
    if (!target) return null;
    const tgtRaw = String(target).toLowerCase();
    const tgt = tgtRaw.replace(/[\s\-']/g, '');
    if (!tgt || tgt.length < 4) return null;
    const intents = (intentWords || []).map(w => String(w).toLowerCase()).filter(Boolean);
    if (!intents.length) return null;

    const intentAlt = intents.map(escapeRegex).join('|');
    const join = strict >= 10 ? '[\\s\\W_]{0,20}' : (strict >= 8 ? '[\\s\\W_]{0,10}' : (strict >= 4 ? '[\\s_]{0,4}' : '[\\s_]{1,2}'));
    const targetPat = strict >= 10 ? buildFuzzyTokenPattern(tgtRaw, strict) : (strict >= 8 ? buildFuzzyTokenPattern(tgtRaw, strict) : escapeRegex(tgt));
    return new RegExp(`(?:^|[^a-z0-9])(?:${intentAlt})${join}${targetPat}(?![a-z0-9])`, 'i');
}
function makeDefaultData() {
    return {
        violations: {}, exiles: {}, immunity: {},
        guildSettings: {}, appeals: {}, spamTracker: {},
        bans: {}, timeouts: {}, hardBans: {},
        logMessages: [],
        guildStats: {},
        cases: {},
        caseCounter: 0,
    };
}

// ── Violation data helpers (supports old numeric entries for backward compat) ──
function getViolationCount(data, uid) {
    const v = data.violations[uid];
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    return v.count || 0;
}
function getViolationHistory(data, uid) {
    const v = data.violations[uid];
    if (!v || typeof v === 'number') return [];
    return Array.isArray(v.history) ? v.history : [];
}
function addViolationEntry(data, uid, { reason = 'Rule violation', category = 'unknown', by = null } = {}) {
    const count = getViolationCount(data, uid);
    const history = getViolationHistory(data, uid);
    const newCount = count + 1;
    const warnId = `w_${Date.now()}_${uid}`;
    history.push({ warnId, reason: String(reason).slice(0, 300), category: String(category).slice(0, 80), timestamp: Date.now(), by: by ? String(by) : null });
    data.violations[uid] = { count: newCount, history };
    return newCount;
}
function getLastWarnId(data, uid) {
    const history = getViolationHistory(data, uid);
    if (!history.length) return null;
    return history[history.length - 1].warnId || null;
}
function clearViolationEntry(data, uid) {
    data.violations[uid] = { count: 0, history: [] };
}
function decrementViolationEntry(data, uid) {
    const count = getViolationCount(data, uid);
    const history = getViolationHistory(data, uid);
    const newCount = Math.max(0, count - 1);
    data.violations[uid] = { count: newCount, history };
    return newCount;
}

function getGuildCases(guildId, data) {
    data.cases = data.cases || {};
    if (!data.cases[guildId]) data.cases[guildId] = {};
    return data.cases[guildId];
}

function nextCaseId(data) {
    data.caseCounter = Number(data.caseCounter || 0) + 1;
    return String(data.caseCounter);
}

function createCaseFromMessage(message, data, gs, opts) {
    try {
        const guildId = message.guild?.id;
        if (!guildId) return null;
        const cases = getGuildCases(guildId, data);
        const id = nextCaseId(data);
        const now = Date.now();
        const payload = {
            id,
            guildId,
            userId: message.author?.id || null,
            channelId: message.channel?.id || null,
            messageId: message.id || null,
            messageUrl: message.url || null,
            createdAt: now,
            category: String(opts?.footerLabel || 'Violation').toLowerCase(),
            title: String(opts?.title || 'Violation'),
            action: String(opts?.action || 'warn'),
            reason: String(opts?.reason || ''),
            content: String(opts?.details || message.content || '').slice(0, 2000),
            notes: [],
            voided: false,
            voidReason: null,
            voidedAt: null,
        };
        cases[id] = payload;
        data.cases[guildId] = cases;
        saveData(data);
        return payload;
    } catch {
        return null;
    }
}

function addCaseNote(guildId, data, caseId, actorId, text) {
    const cases = getGuildCases(guildId, data);
    const c = cases?.[caseId];
    if (!c) return null;
    c.notes = Array.isArray(c.notes) ? c.notes : [];
    c.notes.push({ at: Date.now(), by: String(actorId || ''), text: String(text || '').slice(0, 500) });
    cases[caseId] = c;
    data.cases[guildId] = cases;
    saveData(data);
    return c;
}

function voidCase(guildId, data, caseId, actorId, reason) {
    const cases = getGuildCases(guildId, data);
    const c = cases?.[caseId];
    if (!c) return null;
    c.voided = true;
    c.voidReason = String(reason || '').slice(0, 500);
    c.voidedAt = Date.now();
    addCaseNote(guildId, data, caseId, actorId, `VOIDED: ${c.voidReason}`);
    cases[caseId] = c;
    data.cases[guildId] = cases;
    saveData(data);
    return c;
}

function getGuildStats(guildId, data) {
    data.guildStats = data.guildStats || {};
    if (!data.guildStats[guildId]) {
        data.guildStats[guildId] = {
            counters: {
                commandUsage: 0,
                commandAbuse: 0,
                spam: 0,
                accountTrading: 0,
                begging: 0,
                trade: 0,
                service: 0,
                race: 0,
                scam: 0,
                linkPolicy: 0,
                mentionSpam: 0,
                raidLockdown: 0,
                aiFlag: 0,
            },
            lastUpdated: Date.now(),
        };
    }
    return data.guildStats[guildId];
}

function incStat(guildId, data, key, amt = 1) {
    const gs = getGuildStats(guildId, data);
    gs.counters[key] = (gs.counters[key] || 0) + (amt || 1);
    gs.lastUpdated = Date.now();
    data.guildStats[guildId] = gs;
    return gs.counters[key];
}
function saveData(data) {
    try {
        createBackupFile(DATA_FILE);
        rotateBackups(25);
        safeWriteJsonAtomic(DATA_FILE, data);
    } catch(e) {
        console.error('saveData error:', e);
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        } catch {}
    }
}

// ══════════════════════════════════════════════════════════
//  MULTI-CHANNEL HELPERS
// ══════════════════════════════════════════════════════════
// Valid category keys for channelconfig
const CHANNEL_CATEGORIES = {
    trade:        { key: 'tradeChannelIds',               label: '🔄 Trade',               desc: 'fast-trading, slow-trading, fruit-value, etc.' },
    raid:         { key: 'raidServiceChannelIds',          label: '⚔️ Raid/Service',         desc: 'raids, dungeons, bosses, lvling, sword quests, enchants, materials' },
    race:         { key: 'raceV4ServiceChannelIds',        label: '🏁 Race V4/Trials',       desc: 'race-v4-service, trials, blue gear' },
    seaevents:    { key: 'seaEventsChannelIds',            label: '🌊 Sea Events',           desc: 'general sea-events channel(s)' },
    mirage:       { key: 'mirageIslandChannelIds',         label: '🏝️ Mirage Island',        desc: 'mirage-island' },
    prehistoric:  { key: 'prehistoricIslandChannelIds',    label: '🦕 Prehistoric Island',   desc: 'prehistoric-island' },
    kitsune:      { key: 'kitsuneIslandChannelIds',        label: '🦊 Kitsune Island',       desc: 'kitsune-island' },
    leviathan:    { key: 'leviathanChannelIds',            label: '🐉 Leviathan/Frozen',     desc: 'leviathan-island, frozen dimension, levi heart' },
};

/** Get the multi-channel array for a category, falling back to the legacy single-ID field. */
function getChannelIds(gs, categoryKey) {
    const arr = gs[categoryKey];
    if (Array.isArray(arr) && arr.length > 0) return arr;
    // Legacy fallbacks
    if (categoryKey === 'tradeChannelIds') return gs.tradeChannelId ? [gs.tradeChannelId] : [];
    if (categoryKey === 'raidServiceChannelIds' || categoryKey === 'raceV4ServiceChannelIds' ||
        categoryKey === 'seaEventsChannelIds' || categoryKey === 'mirageIslandChannelIds' ||
        categoryKey === 'prehistoricIslandChannelIds' || categoryKey === 'kitsuneIslandChannelIds' ||
        categoryKey === 'leviathanChannelIds') {
        return gs.servicesChannelId ? [gs.servicesChannelId] : [];
    }
    return [];
}

/** First channel ID in the pool, or null. */
function primaryChannelId(gs, categoryKey) {
    const ids = getChannelIds(gs, categoryKey);
    return ids.length > 0 ? ids[0] : null;
}

/** Is the given channel one of the "correct" trade channels? */
function isInCorrectTradeChannel(channelId, gs) {
    const ids = getChannelIds(gs, 'tradeChannelIds');
    return ids.includes(channelId);
}

/** Is the given channel one of any correct service channel? */
function isInCorrectServiceChannel(channelId, gs) {
    const allServiceIds = [
        gs.servicesChannelId,
        ...(Array.isArray(gs.servicesChannelIds) ? gs.servicesChannelIds : []),
        ...getChannelIds(gs, 'raidServiceChannelIds'),
        ...getChannelIds(gs, 'raceV4ServiceChannelIds'),
        ...getChannelIds(gs, 'seaEventsChannelIds'),
        ...getChannelIds(gs, 'mirageIslandChannelIds'),
        ...getChannelIds(gs, 'prehistoricIslandChannelIds'),
        ...getChannelIds(gs, 'kitsuneIslandChannelIds'),
        ...getChannelIds(gs, 'leviathanChannelIds'),
    ].filter(Boolean);
    return allServiceIds.includes(channelId);
}

/** Leviathan / frozen-dimension detection regex */
const LEVI_REDIRECT_RE = /\b(leviathan|levi\s*heart|levi\b|frozen\s*dimension|frozen\s*dim)\b/i;
/** Kitsune island detection */
const KITSUNE_ISLAND_RE = /\bkitsune\s*island\b/i;
/** Prehistoric island detection */
const PREHISTORIC_ISLAND_RE = /\bprehistoric\s*island\b|\bprehistoric\s*isle\b|\bprehisto?ric\b/i;
/** Mirage island detection */
const MIRAGE_ISLAND_RE = /\bmirage\s*island\b|\bmirage\s*isle\b|\bmirage\b/i;
/** Race V4 / trials / blue gear detection */
const RACE_V4_SERVICE_RE = /\b(race\s*v4|race\s*reroll|trials?|blue\s*gear)\b/i;
/** Raid / dungeon / boss service detection */
const RAID_SERVICE_RE = /\b(raid|dungeon|raid\s*boss|boss\s*carry|lev?el\s*up|lvl\s*up|lvling\s*up|leveling|sword\s*quest|cdk|ttk|enchant|material|bounty\s*reset|bounty\s*farm|materials?\s*hunt|pain\s*and\s*suffering|haze\s*of\s*misery|fear\s*the\s*reaper|sense\s*of\s*duty|the\s*hunter|soulless|legendary\s*sword\s*dealer|sword\s*dealer|mysterious\s*man|mastery\s*grind|mastery\s*farm|mastery\s*300|2m\s*beli|beli\s*purchase|wando\s*purchase|shisui\s*purchase|saddi\s*purchase|ttk\s*fusion|ttk\s*quest|cdk\s*quest|cdk\s*chain|ttk\s*chain|tushita\s*quest|yama\s*quest)\b/i;

// ── Detects farm/grind/hunt/help intent paired with materials or NPCs
//    (independent of svcIntent — catches "grind gorilla", "help shark tooth", etc.)
const MATERIAL_NPC_FARM_RE = /\b(?:grind(?:ing)?|farm(?:ing)?|hunt(?:ing)?|help(?:\s+(?:with|me|out))?|need(?:ing)?|lf(?:\s+for)?|looking\s+for|hosting|anyone\s+(?:farm|grind|hunt)|who(?:\s+(?:wanna?|wants?\s+to|is)\s+(?:farm|grind|hunt))?|wanna?\s+(?:farm|grind|hunt|do)|want(?:s?\s+to)?\s+(?:farm|grind|hunt))\b/i;

/**
 * Given what was detected in a service violation, pick the best redirect channel pool.
 * Returns { channelId, label } — channelId is the primary ID to redirect to (may be null),
 * label is human-readable for the bot message.
 */
function pickServiceRedirectTarget(gs, detected) {
    const fallback = { channelId: gs.servicesChannelId, label: 'the services channel' };
    const pick = (catKey, label) => {
        const id = primaryChannelId(gs, catKey);
        return id ? { channelId: id, label } : fallback;
    };
    if (detected.leviathan) return pick('leviathanChannelIds', 'the leviathan/frozen-dimension channel');
    if (detected.kitsune)   return pick('kitsuneIslandChannelIds', 'the kitsune island channel');
    if (detected.prehistoric) return pick('prehistoricIslandChannelIds', 'the prehistoric island channel');
    if (detected.mirage)    return pick('mirageIslandChannelIds', 'the mirage island channel');
    if (detected.seaEvent)  return pick('seaEventsChannelIds', 'the sea-events channel');
    if (detected.raceV4)    return pick('raceV4ServiceChannelIds', 'the race/trials channel');
    if (detected.raid)      return pick('raidServiceChannelIds', 'the raid/service channel');
    return fallback;
}

/** Format a channel ID array for display, e.g. "<#111>, <#222>" */
function formatChannelIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return 'None';
    return ids.map(id => `<#${id}>`).join(', ');
}

function exportGuildConfig(guildId, data) {
    const gs = getGuildSettings(guildId, data);
    const out = {
        guildId,
        guildSettings: gs,
        immunity: data.immunity?.[guildId] || {},
        categoryImmunity: data.categoryImmunity?.[guildId] || {},
    };
    return out;
}

function importGuildConfig(guildId, data, payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid config payload');
    if (!payload.guildSettings || typeof payload.guildSettings !== 'object') throw new Error('Missing guildSettings');
    data.guildSettings = data.guildSettings || {};
    data.immunity = data.immunity || {};
    data.categoryImmunity = data.categoryImmunity || {};
    data.guildSettings[guildId] = Object.assign(getGuildSettings(guildId, data), payload.guildSettings);
    if (payload.immunity && typeof payload.immunity === 'object') data.immunity[guildId] = payload.immunity;
    if (payload.categoryImmunity && typeof payload.categoryImmunity === 'object') data.categoryImmunity[guildId] = payload.categoryImmunity;
    return data.guildSettings[guildId];
}

// Per-guild settings helpers
function getGuildSettings(guildId, data) {
    if (!data.guildSettings[guildId]) {
        data.guildSettings[guildId] = {
            tradeChannelId:    DEFAULT_TARGET_CHANNEL_ID,
            tradeChannelIds:   [],   // multi: fast-trading, slow-trading, fruit-value, etc.
            servicesChannelId: DEFAULT_SERVICES_CHANNEL_ID,
            servicesChannelIds: [],  // multi: general service channels (fallback pool)
            // ── Specific service channel pools (each supports multiple channels) ──
            raidServiceChannelIds:       [],  // raids, dungeons, raid bosses, services, bosses, lvling, sword quests (CDK/TTK), enchants, materials
            raceV4ServiceChannelIds:     [],  // race-v4-service, trials, blue gear
            seaEventsChannelIds:         [],  // general sea-events channel(s)
            mirageIslandChannelIds:      [],  // mirage-island
            prehistoricIslandChannelIds: [],  // prehistoric-island
            kitsuneIslandChannelIds:     [],  // kitsune-island
            leviathanChannelIds:         [],  // leviathan-island, frozen dimension, levi heart
            gamesHubId:        DEFAULT_GAMES_HUB_ID,
            gamesHubIds:       [],   // multi: all allowed bot-commands channels
            exiledRoleId:      DEFAULT_EXILED_ROLE_ID,
            logChannelId:      null,
            appealsChannelId:  null,
            redirectEmojiId:   DEFAULT_REDIRECT_EMOJI_ID,
            scamEnabled:       false,
            commandRedirectEnabled: false,  // off until /setup completeset is run
            serviceRedirectEnabled: false,  // off until /setup completeset is run
            tradeRedirectEnabled:   false,  // off until /setup completeset is run
            spamWarnEnabled:        false,
            begWarnEnabled:         false,
            scamWarnEnabled:        false,
            accTradeWarnEnabled:    false,
            aiEnabled: false,
            checksEnabled: false,
            noAffiliationEnabled: false,
            serverSetupComplete: false,  // true once /setup or /set channels run
            exileStripRoles: false,
            botOwnerId: null,
            botFooterText: null,
            botInfoPublic: false,

            regexStrictness: 5,

            linkMode: 'strict',
            linkAction: 'warn',

            verifyGateEnabled: false,
            verifyMinAccountAgeDays: 7,
            verifyRequiredRoleId: null,
            verifyGateAction: 'warn',

            timeoutEnabled: false,
            timeoutMinutesSpam: 10,
            timeoutMinutesScam: 60,
            timeoutMinutesCommand: 5,
            timeoutMinutesTrade: 5,
            timeoutMinutesService: 5,

            enforcementMode: 'enforce',
            categoryPolicies: {},

            violationThreshold: VIOLATION_THRESHOLD,
            exileDurationMins:  EXILE_DURATION_MINS,

            raidModeEnabled:   false,
            raidAutoEnabled:   true,
            raidJoinWindowSec: 25,
            raidJoinThreshold: 7,
            raidLockdownMins:  8,
            raidLockChannels:  true,
            raidNotifyChannelId: null,
            raidLinkBlockAll:  true,
            raidNewAccountDays: 7,

            capsSpamEnabled: false,
            capsMaxPercent: 70,
            capsMinLetters: 16,
            capsMaxRun: 28,

            emojiSpamEnabled: false,
            emojiMaxCount: 18,
            emojiWindowSec: 12,

            zalgoEnabled: false,
            zalgoMaxCombining: 12,

            stretchSpamEnabled: false,
            stretchMaxCharRun: 12,
            stretchMaxPunctRun: 10,
            stretchMaxWordRepeat: 5,

            dupeSpamEnabled: false,
            dupeWindowSec: 20,
            dupeThreshold: 4,
            dupeMinLen: 10,

            invitePolicyEnabled: false,
            inviteAllowlistDomains: [
                'discord.com','discord.gg','discordapp.com',
            ],
            inviteDenylistDomains: [
                'discord.gg','discord.com','discordapp.com',
                'discord.me','discord.io','discord.li','discord.id',
                'disboard.org','top.gg',
                'invite.gg','inv.gg','discord.link','dsc.gg',
                'dis.gd','discord.gift',
                'discordcdn.com','cdn.discordapp.com',
            ],
            inviteAllowedChannelIds: [],

            attachmentPolicyEnabled: false,
            attachmentBlockExts: [
                'exe','scr','com','bat','cmd','ps1','vbs','js','jse','jar','msi','msp','reg','dll','sys',
                'apk','ipa','dmg','pkg','app','appimage','iso',
                'lnk','url','hta','wsf','wsh','cpl','pif',
                'zip','rar','7z','tar','gz','bz2','xz','zst',
                'ace','arj','cab','lzh','lz','lzma','sfx',
                'docm','xlsm','pptm','dotm','xlam','ppam',
                'chm','iso','img','vhd','vhdx','vmdk',
                'psm1','psd1','psc1','msh','msh1','msh2','mshxml','msh1xml','msh2xml',
                'scf','inf','gadget','application','appref-ms',
                'swf','flv','class',
                'py','pyw','rb','pl','php','sh','zsh','bash','fish',
                'c','cpp','h','hpp','cs','go','rs','java','kt','swift',
                'html','htm','xhtml','svg','xml',
                'json','yml','yaml','toml','ini','cfg',
            ],
            linkPolicyEnabled: false,
            linkAllowlistedDomains: [
                // ── Discord (every CDN/attachment/media variant) ──────────────
                'discord.com','discord.gg','discordapp.com','discordapp.net',
                'discordcdn.com','discord.media',
                'cdn.discordapp.com','media.discordapp.net',
                'images-ext-1.discordapp.net','images-ext-2.discordapp.net',
                'images-ext-3.discordapp.net','images-ext-4.discordapp.net',
                'attachments.discordapp.com',
                'support.discord.com',
                // ── Roblox ───────────────────────────────────────────────────
                'roblox.com','rbxcdn.com','rbx.com',
                // ── Tenor (GIFs) ─────────────────────────────────────────────
                'tenor.com','media.tenor.com','c.tenor.com','g.tenor.com',
                // ── Giphy (GIFs) ─────────────────────────────────────────────
                'giphy.com','media.giphy.com','i.giphy.com',
                // ── Imgur ─────────────────────────────────────────────────────
                'imgur.com','i.imgur.com',
                // ── YouTube ───────────────────────────────────────────────────
                'youtube.com','youtu.be','i.ytimg.com',
                // ── Twitch ────────────────────────────────────────────────────
                'twitch.tv','jtvnw.net',
                // ── Twitter/X ─────────────────────────────────────────────────
                'twitter.com','x.com','t.co','pbs.twimg.com',
                // ── Reddit ────────────────────────────────────────────────────
                'reddit.com','redd.it','i.redd.it','v.redd.it',
                // ── GitHub ────────────────────────────────────────────────────
                'github.com','githubusercontent.com','github.io',
                // ── Paste / media hosts ───────────────────────────────────────
                'pastebin.com','rentry.co','hastebin.com',
                'postimg.cc','i.postimg.cc','gyazo.com','i.gyazo.com',
                'streamable.com','medal.tv',
                'catbox.moe','litter.catbox.moe',
                // ── Blox Fruits wiki ─────────────────────────────────────────
                'fandom.com','wikia.com',
            ],
            linkDenylistedDomains: [],
            scanEditsEnabled: false,
            policyPreset: null,

            // ── Roast system ──────────────────────────────────────────
            roastProvider: 'roastedbyai',   // 'claude' | 'roastedbyai'
            roastContext:  true,     // include target's last 5 msgs as context

            // ── Manager system ────────────────────────────────────────
            // Roles/users granted full access to ALL bot commands (equal to Admin)
            managerRoles: [],   // array of role IDs
            managerUsers: [],   // array of user IDs
        };
    }
    const gs = data.guildSettings[guildId];
    if (gs.commandRedirectEnabled === undefined) gs.commandRedirectEnabled = false;
    if (gs.serviceRedirectEnabled === undefined) gs.serviceRedirectEnabled = false;
    if (gs.tradeRedirectEnabled === undefined) gs.tradeRedirectEnabled = false;
    if (gs.spamWarnEnabled === undefined) gs.spamWarnEnabled = false;
    if (gs.begWarnEnabled === undefined) gs.begWarnEnabled = false;
    if (gs.scamWarnEnabled === undefined) gs.scamWarnEnabled = false; 
    if (gs.accTradeWarnEnabled === undefined) gs.accTradeWarnEnabled = false;
    if (gs.aiEnabled === undefined) gs.aiEnabled = false;
    if (gs.checksEnabled === undefined) gs.checksEnabled = false;
    if (gs.noAffiliationEnabled === undefined) gs.noAffiliationEnabled = false;
    if (gs.exileStripRoles === undefined) gs.exileStripRoles = false;
    if (gs.exileRemoveRole === undefined) gs.exileRemoveRole = true;
    if (gs.botOwnerId === undefined) gs.botOwnerId = null;
    if (gs.botFooterText === undefined) gs.botFooterText = null;
    if (gs.botInfoPublic === undefined) gs.botInfoPublic = false;

    if (gs.linkMode === undefined) gs.linkMode = 'strict';
    if (gs.linkAction === undefined) gs.linkAction = 'warn';

    if (gs.verifyGateEnabled === undefined) gs.verifyGateEnabled = false;
    if (gs.verifyMinAccountAgeDays === undefined) gs.verifyMinAccountAgeDays = 7;
    if (gs.verifyRequiredRoleId === undefined) gs.verifyRequiredRoleId = null;
    if (gs.verifyGateAction === undefined) gs.verifyGateAction = 'warn';

    if (gs.timeoutEnabled === undefined) gs.timeoutEnabled = false;
    if (gs.timeoutMinutesSpam === undefined) gs.timeoutMinutesSpam = 10;
    if (gs.timeoutMinutesScam === undefined) gs.timeoutMinutesScam = 60;
    if (gs.timeoutMinutesCommand === undefined) gs.timeoutMinutesCommand = 5;
    if (gs.timeoutMinutesTrade === undefined) gs.timeoutMinutesTrade = 5;
    if (gs.timeoutMinutesService === undefined) gs.timeoutMinutesService = 5;
    if (gs.enforcementMode === undefined) gs.enforcementMode = 'enforce';
    if (!gs.categoryPolicies || typeof gs.categoryPolicies !== 'object') gs.categoryPolicies = {};
    if (gs.policyPreset === undefined) gs.policyPreset = null;
    if (gs.roastProvider === undefined) gs.roastProvider = 'roastedbyai';
    if (gs.roastContext  === undefined) gs.roastContext  = true;
    if (!Array.isArray(gs.managerRoles)) gs.managerRoles = [];
    if (!Array.isArray(gs.managerUsers)) gs.managerUsers = [];

    // ── Auto-detect setup from existing channel data ──────────────────────────
    // If channels differ from raw defaults, someone already configured them —
    // treat the server as set up and enable all redirects.
    if (gs.serverSetupComplete === undefined || gs.serverSetupComplete === null) {
        const hasCustomTrade    = gs.tradeChannelId    && gs.tradeChannelId    !== DEFAULT_TARGET_CHANNEL_ID;
        const hasCustomServices = gs.servicesChannelId && gs.servicesChannelId !== DEFAULT_SERVICES_CHANNEL_ID;
        if (hasCustomTrade || hasCustomServices) {
            applySetupRedirects(gs);
        } else {
            gs.serverSetupComplete = false;
        }
    }
    // If setup is complete but redirect flags are still at their original defaults,
    // ensure they are actually on (handles upgrades from old saves).
    if (gs.serverSetupComplete) {
        if (gs.commandRedirectEnabled === undefined) gs.commandRedirectEnabled = true;
        if (gs.serviceRedirectEnabled === undefined) gs.serviceRedirectEnabled = true;
        if (gs.tradeRedirectEnabled   === undefined) gs.tradeRedirectEnabled   = true;
    }
    // ─────────────────────────────────────────────────────────────────────────

    return gs;
}

function applyPolicyPreset(gs, name) {
    const preset = String(name || '').toLowerCase();
    if (!['strict','balanced','soft','monitor'].includes(preset)) return false;

    if (preset === 'monitor') {
        gs.enforcementMode = 'monitor';
        gs.policyPreset = 'monitor';
        return true;
    }

    gs.enforcementMode = 'enforce';
    gs.policyPreset = preset;
    gs.categoryPolicies = gs.categoryPolicies && typeof gs.categoryPolicies === 'object' ? gs.categoryPolicies : {};

    if (preset === 'strict') {
        gs.categoryPolicies.spam = { action: 'timeout', minutes: 10 };
        gs.categoryPolicies.scam = { action: 'exile', minutes: 60 };
        gs.categoryPolicies.command = { action: 'delete', minutes: 0 };
        gs.categoryPolicies.trade = { action: 'delete', minutes: 0 };
        gs.categoryPolicies.service = { action: 'delete', minutes: 0 };
        gs.categoryPolicies.beg = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.acctrade = { action: 'exile', minutes: 60 };
    }

    if (preset === 'balanced') {
        gs.categoryPolicies.spam = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.scam = { action: 'timeout', minutes: 60 };
        gs.categoryPolicies.command = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.trade = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.service = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.beg = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.acctrade = { action: 'timeout', minutes: 120 };
    }

    if (preset === 'soft') {
        gs.categoryPolicies.spam = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.scam = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.command = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.trade = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.service = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.beg = { action: 'warn', minutes: 0 };
        gs.categoryPolicies.acctrade = { action: 'warn', minutes: 0 };
    }
    return true;
}

function buildDashboardEmbed(gs) {
    const embed = new EmbedBuilder()
        .setTitle('🧩 Admin Dashboard')
        .setColor(0x5865F2)
        .addFields(
            { name: 'Checks', value: gs.checksEnabled ? '✅ ON' : '❌ OFF', inline: true },
            { name: 'AI', value: gs.aiEnabled ? '✅ ON' : '❌ OFF', inline: true },
            { name: 'Enforcement', value: String(gs.enforcementMode || 'enforce'), inline: true },
            { name: 'Preset', value: gs.policyPreset ? String(gs.policyPreset) : 'None', inline: true },
        )
        .setTimestamp();
    const ft = footerText(gs);
    if (ft) embed.setFooter({ text: ft });
    return embed;
}

function buildDashboardComponents() {
    const r1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_toggle_checks').setLabel('Toggle Checks').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dash_toggle_ai').setLabel('Toggle AI').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('dash_toggle_mode').setLabel('Toggle Mode').setStyle(ButtonStyle.Secondary),
    );
    const r2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_preset_strict').setLabel('Strict').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('dash_preset_balanced').setLabel('Balanced').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('dash_preset_soft').setLabel('Soft').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('dash_preset_monitor').setLabel('Monitor').setStyle(ButtonStyle.Secondary),
    );
    return [r1, r2];
}

function footerText(gs) {
    return gs?.botFooterText ? String(gs.botFooterText).slice(0, 200) : null;
}

async function tryTimeout(member, minutes, reason) {
    try {
        if (!member || !minutes || minutes <= 0) return false;
        if (!member.moderatable) return false;
        await member.timeout(minutes * 60 * 1000, reason);
        return true;
    } catch {
        return false;
    }
}

async function applyConfiguredAction(message, data, gs, opts) {
    const action = String(opts?.action || 'warn').toLowerCase();
    const reason = String(opts?.reason || '');
    const title = String(opts?.title || '⚠️ Moderation');
    const footerLabel = String(opts?.footerLabel || 'Moderation');
    const ttlMs = opts?.ttlMs || 12000;
    const timeoutMins = Number(opts?.timeoutMins || 0);
    const exileMins = Number(opts?.exileMins || (gs.exileDurationMins || EXILE_DURATION_MINS));

    if (action === 'delete') {
        createCaseFromMessage(message, data, gs, {
            title,
            reason,
            details: message.content,
            footerLabel,
            action: 'delete',
        });
        try { await message.delete(); } catch {}
        return { action };
    }

    if (action === 'timeout') {
        try { await message.delete(); } catch {}
        if (gs.timeoutEnabled) {
            await tryTimeout(message.member, timeoutMins, reason);
        }
        await issueViolation(message, data, gs, {
            title,
            color: opts?.color || 0x5865F2,
            reason,
            details: message.content,
            footerLabel,
            ttlMs,
        });
        return { action };
    }

    if (action === 'exile') {
        try { await message.delete(); } catch {}
        const fd = loadData();
        await performExile(message.member, message.guild, exileMins, reason || 'Auto exile', fd);
        saveData(fd);
        await issueViolation(message, data, gs, {
            title,
            color: opts?.color || 0xFF2222,
            reason,
            details: message.content,
            footerLabel,
            ttlMs,
        });
        return { action };
    }

    // warn (default)
    try { await message.delete(); } catch {}
    await issueViolation(message, data, gs, {
        title,
        color: opts?.color || 0xFF8800,
        reason,
        details: message.content,
        footerLabel,
        ttlMs,
        redirectChannelId: opts?.redirectChannelId || null,
    });
    return { action: 'warn' };
}

function detectScamByMode(gs, contentClean, rawText) {
    if (gs.linkMode === 'off') return { hit: false };
    const guildAllowlist = gs?.linkAllowlistedDomains || [];
    if (gs.linkMode === 'medium') {
        const raw = rawText || '';
        const hasUrl = /https?:\/\//i.test(raw);
        if (!hasUrl) return { hit: false };
        return detectScamOrExploit(contentClean, rawText, guildAllowlist);
    }
    const base = detectScamOrExploit(contentClean, rawText, guildAllowlist);
    if (base?.hit) return base;
    const obf = detectObfuscatedDomains(rawText, guildAllowlist);
    if (obf.length) return { hit: true, reason: `Obfuscated domain(s): ${obf.join(', ')}` };
    return { hit: false };
}

function normalizeObfuscatedDomainText(raw) {
    return String(raw || '')
        .toLowerCase()
        // Strip Discord/Markdown [display text](url) links BEFORE scanning — the display
        // text is NOT an attempt to obfuscate a domain (e.g. "[www.roblox](https://...)"
        // would otherwise match "www.roblox" as a false positive).
        .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\(dot\)|\[dot\]|\{dot\}|\sdot\s/g, '.')
        .replace(/\(\.\)|\[\.\]|\{\.\}/g, '.')
        .replace(/\(com\)|\[com\]|\{com\}|\scom\b/g, '.com')
        .replace(/\s+/g, ' ');
}

function detectObfuscatedDomains(rawText, extraAllowed) {
    const t = normalizeObfuscatedDomainText(rawText);
    const hits = (t.match(/(?<![a-z0-9])[a-z0-9][a-z0-9\-]{0,60}\s*(?:\.|\s+dot\s+)\s*[a-z]{2,}(?![a-z0-9])/gi) || []);
    if (!hits.length) return [];
    // Filter out any match that is already a known-safe domain
    const combined = [...COMMON_ALLOWED_DOMAINS, ...(extraAllowed || [])];
    const suspicious = hits.filter(h => {
        const cleaned = h.replace(/\s+/g, '').toLowerCase();
        const normalized = normalizeDomain(cleaned);
        // After normalization (which strips a leading "www.") a real domain still has a
        // dot in it.  If there is no dot left the regex only captured a bare hostname
        // fragment (e.g. "roblox" from "www.roblox") — not a complete domain, skip it.
        if (!normalized.includes('.')) return false;
        return !domainInList(cleaned, combined);
    });
    return suspicious.slice(0, 5);
}

function getCategoryImmunity(guildId, data, category) {
    data.categoryImmunity = data.categoryImmunity || {};
    if (!data.categoryImmunity[guildId]) data.categoryImmunity[guildId] = {};
    if (!data.categoryImmunity[guildId][category]) {
        data.categoryImmunity[guildId][category] = { roles: [], members: [] };
    }
    const c = data.categoryImmunity[guildId][category];
    c.roles = Array.isArray(c.roles) ? c.roles : [];
    c.members = Array.isArray(c.members) ? c.members : [];
    return c;
}

function isCategoryImmune(member, guildId, data, category) {
    if (!member) return false;
    const c = getCategoryImmunity(guildId, data, category);
    if (c.members.includes(member.id)) return true;
    for (const rid of c.roles) {
        if (member.roles?.cache?.has(rid)) return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  MANAGER SYSTEM — grants full bot access to specific roles/users
// ══════════════════════════════════════════════════════════
/**
 * Returns true if the given GuildMember has been granted "Manager" status,
 * meaning they have full access to every bot command regardless of Discord perms.
 */
function isManagerMember(member, guildId, data) {
    if (!member) return false;
    const gs = getGuildSettings(guildId, data);
    const managerUsers = Array.isArray(gs.managerUsers) ? gs.managerUsers : [];
    const managerRoles = Array.isArray(gs.managerRoles) ? gs.managerRoles : [];
    // Check user ID
    if (managerUsers.includes(member.id)) return true;
    // Check any of the member's roles
    if (member.roles && member.roles.cache) {
        for (const roleId of managerRoles) {
            if (member.roles.cache.has(roleId)) return true;
        }
    }
    return false;
}

/**
 * Checks whether `actor` is allowed to take action on `target`.
 * Returns null if allowed, or an error message string if blocked.
 *
 * Rules:
 *  - Can never target yourself
 *  - Can never target someone whose highest role is >= your own highest role
 *    (same role position = same tier, still blocked)
 */
function checkHierarchy(actorMember, targetMember) {
    if (!actorMember || !targetMember) return null; // can't check, let it through
    if (targetMember.id === actorMember.id) {
        return '❌ You cannot do that to yourself.';
    }
    const actorPos  = actorMember.roles?.highest?.position ?? 0;
    const targetPos = targetMember.roles?.highest?.position ?? 0;
    if (targetPos >= actorPos) {
        return '❌ You cannot do that to someone with an equal or higher role than you.';
    }
    return null;
}

/**
 * Like checkHierarchy but for a Role object (not a member).
 * Used in /manager addrole / removerole to prevent managing roles
 * that are at or above the actor's own highest role.
 */
function checkRoleHierarchy(actorMember, role) {
    if (!actorMember || !role) return null;
    const actorPos = actorMember.roles?.highest?.position ?? 0;
    if (role.position >= actorPos) {
        return '❌ You cannot manage a role that is equal to or higher than your own highest role.';
    }
    return null;
}

function getImmunitySettings(guildId, data) {
    data.immunity = data.immunity || {};
    if (!data.immunity[guildId]) {
        data.immunity[guildId] = {
            enabled: false,
            whitelistedRoles: [],
            whitelistedMembers: [],
        };
    }
    data.immunity[guildId].whitelistedRoles = Array.isArray(data.immunity[guildId].whitelistedRoles)
        ? data.immunity[guildId].whitelistedRoles
        : [];
    data.immunity[guildId].whitelistedMembers = Array.isArray(data.immunity[guildId].whitelistedMembers)
        ? data.immunity[guildId].whitelistedMembers
        : [];
    if (typeof data.immunity[guildId].enabled !== 'boolean') data.immunity[guildId].enabled = false;
    return data.immunity[guildId];
}

function isMemberImmune(member, guildId, data) {
    const s = getImmunitySettings(guildId, data);
    // Explicitly whitelisted individual members always get immunity
    if (s.whitelistedMembers.includes(member.id)) return true;
    // Whitelisted roles via /addimmunity always grant global immunity,
    // regardless of whether the enabled toggle is on or off.
    for (const rid of s.whitelistedRoles) {
        if (member.roles.cache.has(rid)) return true;
    }
    // The enabled toggle controls whether Discord staff perms (Admin/ManageMessages)
    // automatically get immunity — it does NOT affect explicit whitelisted roles/members.
    if (!s.enabled) return false;
    if (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) return true;
    return false;
}

// ══════════════════════════════════════════════════════════
//  EXILE CHANNEL GUARD
// ══════════════════════════════════════════════════════════
/**
 * Returns true if the given channelId is the configured exile channel.
 * Uses gs.exileChannelId first (set by /exilechannel create), then falls
 * back to searching for a channel named "exile-zone" so it works even on
 * servers that created the channel before this fix was deployed.
 */
function isExileChannel(channelId, guild, gs) {
    if (!channelId || !guild) return false;
    if (gs?.exileChannelId && channelId === gs.exileChannelId) return true;
    // Fallback: match by name if no ID is stored yet
    const ch = guild.channels?.cache?.get(channelId);
    if (ch && ch.name === 'exile-zone') return true;
    return false;
}

// ══════════════════════════════════════════════════════════
//  SETUP WIZARD HELPERS
// ══════════════════════════════════════════════════════════
function fmtCh(id) { return id ? `<#${id}>` : '`not set`'; }
function fmtFirstPool(gs, key) {
    const ids = gs[key];
    if (!Array.isArray(ids) || !ids.length) return '`not set`';
    return ids.map(id => `<#${id}>`).join(', ');
}

function buildSetupPickerEmbed(gs) {
    const raidIds  = fmtFirstPool(gs, 'raidServiceChannelIds');
    const raceIds  = fmtFirstPool(gs, 'raceV4ServiceChannelIds');
    const seaIds   = fmtFirstPool(gs, 'seaEventsChannelIds');
    const mirIds   = fmtFirstPool(gs, 'mirageIslandChannelIds');
    const preIds   = fmtFirstPool(gs, 'prehistoricIslandChannelIds');
    const kitIds   = fmtFirstPool(gs, 'kitsuneIslandChannelIds');
    const leviIds  = fmtFirstPool(gs, 'leviathanChannelIds');
    return new EmbedBuilder()
        .setTitle('🔧 SKYNET V7 — Setup Wizard')
        .setColor(0x5865F2)
        .setDescription('Choose a section to configure. Each button opens a form for that group of settings.\n\u200b')
        .addFields(
            {
                name: '📋 Page 1 — Core',
                value: [
                    `Trade Channel(s): ${fmtFirstPool(gs, 'tradeChannelIds') !== '`not set`' ? fmtFirstPool(gs, 'tradeChannelIds') : fmtCh(gs.tradeChannelId)}`,
                    `Services Channel(s): ${fmtFirstPool(gs, 'servicesChannelIds') !== '`not set`' ? fmtFirstPool(gs, 'servicesChannelIds') : fmtCh(gs.servicesChannelId)}`,
                    `Exile Role: ${gs.exiledRoleId ? `<@&${gs.exiledRoleId}>` : '`not set`'}`,
                    `Log Channel: ${fmtCh(gs.logChannelId)}`,
                    `Appeals Channel: ${fmtCh(gs.appealsChannelId)}`,
                ].join('\n'),
                inline: false,
            },
            {
                name: '📋 Page 2 — Service Channel Pools',
                value: [
                    `⚔️ Raid/Service: ${raidIds}`,
                    `🏁 Race V4/Trials: ${raceIds}`,
                    `🌊 Sea Events: ${seaIds}`,
                    `🏝️ Mirage Island: ${mirIds}`,
                    `🦕 Prehistoric Island: ${preIds}`,
                    `🦊 Kitsune Island: ${kitIds}`,
                    `🐉 Leviathan/Frozen: ${leviIds}`,
                ].join('\n'),
                inline: false,
            },
            {
                name: '📋 Page 3 — Misc',
                value: [
                    `Commands Channel(s): ${fmtFirstPool(gs, 'gamesHubIds') !== '`not set`' ? fmtFirstPool(gs, 'gamesHubIds') : fmtCh(gs.gamesHubId)}`,
                    `Exile Channel: ${fmtCh(gs.exileChannelId)}`,
                    `Violation Threshold: **${gs.violationThreshold || 3}**`,
                    `Exile Duration: **${gs.exileDurationMins || 45}m**`,
                ].join('\n'),
                inline: false,
            },
        )
        .setFooter({ text: 'Tip: paste raw IDs — Discord channel/role/user IDs work directly' })
        .setTimestamp();
}

function buildSetupPickerComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_open_page1').setLabel('📋 Page 1 — Core').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_open_page2').setLabel('📋 Page 2 — Channel Pools').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_open_page3').setLabel('📋 Page 3 — Misc').setStyle(ButtonStyle.Secondary),
        ),
    ];
}

// ══════════════════════════════════════════════════════════
//  LOG HELPER
// ══════════════════════════════════════════════════════════
async function sendLog(guild, data, embed) {
    const gs = getGuildSettings(guild.id, data);
    if (!gs.logChannelId) return;
    try {
        const ch = await guild.channels.fetch(gs.logChannelId).catch(() => null);
        if (ch) await ch.send({ embeds: [embed] });
    } catch {}
}

async function sendConfigLog(guild, data, actorId, title, lines) {
    try {
        await sendLog(guild, data, new EmbedBuilder()
            .setTitle(title)
            .setColor(0x5865F2)
            .setDescription((lines || []).filter(Boolean).join('\n').slice(0, 4096) || 'No details')
            .addFields({ name: 'By', value: `<@${actorId}> (${actorId})`, inline: false })
            .setTimestamp());
    } catch {}
}

client.on('messageUpdate', async (oldMsg, newMsg) => {
    try {
        const message = newMsg?.partial ? await newMsg.fetch().catch(()=>null) : newMsg;
        if (!message || !message.guild || message.author?.bot) return;
        const data = loadData();
        const gs = getGuildSettings(message.guild.id, data);
        if (!gs.scanEditsEnabled) return;
        if ((oldMsg?.content || '') === (message.content || '')) return;
        // Superuser is always immune from edit scans too.
        const immune = isSuperUser(message.author?.id) || (message.member ? isMemberImmune(message.member, message.guild.id, data) : false);
        if (immune) return;
        // No moderation enforcement inside the exile channel
        if (isExileChannel(message.channel.id, message.guild, gs)) return;

        if (gs.attachmentPolicyEnabled && message.attachments && message.attachments.size) {
            const exts = getAttachmentExts(message);
            const block = (gs.attachmentBlockExts || []).map(x => String(x||'').toLowerCase());
            const hit = exts.find(e => block.includes(String(e||'').toLowerCase()));
            let suspiciousName = false;
            for (const a of message.attachments.values()) {
                if (isSuspiciousAttachmentName(a?.name || '')) { suspiciousName = true; break; }
            }
            if (hit || suspiciousName) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '🚫 Attachment Blocked (Edit)',
                    color: 0xCC0000,
                    reason: hit ? `Blocked file type: .${hit}` : 'Suspicious attachment filename pattern.',
                    details: message.content || '(attachment)',
                    footerLabel: 'Attachment Policy',
                    ttlMs: 15000,
                });
                return;
            }
        }

        if (gs.invitePolicyEnabled && hasDiscordInvite(message.content)) {
            const allowedCh = (gs.inviteAllowedChannelIds || []).includes(message.channel.id);
            if (!allowedCh) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '🚫 Invite Link Blocked (Edit)',
                    color: 0xCC0000,
                    reason: 'Discord invites are not allowed in this channel.',
                    details: message.content,
                    footerLabel: 'Invite Policy',
                    ttlMs: 15000,
                });
                return;
            }
        }

        if (gs.capsSpamEnabled) {
            const m = countUppercaseMetrics(message.content);
            const minLetters = Math.max(8, Math.min(80, gs.capsMinLetters || 16));
            const maxPct = Math.max(30, Math.min(100, gs.capsMaxPercent || 70));
            const maxRun = Math.max(10, Math.min(120, gs.capsMaxRun || 28));
            if (m.letters >= minLetters && (m.percent >= maxPct || m.maxRun >= maxRun)) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '⚠️ Caps Spam (Edit)',
                    color: 0xFF4466,
                    reason: `Too much caps (letters=${m.letters}, caps=${m.upper}, caps%=${m.percent.toFixed(1)}%, run=${m.maxRun}).`,
                    details: message.content,
                    footerLabel: 'Caps Spam',
                    ttlMs: 12000,
                });
                return;
            }
        }

        if (gs.emojiSpamEnabled) {
            const emojiCount = countEmojiLike(message.content);
            if (emojiCount) {
                recordEmojiSpam(message.author.id, message.guild.id, emojiCount);
                const score = getEmojiSpamScore(message.author.id, message.guild.id, gs.emojiWindowSec || 12);
                const max = Math.max(5, Math.min(60, gs.emojiMaxCount || 18));
                if (score.total >= max) {
                    try { await message.delete(); } catch {}
                    await issueViolation(message, data, gs, {
                        title: '⚠️ Emoji Spam (Edit)',
                        color: 0xFF4466,
                        reason: `Too many emoji in ${gs.emojiWindowSec || 12}s window (${score.total} >= ${max}).`,
                        details: message.content,
                        footerLabel: 'Emoji Spam',
                        ttlMs: 12000,
                    });
                    return;
                }
            }
        }

        if (gs.zalgoEnabled) {
            const marks = countCombiningMarks(message.content);
            const max = Math.max(4, Math.min(80, gs.zalgoMaxCombining || 12));
            if (marks >= max) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '⚠️ Zalgo / Glitch Text (Edit)',
                    color: 0xFF4466,
                    reason: `Too many combining marks (${marks} >= ${max}).`,
                    details: message.content,
                    footerLabel: 'Zalgo Text',
                    ttlMs: 12000,
                });
                return;
            }
        }

        if (gs.stretchSpamEnabled) {
            const res = detectStretchSpam(message.content, gs);
            if (res?.hit) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '⚠️ Stretch / Repeat Spam (Edit)',
                    color: 0xFF4466,
                    reason: res.reason,
                    details: message.content,
                    footerLabel: 'Stretch Spam',
                    ttlMs: 12000,
                });
                return;
            }
        }

        if (gs.dupeSpamEnabled) {
            const res = detectDupeSpam(message.author.id, message.guild.id, message.content, gs);
            if (res?.hit) {
                try { await message.delete(); } catch {}
                incStat(message.guild.id, data, 'spam', 1);
                await issueViolation(message, data, gs, {
                    title: '⚠️ Duplicate Message Spam (Edit)',
                    color: 0xFF4466,
                    reason: res.reason,
                    details: message.content,
                    footerLabel: 'Duplicate Spam',
                    ttlMs: 12000,
                });
                return;
            }
        }

        const { contentClean } = prepareText(message.content, message);
        const scam = gs.scamEnabled ? detectScamByMode(gs, contentClean, message.content) : { hit: false };
        if (scam?.hit) {
            try { await message.delete(); } catch {}
            incStat(message.guild.id, data, 'scam', 1);
            await issueViolation(message, data, gs, {
                title: '🚨 Scam/Exploit Content (Edit) Detected',
                color: 0xCC0000,
                reason: scam.reason || 'Suspicious link or exploit/scam content (edited).',
                details: message.content,
                footerLabel: 'Scam/Exploit',
                ttlMs: 15000,
            });
            return;
        }

        if (gs.linkPolicyEnabled) {
            const domains = extractDomains(message.content);
            if (domains.length) {
                const cls = classifyLinkDomains(domains, gs);
                if (cls.blocked.length || cls.suspicious.length) {
                    try { await message.delete(); } catch {}
                    const why = cls.blocked.length
                        ? `Blocked domain(s): ${cls.blocked.slice(0,6).join(', ')}`
                        : `Suspicious domain(s): ${cls.suspicious.slice(0,6).join(', ')}`;
                    incStat(message.guild.id, data, 'linkPolicy', 1);
                    await issueViolation(message, data, gs, {
                        title: '🚫 Link Policy Violation (Edit)',
                        color: 0xCC0000,
                        reason: why,
                        details: message.content,
                        footerLabel: 'Link Policy',
                        ttlMs: 15000,
                    });
                    return;
                }
            }
        }
    } catch {}
});

client.on('guildMemberAdd', async member => {
    if (!member?.guild) return;
    const data = loadData();
    const gs = getGuildSettings(member.guild.id, data);
    if (!gs.raidAutoEnabled && !gs.raidModeEnabled) return;

    const e = recordJoinSpike(member.guild.id);
    const w = getJoinSpikeWindow(e, gs.raidJoinWindowSec || 25);
    const threshold = Math.max(2, Math.min(50, gs.raidJoinThreshold || 7));
    if (w >= threshold) {
        setRaidLocked(member.guild.id, gs.raidLockdownMins || 8);

        if (gs.raidModeEnabled || gs.raidAutoEnabled) {
            await sendLog(member.guild, data, new EmbedBuilder()
                .setTitle('🚨 Join Spike Detected — Raid Lockdown')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'Joins in Window', value: `${w}/${threshold}`, inline: true },
                    { name: 'Window', value: `${gs.raidJoinWindowSec || 25}s`, inline: true },
                    { name: 'Lockdown', value: `${gs.raidLockdownMins || 8}m`, inline: true },
                    { name: 'New Member', value: `<@${member.id}> (${member.id})`, inline: false },
                ).setTimestamp());
        }

        if (gs.raidLockChannels) {
            const reason = 'SKYNET V7: Raid lockdown auto-triggered';
            for (const [, ch] of member.guild.channels.cache) {
                if (ch.type !== ChannelType.GuildText) continue;
                if (gs.logChannelId && ch.id === gs.logChannelId) continue;
                if (gs.appealsChannelId && ch.id === gs.appealsChannelId) continue;
                try {
                    await ch.permissionOverwrites.edit(member.guild.id, { SendMessages: false }, { reason });
                    await grantAdminRolesSendMessages(ch, member.guild, gs);
                } catch {}
            }
        }

        const notifyId = gs.raidNotifyChannelId || gs.logChannelId;
        if (notifyId) {
            const ch = await member.guild.channels.fetch(notifyId).catch(()=>null);
            if (ch && ch.isTextBased && ch.isTextBased()) {
                ch.send({ embeds: [new EmbedBuilder()
                    .setTitle('🛡️ Raid Lockdown Enabled')
                    .setColor(0xFFAA00)
                    .setDescription('Join spike threshold exceeded. Lockdown is active.\nStaff: review new accounts and suspicious links.')
                    .addFields(
                        { name: 'Joins in Window', value: `${w}/${threshold}`, inline: true },
                        { name: 'Window', value: `${gs.raidJoinWindowSec || 25}s`, inline: true },
                        { name: 'Lockdown', value: `${gs.raidLockdownMins || 8}m`, inline: true },
                    ).setTimestamp()] }).catch(()=>{});
            }
        }
    }
});

// ══════════════════════════════════════════════════════════
//  UNICODE / HOMOGLYPH / LEET NORMALIZATION
// ══════════════════════════════════════════════════════════
const HOMOGLYPHS = {
    'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','і':'i','ї':'i',
    'ı':'i','ĺ':'l','ļ':'l','ľ':'l','ł':'l','ß':'ss','ø':'o',
    'đ':'d','ð':'d','þ':'th',
    '\u200b':'','\u200c':'','\u200d':'','\ufeff':'','\u00ad':'',
    'α':'a','β':'b','γ':'g','δ':'d','ε':'e','ζ':'z','η':'n',
    'θ':'th','ι':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x',
    'ο':'o','π':'p','ρ':'r','σ':'s','τ':'t','υ':'u','φ':'ph',
    'χ':'ch','ψ':'ps','ω':'o',
    'Ａ':'a','Ｂ':'b','Ｃ':'c','Ｄ':'d','Ｅ':'e','Ｆ':'f','Ｇ':'g',
    'Ｈ':'h','Ｉ':'i','Ｊ':'j','Ｋ':'k','Ｌ':'l','Ｍ':'m','Ｎ':'n',
    'Ｏ':'o','Ｐ':'p','Ｑ':'q','Ｒ':'r','Ｓ':'s','Ｔ':'t',
    'Ｕ':'u','Ｖ':'v','Ｗ':'w','Ｘ':'x','Ｙ':'y','Ｚ':'z',
    'ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g',
    'ｈ':'h','ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n',
    'ｏ':'o','ｐ':'p','ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t',
    'ｕ':'u','ｖ':'v','ｗ':'w','ｘ':'x','ｙ':'y','ｚ':'z',
};

const HOMOGLYPHS_EXTRA = {
    'Α':'a','Β':'b','Ε':'e','Ζ':'z','Η':'h','Ι':'i','Κ':'k','Μ':'m','Ν':'n','Ο':'o','Ρ':'p','Τ':'t','Υ':'y','Χ':'x',
    'ϲ':'c','Ϲ':'c','ϳ':'j','ϵ':'e','϶':'e','Ϸ':'p','ϸ':'p','Ϻ':'m','ϻ':'m','Ͻ':'c','Ͼ':'c','Ͽ':'c',
    'а':'a','А':'a','в':'b','В':'b','с':'c','С':'c','ԁ':'d','Ｄ':'d','е':'e','Е':'e','і':'i','І':'i','ј':'j','Ј':'j',
    'к':'k','К':'k','м':'m','М':'m','н':'h','Н':'h','о':'o','О':'o','р':'p','Р':'p','т':'t','Т':'t','у':'y','У':'y','х':'x','Х':'x',
    'Ь':'b','Ъ':'b','Ы':'b','ь':'b','ъ':'b','ы':'b',
    'ᴬ':'a','ᵃ':'a','ᴮ':'b','ᵇ':'b','ᶜ':'c','ᵈ':'d','ᴰ':'d','ᵉ':'e','ᶠ':'f','ᵍ':'g','ʰ':'h','ᴴ':'h','ᶦ':'i','ᴵ':'i','ʲ':'j','ᵏ':'k','ᴷ':'k',
    'ˡ':'l','ᴸ':'l','ᵐ':'m','ᴹ':'m','ⁿ':'n','ᴺ':'n','ᵒ':'o','ᴼ':'o','ᵖ':'p','ᴾ':'p','ʳ':'r','ᴿ':'r','ˢ':'s','ᵗ':'t','ᵀ':'t','ᵘ':'u','ᵛ':'v','ʷ':'w','ˣ':'x','ʸ':'y','ᶻ':'z',
    'ⓐ':'a','ⓑ':'b','ⓒ':'c','ⓓ':'d','ⓔ':'e','ⓕ':'f','ⓖ':'g','ⓗ':'h','ⓘ':'i','ⓙ':'j','ⓚ':'k','ⓛ':'l','ⓜ':'m','ⓝ':'n','ⓞ':'o','ⓟ':'p','ⓠ':'q','ⓡ':'r','ⓢ':'s','ⓣ':'t','ⓤ':'u','ⓥ':'v','ⓦ':'w','ⓧ':'x','ⓨ':'y','ⓩ':'z',
    'Ⓐ':'a','Ⓑ':'b','Ⓒ':'c','Ⓓ':'d','Ⓔ':'e','Ⓕ':'f','Ⓖ':'g','Ⓗ':'h','Ⓘ':'i','Ⓙ':'j','Ⓚ':'k','Ⓛ':'l','Ⓜ':'m','Ⓝ':'n','Ⓞ':'o','Ⓟ':'p','Ⓠ':'q','Ⓡ':'r','Ⓢ':'s','Ⓣ':'t','Ⓤ':'u','Ⓥ':'v','Ⓦ':'w','Ⓧ':'x','Ⓨ':'y','Ⓩ':'z',
    '🄰':'a','🄱':'b','🄲':'c','🄳':'d','🄴':'e','🄵':'f','🄶':'g','🄷':'h','🄸':'i','🄹':'j','🄺':'k','🄻':'l','🄼':'m','🄽':'n','🄾':'o','🄿':'p','🅀':'q','🅁':'r','🅂':'s','🅃':'t','🅄':'u','🅅':'v','🅆':'w','🅇':'x','🅈':'y','🅉':'z',
    '🅰':'a','🅱':'b','🅲':'c','🅳':'d','🅴':'e','🅵':'f','🅶':'g','🅷':'h','🅸':'i','🅹':'j','🅺':'k','🅻':'l','🅼':'m','🅽':'n','🅾':'o','🅿':'p','🆀':'q','🆁':'r','🆂':'s','🆃':'t','🆄':'u','🆅':'v','🆆':'w','🆇':'x','🆈':'y','🆉':'z',
    // Regional indicator letters (🇦–🇿) — used in flag combos but also to spell words letter-by-letter
    '🇦':'a','🇧':'b','🇨':'c','🇩':'d','🇪':'e','🇫':'f','🇬':'g','🇭':'h','🇮':'i','🇯':'j',
    '🇰':'k','🇱':'l','🇲':'m','🇳':'n','🇴':'o','🇵':'p','🇶':'q','🇷':'r','🇸':'s','🇹':'t',
    '🇺':'u','🇻':'v','🇼':'w','🇽':'x','🇾':'y','🇿':'z',
    '—':'-','–':'-','−':'-','‑':'-','‒':'-','﹘':'-','﹣':'-','－':'-','·':'.','•':'.','∙':'.','⋅':'.','•':'.','。':'.','｡':'.',
    '“':'"','”':'"','„':'"','‟':'"','′':'\'','＇':'\'','‘':'\'','’':'\'','‚':'\'','‛':'\'',
    '（':'(','）':')','［':'[','］':']','｛':'{','｝':'}','〈':'<','〉':'>','《':'<','》':'>',
    '：':':','；':';','，':',','、':',','！':'!','？':'?','％':'%','＃':'#','＆':'&','＠':'@','＊':'*','＋':'+','＝':'=','／':'/','＼':'\\','｜':'|',
    '\u2060':'','\u180e':'','\u200e':'','\u200f':'','\u202a':'','\u202b':'','\u202c':'','\u202d':'','\u202e':'',
    '\u2061':'','\u2062':'','\u2063':'','\u2064':'','\u034f':'',
};
// ══════════════════════════════════════════════════════════
//  EMOJI → GAME WORD MAP
//  Converts pictographic emoji used as item/fruit shortcuts
//  into their plain-text equivalents BEFORE the decorative
//  emoji strip, so "lf 🐉" → "lf dragon" and gets caught.
//  Add new entries here whenever a new emoji shorthand appears.
// ══════════════════════════════════════════════════════════
const EMOJI_WORD_MAP = {
    // ── Fruits ──────────────────────────────────────────────────────
    '🐉':'dragon',   '🐲':'dragon',
    '🔥':'flame',    '🌋':'magma',
    '❄️':'ice',      '🧊':'ice',      '🌨':'blizzard',  '☃️':'blizzard', '🌨️':'blizzard',
    '⚡':'lightning', '🌩':'lightning','🌩️':'lightning',
    '🌀':'rumble',
    '🌑':'shadow',   '🌙':'shadow',   '🌚':'dark',
    '💎':'diamond',
    '🐆':'leopard',
    '🐯':'tiger',    '🐅':'tiger',
    '🦊':'kitsune',
    '🦣':'mammoth',
    '🦖':'trex',     '🦕':'trex',
    '👻':'ghost',
    '🕷️':'spider',   '🕷':'spider',
    '🍩':'dough',
    '🐍':'venom',
    '🌪️':'gravity',  '🌪':'gravity',
    '💨':'smoke',    '🌫️':'smoke',    '🌫':'smoke',
    '🔮':'control',
    '💫':'spirit',   '✨':'light',
    '🌸':'love',
    '🌊':'flood',
    '💀':'pain',
    '❤️':'love',     '💗':'love',
    '🌱':'spring',
    '🧲':'gravity',
    '🔵':'bubble',
    '☠️':'shadow',
    '🧬':'creation',
    '🦋':'phoenix',
    '🕊️':'phoenix',  '🕊':'phoenix',
    '⚙️':'cyborg',   '⚙':'cyborg',
    '🌍':'portal',   '🌐':'portal',
    // ── Swords ──────────────────────────────────────────────────────
    '⚔️':'sword',    '⚔':'sword',
    '🗡️':'sword',    '🗡':'sword',
    '🔱':'trident',
    '🪝':'hook',
    '🌀':'rumble',
    // ── Bosses / items ───────────────────────────────────────────────
    '🏆':'chalice',
    '🦍':'gorilla',
    '🐋':'leviathan','🦈':'sea beast','🐬':'sea beast',
    '🧊':'ice admiral',
    '🍰':'cake',
    '🩸':'venom',
    '🌟':'legendary',
    // ── Actions / trade intent ────────────────────────────────────────
    '💰':'pay',      '💵':'pay',      '💸':'pay',
    '🤝':'trade',
    '🔍':'looking',  '👀':'looking',  '🫵':'offer',
};

const LEET_MAP = {
    '4':'a','3':'e','1':'i','0':'o','@':'a','!':'',
    '5':'s','7':'t','8':'b','9':'g','6':'g','$':'s',
    '|':'i','+':'t','(':'c',')':'o','<':'c','>':'o',
    '#':'h','^':'a','?':'',
};

const LEET_MAP_EXTRA = {
    '€':'e','£':'l','¥':'y','¢':'c','©':'c','®':'r','™':'tm','×':'x','÷':'/','°':'o',
    '§':'s','¶':'p','¤':'o','∞':'oo','✓':'v','✔':'v','✗':'x','✕':'x',
    '¡':'','¿':'','¬':'-','¦':'|',
    '₂':'2','³':'3','¹':'1','⁰':'0','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
    '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
    '⓪':'0','①':'1','②':'2','③':'3','④':'4','⑤':'5','⑥':'6','⑦':'7','⑧':'8','⑨':'9',
    '⑩':'10','⑪':'11','⑫':'12','⑬':'13','⑭':'14','⑮':'15',
    '𝟘':'0','𝟙':'1','𝟚':'2','𝟛':'3','𝟜':'4','𝟝':'5','𝟞':'6','𝟟':'7','𝟠':'8','𝟡':'9',
    '｟':'(','｠':')',
    '[':' ','{':' ','}':' ',';':' ','"':' ','\'':' ',
};

const PUNCT_SEPARATORS = /[\-—–−‑‒_~`'".,:;|\\/]+/g;
function normalizeSeparators(t) {
    return t.replace(PUNCT_SEPARATORS, ' ');
}

// ══════════════════════════════════════════════════════════
//  TIER PLACEHOLDER PROTECTION
//  Must run BEFORE leet substitution so '4'→'a' and '3'→'e'
//  cannot corrupt v4→va or v3→ve.
// ══════════════════════════════════════════════════════════
const T_V2 = '\x01TVTWO\x01', T_V3 = '\x01TVTHREE\x01', T_V4 = '\x01TVFOUR\x01';
function protectTiers(t) {
    t = t.replace(/\bv[\s_]*4\b/gi, T_V4);
    t = t.replace(/\bv[\s_]*3\b/gi, T_V3);
    t = t.replace(/\bv[\s_]*2\b/gi, T_V2);
    t = t.replace(/[\/\\|]{1,2}[\s_]*4\b/gi, T_V4);
    t = t.replace(/[\/\\|]{1,2}[\s_]*3\b/gi, T_V3);
    t = t.replace(/[\/\\|]{1,2}[\s_]*2\b/gi, T_V2);
    return t;
}
function restoreTiers(t) {
    return t.split(T_V4).join('v4').split(T_V3).join('v3').split(T_V2).join('v2');
}
function normalizeUnicode(t) {
    t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    for (const [s, d] of Object.entries(HOMOGLYPHS)) t = t.split(s).join(d);
    for (const [s, d] of Object.entries(HOMOGLYPHS_EXTRA)) t = t.split(s).join(d);
    // ── Step 1: Emoji → game word substitution ───────────────────────────────
    // Must run BEFORE the decorative strip so "lf 🐉" → "lf dragon" (not "lf ").
    // Variation-selector suffix (\uFE0F) is stripped alongside the base glyph
    // so both 🔥 (plain) and 🔥️ (with VS-16) match the same entry.
    for (const [emoji, word] of Object.entries(EMOJI_WORD_MAP)) {
        // Build a regex that matches the emoji optionally followed by a variation selector
        const esc = emoji.replace(/[\u{1F000}-\u{1FFFF}]/gu, c => c)
                         .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try { t = t.replace(new RegExp(esc + '\\uFE0F?', 'gu'), ' ' + word + ' '); } catch(_) {}
    }
    // ── Step 2: Decorative emoji → space ─────────────────────────────────────
    // Convert all remaining decorative/pictographic Unicode emoji to spaces so
    // they cannot act as invisible separators between letters (e.g. "L🔥F🔥K🔥I🔥T"
    // → "L F K I T" → nospace → "lfkit").
    // Letter-shaped emoji (🅰–🆉, 🄰–🄿, 🇦–🇿) have already been mapped above,
    // so only decorative/non-letter emoji reach this step.
    //   Range 1: Misc symbols ☀️–✂️ (U+2600–27BF) + arrows/shapes (U+2B00–2BFF)
    //   Range 2: Emoticons 😀, pictographs 🌍, transport 🚀, supplemental 🤔 (U+1F004–1FAFF)
    t = t.replace(/[\u2600-\u27BF\u2B00-\u2BFF]/g, ' ');
    t = t.replace(/[\u{1F004}-\u{1FAFF}]/gu, ' ');
    // Strip variation selectors (VS-1–VS-16) and combining enclosing keycap (used in #️⃣ 1️⃣)
    t = t.replace(/[\uFE00-\uFE0F\u20E3]/g, '');
    return t;
}
function cleanLeet(t) {
    for (const [k, v] of Object.entries(LEET_MAP)) t = t.split(k).join(v);
    for (const [k, v] of Object.entries(LEET_MAP_EXTRA)) t = t.split(k).join(v);
    return t;
}
function collapseRepeats(t) { return t.replace(/(.)\1{2,}/g, '$1$1'); }
function fullClean(t) {
    t = normalizeUnicode(t.toLowerCase());
    t = protectTiers(t);
    t = cleanLeet(t);
    t = restoreTiers(t);
    t = normalizeSeparators(t);
    t = collapseRepeats(t);
    return t;
}

// ══════════════════════════════════════════════════════════
//  FUZZY MATCHING
// ══════════════════════════════════════════════════════════
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fuzzyRatio(a, b) {
    if (!a.length && !b.length) return 1.0;
    if (!a.length || !b.length) return 0.0;
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
    return (2*dp[m][n])/(m+n);
}

// ══════════════════════════════════════════════════════════
//  MASSIVE COMMON-WORD WHITELIST
// ══════════════════════════════════════════════════════════
const COMMON_WORD_WHITELIST = new Set([
    // ── Pronouns & contractions ──────────────────────────────────
    "i","im","ive","id","ill","me","my","mine","myself",
    "we","us","our","ours","ourselves","you","your","yours","yourself","yourselves",
    "he","him","his","himself","she","her","hers","herself",
    "it","its","itself","they","them","their","theirs","themselves",
    "who","whom","whose","which","what","that","this","these","those",
    "weve","youve","theyve","hes","shes","its","hed","shed","wed","theyd",
    "im","youre","hes","shes","were","theyre","ive","youve","weve","theyve",
    "ill","youll","hell","shell","well","theyll","itll",
    "wont","cant","dont","isnt","arent","wasnt","werent",
    "hadnt","hasnt","havent","didnt","doesnt","shouldnt","wouldnt","couldnt",
    "mightnt","mustnt","neednt","darent","shant","oughtn",
    "ud","ull","ur","u","em","ya","yall",
    // ── Articles, conjunctions, prepositions ────────────────────
    "a","an","the","and","but","or","nor","for","so","yet",
    "to","of","in","on","at","by","up","as","if","is","it",
    "be","do","go","no","my","am","an","me","he","we","us","vs",
    "via","per","not","nor","too","off","out","into","onto","upon",
    "with","from","over","than","then","also","just","even","still",
    "once","soon","now","here","there","when","where","why","how",
    "about","above","across","after","against","along","among","around",
    "before","behind","below","beneath","beside","besides","between","beyond",
    "despite","down","during","except","following","inside","near","outside",
    "past","since","through","throughout","till","under","until","unto",
    "within","without","according","alongside","amid","amidst","concerning",
    "regarding","underneath","unlike","versus","toward","towards",
    "although","though","because","since","unless","while","whereas","whereby",
    "whether","thus","hence","therefore","furthermore","moreover","however",
    "nevertheless","nonetheless","otherwise","meanwhile","instead","indeed",
    // ── Common verbs ─────────────────────────────────────────────
    "am","are","is","was","were","be","been","being",
    "have","has","had","having","do","does","did","doing",
    "will","would","shall","should","may","might","must","can","could",
    "get","got","gotten","let","lets","put","set","sit","hit","bit",
    "say","said","see","saw","seen","try","tried","use","run","ran",
    "eat","ate","ask","pay","add","aim","go","goes","went","gone",
    "come","came","know","knew","known","think","thought",
    "take","took","taken","give","gave","given","find","found",
    "tell","told","feel","felt","leave","left","call","keep","kept",
    "bring","brought","begin","began","begun","show","showed","shown",
    "hold","held","start","stand","hear","heard","let","mean","meet","met",
    "read","lead","led","grow","grew","grown","spend","spent",
    "send","sent","lose","lost","break","broke","broken",
    "win","won","fall","fell","fallen","build","built","sell","sold",
    "pay","paid","catch","caught","learn","learned","change","happen",
    "follow","stop","move","live","believe","allow","play","turn",
    "seem","remain","open","close","write","wrote","written",
    "walk","require","include","continue","become","became","consider",
    "appear","create","speak","spoke","spoken","help","decide",
    "pull","reach","kill","suggest","raise","pass","require","report",
    "enter","exist","provide","cover","offer","expect","serve","work",
    "stay","choose","chose","chosen","drive","drove","carry","carried",
    "return","produce","receive","increase","understand","understood",
    "watch","care","join","develop","cause","manage","result","prevent",
    "compare","affect","apply","identify","control","check","focus",
    "improve","agree","complete","protect","involve","relate","operate",
    "reduce","represent","present","prepare","describe","explain",
    // ── Common adjectives ─────────────────────────────────────────
    "good","bad","big","small","large","little","old","new","first","last",
    "long","short","great","high","low","right","left","next","early","late",
    "young","important","real","other","different","hard","free","open",
    "clear","full","simple","easy","strong","true","false","able","ready",
    "same","sure","whole","best","worst","main","few","much","many",
    "most","more","less","least","only","both","all","any","each","every",
    "some","such","no","not","even","back","still","well","very","quite",
    "rather","almost","enough","either","neither","also","just",
    "far","near","quick","slow","fast","hot","cold","warm","cool",
    "dark","light","heavy","loud","quiet","thick","thin","wide","narrow",
    "deep","shallow","round","flat","sharp","soft","rough","smooth",
    "clean","dirty","safe","happy","sad","angry","afraid","sorry",
    "nice","pretty","bright","rich","poor","busy","lazy","smart",
    "crazy","normal","strange","random",
    "special","common","rare","basic",
    "advanced","extra","final","total","exact","certain","complete",
    "correct","wrong","possible","impossible","available","necessary",
    "perfect","natural","social","local","national","personal","physical",
    "major","minor","previous","current","future","recent","original",
    "similar","specific","general","particular","interesting","ahead",
    "alone","apart","aside","forward","backward","upward","downward",
    "inside","outside","above","below","before","behind","beside",
    // ── Common nouns ─────────────────────────────────────────────
    "time","year","day","week","month","hour","minute","second","moment",
    "place","area","land","home","house","room","door","window","floor",
    "wall","table","chair","bed","hand","head","face","eye","ear","nose",
    "mouth","arm","leg","foot","body","back","side","top","end","part",
    "point","line","name","fact","question","problem","work","thing",
    "people","man","men","woman","women","child","children","boy","girl",
    "life","world","country","city","town","road","street","school",
    "group","company","team","family","friend","human","person",
    "number","money","food","water","fire","air","earth","sky","sea",
    "tree","plant","animal","fish","bird","dog","cat","game","way",
    "type","kind","form","level","age","size","color","colour","sound",
    "power","force","energy","matter","space","information","message",
    "news","word","book","story","list","idea","plan","system","result",
    "effect","reason","cause","goal","task","job","role","rule","law",
    "right","need","chance","action","event","step","field","account",
    "value","difference","example","experience","knowledge","nature",
    "position","health","ability","agreement","attention","business",
    "decision","direction","distance","education","environment","language",
    "movement","organization","performance","population","relationship",
    "situation","structure","technology","understanding","community",
    "development","management","opportunity","possibility","requirement",
    "responsibility","communication","person","object","subject",
    "answer","choice","condition","detail","feature","history","letter",
    "level","method","model","month","movement","network","number",
    "object","opinion","pattern","period","process","product","program",
    "quality","question","reason","record","resource","result","section",
    "series","service","society","source","standard","status","subject",
    "support","surface","system","term","theory","thought","treatment",
    "truth","understanding","university","version","weight",
    // ── Short words (3-letter) that aren't game items ────────────
    "age","ace","act","aid","air","all","any","apt","arc","arm","art",
    "ash","awe","bad","bag","ban","bar","bat","bay","bed","big","bit","bot",
    "bow","box","boy","bud","bug","bus","cab","cap","car","cat","cop","cup",
    "cut","day","den","dig","dim","dip","dog","dot","dug","duo","ear","egg",
    "ego","end","era","eve","eye","fad","fan","far","fat","fax","fee","fig",
    "fit","fix","fly","fog","fun","gap","gel","gem","god","guy","gym","hat",
    "hay","hey","hip","hop","hot","hub","hue","hug","hum","ink","inn","ion",
    "jar","jaw","joy","key","kid","kin","lab","lag","law","lay","led","leg",
    "lid","lip","log","lot","low","map","mar","mat","max","mob","mod","mom",
    "mop","mud","mug","nap","net","nod","nun","nut","oak","odd","oil","old",
    "one","opt","orb","ore","owl","pad","pan","pat","paw","peg","pen","pet",
    "pie","pig","pin","pit","pod","pop","pot","pun","pup","rat","raw","ray",
    "red","ref","rep","rib","rid","rig","rip","rob","rod","row","rub","rug",
    "rum","sad","sap","sat","sew","shy","sin","sip","sir","six","ski","sky",
    "sly","sob","son","sow","spa","spy","sub","sum","sun","sup","tab","tan",
    "tap","tar","tax","tea","ten","tip","toe","ton","too","top","tow","toy",
    "tub","tug","two","urn","van","vat","vow","wag","war","wax","web","wed",
    "wet","win","wit","woe","wok","won","woo","yak","yam","yap","yaw","yes",
    "yew","zip","zoo",
    // ── 4-letter common words ────────────────────────────────────
    "able","also","area","back","ball","band","bank","base","bath","been",
    "best","beta","bill","bird","blow","blue","body","book","boot","born",
    "both","call","calm","came","card","care","case","cash","cast","chat",
    "chip","city","clam","clap","clay","clip","club","coal","coat","code",
    "coin","cold","come","cook","cool","cope","copy","cord","core","corn",
    "cost","cozy","crew","crop","cure","data","date","dawn","dead","deal",
    "dean","dear","debt","deck","deed","deep","deer","demo","deny","desk",
    "dial","dice","diet","dirt","disk","dive","door","dose","dove","down",
    "draw","drip","drop","drum","duck","dude","duel","dumb","dump","dusk",
    "dust","duty","earn","ease","east","edge","emit","epic","even","ever",
    "evil","exam","face","fact","fail","fair","fake","fall","fame","fast",
    "fate","feel","feet","fell","felt","fern","file","fill","film","find",
    "fine","fire","firm","fish","fist","flag","flat","flew","flip","flow",
    "foam","fold","folk","fond","food","fool","foot","ford","fore","fork",
    "form","fort","foul","four","free","frog","fuel","full","fume","fund",
    "fuse","fuss","gain","game","gave","gear","gift","girl","give","glad",
    "glow","glue","goal","gold","golf","good","gown","grab","grid","grin",
    "grip","grow","gulf","gust","guys","hack","half","hall","hand","hang",
    "hard","harm","hate","have","head","heal","heap","hear","heat","held",
    "hell","help","hide","high","hill","hire","hold","hole","home","hood",
    "hook","hope","horn","host","hour","huge","hull","hung","hunt","hurt",
    "idea","idle","into","iron","isle","item","join","joke","jump","just",
    "keen","keep","kick","kill","kind","king","knew","know","lack","laid",
    "lake","land","lane","last","late","lead","leaf","leak","lean","leap",
    "left","lend","less","lick","life","lift","like","lime","line","link",
    "lion","list","live","load","loan","lock","loft","lone","look","loom",
    "loop","lord","lore","lose","loss","lost","loud","lout","lure","lush",
    "made","mail","main","make","male","mall","mane","many","mark","mars",
    "mash","mass","mast","mate","math","maze","mean","meet","melt","memo",
    "menu","mere","mess","mind","mine","mint","miss","mode","mold","mole",
    "moon","move","much","muse","must","mute","myth","nail","name","navy",
    "near","neat","neck","news","next","nice","nine","node","none","noon",
    "norm","nose","note","noun","nude","null","oath","obey","once","only",
    "open","oral","orca","over","pace","pack","page","paid","pair","pale",
    "pane","park","part","pass","past","path","peak","peel","peer","pick",
    "pile","pink","pipe","plan","play","plot","plow","plug","plus","pole",
    "poll","pond","pool","pore","port","pose","post","pour","pray","prey",
    "prop","pull","pump","pure","push","quiz","race","rack","rage","rain",
    "rank","rare","rate","read","real","reap","rear","rely","rent","rest",
    "rich","ride","rife","ring","riot","rise","risk","road","roam","roar",
    "robe","rock","rode","role","roll","roof","room","root","rope","rose",
    "rout","rule","rush","rust","safe","sage","sail","sake","sale","sang",
    "sank","save","scan","scar","seal","seat","seed","seek","seem","seen",
    "self","sell","send","sent","shed","ship","shoe","shop","shot","show",
    "shut","sick","side","sigh","silk","sill","sing","sink","site","size",
    "skip","slab","slam","slap","sled","slew","slim","slip","slot","slow",
    "slug","slum","snap","snow","soak","sock","soft","soil","sole","some",
    "song","soon","sore","soul","soup","sour","span","spec","spit","spot",
    "spur","stab","star","stay","step","stem","stew","stop","stub","such",
    "suit","sung","sunk","sure","swan","swam","swim","sync","tail","tale",
    "talk","tall","tame","task","taut","team","tear","tell","tend","tent",
    "term","test","text","than","that","then","this","thou","thus","tide",
    "tied","tile","till","time","tire","told","toll","tomb","tone","tore",
    "torn","toss","tour","town","trap","tray","tree","trek","trim","trip",
    "true","tube","tune","turf","turn","twin","type","ugly","undo","unit",
    "upon","used","user","vain","vale","vary","vast","veil","vein","verb",
    "very","vest","view","vine","visa","void","volt","vote","wade","wait",
    "wake","walk","wall","want","ward","warm","warn","wary","wave","weak",
    "weld","went","west","whim","wide","wife","wiki","wild","wind","wine",
    "wing","wire","wise","wish","with","wolf","wood","wool","word","wore",
    "work","worm","worn","wrap","writ","yard","yarn","year","yell","zero",
    "zone","loot","lore","hero","buff","nerf","stat","nice",
    // ── Common words that fuzzy-match boss/race names (prevents false positives) ──
    "cyber","diamond","warden","stone","swan","yeti","bobby","jeremy","indra","angel","draco","mink","ghoul","shark",
    // ── 5-letter common words ────────────────────────────────────
    "about","above","after","again","ahead","alone","along","among","apart",
    "apply","argue","aside","asked","avoid","aware","badly","began","being",
    "below","blood","boats","bonus","bound","break","bring","broke","build",
    "built","burns","bytes","calls","cause","chain","claim","class","clean",
    "clear","close","coins","color","comes","count","cover","crash","crazy",
    "cross","cycle","daily","dance","death","delta","depth","doors","drive",
    "early","enjoy","enter","equal","error","event","every","exact","exist",
    "extra","falls","feels","field","final","finds","fixed","floor","focus",
    "found","frame","fresh","front","fully","gains","games","given","glass",
    "going","grand","grant","great","green","greet","group","guess","guide",
    "hands","happy","heard","hence","holds","holes","honor","hours","house",
    "human","inbox","inner","issue","items","keeps","kills","known","large",
    "later","leads","learn","least","leave","light","liked","limit","links",
    "lives","local","lobby","lower","lucky","lunch","magic","match","means",
    "media","meets","merge","metal","might","minor","modes","money","month",
    "moved","named","needs","never","night","nodes","noise","noted","occur",
    "often","order","ought","pages","party","place","plain","plans","plays",
    "point","pools","power","press","price","print","prior","proof","queue",
    "quite","races","range","rates","reads","reach","ready","realm","refer",
    "reset","right","rings","roles","rooms","round","route","saves","scene",
    "score","seems","sends","sense","serve","setup","share","shift","ships",
    "shown","sides","since","sizes","skill","sleep","small","smart","solve",
    "sorts","sound","space","speak","specs","speed","split","stand","start",
    "state","stays","still","stone","stops","store","story","stuck","style",
    "suits","super","table","takes","tasks","teams","tests","thick","thing",
    "think","those","three","throw","tiles","times","title","token","tools",
    "total","touch","towns","trace","track","train","trees","tried","truck",
    "trust","truth","twice","typed","types","under","union","units","until",
    "usage","using","usual","valid","value","video","voice","walks","walls",
    "wants","watch","water","waves","where","while","whole","whose","words",
    "works","worse","worth","would","write","wrote","years","young","yours",
    "zones","prior","their","there","about",
    // ── Discord slang / shorthand ─────────────────────────────────
    "gg","gl","hf","wp","ez","nt","gg","lol","lmao","omg","wtf","smh",
    "tbh","ngl","imo","imho","fr","nah","yea","yeah","yep","yup","nope",
    "ok","okay","oki","okie","kk","brb","afk","gtg","bbl","ttyl","ttys",
    "omw","irl","irl","ofc","obv","ikr","ikr","ik","idk","idc","imo",
    "bc","cuz","cos","cause","tho","tbs","tba","tbd","tbf","tbt","tbt",
    "bro","bruh","fam","dude","man","mate","dawg","homie","buddy","pal",
    "sir","maam","lad","lass","chief","boss","king","queen","slay",
    "haha","hehe","lmao","rofl","lmfao","xd","xdd","uwu","owo","fff",
    "rip","ripp","oof","gg","ez","noice","nice","cool","lit","fire",
    "goat","chad","based","cringe","ratio","real","cap","nocap","npc",
    "facts","big","small","mid","lowkey","highkey","slay","vibe","mood",
    "bet","aight","alright","alr","ayt","sup","wassup","whatsup","wsg",
    "hru","howru","wyd","wya","wdym","imo","tbh","fr","rn","atm","asap",
    "eta","fyi","btw","aka","iirc","afaik","afaict","tldr","tl","dr",
    "dw","nvm","nm","np","yw","ty","thx","tyvm","tysm","ggs","gj","gf",
    "wp","l","w","wl","wfl","pog","poggers","pogchamp","kekw","omegalul",
    "monkas","peepo","sadge","pepehands","copium","hopium","pepelaugh",
    "real","cap","nocap","deadass","literally","literally","actually",
    "basically","honestly","genuinely","totally","definitely","absolutely",
    "probably","possibly","maybe","perhaps","seemingly","apparently",
    "obviously","clearly","simply","easily","quickly","slowly","lightly",
    "heavily","strongly","highly","deeply","fully","completely","partly",
    "mostly","nearly","almost","exactly","perfectly","roughly","barely",
    "hardly","slightly","fairly","pretty","rather","quite","truly","really",
    "very","too","also","even","just","still","yet","now","then","here",
    "there","where","when","how","why","what","who","which","that","this","fuck","crap","damn","ass","shit","shi","fck",
    // ── Common reactions / responses Discord users type ───────────
    "yes","no","sure","fine","okay","ofc","course","indeed","exactly",
    "correct","right","wrong","true","false","maybe","perhaps","probably",
    "definitely","absolutely","certainly","honestly","literally","actually",
    "seriously","really","obviously","clearly","apparently","supposedly",
    "admittedly","fortunately","unfortunately","typically","generally",
    "usually","normally","regularly","commonly","frequently","rarely",
    "never","always","sometimes","often","occasionally","eventually",
    "finally","recently","currently","previously","originally","initially",
    "suddenly","immediately","quickly","slowly","carefully","easily",
    "hardly","barely","nearly","almost","already","still","yet","again",
    "soon","now","then","today","tomorrow","yesterday","later","earlier",
    "morning","afternoon","evening","night","midnight","noon","dawn","dusk",
    "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
    "january","february","march","april","june","july","august",
    "september","october","november","december",
    // ── Numbers & ordinals ────────────────────────────────────────
    "one","two","three","four","five","six","seven","eight","nine","ten",
    "eleven","twelve","thirteen","fourteen","fifteen","sixteen",
    "seventeen","eighteen","nineteen","twenty","thirty","forty","fifty",
    "sixty","seventy","eighty","ninety","hundred","thousand","million",
    "first","second","third","fourth","fifth","sixth","seventh","eighth",
    "ninth","tenth","eleventh","twelfth",
    "1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th",
    "11th","12th","13th","14th","15th","20th","25th","30th","50th",
    "v1","v2","v3","v4","v5","p1","p2","p3",
    "1x","2x","3x","4x","5x","10x","20x","100x",
    // ── Tech / Discord platform words ─────────────────────────────
    "discord","server","channel","message","messages","dm","dms","pm","pms",
    "mention","mentions","ping","pings","notification","notifications",
    "role","roles","admin","admins","mod","mods","moderator","moderators",
    "staff","owner","member","members","user","users","bot","bots",
    "voice","vc","text","emoji","emote","emotes","sticker","gif","image",
    "embed","link","links","invite","invites","thread","threads","forum",
    "category","server","guild","announcement","announcements","rules",
    "ticket","tickets","support","help","faq","info","information",
    "settings","permissions","perms","ban","kick","mute","timeout","warn",
    "warning","warnings","strike","strikes","case","cases","report",
    "appeal","appeals","log","logs","audit","nitro","boost","booster",
    "level","levels","xp","points","rank","ranks","leaderboard","top",
    "profile","avatar","status","activity","presence","online","offline",
    "idle","dnd","streaming","custom","bio","badge","badges","verified",
    "partner","hypesquad","developer","early","supporter","system",
    // ── Roblox / Blox Fruits game terms ──────────────────────────
    "robux","roblox","blox","bloxfruits","experience","exp","xp","level",
    "lvl","mastery","bounty","honor","beli","fragment","fragments","stat",
    "stats","reset","rebirth","race","races","island","islands","sea",
    "seas","ship","boats","boat","teleport","tp","warp","location","area",
    "zone","map","world","server","private","public","vip","game","games",
    "update","patch","nerf","buff","meta","build","builds","loadout",
    "spawn","respawn","revive","die","died","death","kill","kills","kd",
    "pvp","pve","boss","bosses","raid","raids","dungeon","dungeons","chest",
    "chests","drop","drops","loot","grind","grinding","farm","farming",
    "noob","newbie","pro","main","alt","account","acc","player","players",
    "teammate","teammates","squad","team","party","group","guild",
    "quest","quests","mission","missions","npc","mob","mobs","enemy",
    "enemies","fruit","fruits","sword","swords","ability","abilities",
    "skill","skills","move","moves","combo","combos","awakening","awaken",
    "unawakened","maxed","maxing","grinding","farming","leveling","levelling",
    "trading","trade","swap","sell","buy","offer","deal","market",
    "checkpoint","save","load","rejoin","server hop","serverhop","private server",
    "ps","vip","full moon","fullmoon","mirage","mirror","fractal","gear",
    "gears","item","items","gamepass","gp","perm","perms","permanent",
    "notifier","notification","dark","blade","yoru","fast","boats","mastery",
    "money","bossdrops","boss drops","2x",
    // ── Common gaming / Discord chat phrases (standalone words) ──
    "omg","wow","wtf","bruh","lmao","haha","lol","xd","nice","good",
    "bad","great","awesome","amazing","cool","lit","fire","goat","noice",
    "sad","mad","angry","happy","excited","bored","tired","sleepy",
    "hungry","ok","fine","alright","sure","true","false","correct",
    "wrong","yes","no","nope","yep","maybe","idk","idc","whatever",
    "same","mood","relatable","facts","real","cap","nocap","lowkey",
    "highkey","literally","actually","basically","honestly","genuinely",
    "apparently","obviously","clearly","definitely","absolutely","probably",
    "possibly","certainly","truly","really","totally","completely",
    // ── Extra Discord-common words to prevent false positives ─────
    "here","there","where","when","how","why","who","what","which",
    "anyone","someone","everyone","nobody","nothing","something","anything",
    "everything","everywhere","somewhere","anywhere","nowhere","somehow",
    "sometime","anytime","sometimes","meanwhile","however","therefore",
    "moreover","furthermore","additionally","consequently","accordingly",
    "nevertheless","nonetheless","otherwise","instead","although","whereas",
    "unless","until","whether","through","throughout","despite","except",
    "within","without","beyond","along","among","amid","beside","besides",
    "between","underneath","underneath","alongside","regarding","concerning",
    "including","excluding","following","preceding","considering","given",
    "assuming","provided","unless","in","on","at","by","to","for","of",
    "with","from","about","against","around","before","after","during",
    // ── Discord reaction/emotion words ────────────────────────────
    "congrats","congratulations","welcome","goodbye","bye","hello","hi",
    "hey","howdy","greetings","salutations","cheers","thanks","thank",
    "please","sorry","apologize","apology","excuse","pardon","forgive",
    "love","hate","like","dislike","enjoy","prefer","want","need","miss",
    "hope","wish","believe","think","feel","know","understand","remember",
    "forget","notice","realize","discover","learn","teach","help","assist",
    "support","encourage","motivate","inspire","appreciate","respect",
    "agree","disagree","accept","reject","approve","disapprove","allow",
    "deny","permit","prohibit","suggest","recommend","advise","warn",
    "remind","inform","notify","announce","confirm","verify","prove",
    "explain","describe","show","demonstrate","illustrate","clarify",
    // ── Time & dates ──────────────────────────────────────────────
    "today","tomorrow","yesterday","now","then","soon","later","early",
    "late","morning","afternoon","evening","night","midnight","noon",
    "daily","weekly","monthly","yearly","annually","hourly","secondly",
    "ago","past","present","future","recent","current","previous","next",
    "last","first","before","after","during","throughout","meanwhile",
    "sec","secs","min","mins","hr","hrs","hour","hours","day","days",
    "week","weeks","month","months","year","years","decade","century",
    // ── Filler words commonly typed in Discord ────────────────────
    "lmk","hmu","dm","pm","msg","message","text","chat","say","mention",
    "tag","ping","alert","notify","reach","contact","respond","reply",
    "answer","ask","request","question","wonder","curious","interested",
    "want","need","looking","searching","seeking","finding","getting",
    "having","using","making","doing","going","coming","taking","giving",
    "saying","telling","showing","sending","receiving","reading","writing",
    "watching","listening","playing","working","trying","starting","stopping",
    "continuing","finishing","completing","checking","testing","fixing",
    "changing","updating","adding","removing","deleting","moving","copying",
    "saving","loading","opening","closing","joining","leaving","entering",
    // ── More common gaming words (safe) ───────────────────────────
    "hp","mp","sp","mana","health","shield","armor","defence","defense",
    "attack","damage","dmg","dps","aoe","dot","hot","cc","crowd","control",
    "stun","knockback","knockup","slow","freeze","burn","bleed","poison",
    "buff","debuff","nerf","rework","passive","active","ultimate","ult",
    "cooldown","cd","cast","channel","interrupt","cancel","dodge","dash",
    "jump","teleport","blink","recall","respawn","spawn","wave","lane",
    "jungle","mid","top","bot","carry","support","tank","assassin","mage",
    "marksman","bruiser","fighter","healer","ranger","rogue","warrior",
    "mage","archer","knight","paladin","druid","monk","bard","cleric",
    "patch","meta","tier","ranked","casual","competitive","tournament",
    "matchmaking","queue","lobby","pregame","ingame","postgame","replay",
    "highlight","clip","screenshot","record","stream","twitch","youtube",
    "content","creator","youtuber","streamer","viewer","subscriber","follower",
    "like","comment","share","subscribe","notification","bell","channel",
    "video","short","reel","post","story","feed","timeline","profile",
    "handle","username","tag","hashtag","trending","viral","meme","gif",
    "reaction","respond","thread","reply","quote","retweet","like","share",
    // ── Swear words & mild expletives (very common in Discord, should NOT trigger trade/service detection) ──
    "damn","damned","damning","damnit","dammit","dang","darn","darned",
    "shit","shite","shits","shitty","shitting","shithead","bullshit","bs","horseshit",
    "fuck","fucker","fucked","fucking","fuckin","fucks","fuk","fucc","frick","fricking","fricked",
    "fudge","fudging","ffs","stfu","gtfo","omfg","wtaf",
    "ass","asses","asshole","assholes","dumbass","jackass","smartass","badass","hardass","fatass",
    "bitch","bitches","bitching","bitchy","son of a bitch",
    "bastard","bastards",
    "crap","craps","crappy","crapping","crapped",
    "piss","pissed","pissing","pisses","pisser",
    "hell","hells","bloody","damn hell","what the hell","the hell",
    "cunt","cunts",
    "dick","dicks","dickhead","dicked",
    "cock","cocks","cockhead",
    "pussy","pussies",
    "whore","whores","slut","sluts",
    "idiot","idiots","idiotic","moron","morons","moronic","retard","retards","imbecile",
    "stupid","stupider","stupidest","stupidity","dumb","dumber","dumbest","dumbass",
    "jerk","jerks","jerkoff","jackass","jackasses",
    "loser","losers","nerd","nerds","geek","geeks","freak","freaks","weirdo","weirdos",
    // ── Extra ones (extended Discord slang / swears / fillers) ─────────────────
"wtff","wtfff","wtffff","wtf bro","wtf man","wtf dude",
"omfg","omfgg","omfggg","omfg bro","omfg dude",
"tf","tf bro","tf man","tf is this","tf was that",
"af","asf","af bro","asf bro","asf man",
"frfr","fr fr","fr bro","fr man","fr dude",
"nahhh","nahhhh","nahhhhh","nah broo","nah dude",
"yeaaa","yeaaaa","yeaaaaa","yeahhh","yeahhhh",
"brooo","brooooo","broooooo","bruhhh","bruhhhh","bruhhhhh",
"dudeee","dudeeee","dudeeeeee","mannn","mannnn","maneee",
"ayo bro","ayo what","ayo wtf","ayo nah","ayo chill",
"yo broo","yo dudee","yo mannn","yo wtf bro",
"sheeesh","sheeeshh","sheeeshhh","sheeshhh",
"gahdamn","goddamn","goddamnn","goddamnnn",
"damnnn","damnnnn","damnnnnn","damn bro","damn dude",
"shittt","shitttt","shittttt","shit bro","shit dude",
"bullshitt","bullshitt","bullshitt bro","bullshitttt",
"fuuuuck","fuuuck","fuuuuuck","fuuuuuckk","fuckkkk","fuckkkkk",
"fkin","fckin","fk","fk bro","fk man","fk dude",
"mf","mfer","mfers","mf bro","mf dude",
"bitchhh","bitchhhh","bitchhhhh","bitch bro","bitch dude",
"asss","assss","asssss","ass bro","ass dude",
"hell nah","hell nahh","hell nahhh","hell nooo",
"nah hell","nah hell bro","nah hell nah",
"tf brooo","tf dudeee","tf mannn",
"nah wtf","nah wtf bro","nah wtf dude",
"yo wtf bro","yo wtf man","yo wtf dude",
"bro wtf is that","bro wtf was that",
"bro whattt","bro whatttt","bro whattttt",
"bro whyyy","bro whyyyy","bro whyyyyy",
"bro howww","bro howwww","bro howwwww",
"dude whattt","dude whyyy","dude howww",
"man whattt","man whyyy","man howww",
"wtf happened","wtf is going on","wtf just happened",
"bro stoppp","bro stopp","bro stahp",
"stopppp","stoppppp","stop brooo",
"waittt","waitttt","waittttt","wait brooo",
"hold up","holdup","hold uppp","hold upppp",
"nah chill","nah chilll","nah chill bro",
"chillll","chilllll","chillllll",
"calm downnn","calm downnnn","calm bro",
"relaxxx","relaxxxx","relax bro",
"no shot","no shottt","no shot bro",
"no way broo","no wayyy bro","no wayyy dude",
"aint no shot","aint no wayyy","aint no way bro",
"bro i cant","bro i canttt","bro i cantttt",
"i cant bro","i canttt","i cantttt",
"im done","im done bro","im doneee",
"im dead bro","im deaddd","im deadddd",
"dying bro","dyinggg","dyingggg",
"crying bro","cryinggg","cryingggg",
"nah im out","im out bro","im outtt",
"im gone","im gone bro","im goneee",
"this crazy","this crazyy","this crazyyy",
"thats crazy","thats crazyy","thats crazyyy",
"wild bro","wilddd","wildddd",
"insane bro","insaneee","insaneeee",
"crazy bro","crazyyy","crazyyyy",
"nah bro stop","nah bro stopp","nah bro stoppp",
"bro actually","bro literally","bro honestly",
"literally bro","actually bro","honestly bro",
"deadass bro","deadasss","deadassss",
"on god bro","on goddd","on godddd",
"no cap bro","no capp","no cappp",
"cappp","capppp","cappppp",
"middd","midddd","middddd",
"trashhh","trashhhh","trashhhhh",
"garbageee","garbageeee","garbageeeee",
"so bad bro","so badddd","so badddd",
"get good","get gud","git gud",
"skill issue bro","skill issueee","skill issueeee",
"massive skill issue","huge skill issue",
"hard diff","big diff","massive diff",
"diffed","diffed bro","diffed hard",
"ezzz","ezzz","ezzzz","ez bro",
"too ez","too easyyy","too easyyyy",
"freeee","freeeee","freeeeee",
"free win","free win bro",
"owned","owned bro","you got owned",
"rekt","rekt bro","rekt hard",
"clapped","clapped bro","you got clapped",
"rolled","rolled bro","you got rolled",
"smoked","smoked bro","you got smoked",
"folded","folded bro","you folded",
"nah u suck","u suck bro","u suckkk",
"you trash","you trashhh","you trashhhh",
"you bad","you baddd","you badddd",
"bot","bottt","botttt","npc bro","npc behavior",
"npc ass","npc energy","npc vibes",
"weird bro","weirdd","weirddd",
"cringe bro","cringee","cringeee",
"so cringe","so cringeee","so cringeeee",
"embarrassing","embarrassing bro",
"nah thats sad","thats saddd","thats sadddd",
"yikes bro","yikess","yikesss",
"oofff","ooffff","oofffff",
"big oof","huge oof",
"nah bro pls","bro pls","pls brooo",
"please bro","pleaseeee","pleaseeeee",
"nah bro fr","bro fr fr","fr bro fr",
"dead game","dead gameee","dead gameeee",
"game dead","game deaddd","game deadddd",
"laggy","laggyy","laggyyy",
"so laggy","so laggyyy",
"buggy","buggyy","buggyyy",
"glitched","glitchedd","glitcheddd",
"broken bro","brokennn","brokennnn",
"op bro","oppp","opppp",
"too op","too oppp","too opppp",
"nerf this","nerf this bro",
"buff this","buff this bro",
"fix this","fix this bro",
"devs pls","dev pls","devs fix",
"admins pls","mods pls","staff pls",
"report this","report bro",
"ban this guy","ban him bro",
"kick him","kick him bro",
"mute him","mute him bro",
"nah ban","nah ban bro",
"what is this","what is this bro",
"what even","what even bro",
"why is this","why is this bro",
"how is this","how is this bro", 

    // ── Common Discord / internet slang ───────────────────────────────────────────
    "bro","bruh","bruv","brah","bra","homie","homies","dude","duude","dudee","dudes",
    "fam","gang","gg","ez","gl","wp","gj","bg","rip","grz","gz","grats","gratz",
    "lmao","lmfao","rofl","roflmao","xd","xdd","lol","lolol","lolll","haha","hahaha","hahahaha",
    "hehe","hihi","kek","kekw","kekl","lmaooo","lmaoo","lmaoooo","loool","looool",
    "pog","poggers","pogchamp","copium","hopium","sadge","pepega","pepe","pepehands",
    "ngl","tbh","imo","imho","tbf","istg","iirc","afaik","fwiw","tldr","eta","irl",
    "ofc","obv","atp","rn","fr","ig","jk","nvm","lmk","hmu","ty","tysm","yw","np",
    "afk","brb","bbl","gtg","ggwp","ggez","ff","nt","bd","bg","gg","gl hf","glhf",
    "smh","smfh","smdh","foh","gtfoh","stfu","npc","yolo","swag","based","cringe",
    "ratio","w","l","yikes","oof","rip","mid","sus","cap","nocap","on god","ong",
    "bet","slay","vibe","vibing","bussin","bussin bussin","no cap","facts","real",
    "lowkey","highkey","literally","deadass","periodt","period","sheesh","sksksk",
    "ight","aight","alr","aite","fr fr","no fr","bro fr","bruh fr",
    "goated","goat","sigma","alpha","based af","cringe af","mid af","fire af",
    "mega","ultra","super","hyper","cracked","insane","insanely","crazy","hella",
    "mad","wicked","sick","heat","heat check","cold","raw","wavy","drip","sauce",
    "nah bro","nah man","nah dude","ok bro","ok man","bro what","bro why","bro how",
    "man why","man what","man bro","dude why","dude what","dude bro",
    "why bro","why man","why tho","why though","why tf","why the",
    "what bro","what man","what tf","what the",
    "bruh moment","bruh what","bruh why","bruh how","bruh tf",
    "no way","no wayy","no wayyy","bro no way","yooo","yoo","yo","yooooo",
    "bro stop","stop bro","bro wait","wait bro","bro seriously","seriously bro",
    "imagine","bro imagine","actually","literally","honestly",
    "true","facts bro","real bro","facts fr","real fr","on god bro",
    "kinda","sorta","gonna","wanna","gotta","hafta","tryna","finna","ima","imma",
    "prolly","prob","probs","defo","def","deffo","totes","totally","obvy","obvs",
    "idk","idek","idc","idgaf","idf","ik","ikr","ikk","ikf","ikyfl",
    "same bro","same lol","same honestly","same ngl","same fr",
    "mood bro","mood honestly","mood fr","big mood","same mood",
    "rn bro","atm","rn fr","at the moment",
    "ugh","uggh","ugghh","argh","aaah","ahhh","ughhh","eww","ewww","ew bro",
    "omg","omgg","omggg","omg bro","oh my","oh wow","oh shit","oh damn",
    "bro oh my","yo bro","yo man","yo dude","yo wtf","yo omg",
    "nope","yep","yup","yuppp","yupp","nope nope","yeah nah","nah yeah",
    "ayy","ayo","ayoo","broo","broooo","dude bro","man bro",
    "lmaooo bro","lmao bro","bruh lmao","bro lmao","dude lmao",
    "haha bro","bro haha","lol bro","bro lol","kek bro",
    "cry","crying","dies","dying","dead","im dead","im dying","literally dead",
    "pff","pfft","pffft","lmfaooo","meh","nah meh","meh bro",
    "eh","ehh","ehhh","idk man","idk bro","idk dude","idk fr",
    "cope","coping","copium","touch grass","skill issue","skill diff","diff",
    "ratio","ratioed","ratio bro","hard ratio","massive ratio",
    "rizz","rizzed","rizzing","no rizz","got rizz","rizz up",
    "cooked","absolutely cooked","cooked bro","cooked fr","he cooked","she cooked",
    "glazing","glazed","glaze","stop glazing","stop the glaze",
    "aint","ain't","aint even","ain't even","aint no way","ain't no way",
    "bruh bruh","bro bro","man man","dude dude",
    "smh bro","smh fr","smh honestly","smh ngl","smh lol",
    "maxed","maxing","maxlevel","maxlvl","fullbuild","endgame","lategame",
    "midgame","earlygame","newplayer","veteran","experienced","skilled",
    "strong","weak","op","overpowered","underpowered","balanced","broken",
    "bugged","glitched","lag","lagging","latency","connection","disconnect",
    "reconnect","rejoin","crash","freeze","loading","buffering",
    "update","hotfix","patch","maintenance","downtime","reboot","restart",
    "wipe","reset","rollback","rollout","deploy","release","version",
    "patch notes","patchnotes","changelogs","changelog","news","announcement",
    "dev","developer","developers","admin","admins","mod","mods","staff",
    "support","help","faq","guide","tutorial","tips","tricks","strategy",
    "walkthrough","howto","explain","taught","showing","demonstrating",
]);

// ══════════════════════════════════════════════════════════
//  FRUITS
// ══════════════════════════════════════════════════════════
const FRUITS = [
    // ── Common ────────────────────────────────────────────────────────────
    "rocket","spin","chop","spring","bomb","smoke","spike","flame","kilo",
    "🚀","🌀","🪓","🌸","💣","💨","🦔","🔥","⚖️",
    // ── Uncommon ──────────────────────────────────────────────────────────
    "ice","sand","dark","eagle","diamond",
    "🧊","🏜️","🖤","🦅","💎",
    // ── Rare ──────────────────────────────────────────────────────────────
    "light","rubber","ghost","magma","quake","buddha","buda","love","creation",
    "spider","sound",
    "💡","🪀","👻","🌋","🌊","🧘","❤️","🎨","🕷️","🔊",
    // ── Legendary ─────────────────────────────────────────────────────────
    "phoenix","portal","rumble","lightning","pain","blizzard","gravity",
    "mammoth","trex","t-rex","dough","shadow","venom",
    "🐦‍🔥","🔮","⚡","🌩️","💀","❄️","🌍","🦣","🦖","🍩","🌑","☠️",
    // ── Mythical ──────────────────────────────────────────────────────────
    "gas","spirit","tiger","yeti","kitsune","control","dragon","leopard",
    "🫧","💫","🐯","🏔️","🦊","🎮","🐉","🐆",
    // ── Gamepasses / perks ────────────────────────────────────────────────
    "2x money","2x mastery","2x boss drops","dark blade","yoru",
    "fast boats","fruit notifier","werewolf",
    "💰","⚔️","👑","🗡️","🗡️","⛵","🔔","🐺",
    // ── Cosmetics / skins / auras / chromatics ────────────────────────────
    "empyrean","fiendyetimutation","fiend yeti mutation",
    "werewolftigermutation","werewolf tiger mutation",
    "blueportalskin","blue portal skin",
    "divineportalskin","divine portal skin",
    "purplelightningskin","purple lightning skin",
    "eclipsedracoskin","eclipse draco skin",
    "emberdragonskin","ember dragon skin",
    "empyreanskin","empyrean skin",
    "snowwhiteaura","snow white aura",
    "pureredaura","pure red aura",
    "winterskyaura","winter sky aura",
    "chromaticbomb","chromatic bomb",
    "chromaticdiamond","chromatic diamond",
    "chromaticpain","chromatic pain",
    "chromaticportal","chromatic portal",
    "chromaticempyrean","chromatic empyrean",
    "chromaticeagle","chromatic eagle",
    "chromaticlightning","chromatic lightning",
    "chromaticdragon","chromatic dragon",
    "nuclearbombskin","nuclear bomb skin",
    "thermitebombskin","thermite bomb skin",
    "azurabombskin","azura bomb skin",
    "celebrationbombskin","celebration bomb skin",
    "tormentpainskin","torment pain skin",
    "superspiritpainskin","super spirit pain skin",
    "frustrationpainskin","frustration pain skin",
    "sadnesspainskin","sadness pain skin",
    "celestialpainskin","celestial pain skin",
    "greenlightningskin","green lightning skin",
    "redlightningskin","red lightning skin",
    "yellowlightningskin","yellow lightning skin",
    // ── Cosmetic emoji versions ───────────────────────────────────────────
    "✨",                // empyrean
    "🦣❄️","🐺🐯",      // fiend yeti mutation, werewolf tiger mutation
    "🔵🔮","✨🔮",       // blue portal skin, divine portal skin
    "🟣⚡","🌑🐉","🔥🐉", // purple lightning / eclipse draco / ember dragon skins
    "⬜","🔴","🩵",      // snow white aura, pure red aura, winter sky aura
    "🌈💣","🌈💎","🌈💀","🌈🔮","🌈✨","🌈🦅","🌈⚡","🌈🐉", // chromatics
    "☢️💣","🔥💣","🔵💣","🎉💣", // nuclear / thermite / azura / celebration bomb skins
    "😈💀","💫💀","😤💀","😢💀","🌟💀", // pain skins (torment/super spirit/frustration/sadness/celestial)
    "💚⚡","🔴⚡","💛⚡", // green / red / yellow lightning skins
];
const FRUIT_ALIASES = {
    "rmble":"rumble","rmbl":"rumble","ruble":"rumble","rumbl":"rumble",
    "drg":"dragon","drgn":"dragon","drago":"dragon","draggon":"dragon",
    "phx":"phoenix","phnx":"phoenix","phonix":"phoenix","phenix":"phoenix",
    "foenix":"phoenix","pheonix":"phoenix","phoenex":"phoenix",
    "lghtn":"lightning","lightnin":"lightning","litning":"lightning",
    "ltning":"lightning","lghtning":"lightning","lnghtning":"lightning",
    "lighning":"lightning","lightening":"lightning","ligtning":"lightning",
    "blzrd":"blizzard","blizzrd":"blizzard","blzd":"blizzard",
    "blzard":"blizzard","blizzrad":"blizzard","blizard":"blizzard",
    "spdr":"spider","spidur":"spider","spidder":"spider","spidr":"spider",
    "mmth":"mammoth","mamoth":"mammoth","mamoto":"mammoth",
    "mammouth":"mammoth","mamouth":"mammoth",
    "budha":"buddha","buda":"buddha","budda":"buddha",
    "budah":"buddha","buddah":"buddha","budaah":"buddha",
    "ghst":"ghost","gost":"ghost","ghot":"ghost","gohst":"ghost",
    "shdw":"shadow","shadw":"shadow","shado":"shadow","shadoe":"shadow",
    "shadowe":"shadow","shaodw":"shadow","shdow":"shadow",
    "dmnd":"diamond","diamnd":"diamond","dimond":"diamond","daimnd":"diamond",
    "diamnod":"diamond","dimand":"diamond","diamod":"diamond",
    "grv":"gravity","gravty":"gravity","graviti":"gravity",
    "gravty":"gravity","gravitty":"gravity","garvity":"gravity",
    "ctrl":"control","contrl":"control","contrll":"control",
    "contol":"control","contorl":"control","cntrol":"control",
    "cntrl":"control",
    "quak":"quake","qake":"quake","quke":"quake","quakee":"quake",
    "lght":"light","ligt":"light","ight":"light","lgt":"light",
    "liight":"light","litght":"light",
    "flme":"flame","flam":"flame","flaim":"flame",
    "blad":"blade","balde":"blade","blde":"blade","balade":"blade",
    "sprng":"spring","sprin":"spring","spng":"spring",
    "sprg":"spring","sprnig":"spring","springg":"spring",
    "rubbr":"rubber","rubr":"rubber","ruber":"rubber",
    "rubr":"rubber","rubeer":"rubber",
    "cration":"creation","cretion":"creation","creaton":"creation",
    "crtn":"creation","creatn":"creation","creatiion":"creation",
    "ventom":"venom","venm":"venom","vnm":"venom",
    "venoum":"venom","vemom":"venom","vnoom":"venom",
    "tgr":"tiger","tigr":"tiger","tigar":"tiger",
    "tigger":"tiger","tigerr":"tiger","tigear":"tiger",
    "kitsun":"kitsune","kitune":"kitsune","kitsn":"kitsune",
    "kitsnue":"kitsune","kitstune":"kitsune","kittsune":"kitsune",
    "ytes":"yeti","yti":"yeti","yeit":"yeti",
    "yette":"yeti","yetii":"yeti",
    "drkblade":"dark blade","drk blade":"dark blade","drkblde":"dark blade",
    "darkblade":"dark blade","darkblde":"dark blade","dkblade":"dark blade",
    "mg":"magma","mgma":"magma","magm":"magma","magmma":"magma",
    "magmaa":"magma","maga":"magma",
    "leoprd":"leopard","leapord":"leopard","leoprad":"leopard",
    "lepoard":"leopard","leoppard":"leopard","leopad":"leopard",
    "spirt":"spirit","sprt":"spirit","spiirt":"spirit","spriti":"spirit",
    "portl":"portal","portle":"portal","portale":"portal","prtal":"portal",
    "drag":"dragon","lg":"lightning","leo":"leopard",
    "dough":"dough","dugh":"dough","doh":"dough","douggh":"dough",
    "trex":"t-rex","tyrex":"t-rex","trx":"t-rex",
    "werwolf":"werewolf","werevolf":"werewolf","werwlf":"werewolf",
    "rckt":"rocket","rokt":"rocket","rockket":"rocket","rokket":"rocket",
    "spn":"spin","spinn":"spin","bmb":"bomb","bom":"bomb",
    "smk":"smoke","smke":"smoke","smoe":"smoke",
    "spke":"spike","spik":"spike","snd":"sand","drk":"dark",
    "eagl":"eagle","egle":"eagle","eagel":"eagle",
    "klo":"kilo","killo":"kilo","kiilo":"kilo","kiol":"kilo",
    "chp":"chop","chopp":"chop","ch0p":"chop",
    "blade":"chop", // Chop is sometimes called blade at common tier in the game
    "gass":"gas","gaas":"gas","luv":"love","lov":"love",
    "payn":"pain","pian":"pain",
    "rkt":"rocket","ic":"ice","snand":"sand","darck":"dark",
};

// ══════════════════════════════════════════════════════════
//  PAIN FRUIT UPGRADES
// ══════════════════════════════════════════════════════════
const PAIN_UPGRADES = [
    "infernal endurance","agony surge","torment conductor","spectral assimilation",
    "infernalendurance","agonysurge","tormentconductor","spectralassimilation",
];
const PAIN_UPGRADE_ALIASES = {
    "infend":   "infernal endurance",
    "infendr":  "infernal endurance",
    "infernalendr": "infernal endurance",
    "agonysrg": "agony surge",
    "agysrge":  "agony surge",
    "agonysurge":"agony surge",
    "trmtcndr": "torment conductor",
    "trmcond":  "torment conductor",
    "tormentcond": "torment conductor",
    "spectralasm": "spectral assimilation",
    "spectrasim":  "spectral assimilation",
    "specasm":  "spectral assimilation",
    "spctasm":  "spectral assimilation",
};

// ══════════════════════════════════════════════════════════
//  LIGHTNING FRUIT UPGRADES
// ══════════════════════════════════════════════════════════
const LIGHTNING_UPGRADES = [
    "predator circuit breaker","capacitor overload test","conductor's resonance",
    "predatorcircuitbreaker","capacitoroverloadtest","conductorsresonance",
    "circuit breaker","overload test","conductor resonance",
];
const LIGHTNING_UPGRADE_ALIASES = {
    "predcb":   "predator circuit breaker",
    "predbrkr": "predator circuit breaker",
    "circbrkr": "predator circuit breaker",
    "circuitbrkr": "predator circuit breaker",
    "capovrld": "capacitor overload test",
    "capovrtest": "capacitor overload test",
    "capovrltest": "capacitor overload test",
    "ovrldtest": "capacitor overload test",
    "condrsn":  "conductor's resonance",
    "condrson": "conductor's resonance",
    "condresn": "conductor's resonance",
    "cndrsn":   "conductor's resonance",
};

// ══════════════════════════════════════════════════════════
//  SWORDS
// ══════════════════════════════════════════════════════════
const SWORDS = [
    "cursed dual katana","dark blade","hallow scythe","true triple katana",
    "dragonheart","dragon heart","bisento","buddy sword","canvander",
    "dark dagger","fox lamp","koko","midnight blade","pole","rengoku",
    "saber","saddi","shark anchor","shisui","spikey trident","tushita",
    "wando","yama","dragon trident","dual-headed blade","dual headed blade",
    "gravity cane","jitte","longsword","pipe","soul cane","trident",
    "warden's sword","wardens sword","warden sword","flail","iron mace",
    "shark saw","triple katana","twin hooks","cutlass","dual katana","katana",
    "ttk","cdk","hs",
];
const SWORD_ALIASES = {
    "cdk":"cursed dual katana","ttk":"true triple katana",
    "dk":"dark blade","db":"dark blade","hs":"hallow scythe",
    "bs":"buddy sword","cvnd":"canvander","cnvdr":"canvander",
    "dd":"dark dagger","fl":"fox lamp","mb":"midnight blade",
    "rng":"rengoku","rgk":"rengoku","rngku":"rengoku","rngk":"rengoku",
    "renk":"rengoku","rengokuu":"rengoku","rngoku":"rengoku",
    "sab":"saber","sabr":"saber","sabber":"saber",
    "sad":"saddi","saddie":"saddi","sadi":"saddi",
    "sa":"shark anchor","sharkanc":"shark anchor",
    "shs":"shisui","shsui":"shisui","shisuii":"shisui","shsi":"shisui",
    "st":"spikey trident","spkytrdnt":"spikey trident",
    "tush":"tushita","tsh":"tushita","tshta":"tushita","tushta":"tushita",
    "wan":"wando","wand":"wando","wandoo":"wando",
    "ya":"yama","yamaa":"yama","yamma":"yama",
    "dt":"dragon trident","drgntrident":"dragon trident",
    "dhb":"dual-headed blade","dualhdbld":"dual-headed blade",
    "gc":"gravity cane","gravcane":"gravity cane","grvcane":"gravity cane",
    "jt":"jitte","jiite":"jitte","jite":"jitte",
    "ls":"longsword","lngswd":"longsword","longswd":"longsword",
    "sc":"soul cane","slcane":"soul cane","soulcn":"soul cane",
    "tri":"trident","trdnt":"trident","triident":"trident",
    "ws":"warden's sword","wardenswd":"warden's sword",
    "wardsword":"warden's sword","wardenswrd":"warden's sword",
    "im":"iron mace","ironmc":"iron mace","imace":"iron mace",
    "ss":"shark saw","shrksw":"shark saw","shsaw":"shark saw",
    "tk":"triple katana","trplkat":"triple katana","trkat":"triple katana",
    "th":"twin hooks","twnhks":"twin hooks","twinhk":"twin hooks",
    "cut":"cutlass","cutlas":"cutlass","ctlss":"cutlass",
    "dkat":"dual katana","dualkat":"dual katana","dktn":"dual katana",
    "kat":"katana","katna":"katana","katanna":"katana","katan":"katana",
    "bist":"bisento","bsnt":"bisento","bisent":"bisento","bisnto":"bisento",
    "trpktna":"triple katana","wands":"wando","rengk":"rengoku",
    "drght":"dragonheart","dragnh":"dragonheart",
    "shisiu":"shisui","shsius":"shisui",
    "tushita":"tushita","tsushita":"tushita",
    "koko":"koko","kukoo":"koko","cok":"koko",
    "saddii":"saddi","pipe2":"pole","pole2":"pole","pole1":"pole",
    "cursed dual":"cursed dual katana","curseddual":"cursed dual katana",
    "hallwscythe":"hallow scythe","halscythe":"hallow scythe",
    "truetrple":"true triple katana","ttrpkat":"true triple katana",
    "drgnhrt":"dragonheart","dragonhrt":"dragonheart",
    "bddyswd":"buddy sword","buddyswd":"buddy sword",
    "drkdgr":"dark dagger","darkdgr":"dark dagger",
    "fxlmp":"fox lamp","foxlmp":"fox lamp",
    "mdnightbld":"midnight blade","midnblade":"midnight blade",
    "midnightbld":"midnight blade",
    "sankr":"shark anchor","shrkanchr":"shark anchor",
    "sptrident":"spikey trident","spkytrident":"spikey trident",
    "dtrident":"dragon trident","drgtrident":"dragon trident",
    "dheadblade":"dual-headed blade","dualheadbld":"dual-headed blade",
    "gcane":"gravity cane","lsword":"longsword","scane":"soul cane",
    "sharksw":"shark saw","sksaw":"shark saw",
    "thooks":"twin hooks","cutlass":"cutlass",
    "dktn":"dual katana","lngswrd":"longsword",
    "pole2ndform":"pole","pole1stform":"pole",
};

// ══════════════════════════════════════════════════════════
//  BOSSES
// ══════════════════════════════════════════════════════════
const BOSSES = [
    // ── Gods Chalice / story items ───────────────────────────────────────
    "gods chalice","god's chalice","godschalice",
    "fist of darkness","fistofdarkness",
    // ── First Sea bosses ─────────────────────────────────────────────────
    "greybeard","grey beard",
    "order",
    "vice admiral","viceadmiral",
    "saber expert","saberexpert",
    "warden",
    "chief warden","chiefwarden",
    "swan",
    "gorilla king","gorillaking",
    "bobby",
    "the saw","thesaw",
    "mob leader","mobleader",
    // ── Second Sea bosses ────────────────────────────────────────────────
    "darkbeard","dark beard",
    "jeremy",
    "fajita",
    "wysper",
    "thunder god","thundergod",
    "magma admiral","magmaadmiral",
    "fishman lord","fishmanlord",
    "cyborg",
    "ice admiral","iceadmiral",
    "diamond",
    "don swan","donswan",
    "smoke admiral","smokeadmiral",
    "awakened ice admiral","awakenediceadmiral",
    "kilo admiral","kiloadmiral",
    // ── Third Sea bosses ─────────────────────────────────────────────────
    "tide keeper","tidekeeper",
    "stone",
    "island empress","islandempres",
    "captain elephant","captainelephant",
    "beautiful pirate","beautifulpirate",
    "longma",
    "cake queen","cakequeen",
    "soul reaper","soulreaper",
    "indra",
    "katakuri",
    "yeti",
    // ── Raid bosses (end-game) ────────────────────────────────────────────
    "cake prince","cakeprince",
    "dough king","doughking",
    "tyrant of the skies","tyrant skies","tyrantskies",
    "leviathan","leviathn","leviatan","levithan",
    "sea beast","seabeast","seabst",
    "unbound werewolf","unboundwerewolf","werewlf","wwolf",
    // ── Raid-type references ──────────────────────────────────────────────
    "raid boss","raidboss","raid bosses","raidbosses",
    "buddha raid boss","rumble raid boss","dough raid boss",
    "dragon raid boss","leopard raid boss","kitsune raid boss",
    "phoenix raid boss","portal raid boss","blizzard raid boss",
    "mammoth raid boss","spirit raid boss","venom raid boss",
    "shadow raid boss","gravity raid boss","pain raid boss",
];
const BOSS_ALIASES = {
    "gc":"gods chalice","fod":"fist of darkness",
    "gb":"greybeard","db":"darkbeard",
    "cp":"cake prince","dk":"dough king",
    "tots":"tyrant of the skies","levi":"leviathan",
    "sb":"sea beast","uw":"unbound werewolf","ww":"unbound werewolf",
    "gk":"gorilla king","bob":"bobby","saw":"the saw",
    "va":"vice admiral","se":"saber expert","wa":"warden",
    "cw":"chief warden","ma":"magma admiral","fl":"fishman lord",
    "tg":"thunder god","ia":"ice admiral","dia":"diamond",
    "jer":"jeremy","faj":"fajita","ds":"don swan",
    "sma":"smoke admiral","aia":"awakened ice admiral",
    "tk":"tide keeper","ie":"island empress","ka":"kilo admiral",
    "ce":"captain elephant","bp":"beautiful pirate","lm":"longma",
    "cq":"cake queen","sr":"soul reaper","ind":"indra","kat":"katakuri",
    "mob":"mob leader","sw":"swan",
    "grybrd":"greybeard","greyb":"greybeard",
    "dkbrd":"darkbeard","darkb":"darkbeard",
    "godchalice":"gods chalice","godschalice":"gods chalice",
    "fistdark":"fist of darkness","fistdrk":"fist of darkness",
    "gorilla":"gorilla king","gorillak":"gorilla king","gking":"gorilla king",
    "bby":"bobby","boby":"bobby",
    "tsaw":"the saw","thsaw":"the saw",
    "vicadm":"vice admiral","vadm":"vice admiral",
    "saberexp":"saber expert","sabexp":"saber expert",
    "wardn":"warden","chiefwrdn":"chief warden","cwardn":"chief warden",
    "mgmaadm":"magma admiral","mgadm":"magma admiral",
    "fishmlord":"fishman lord","flord":"fishman lord",
    "wysp":"wysper","wisper":"wysper",
    "thndrgod":"thunder god","tgod":"thunder god",
    "iceadm":"ice admiral","icedm":"ice admiral",
    "diamnd":"diamond","diam":"diamond",
    "jermy":"jeremy","jeremi":"jeremy",
    "fajta":"fajita","fajitas":"fajita",
    "dnswan":"don swan","dswan":"don swan",
    "smkadm":"smoke admiral","smokadm":"smoke admiral",
    "awkniced":"awakened ice admiral","awaknia":"awakened ice admiral",
    "tkeep":"tide keeper","tidkpr":"tide keeper",
    "stonee":"stone","stoone":"stone",
    "islandemprs":"island empress","ilemp":"island empress",
    "kiloadm":"kilo admiral","kadmrl":"kilo admiral",
    "captelph":"captain elephant","cptlph":"captain elephant",
    "beaupir":"beautiful pirate","bpir":"beautiful pirate",
    "lngma":"longma","lgma":"longma",
    "cakequn":"cake queen","ckqueen":"cake queen",
    "soulrpr":"soul reaper","srpr":"soul reaper",
    "indrra":"indra","indraa":"indra",
    "katakri":"katakuri","ktakuri":"katakuri",
    "tyrant":"tyrant of the skies","tyrantsky":"tyrant of the skies",
    "levthan":"leviathan","lviathan":"leviathan","leviatan":"leviathan",
    "sebeast":"sea beast","seabeast":"sea beast",
    "unbndww":"unbound werewolf","ubww":"unbound werewolf",
};

// ══════════════════════════════════════════════════════════
//  MATERIALS
// ══════════════════════════════════════════════════════════
const MATERIALS = [
    "angel wings","angelwings",
    "leather",
    "magma ore","magmaore",
    "scrap metal","scrapmetal",
    "wooden plank","woodenplank",
    "yeti fur","yetifur",
    "fish tail","fishtail",
    "mystic droplet","mysticdroplet",
    "radioactive material","radioactivematerial",
    "shark tooth","sharktooth",
    "vampire fang","vampirefang",
    "conjured cocoa","conjuredcocoa",
    "demonic wisp","demonicwisp",
    "dragon scale","dragonscale",
    "electric wing","electricwing",
    "mutant tooth","mutanttooth",
    "alucard fragment","alucardfragment",
    "azure ember","azureember",
    "celestial token","celestialtoken",
    "dinosaur bones","dinosaurbones",
    "dark fragment","darkfragment",
    "fool's gold","fools gold","foolsgold",
    "hearts",
    "leviathan scale","leviathanscale",
    "meteorite",
    "mini mythic","minimythic",
    "monster magnet","monstermagnet",
    "oni token","onitoken",
    "summer token","summertoken",
    "terror eyes","terroreyes",
    "volcanic magnet","volcanicmagnet",
    "volt capsule","voltcapsule",
    "leviathan heart","leviatanheart",
];
const MATERIAL_ALIASES = {
    "angwings":"angel wings","angwng":"angel wings","angelwng":"angel wings",
    "leathr":"leather","lether":"leather","lethr":"leather",
    "magore":"magma ore","mgore":"magma ore","magmaor":"magma ore",
    "scrpmetal":"scrap metal","scrapmet":"scrap metal","scrapmtl":"scrap metal",
    "woodplank":"wooden plank","wdnplank":"wooden plank","woodenplk":"wooden plank",
    "yetifr":"yeti fur","ytifur":"yeti fur","yetfur":"yeti fur",
    "fishtl":"fish tail","fshtail":"fish tail",
    "mysticdrop":"mystic droplet","mystdrop":"mystic droplet","mysticdropl":"mystic droplet",
    "radmat":"radioactive material","radiomat":"radioactive material","radactmat":"radioactive material",
    "shrktooth":"shark tooth","sharktth":"shark tooth","shktooth":"shark tooth",
    "vampfang":"vampire fang","vampirefng":"vampire fang","vmpfang":"vampire fang",
    "conjcocoa":"conjured cocoa","conjuredcoc":"conjured cocoa","conjcoc":"conjured cocoa",
    "demwisp":"demonic wisp","demonwisp":"demonic wisp","dmcwisp":"demonic wisp",
    "drgscale":"dragon scale","dragonscl":"dragon scale","dragscale":"dragon scale",
    "elecwing":"electric wing","electricwng":"electric wing","elwing":"electric wing",
    "mutanttth":"mutant tooth","muttooth":"mutant tooth","mutntooth":"mutant tooth",
    "alucardfrag":"alucard fragment","alucfrag":"alucard fragment","alufrag":"alucard fragment",
    "azrember":"azure ember","azuremb":"azure ember","azrembr":"azure ember",
    "celesttok":"celestial token","celesttoken":"celestial token","celesttk":"celestial token",
    "dinobones":"dinosaur bones","dinosaurbns":"dinosaur bones",
    "darkfrag":"dark fragment","drkfrag":"dark fragment",
    "foolsgold":"fool's gold","foolsglod":"fool's gold","fgold":"fool's gold",
    "hrt":"hearts","hart":"hearts",
    "leviscale":"leviathan scale","levithanscale":"leviathan scale","levscale":"leviathan scale",
    "meterite":"meteorite","meteor":"meteorite","meteroite":"meteorite",
    "minimyth":"mini mythic","mnimythic":"mini mythic","mnimyth":"mini mythic",
    "monstermag":"monster magnet","mnstrmagnet":"monster magnet","monstermagn":"monster magnet",
    "onitok":"oni token","onitokn":"oni token","ontok":"oni token",
    "summertok":"summer token","sumtok":"summer token","summtok":"summer token",
    "terroreye":"terror eyes","trreyes":"terror eyes",
    "volcmag":"volcanic magnet","volcanicmag":"volcanic magnet","volcmagnet":"volcanic magnet",
    "voltcap":"volt capsule","vltcap":"volt capsule","voltcapsul":"volt capsule",
    "leviheart":"leviathan heart","leviatanhrt":"leviathan heart","levihrt":"leviathan heart",
};

// ══════════════════════════════════════════════════════════
//  NPCs
// ══════════════════════════════════════════════════════════
const NPCS = [
    // ── Combat NPCs (enemies / grindable mobs) ────────────────────────────
    "bandit","monkey","gorilla","pirate","brute",
    "desert bandit","desertbandit","desert officer","desertofficer",
    "snow bandit","snowbandit","snowman",
    "chief petty officer","chiefpettyofficer",
    "sky bandit","skybandit","dark master","darkmaster",
    "prisoner","dangerous prisoner","dangerousprisoner",
    "tars",
    "fishman warrior","fishmanwarrior",
    "fishman commando","fishmancommando",
    "god's guard","gods guard","godsguard",
    "shanda","royal squad","royalsquad",
    "royal soldier","royalsoldier",
    "swan pirate","swanpirate",
    "factory staff","factorystaff",
    "marine lieutenant","marineleuienant","marine lt",
    "marine captain","marinecaptain",
    "zombie","vampire",
    "snow trooper","snowtrooper","winter warrior","winterwarrior",
    "scout","ship officer","shipofficer",
    "ship engineer","shipengineer",
    "ship steward","shipsteward",
    "ship captain","shipcaptain",
    "arctic warrior","arcticwarrior",
    "snow mountain warrior","snowmountainwarrior",
    "sea soldier","seasoldier","water gladiator","watergladiator",
    "reborn skeleton","rebornskeleton",
    "living zombie","livingzombie",
    "demonic soul","demonicsoul",
    "posessed mummy","possessed mummy","possessedmummy",
    "forest pirate","forestpirate",
    "mythological pirate","mythologicalpirate",
    "marine commodore","marinecommodore",
    "fishman raider","fishmanraider",
    "fishman captain","fishmancaptain",
    "giant bandit","giantbandit",
    "haunted shipwright","hauntedshipwright",
    "candy pirate","candypirate",
    "snow demon","snowdemon",
    "ice cream chef","icecreamchef",
    "peanut scout","peanutscout","peanut bandit","peanutbandit",
    "cocoa warrior","cocoawarrior",
    "chocolate bar battallion","chocolatebarbattallion","chocolate bar battalion","chocolatebarbattalion",
    "sweet scout","sweetscout","cookie cracker","cookiecracker",
    "cake guard","cakeguard","baking staff","bakingstaff",
    "head baker","headbaker","cocoa pirate","cocoapirate",
    "dragon wizard","dragonwizard","dragon hunter","dragonhunter",
    "skeleton apprentice","skeletonapprentice",
    "skeletal scouter","skeletalscouter",
    "demonic soul reaper","demonicsoulreaper",
    "crypt master","cryptmaster",
    "living skeleton","livingskeleton",
    // ── Friendly NPCs / Vendors / Trainers ───────────────────────────────
    "citizen","sea captain","seacaptain","blacksmith",
    "set home point","sethomepoint",
    "mysterious man","mysteriousman",
    "crew captain","crewcaptain","trevor","manager","nerd",
    "bounty expert","bountyexpert",
    "honor expert","honorexpert",
    "awakenings expert","awakeningsexpert",
    "customer","experienced captain","experiencedcaptain",
    "rip indra","ripindra","rip_indra",
    "titles specialist","titlesspecialist",
    "aura editor","auraeditor",
    "mr captain","mr. captain","mrcaptain",
    "military detective","militarydetective",
    "mysterious entity","mysteriousentity",
    "erin","angler","lucien",
    "trinket expert","trinketexpert",
    "trinket refiner","trinketrefiner",
    "valentines delivery","valentinesdelivery",
    "blox fruit dealer","bloxfruitdealer",
    "blox fruit gacha","bloxfruitgacha",
    "sabi","santa claws","santaclaws",
    "sealed king","sealedking","shafi",
    "shark hunter","sharkhunter",
    "sharkman master","sharkmanmaster",
    "sharkman teacher","sharkmanteacher",
    "shipwright teacher","shipwrightteacher",
    "sick man","sickman","spy","statue",
    "submarine worker","submarineworker",
    "sweet crafter","sweetcrafter",
    "beast hunter","beasthunter",
    "ancient one","ancientone",
    "dojo trainer","dojotrainer",
    "dragon talon sage","dragontalonsage",
    "previous hero","previoushero",
    "hungry man","hungryman","barista",
    "death king","deathking",
    "weird machine","weirdmachine",
    "sick scientist","sickscientist",
    "cake scientist","cakescientist",
    "drip mama","drip_mama","dripmama",
    "lunoven","plokster","butler",
    "mysterious scientist","mysteriousscientist",
    "tacomura","phoeyu the reformed","phoeyuthereformed",
    "water kung fu teacher","waterkungfuteacher",
    "dark step teacher","darkstepteacher",
    "mad scientist","madscientist",
    "martial arts master","martialartsmaster",
    "elite hunter","elitehunter",
    "player hunter","playerhunter",
    "remove blox fruit","removebloxfruit",
    "hassan","boris","yoshi",
];
const NPC_ALIASES = {
    "bndtt":"bandit","mnky":"monkey","monky":"monkey","monke":"monkey",
    "grlla":"gorilla","gorila":"gorilla","grla":"gorilla",
    "pirte":"pirate","prat":"pirate","prte":"pirate",
    "brtt":"brute","brt":"brute",
    "dserbandit":"desert bandit","desrtbandit":"desert bandit","drtbandit":"desert bandit",
    "dsertofficer":"desert officer","desrtofficer":"desert officer",
    "snwbandit":"snow bandit","snwbndt":"snow bandit","snowbndt":"snow bandit",
    "snwman":"snowman","snoman":"snowman",
    "cpo":"chief petty officer","chfpettyofficer":"chief petty officer","chiefpto":"chief petty officer",
    "skybndt":"sky bandit","skybdt":"sky bandit",
    "drkmaster":"dark master","darkmastr":"dark master","drkmstr":"dark master",
    "prisnr":"prisoner","prisonr":"prisoner",
    "dangerousprsnr":"dangerous prisoner","dangprisoner":"dangerous prisoner",
    "fishwarr":"fishman warrior","fshmanwarr":"fishman warrior",
    "fishcmdo":"fishman commando","fshmancmdo":"fishman commando",
    "godsguard":"god's guard","godguard":"god's guard","gdguard":"god's guard",
    "royalsqd":"royal squad","ryalsquad":"royal squad","roylsquad":"royal squad",
    "royalsldr":"royal soldier","ryalsoldier":"royal soldier","roysldr":"royal soldier",
    "swanprt":"swan pirate","swanpirte":"swan pirate","swanpirt":"swan pirate",
    "factstf":"factory staff","factorystf":"factory staff","facstf":"factory staff",
    "marinelt":"marine lieutenant","marinelieu":"marine lieutenant",
    "marinecpt":"marine captain","marinecap":"marine captain","marinecapt":"marine captain",
    "zmbie":"zombie","zmby":"zombie","zomie":"zombie",
    "vampr":"vampire","vampyre":"vampire","vampir":"vampire",
    "snowtrpr":"snow trooper","snwtrpr":"snow trooper","snowtroopr":"snow trooper",
    "wintrwarr":"winter warrior","wntwarr":"winter warrior",
    "scot":"scout","sct":"scout",
    "shipoffcr":"ship officer","shipofficr":"ship officer",
    "shipengnr":"ship engineer","shipenginr":"ship engineer",
    "shipstwd":"ship steward","shipstewd":"ship steward",
    "shipcpt":"ship captain","shipcapt":"ship captain",
    "arcticwarr":"arctic warrior","arcwarr":"arctic warrior",
    "snowmtwarr":"snow mountain warrior","snwmtnwarr":"snow mountain warrior",
    "seasldr":"sea soldier","seaoldr":"sea soldier",
    "watergla":"water gladiator","wtrglad":"water gladiator","wglad":"water gladiator",
    "rebrnsk":"reborn skeleton","rebskel":"reborn skeleton",
    "lvngzmb":"living zombie","livingzmb":"living zombie",
    "demncsoul":"demonic soul","dmcsoul":"demonic soul","demonsoul":"demonic soul",
    "possedmum":"possessed mummy","possdmum":"possessed mummy",
    "frstpirate":"forest pirate","forestpirt":"forest pirate",
    "mythpirt":"mythological pirate","mytholgpirt":"mythological pirate",
    "marinecmdr":"marine commodore","marinecmod":"marine commodore",
    "fishraidr":"fishman raider","fshmanraidr":"fishman raider",
    "fishcapt":"fishman captain","fishmancapt":"fishman captain",
    "giantbndt":"giant bandit","gntbandit":"giant bandit",
    "hauntshpwrt":"haunted shipwright","hauntedshpwrt":"haunted shipwright",
    "candyprt":"candy pirate","candypirt":"candy pirate",
    "snwdmn":"snow demon","snowdmn":"snow demon","snwdem":"snow demon",
    "icecrmchef":"ice cream chef","icecrmchf":"ice cream chef",
    "pnutsct":"peanut scout","pnutscout":"peanut scout",
    "pnutbndt":"peanut bandit","pnutbandit":"peanut bandit",
    "cocoawarr":"cocoa warrior","cocoawarrir":"cocoa warrior",
    "chocbar":"chocolate bar battallion","chocbarbatt":"chocolate bar battallion",
    "swtsct":"sweet scout","sweetscot":"sweet scout",
    "cookieckr":"cookie cracker","cookcracker":"cookie cracker",
    "cakegrd":"cake guard","ckgrd":"cake guard",
    "bakstf":"baking staff","bakingst":"baking staff",
    "hdbakr":"head baker","headbakr":"head baker",
    "cocoaiprt":"cocoa pirate","ccoaiprt":"cocoa pirate",
    "drgwzrd":"dragon wizard","dragonwzrd":"dragon wizard","drgwiz":"dragon wizard",
    "drghuntr":"dragon hunter","drgonhuntr":"dragon hunter",
    "skelappr":"skeleton apprentice","skleappr":"skeleton apprentice",
    "skelsct":"skeletal scouter","sktlsctr":"skeletal scouter",
    "demncsoulrpr":"demonic soul reaper","demsoulrpr":"demonic soul reaper",
    "cryptmstr":"crypt master","cryptmastr":"crypt master",
    "lvngsk":"living skeleton","livingskel":"living skeleton",
    "ctzn":"citizen","citiz":"citizen",
    "seacpt":"sea captain","seacapt":"sea captain",
    "blksmith":"blacksmith","blcksmith":"blacksmith",
    "mystman":"mysterious man","mysteriousmn":"mysterious man",
    "crewcpt":"crew captain","crwcpt":"crew captain",
    "trevr":"trevor","trvor":"trevor",
    "mngr":"manager","mgr":"manager",
    "bntexp":"bounty expert","bountyexp":"bounty expert","btyexp":"bounty expert",
    "honexp":"honor expert","honorexp":"honor expert","hnrexp":"honor expert",
    "awakexp":"awakenings expert","awknexp":"awakenings expert",
    "custmr":"customer","cstmr":"customer",
    "exprcpt":"experienced captain","expcpt":"experienced captain",
    "ripindra":"rip indra","ripindr":"rip indra",
    "titlespec":"titles specialist","titlspec":"titles specialist",
    "auraed":"aura editor","auraedit":"aura editor",
    "mrcpt":"mr. captain","mrcapt":"mr. captain",
    "mildet":"military detective","mildetr":"military detective",
    "mystent":"mysterious entity","mysteriousent":"mysterious entity",
    "anglr":"angler",
    "lcn":"lucien","luci":"lucien","lucein":"lucien",
    "trinktexp":"trinket expert","trnktexp":"trinket expert",
    "trinktref":"trinket refiner","trnktref":"trinket refiner",
    "valdel":"valentines delivery","valentdel":"valentines delivery",
    "bfdealer":"blox fruit dealer","blxfruitdlr":"blox fruit dealer","bfdlr":"blox fruit dealer",
    "bfgacha":"blox fruit gacha","blxfruitgch":"blox fruit gacha","bfgch":"blox fruit gacha",
    "santaclaw":"santa claws","sntaclaws":"santa claws",
    "sealdking":"sealed king","sealedkng":"sealed king",
    "shrkhuntr":"shark hunter","sharkhuntr":"shark hunter",
    "shmkmastr":"sharkman master","sharkmanmstr":"sharkman master",
    "shmktchr":"sharkman teacher","sharkmanteach":"sharkman teacher",
    "shipwrttchr":"shipwright teacher","shpwrtteach":"shipwright teacher",
    "sckman":"sick man","sickmn":"sick man",
    "subwrkr":"submarine worker","subworker":"submarine worker",
    "sweetcrft":"sweet crafter","swetcrafter":"sweet crafter",
    "bsthuntr":"beast hunter","beasthuntr":"beast hunter",
    "ancntone":"ancient one","ancentone":"ancient one",
    "dojotrnr":"dojo trainer","dojotrain":"dojo trainer",
    "drgtalnsage":"dragon talon sage","drgtalonsge":"dragon talon sage",
    "prevhero":"previous hero","prevhro":"previous hero",
    "hungrymn":"hungry man","hungman":"hungry man","hngrmn":"hungry man",
    "bartst":"barista","bartsta":"barista","barist":"barista",
    "dthking":"death king","deathkng":"death king","dthkng":"death king",
    "wrdmachine":"weird machine","wrdmchn":"weird machine",
    "sckscntst":"sick scientist","sicksci":"sick scientist",
    "cakescntst":"cake scientist","cakesci":"cake scientist",
    "dripmama":"drip_mama","drpmama":"drip_mama",
    "lnoven":"lunoven","lunovn":"lunoven",
    "plkstr":"plokster","plokstre":"plokster",
    "butlr":"butler","butlar":"butler",
    "mystsci":"mysterious scientist","mystscient":"mysterious scientist",
    "tacomur":"tacomura","tcomura":"tacomura",
    "phoeyu":"phoeyu the reformed","phoeyurform":"phoeyu the reformed",
    "wkfteach":"water kung fu teacher","waterkfteach":"water kung fu teacher",
    "drkstpteach":"dark step teacher","darkstepteach":"dark step teacher",
    "madsci":"mad scientist","madscient":"mad scientist",
    "marartmastr":"martial arts master","martartsmastr":"martial arts master",
    "elthuntr":"elite hunter","elitehuntr":"elite hunter",
    "plyhuntr":"player hunter","playerhuntr":"player hunter",
    "rmvbf":"remove blox fruit","removebf":"remove blox fruit","rmbf":"remove blox fruit",
    "hssn":"hassan","hasssn":"hassan",
    "brrs":"boris","borris":"boris",
    "yshi":"yoshi","yoshii":"yoshi","yosh":"yoshi",
};

// ══════════════════════════════════════════════════════════
//  ENCHANTS
// ══════════════════════════════════════════════════════════
const ENCHANTS = [
    "sharpness","hardening","precision","vampiric","elemental","haste",
    "critical","curse","masterpiece","rage","sharpshooter","strong grip",
    "unreal","sea blessing","sea/blessing","agile","deadly","piercing",
    "siphon","lucky","fortune","beast","cool","efficient",
];
const ENCHANT_ALIASES = {
    "sharp":"sharpness","shrpns":"sharpness","sharps":"sharpness",
    "sharpes":"sharpness","sharpnes":"sharpness","shrpness":"sharpness",
    "harden":"hardening","hrdning":"hardening","hardner":"hardening",
    "hardn":"hardening","hardning":"hardening",
    "prec":"precision","precis":"precision","precisn":"precision",
    "precison":"precision","precsion":"precision",
    "vamp":"vampiric","vampric":"vampiric","vampirc":"vampiric","vamperic":"vampiric",
    "elem":"elemental","elemnt":"elemental","elemntl":"elemental",
    "elemtal":"elemental","elemntal":"elemental",
    "hst":"haste","haist":"haste","hsted":"haste",
    "crit":"critical","critcal":"critical","crse":"curse",
    "criticl":"critical","critcl":"critical","crtiical":"critical",
    "curs":"curse","cursse":"curse",
    "masterp":"masterpiece","mstrpc":"masterpiece","mastpc":"masterpiece",
    "masterpc":"masterpiece","mstpc":"masterpiece","mstrpiece":"masterpiece",
    "rge":"rage","raeg":"rage","rag":"rage",
    "sharpshtr":"sharpshooter","sharpshoot":"sharpshooter",
    "sshooter":"sharpshooter","sshotr":"sharpshooter","sharpshtr":"sharpshooter",
    "stronggrp":"strong grip","strgrip":"strong grip","strgr":"strong grip",
    "strgrp":"strong grip","strggrip":"strong grip","stronggrip":"strong grip",
    "unrl":"unreal","unreall":"unreal","unreel":"unreal",
    "seabl":"sea blessing","seabless":"sea blessing","sbless":"sea blessing",
    "seabless":"sea blessing","seablessing":"sea blessing",
    "agl":"agile","agil":"agile","agill":"agile","agille":"agile",
    "ddly":"deadly","dead":"deadly","deadlly":"deadly","deady":"deadly",
    "pierc":"piercing","pirc":"piercing","piercng":"piercing","peircing":"piercing",
    "siph":"siphon","siphn":"siphon","siphoon":"siphon","siphonn":"siphon",
    "lky":"lucky","lck":"lucky","luky":"lucky","luckyy":"lucky",
    "fort":"fortune","frtne":"fortune","fortne":"fortune","forutne":"fortune",
    "bst":"beast","beasst":"beast","beastt":"beast",
    "cl":"cool","coool":"cool","cooll":"cool",
    "eff":"efficient","effic":"efficient","eficent":"efficient","effcnt":"efficient",
    "efficint":"efficient",
};

// ══════════════════════════════════════════════════════════
//  HAKI COLORS
// ══════════════════════════════════════════════════════════
const HAKI_COLORS = [
    "soda orange","yellow sunshine","slimy green","lizard green",
    "blue jeans","plump purple","fiery rose","heat wave",
    "absolute zero","snow white","pure red","winter sky","rainbow savior",
];
const HAKI_ALIASES = {
    "soda":"soda orange","orange":"soda orange",
    "sodaorng":"soda orange","sodaor":"soda orange",
    "sunshine":"yellow sunshine","yellsun":"yellow sunshine","yelsun":"yellow sunshine",
    "yellsunshine":"yellow sunshine","ylwsun":"yellow sunshine",
    "slimygrn":"slimy green","lizgrn":"lizard green","lizardgrn":"lizard green",
    "slmygrn":"slimy green","slimyg":"slimy green","slmgrn":"slimy green",
    "lzrdgrn":"lizard green","lizgrn":"lizard green","lgrn":"lizard green",
    "bluejns":"blue jeans","jeans":"blue jeans","bljns":"blue jeans",
    "bljeans":"blue jeans","jeansblu":"blue jeans",
    "purple":"plump purple","plmppurp":"plump purple","plmpprpl":"plump purple",
    "purplplmp":"plump purple",
    "fiery":"fiery rose","frose":"fiery rose","fieryrse":"fiery rose",
    "fyrose":"fiery rose","frieyrose":"fiery rose",
    "heatwv":"heat wave","htwv":"heat wave","heawave":"heat wave","htwve":"heat wave",
    "absz":"absolute zero","abszero":"absolute zero","absltzro":"absolute zero",
    "abszro":"absolute zero",
    "snowwht":"snow white","snwwht":"snow white","snowwt":"snow white","snwhite":"snow white",
    "purered":"pure red","prred":"pure red","purrd":"pure red",
    "wntsky":"winter sky","wntrsky":"winter sky","wntsky":"winter sky","wtrsky":"winter sky",
    "rainbow":"rainbow savior","rnbw":"rainbow savior","rnbwsav":"rainbow savior",
    "rnbwsavior":"rainbow savior","rainbwsav":"rainbow savior",
};

// ══════════════════════════════════════════════════════════
//  FIGHTING STYLES
// ══════════════════════════════════════════════════════════
const FIGHTING_STYLES = [
    "combat","dark step","electric","water kung fu","dragon breath",
    "superhuman","sharkman karate","electric claw","dragon talon","sanguine art",
];
const FIGHTING_STYLE_ALIASES = {
    "cbt":"combat","cmbt":"combat","combatt":"combat","cmbat":"combat",
    "dstep":"dark step","drkstep":"dark step","darkstep":"dark step",
    "drkstp":"dark step","drkstpp":"dark step",
    "elec":"electric","elct":"electric","electrc":"electric","elctrc":"electric",
    "wkf":"water kung fu","waterkf":"water kung fu","wkungfu":"water kung fu",
    "waterkfu":"water kung fu","wtrfu":"water kung fu","waterkungfu":"water kung fu",
    "drgnbrth":"dragon breath","drgbrth":"dragon breath","dragonbr":"dragon breath",
    "dragonbrth":"dragon breath","drgonbrth":"dragon breath",
    "sh":"superhuman","suphuman":"superhuman","shuman":"superhuman",
    "superhumaan":"superhuman","superhumn":"superhuman","suprhuman":"superhuman",
    "smk":"sharkman karate","sharkk":"sharkman karate","sharkmk":"sharkman karate",
    "sharkmankat":"sharkman karate","shmkarate":"sharkman karate",
    "ec":"electric claw","elecclaw":"electric claw","eclaw":"electric claw",
    "electclaw":"electric claw","elctclaw":"electric claw","eclaaw":"electric claw",
    "dt":"dragon talon","drgntaln":"dragon talon","drgtalon":"dragon talon",
    "dragontalon":"dragon talon","drgntalon":"dragon talon",
    "sa":"sanguine art","sangart":"sanguine art","sanguin":"sanguine art",
    "sanguineart":"sanguine art","sangrt":"sanguine art","sngrt":"sanguine art",
};

// ══════════════════════════════════════════════════════════
//  GUNS
// ══════════════════════════════════════════════════════════
const GUNS = [
    "slingshot","flintlock","musket","refined slingshot","refined flintlock",
    "refined musket","dual flintlock","cannon","acidum rifle","bazooka",
    "kabucha","serpent bow","bizarre rifle","soul guitar",
];
const GUN_ALIASES = {
    "slng":"slingshot","slngshot":"slingshot","slingsht":"slingshot",
    "slingh":"slingshot","slngshoot":"slingshot",
    "flnt":"flintlock","flntlck":"flintlock","flntlock":"flintlock","flintlck":"flintlock",
    "musk":"musket","musktt":"musket","muskett":"musket","muskt":"musket","msktt":"musket",
    "rsling":"refined slingshot","rslng":"refined slingshot","rfslng":"refined slingshot",
    "refslng":"refined slingshot","rslngshot":"refined slingshot","rfndslng":"refined slingshot",
    "rflint":"refined flintlock","rfflnt":"refined flintlock","refflnt":"refined flintlock",
    "rflntlock":"refined flintlock","rfndflnt":"refined flintlock",
    "rmusk":"refined musket","rfmusk":"refined musket","refmusk":"refined musket",
    "rmusktt":"refined musket","rfndmusk":"refined musket",
    "dflint":"dual flintlock","dualflnt":"dual flintlock","dflintlock":"dual flintlock",
    "dlfltlk":"dual flintlock",
    "can":"cannon","cann":"cannon","cnnon":"cannon","cannoon":"cannon","canooon":"cannon",
    "acidum":"acidum rifle","acidrfl":"acidum rifle","acid":"acidum rifle",
    "acdrfl":"acidum rifle","acidumrfl":"acidum rifle",
    "baz":"bazooka","bzk":"bazooka","bzoka":"bazooka","bazoook":"bazooka",
    "kab":"kabucha","kabuch":"kabucha","kabcha":"kabucha","kubcha":"kabucha","kabch":"kabucha",
    "serpbow":"serpent bow","sbow":"serpent bow","serp":"serpent bow",
    "serbow":"serpent bow","snakebow":"serpent bow",
    "bizrfl":"bizarre rifle","bizsrfl":"bizarre rifle","bizzrfl":"bizarre rifle",
    "bzrrfl":"bizarre rifle","bizrfle":"bizarre rifle","bizrifle":"bizarre rifle",
    "soulg":"soul guitar","soulgtr":"soul guitar","sgtr":"soul guitar",
    "soulgt":"soul guitar","slgtr":"soul guitar","soulguitar":"soul guitar",
};

// ══════════════════════════════════════════════════════════
//  ACCESSORIES
// ══════════════════════════════════════════════════════════
const ACCESSORIES = [
    "black cape","pink coat","marine cap","swordsman hat","tomoe ring",
    "top hat","usoap's hat","usoaps hat","vice admiral coat","cool shades",
    "black spikey coat","blue spikey coat","red spikey coat","choppa",
    "warrior helmet","dark coat","ghoul mask","swan glasses","zebra cap",
    "heart shades","valkyrie helm","bandanna","hunter cape","bear ears",
    "golden sunhat","holy crown","lei","musketeer hat","pale scarf",
    "pilot helmet","pretty helmet","jaw shield","cupid's coat","cupid's top hat",
    "party hat","50b party hat","holiday cloak","santa hat","elf hat",
    "peppermint helmet","kitsune mask","kitsune ribbon","leviathan crown",
    "leviathan shield","terror jaw","monster jaw","sanguine cloak",
    "dino hood","t-rex skull","coven witch hat","pumpkin mask",
    "divine cloak","celestial helmet","oni helmet","uzoth's cloak",
    "dojo belt","headband",
];
const ACCESSORY_ALIASES = {
    "bcape":"black cape","blkcape":"black cape","blkcp":"black cape",
    "pcoat":"pink coat","pnkcoat":"pink coat","pinkct":"pink coat",
    "mcap":"marine cap","mrncp":"marine cap","marncap":"marine cap",
    "swhat":"swordsman hat","swordhat":"swordsman hat","swrdhat":"swordsman hat",
    "swordsmnhat":"swordsman hat",
    "tring":"tomoe ring","tomoe":"tomoe ring","tomoering":"tomoe ring","tmrng":"tomoe ring",
    "tophat":"top hat","tphat":"top hat","topht":"top hat",
    "uhat":"usoap's hat","usoaphat":"usoap's hat","ushat":"usoap's hat",
    "vacoat":"vice admiral coat","vicadmct":"vice admiral coat",
    "cshades":"cool shades","coolshds":"cool shades","clshades":"cool shades","cshds":"cool shades",
    "bscoat":"black spikey coat","blkspkcoat":"black spikey coat",
    "blspcoat":"blue spikey coat","bluspkcoat":"blue spikey coat",
    "rspcoat":"red spikey coat","redspkcoat":"red spikey coat",
    "chop":"choppa","chpa":"choppa","choppper":"choppa",
    "whelm":"warrior helmet","whlmt":"warrior helmet","warhelm":"warrior helmet",
    "warriorhlmt":"warrior helmet",
    "dcoat":"dark coat","drkcoat":"dark coat","drkct":"dark coat",
    "gmask":"ghoul mask","ghoulmsk":"ghoul mask","ghoulms":"ghoul mask","gmsk":"ghoul mask",
    "sglass":"swan glasses","swangls":"swan glasses","sgls":"swan glasses","swanglass":"swan glasses",
    "zcap":"zebra cap","zebrcp":"zebra cap","zbrcap":"zebra cap","zebracp":"zebra cap",
    "hshades":"heart shades","heartshds":"heart shades","hrtshades":"heart shades","hshds":"heart shades",
    "valkhelm":"valkyrie helm","valky":"valkyrie helm","valkyyrhlm":"valkyrie helm",
    "vlkhelm":"valkyrie helm","vlkyrhelm":"valkyrie helm","valkyrhlm":"valkyrie helm",
    "band":"bandanna","bandana":"bandanna","bandna":"bandanna","bndna":"bandanna",
    "hcape":"hunter cape","huntercpe":"hunter cape","hntrcape":"hunter cape","hcpe":"hunter cape",
    "bearear":"bear ears","berar":"bear ears","berears":"bear ears","bears":"bear ears",
    "ghat":"golden sunhat","goldensun":"golden sunhat","gldsunhat":"golden sunhat","gldhat":"golden sunhat",
    "hcrown":"holy crown","holycrown":"holy crown","hlycrown":"holy crown",
    "mhat":"musketeer hat","muskhat":"musketeer hat","mskhat":"musketeer hat","mkthat":"musketeer hat",
    "pscarf":"pale scarf","palescrf":"pale scarf","plscarf":"pale scarf","pscrf":"pale scarf",
    "pilothat":"pilot helmet","plthlmt":"pilot helmet","plhelm":"pilot helmet","pilothlmt":"pilot helmet",
    "prettyh":"pretty helmet","prttyhelm":"pretty helmet","prhelm":"pretty helmet","prettyhlmt":"pretty helmet",
    "jshield":"jaw shield","jawshld":"jaw shield","jwshield":"jaw shield","jshld":"jaw shield",
    "ccoat":"cupid's coat","cupidct":"cupid's coat","cpdcoat":"cupid's coat","cpdct":"cupid's coat",
    "ctohat":"cupid's top hat","cupidtophat":"cupid's top hat",
    "phat":"party hat","partyht":"party hat","prtyhat":"party hat","ptyhat":"party hat",
    "50bhat":"50b party hat","50bpartyhat":"50b party hat","50bprtyhat":"50b party hat",
    "hcloak":"holiday cloak","holidayclk":"holiday cloak","hldycloak":"holiday cloak","hclk":"holiday cloak",
    "shat":"santa hat","santaht":"santa hat","snhat":"santa hat","sntathat":"santa hat",
    "ehat":"elf hat","elfht":"elf hat","elht":"elf hat",
    "pephelm":"peppermint helmet","ppmnthelm":"peppermint helmet","pepmenthlmt":"peppermint helmet",
    "kmask":"kitsune mask","kitsunemsk":"kitsune mask","kitsmask":"kitsune mask","ktsumask":"kitsune mask",
    "krib":"kitsune ribbon","kitsunerbbn":"kitsune ribbon","ktsrbn":"kitsune ribbon",
    "lcrown":"leviathan crown","levicrwn":"leviathan crown","lvcrwn":"leviathan crown","levicrown":"leviathan crown",
    "lshield":"leviathan shield","levishld":"leviathan shield","lvshield":"leviathan shield",
    "tjaw":"terror jaw","terrjaw":"terror jaw","terrjw":"terror jaw","tjw":"terror jaw",
    "mjaw":"monster jaw","monstjaw":"monster jaw","mnstjaw":"monster jaw","mjw":"monster jaw",
    "scloak":"sanguine cloak","sangclk":"sanguine cloak","sngcloak":"sanguine cloak","sclk":"sanguine cloak",
    "dhood":"dino hood","dinohood":"dino hood","dnhood":"dino hood",
    "tskull":"t-rex skull","trexskull":"t-rex skull","trxskull":"t-rex skull",
    "cwhat":"coven witch hat","covenhat":"coven witch hat","covenwitchht":"coven witch hat",
    "pmask":"pumpkin mask","pmpknmsk":"pumpkin mask","pmpkn":"pumpkin mask",
    "dcloak":"divine cloak","divineclk":"divine cloak","dvncloak":"divine cloak","dvnclk":"divine cloak",
    "chelm":"celestial helmet","celesthlmt":"celestial helmet","celecthelm":"celestial helmet","chlmt":"celestial helmet",
    "ohelm":"oni helmet","onihlmt":"oni helmet","onihelm":"oni helmet","onhlmt":"oni helmet",
    "ucloak":"uzoth's cloak","uzothclk":"uzoth's cloak","uzthcloak":"uzoth's cloak","uzclk":"uzoth's cloak",
    "djbelt":"dojo belt","dojbelt":"dojo belt","djblt":"dojo belt","dojobt":"dojo belt",
    "hband":"headband","headbnd":"headband","hdbnd":"headband","headb":"headband",
};

// ══════════════════════════════════════════════════════════
//  QUESTS
// ══════════════════════════════════════════════════════════
const QUESTS = [
    "saber expert","alchemist quest","arowe quest","bartilo's mission",
    "citizen's quest","hungry man quest","shipwright quest",
    "trial of water","trial of speed","trial of the king","trial of carnage",
    "alchemist","arowe","bartilo","shipwright",

    // ── CDK (Cursed Dual Katana) quest chain ──────────────────────────────
    "pain and suffering","pain & suffering","haze of misery","fear the reaper",
    "sense of duty","the hunter","soulless",
    "cdk quest","cursed dual katana quest","cdk chain","tushita quest","yama quest",
    "tushita and yama","get tushita","get yama","unlock cdk",

    // ── TTK (True Triple Katana) quest chain ─────────────────────────────
    "legendary sword dealer","sword dealer spawn","sword dealer location",
    "wando purchase","wando 2m","wando beli",
    "shisui purchase","shisui 2m","shisui beli",
    "saddi purchase","saddi 2m","saddi beli",
    "mastery 300","mastery grinding","mastery grind","mastery farm",
    "mysterious man","mysterious man fusion","ttk fusion","ttk quest",
    "true triple katana quest","ttk chain","buy wando","buy shisui","buy saddi",
    "beli purchase","2m beli",
];
const QUEST_ALIASES = {
    "sexp":"saber expert","sabexp":"saber expert","sbrexp":"saber expert","saberxprt":"saber expert",
    "alch":"alchemist quest","alchqst":"alchemist quest","alchquest":"alchemist quest",
    "arow":"arowe quest","aroweqst":"arowe quest","arwqst":"arowe quest","arowquest":"arowe quest",
    "bart":"bartilo's mission","bartmiss":"bartilo's mission","bartmission":"bartilo's mission",
    "bartilomis":"bartilo's mission",
    "citz":"citizen's quest","citizqst":"citizen's quest","citzquest":"citizen's quest",
    "hungman":"hungry man quest","hungrymanqst":"hungry man quest","hungmanq":"hungry man quest",
    "hungrymn":"hungry man quest",
    "shipwrt":"shipwright quest","shipwrtqst":"shipwright quest","shipwquest":"shipwright quest",
    "shipwrtquest":"shipwright quest",
    "twater":"trial of water","trialwtr":"trial of water","trialwt":"trial of water",
    "twaterqst":"trial of water","twtr":"trial of water",
    "tspeed":"trial of speed","trialspd":"trial of speed","trialsped":"trial of speed",
    "tspdqst":"trial of speed","tspd":"trial of speed",
    "tking":"trial of the king","trialkng":"trial of the king","trialking":"trial of the king",
    "tkngqst":"trial of the king","tkng":"trial of the king",
    "tcarn":"trial of carnage","trialcarn":"trial of carnage","trialcarnage":"trial of carnage",
    "tcarnqst":"trial of carnage","tcarnage":"trial of carnage",

    // CDK quest aliases
    "p&s":"pain and suffering","pas":"pain and suffering","painandsuffering":"pain and suffering",
    "pains":"pain and suffering","pain&suffering":"pain and suffering",
    "hom":"haze of misery","hazeofmisery":"haze of misery","hazem":"haze of misery",
    "ftr":"fear the reaper","fearreaper":"fear the reaper","fearthereaper":"fear the reaper",
    "sod":"sense of duty","senseofduty":"sense of duty","snseofduty":"sense of duty",
    "thehunter":"the hunter","huntquest":"the hunter",
    "cdkquest":"cdk quest","cdkchain":"cdk chain","cdkqst":"cdk quest",
    "tushquest":"tushita quest","yamaquest":"yama quest",
    "unlkcdk":"unlock cdk","unlockcdk":"unlock cdk",

    // TTK quest aliases
    "ttksworddealer":"legendary sword dealer","sworddealer":"legendary sword dealer",
    "legendarydealer":"legendary sword dealer","legdealer":"legendary sword dealer",
    "wandopurchase":"wando purchase","wando2m":"wando 2m","wandobeli":"wando beli",
    "shisuipurchase":"shisui purchase","shisui2m":"shisui 2m","shisuibeli":"shisui beli",
    "saddipurchase":"saddi purchase","saddi2m":"saddi 2m","saddibeli":"saddi beli",
    "mst300":"mastery 300","mas300":"mastery 300","mast300":"mastery 300",
    "mastgrind":"mastery grinding","mastgrinding":"mastery grinding","mastfarm":"mastery farm",
    "mysteryman":"mysterious man","mystman":"mysterious man","mystrman":"mysterious man",
    "mystmanfusion":"mysterious man fusion","ttkfusion":"ttk fusion","ttkquest":"ttk quest",
    "ttkchain":"ttk chain","buywando":"buy wando","buyshisui":"buy shisui","buysaddi":"buy saddi",
    "belipurchase":"beli purchase","2mbeli":"2m beli",
};

// ══════════════════════════════════════════════════════════
//  SEA EVENTS
// ══════════════════════════════════════════════════════════
const SEA_EVENTS = [
    // ── Core sea events ───────────────────────────────────────────────────
    "sea beast","seabeast","ship raid","shipraid",
    "rumbling waters","pirate raid","pirateraid",
    "factory raid","factoryraid","ghost ship","ghostship",
    "terrorshark","terror shark","piranhas","piranha",
    "fishman commando","fishman scout",
    "electric recluse","leviathan",
    "rough sea","roughsea","mirage island","mirageisland","mirage",
    "frozen outpost","frozenoutpost",
    "haunted shipwreck","hauntedshipwreck",
    "prehistoric island","prehistoricisland","kitsune island","kitsuneisland",
    // ── Additional event references ───────────────────────────────────────
    "monster shark","monstershark",
    "leviathan raid","leviathanraid","levi raid","leviraid",
    "sea event","sea events","sea spawn","sea boss","seaboss",
    "sea beast spawn","seabeast spawn",
    "rip indra","ripindra",
    "cursed ship","cursedship",
];
const SEA_EVENT_ALIASES = {
    "sb":"sea beast","seabst":"sea beast","sebeast":"sea beast",
    "sr":"ship raid","shiprd":"ship raid","shipraidd":"ship raid",
    "rw":"rumbling waters","rumblwtr":"rumbling waters","rumbwaters":"rumbling waters",
    "pr":"pirate raid","piratrd":"pirate raid","piraid":"pirate raid",
    "fr":"factory raid","factrd":"factory raid","facraid":"factory raid",
    "gs":"ghost ship","ghstship":"ghost ship","ghostshp":"ghost ship","gstship":"ghost ship",
    "ts":"terrorshark","terrorshk":"terrorshark","terrshark":"terrorshark","tshk":"terrorshark",
    "tshark":"terrorshark","piranas":"piranhas","piranna":"piranhas","pirhanas":"piranhas",
    "fc":"fishman commando","fishmancomd":"fishman commando","fshmncomd":"fishman commando",
    "fs":"fishman scout","fishmanscout":"fishman scout","fishmnsct":"fishman scout",
    "er":"electric recluse","electrcls":"electric recluse","elctrcls":"electric recluse",
    "levi":"leviathan","levthan":"leviathan","levitan":"leviathan",
    "rs":"rough sea","roughseas":"rough sea","roughsea":"rough sea",
    "mi":"mirage island","mirageisl":"mirage island","mrisland":"mirage island",
    "mirg":"mirage","mirag":"mirage",
    "fo":"frozen outpost","frozoutpost":"frozen outpost","frznoutpost":"frozen outpost",
    "hw":"haunted shipwreck","hauntshipwreck":"haunted shipwreck","hauntedship":"haunted shipwreck",
    "hauntshp":"haunted shipwreck",
    "ph":"prehistoric island","prehistoricisl":"prehistoric island","prhistoricisland":"prehistoric island",
    "preh":"prehistoric island","prehi":"prehistoric island","prehisland":"prehistoric island",
    "ki":"kitsune island","kitsuneisle":"kitsune island","kitsunisl":"kitsune island",
    "kitsuneisl":"kitsune island","kitisland":"kitsune island",
};

// ══════════════════════════════════════════════════════════
//  RACES
// ══════════════════════════════════════════════════════════
const RACES = ["human","mink","shark","ghoul","angel","cyborg","draco"];
const RACE_ALIASES = {
    "hmn":"human","humam":"human","humna":"human","humman":"human",
    "mnk":"mink","mik":"mink","mnkk":"mink",
    "shrk":"shark","shrak":"shark","shk":"shark","shrark":"shark",
    "ghl":"ghoul","ghul":"ghoul","goul":"ghoul","ghol":"ghoul","ghul":"ghoul",
    "angl":"angel","agnel":"angel","angell":"angel","angell":"angel",
    "cybrg":"cyborg","cybrog":"cyborg","cyb":"cyborg","cybrrg":"cyborg",
    "drco":"draco","drac":"draco","drako":"draco","dracco":"draco",
};
const RACE_TIER_KEYWORDS = ["v2","v3","v4","trials","trial","trils","tials","trilas"];

// ══════════════════════════════════════════════════════════
//  INTENT KEYWORDS
// ══════════════════════════════════════════════════════════
const INTENT_EXACT = [
    "lf","wtt","wtb","wts","w2t","lf4","lfor","lfr","lf4r",
    "trade","trading","swap","swapping","buying","selling",
    "offer","offers","tradng","tradig","swapin","swaping","xchnge","xchange","exchng",
];
const INTENT_PHRASE = [
    "looking for","l00king for","lookingfor","searching for","in exchange for",
    "wanna trade","want to trade","wantotrade","want trade","want2trade",
    "anyone trading","does anyone have","does any1 have","exchang",
];

const INTENT_PHRASE_EXTRA = [
    "lf",
    "lf for",
    "lf: ",
    "lf ",
    "looking for:",
    "looking for ",
    "searching for ",
    "need: ",
    "my offer ",
    "my offers ",
    "i'll give ",
    "i will give ",
    "i can give ",
    "i want ",
    "i need ",
    "i'm looking for ",
    "im looking for ",
    "im lf ",
    "im l f ",
    "wtt ",
    "wtb ",
    "wts ",
    "w2t ",
    "trading ",
    "trade ",
    "swap ",
    "swapping ",
    "for trade ",
    "for trading ",
    "for offers ",
    "for offer ",
    "in exchange ",
    "in exchange for ",
    "in return for ",
    "in return for my ",
    "i trade ",
    "i can trade ",
    "can trade ",
    "trade for ",
    "swap for ",
    "offer for ",
    "my fruit for ",
    "my fruits for ",
    "my item for ",
    "my items for ",
    "my sword for ",
    "my swords for ",
    "my perm for ",
    "my perms for ",
    "perm for ",
    "perms for ",
    "gamepass for ",
    "gp for ",
    "2x mastery for ",
    "2x money for ",
    "fast boats for ",
    "dark blade for ",
    "fruit notifier for ",
    "i can offer my ",
    "i have ",
    "i got for trade ",
    "i have for trade ",
    "does anyone have ",
    "does any1 have ",
    "selling ",
    "buying ",
    "trade my ",
    "trading my ",
    "swap my ",
    "swapping my ",
    "offer my ",
    "offering my ",
    "i'll trade ",
    "i will trade ",
    "i'll swap ",
    "i will swap ",
    "i'll offer ",
    "i will offer ",
    "wtt my ",
    "wtb your ",
    "wts my ",
    "trade? ",
    "trade pls ",
    "trade plz ",
    "trade please ",
    "any trades ",
    "any trade ",
    "anyone trade ",
    "anyone trading ",
    "anyone want trade ",
    "anyone wanna trade ",
    "who trades ",
    "who trade ",
    "who trading ",
    "who want trade ",
    "who wanna trade ",
    "trade me ",
    "dm me offers ",
    "dm offers ",
    "dm for offers ",
    "offers in dms ",
    "offer in dms ",
    "msg offers ",
    "message offers ",
    "pm offers ",
    "lf offers ",
    "taking offers ",
    "accepting offers ",
    "any offers ",
    "good offers ",
    "best offer ",
    "highest offer ",
    "no clown offers ",
    "no low offers ",
    "no trash offers ",
    "no bad offers ",
    "only good offers ",
    "only serious offers ",
    "serious offers ",
    "serious trade ",
    "serious trades ",
    "trade only ",
    "trades only ",
    "trade channel ",
    "trade chat ",
    "trade post ",
    "trading post ",
    "offer post ",
    "lf fruits ",
    "lf fruit ",
    "lf perm ",
    "lf perms ",
    "lf gamepass ",
    "lf gp ",
    "lf yoru ",
    "lf dark blade ",
    "lf notifier ",
    "lf fruit notifier ",
    "lf kitsune ",
    "lf dragon ",
    "lf leopard ",
    "lf dough ",
    "lf control ",
    "lf portal ",
    "lf rumble ",
    "lf buddha ",
    "lf blizzard ",
    "lf mammoth ",
    "lf trex ",
    "lf t-rex ",
    "lf spirit ",
    "lf venom ",
    "lf shadow ",
    "lf gravity ",
    "lf pain ",
    "lf lightning ",
    "lf phoenix ",
    "lf sound ",
    "lf spider ",
    "lf love ",
    "lf magma ",
    "lf quake ",
    "lf ice ",
    "lf light ",
    "lf dark ",
    "lf flame ",
    "lf sand ",
    "lf rubber ",
    "lf ghost ",
    "lf kitsune perm ",
    "lf dragon perm ",
    "lf leopard perm ",
    "lf dough perm ",
    "lf portal perm ",
    "lf buddha perm ",
    "lf rumble perm ",
    "lf 2x mastery ",
    "lf 2x money ",
    "lf fast boats ",
    "lf dark blade ",
    "lf yoru ",
    "lf fruit notifier ",
    "i have ",
    "i have: ",
    "i got: ",
    "have: ",
    "got: ",
    "have for trade ",
    "got for trade ",
    "trading: ",
    "offering: ",
    "selling: ",
    "buying: ",
    "wtt: ",
    "wtb: ",
    "wts: ",
    "lf: ",
    "offer: ",
    "offers: ",
    "want: ",
    "need: ",
];
// SERVICE_INTENT_EXACT — only words that unambiguously mean "service" on their own.
// Generic trading/intent words (lf, need, run, farm, help, join, etc.) are NOT service
// indicators by themselves — they're already covered by compound phrases in
// SERVICE_INTENT_PHRASE (e.g. "lf service", "lf carry", "need carry").
// Adding them here caused massive false-positives (e.g. any "lf" message flagging).
const SERVICE_INTENT_EXACT = [
    "service","services","svc","svcs","carry","carries","carried",
    "boost","boosting","hiring",
];
const SERVICE_INTENT_PHRASE = [
    // Only keep phrases that are unambiguously service solicitations
    "need a carry","need carry","lf carry","lf service","lf raid",
    "anyone carry","anyone doing raids","anyone hosting",
    "services for","service for","carry for","boost for",
    "raid for","hiring for","pay for service","paying for carry",
    "lf boss carry","lf raid carry","need boss carry","need raid carry",
    "which enchant","best enchant","what enchant","enchant for",
    "which sword","best sword","sword for",
    "which gun","best gun","gun for",
    "which style","best style","style for",
    "haki color","change haki","best haki",
];

const SERVICE_INTENT_PHRASE_EXTRA = [
    "help with v4 trials",
    "help with v3 trials",
    "help with v2 trials",
    "help with trials",
    "help with trial",
    "Hosting raids fast, join now!",

"Full raid carry, you just chill!",

"Cheap raid services, fast and safe!",

"Need fragments? I got you covered!",

"Auto raid hosting, fast clears!",

"Join for quick and easy raid wins!",

"Carrying all raids, no effort needed!",

"Fast raids, high success rate!",

"Grinding fragments? Join my raids!",

"Raid services open, limited slots!",

"Solo carry raids, guaranteed win!",

"Professional raid service, trusted!",

"Quick flame raids, join up!",

"Hosting Buddha raids, easy wins!",

"Fully AFK raid carry available!",

"Max level helping with raids!",

"Cheap and fast raid hosting!",

"Need awakening? I got raids!",

"Instant raid start, no waiting!",

"Carrying dough raids, join fast!",

"Join for smooth raid clears!",

"Fastest raid service in server!",

"Helping newbies with raids!",

"Raid farm going on, hop in!",

"Carrying light raids, easy frags!",

"Raid grinding nonstop!",

"Full team raids, join quickly!",

"Legendary raid service open!",

"Easy fragments farm here!",

"Raid boss melts instantly!",

"Hosting raids all day!",

"Top tier raid carrier here!",

"Quick raids, fast rewards!",

"Safe and reliable raid service!",

"Join my raid squad now!",

"Raid help for all players!",

"Fast awakenings guaranteed!",

"Grinding raids nonstop!",

"Join for instant raid clears!",

"Carrying phoenix raids!",

"Easy wins, no stress raids!",

"Raid service active, join now!",

"Helping grind fragments fast!",

"Best raid host in server!",

"Carrying magma raids!",

"Raid grind = fast progress!",

"Need help? Join my raids!",

"Full carry, zero effort!",

"Quick join, raid starting!",

"Raid services open 24/7!",

"Pro raid host, fast clears!",

"Join for guaranteed wins!",

"All raids available here!",

"Raid carry with max stats!",

"Grinding awakenings fast!",

"Carrying ice raids!",

"Fast raids, no fail!",

"Top speed raid hosting!",

"Join now before it's full!",

"Instant raid entry available!",

"Carrying dark raids!",

"Raid farm squad ready!",

"Easy fragment farming!",

"Raid carry for everyone!",

"Nonstop raids, join anytime!",

"High level raid support!",

"Need awakening? Join raids!",

"Fast raid completion guaranteed!",

"Reliable raid host here!",

"Join for easy raid wins!",

"Carrying quake raids!",

"Raid help for beginners!",

"Grinding fragments quickly!",

"Raid hosting, fast entry!",

"Full squad raid carry!",

"Instant wins, join raids!",

"Carrying spider raids!",

"Best raid grinding method!",

"Fastest way to get frags!",

"Join raid team now!",

"Pro level raid service!",

"Raid boss deleted instantly!",

"Carrying sand raids!",

"Join for smooth gameplay!",

"Quick and easy raids!",

"Raid squad forming now!",

"High efficiency raid runs!",

"Carrying rumble raids!",

"Grinding made easy with raids!",

"Join fast before start!",

"Raid services trusted!",

"Fastest clears guaranteed!",

"Carrying love raids!",

"Easy awakenings here!",

"Join my raid lobby!",

"Helping all players grow!",

"Raid farming nonstop!",

"Carrying gravity raids!",

"Best value raid service!",

"Quick clears, big rewards!",

"Raid now, win fast!",

"Carrying blizzard raids!",

"Fast grind, no hassle!",

"Join for pro raid help!",

"Raid carry active!",

"Grinding fragments daily!",

"Carrying portal raids!",

"Instant success raids!",

"Join and get carried!",

"Raid help anytime!",

"Carrying venom raids!",

"Fast progression via raids!",

"Join raid crew now!",

"Top raid performance!",

"Carrying control raids!",

"Easy wins every time!",

"Join for best raid experience!",

"Raid hosting right now!",

"Carrying dragon raids!",

"Fastest way to awaken!",

"Join before it fills!",

"Raid pros ready!",

"Carrying leopard raids!",

"Grinding with pros!",

"Join and dominate raids!",

"Raid farm experts here!",

"Carrying kitsune raids!",

"Fast and smooth runs!",

"Join for instant action!",

"Raid kings hosting now!",

"Carrying all fruit raids!",

"Ultimate raid service!",

"Join and get rich in frags!",

"Raid success guaranteed!",

"Top tier grinding squad!", 
    "help me with v4 trials",
    "help me with v3 trials",
    "help me with v2 trials",
    "help me with trials",
    "need help with v4 trials",
    "need help with v3 trials",
    "need help with v2 trials",
    "need help with trials",
    "can anyone help with v4 trials",
    "can anyone help with v3 trials",
    "can anyone help with v2 trials",
    "can anyone help with trials",
    "who can help with v4 trials",
    "who can help with v3 trials",
    "who can help with v2 trials",
    "who can help with trials",
    "anyone help with v4 trials",
    "anyone help with v3 trials",
    "anyone help with v2 trials",
    "anyone help with trials",
    "looking for 1 for v4 trials",
    "looking for 2 for v4 trials",
    "looking for 3 for v4 trials",
    "looking for 1 for trials",
    "looking for 2 for trials",
    "looking for 3 for trials",
    "looking for one for v4 trials",
    "looking for two for v4 trials",
    "looking for three for v4 trials",
    "looking for one for trials",
    "looking for two for trials",
    "looking for three for trials",
    "need 1 for v4 trials",
    "need 2 for v4 trials",
    "need 3 for v4 trials",
    "need 1 for trials",
    "need 2 for trials",
    "need 3 for trials",
    "need one for v4 trials",
    "need two for v4 trials",
    "need three for v4 trials",
    "need one for trials",
    "need two for trials",
    "need three for trials",
    "lf 1 for v4 trials",
    "lf 2 for v4 trials",
    "lf 3 for v4 trials",
    "lf 1 for trials",
    "lf 2 for trials",
    "lf 3 for trials",
    "lfg v4 trials",
    "lfg trials",
    "need carry v4",
    "need carry v4 trials",
    "need carry trials",
    "carry me v4 trials",
    "carry me trials",
    "need someone for v4 trials",
    "need someone for trials",
    "need ppl for v4 trials",
    "need ppl for trials",
    "assembling team for v4 trials",
    "assembling team for trials",
    "recruiting for v4 trials",
    "recruiting for trials",
    "full moon v4 trials",
    "fm v4 trials",
    "mirage for v4 trials",
    "need mirage for v4",
    "need blue gear",
    "need bluegear",
    "need mirror fractal",
    "need mirror",
    "temple of time v4",
    "temple of time trials",
    "trial room",
    "server hop trials",
    "serverhop trials",
    "ps for v4 trials",
    "private server for v4 trials",
    "vip server for v4 trials",
    "who can host v4 trials",
    "anyone hosting v4 trials",
    "host v4 trials",
    "hosting v4 trials",
    "need host v4 trials",
    "need host for trials",
    "anyone carry trials",
    "anyone carry v4 trials",
    "anyone run trials",
    "anyone run v4 trials",
    "anyone doing trials",
    "anyone doing v4 trials",
    "who doing trials",
    "who doing v4 trials",
    "who running trials",
    "who running v4 trials",
    "help with race trials",
    "need help race trials",
    "race trials help",
    "race trial help",
    "race v4 trials help",
    "help race v4 trials",
    "carry race v4 trials",
    "looking for race v4 trials",
    "need angel v4 trials",
    "need human v4 trials",
    "need mink v4 trials",
    "need shark v4 trials",
    "need ghoul v4 trials",
    "need cyborg v4 trials",
    "need draco v4 trials",
    "need angel trials",
    "need human trials",
    "need mink trials",
    "need shark trials",
    "need ghoul trials",
    "need cyborg trials",
    "need draco trials",
    "need help with raids",
    "need help with raid",
    "need someone to raid",
    "need someone for raid",
    "need someone for raids",
    "looking for raid carry",
    "looking for raid help",
    "need raid carry",
    "need raid help",
    "anyone raid",
    "anyone for raid",
    "anyone for raids",
    "who can raid",
    "who can help raid",
    "who can carry raid",
    "help with raid",
    "help with raids",
    "carry raid",
    "carry raids",
    "raid service",
    "raid services",
    "raid service lf ppl fast",
"lf 3 for raid need carry",
"hosting raids dm me",
"raid carry cheap dm",
"lf ppl for dough raid asap",
"doing raids who wanna join",
"raid service open dm quick",
"need 2 more for raid",
"lf buddha for raid carry",
"hosting flame raid rn",
"raid spam join fast",
"doing 5x raids back to back",
"raid service legit dm",
"lf ppl grind frags",
"need help with raid pls",
"who got raid service",
"buying raid carry",
"selling raid service cheap",
"raid carry for payment",
"lf pro for raid carry",
"raid help needed asap",
"doing raids all night",
"raid service trusted",
"join up raid starting",
"lf team for raids",
"raid grind who in",
"hosting buddha raid",
"doing dough raids dm",
"raid spam fast runs",
"need fragments join raid",
"raid carry guaranteed win",
"lf max lvl for raid",
"doing raids quick clears",
"raid farm join now",
"hosting raid need ppl",
"lf carry for phoenix raid",
"raid service no scam",
"doing raids fast dm",
"join raid free carry",
"raid help for noobs",
"lf ppl raid spam",
"doing 10 raids join",
"raid carry dm offers",
"hosting raid full team",
"lf ppl for fast raids",
"raid service cheap price",
"need raid carry urgent",
"doing raids nonstop join",
"raid grind dm me",
"hosting raid quick join",
"lf help in raid pls",
"raid carry full awaken",
"doing flame raids spam",
"raid service open slots",
"lf raid squad asap",
"join raid easy wins",
"raid carry high lvl",
"doing raids for frags",
"hosting raids need 3",
"lf ppl dough raid",
"raid help dm me",
"doing raid spam fast",
"raid service legit vouches",
"lf carry buddha raid",
"join fast raid starting",
"raid grind all day",
"doing raids back2back",
"raid carry no fail",
"hosting raids rn dm",
"lf ppl for fast clear",
"raid service cheap fast",
"doing raids easy frags",
"raid help quick join",
"lf raid carry pls",
"hosting raids all day dm",
"raid spam who in",
"doing raids join quick",
"raid carry pro only",
"lf ppl raid rn",
"hosting raid need team",
"raid service dm offers",
"doing raids full carry",
"raid grind join up",
"lf ppl for buddha raid",
"raid carry fast runs",
"hosting raid join asap",
"doing raids no stop",
"raid help free carry",
"lf raid team fast",
"raid service trusted dm",
"doing raids quick frags",
"hosting raids dm fast",
"raid carry slots open",
"lf ppl raid farm",
"doing raids join now",
"raid spam fast join",
"hosting raid all fruits",
"raid carry dm quick",
"lf help raid asap",
"doing raids pro carry",
"raid grind fast progress",
"hosting raids who join",
"lf ppl for raid spam",
"raid carry best service",
"doing raids instant clear",
"raid help needed now",
"hosting raid quick runs",
"lf raid carry cheap",
"doing raids easy wins",
"raid service fast response",
"hosting raid dm me now",
"lf ppl for raid grind",
"raid carry high success",
"doing raids join asap",
"raid spam nonstop",
"hosting raid squad full",
"lf raid help quick",
"doing raids pro team",
"raid carry safe legit",
"hosting raid runs fast",
"lf ppl for raid asap",
"raid grind easy mode",
"doing raids all fruits",
"raid carry fast clear",
"hosting raid join fast",
"lf team for raid grind",
"raid service dm now",
"doing raids quick wins",
"raid spam best farm",
"hosting raid open now",
"lf ppl raid quick",
"raid carry guaranteed",
"doing raids fast farm",
"hosting raid dm asap",
"lf ppl for raid team",
"raid grind who join",
"doing raids max lvl",
"raid carry dm fast",
"hosting raid spam now",
"lf help raid now",
"raid service quick join",
"doing raids full team",
"raid carry instant win",
    "service for raid",
    "services for raid",
    "service for raids",
    "services for raids",
    "need service",
    "need services",
    "looking for service",
    "looking for services",
    "service request",
    "services request",
    "need boss",
    "need boss help",
    "need help boss",
    "help with boss",
    "anyone boss",
    "anyone help boss",
    "who can help boss",
    "carry boss",
    "need carry boss",
    "need help dough king",
    "need help doughking",
    "need help darkbeard",
    "need help dark beard",
    "need help leviathan",
    "need help levi",
    "need help cake prince",
    "need help cakeprince",
    "need help order",
    "need help greybeard",
    "need help grey beard",
    "need help sea beast",
    "need help seabeast",
    "need help terror shark",
    "need help terrorshark",
    "need help factory raid",
    "need help ghost ship",
    "need help ship raid",
    "need help pirate raid",
    "need help rumbling waters",
    "need help mirage island",
    "need help frozen outpost",
    "need help haunted shipwreck",
    "need help piranhas",
    "need help piranha",
    "need help fishman commando",
    "need help fishman scout",
    "need help electric recluse",
    "anyone for leviathan",
    "anyone for levi",
    "anyone for dough king",
    "anyone for doughking",
    "anyone for darkbeard",
    "anyone for dark beard",
    "who can help leviathan",
    "who can help dough king",
    "who can help darkbeard",
    "who can carry leviathan",
    "who can carry dough king",
    "who can carry darkbeard",
    "hosting raids",
    "hosting raid",
    "who hosting raid",
    "who hosting raids",
    "need host raid",
    "need host raids",
    "raid host",
    "raids host",
    "need raid host",
    "need raids host",
    "carry service",
    "carry services",
    "boost service",
    "boost services",
    "help service",
    "help services",
    "service carry",
    "services carry",
    "service boost",
    "services boost",
    "need help enchant",
    "need help enchants",
    "help with enchant",
    "help with enchants",
    "what enchant should i use",
    "which enchant is best",
    "best enchant for",
    "best sword for",
    "best gun for",
    "best fighting style for",
    "best style for",
    "which sword should i use",
    "which gun should i use",
    "which style should i use",
    "help me choose sword",
    "help me choose gun",
    "help me choose style",
    "need help with quest",
    "need help with quests",
    "help with quest",
    "help with quests",
    "quest help",
    "quests help",
    "need help with sea events",
    "help with sea events",
    "help sea events",
    "need help sea events",
    "need help with sea beast",
    "need help with seabeast",
    "need carry sea beast",
    "need carry seabeast",
    "sea beast help",
    "seabeast help",
    "need help with pvp",
    "need pvp help",
    "carry pvp",
    "help pvp",
    "need help with grinding",
    "need grinding help",
    "carry grinding",
    "help grinding",
    "need help with farming",
    "need farming help",
    "carry farming",
    "help farming",
    "need help with mastery",
    "need mastery help",
    "help mastery",
    "carry mastery",
    "need help with money",
    "need money help",
    "raid svc lf ppl",

"lf raid asap need 2",

"doing raid rn join fast",

"raid carry dm asap",

"hosting raid lf team",

"raid spam lf ppl quick",

"need raid help rn",

"doing raid farm join",

"raid svc cheap dm me",

"lf 2 more raid fast",

"hosting raids come quick",

"raid carry slots open rn",

"doing raids back2back join",

"lf ppl raid grind fast",

"raid help who can carry",

"hosting raid dm for spot",

"raid svc fast runs",

"doing raids no fail join",

"lf ppl for raid asap",

"raid carry trusted dm",

"hosting raid lf 3 ppl",

"doing raids join quick pls",

"raid spam rn who in",

"lf raid squad now",

"raid svc vouches dm",

"hosting raid need carry",

"doing raids for frags join",

"raid help asap dm",

"lf ppl raid runs fast",

"raid carry cheap slots",

"hosting raid join now pls",

"doing raids spam fast",

"lf help raid quick pls",

"raid svc instant start",

"hosting raid lf pro",

"doing raids quick clear join",

"raid spam fast farm",

"lf ppl for raid run",

"raid carry pro dm",

"hosting raid need ppl asap",

"doing raids nonstop farm",

"raid help fast join pls",

"lf raid carry cheap pls",

"raid svc no fail runs",

"hosting raid fast entry",

"doing raids join now asap",

"raid spam who wanna join",

"lf ppl raid fast run",

"raid carry high lvl dm",

"hosting raid dm quick join",

"doing raids quick frags farm",

"raid help needed quick",

"lf ppl for raid spam rn",

"raid svc open rn dm",

"hosting raid join fast pls",

"doing raids easy farm join",

"raid carry legit fast",

"lf team raid asap pls",

"raid spam nonstop join",

"hosting raid full carry dm",

"doing raids pro runs join",

"raid help dm asap pls",

"lf ppl raid squad fast",

"raid svc best prices dm",

"hosting raid need ppl fast",

"doing raids join quick rn",

"raid carry no fail dm",

"lf ppl raid runs asap",

"raid spam fast clears",

"hosting raid dm for join",

"doing raids instant clear rn",

"raid help join quick pls",

"lf raid carry fast pls",

"raid svc open slots rn",

"hosting raid spam join now",

"doing raids all day join",

"raid carry cheap fast dm",

"lf ppl raid farm asap",

"raid spam join quick rn",

"hosting raid need team now",

"doing raids quick win farm",

"raid help pls join fast",

"lf ppl for raid now pls",

"raid svc dm for invite",

"hosting raid fast runs join",

"doing raids spam nonstop",

"raid carry fast win dm",

"lf raid squad quick pls",

"raid spam who in rn",

"hosting raid join asap pls",

"doing raids pro carry join",

"raid help urgent join",

"lf ppl raid quick asap",

"raid svc fast join dm",

"hosting raid need ppl now",

"doing raids instant win join",

"raid carry best dm",

"lf team raid fast join",

"raid spam join asap rn",

"hosting raid pro runs",

"doing raids full carry join",

"raid help fast pls join",

"lf ppl raid asap join",

"raid svc quick entry dm",

"hosting raid all fruits join",

"doing raids quick spam",

"raid carry dm now pls",

"lf ppl for raid quick rn",

"raid spam join fast asap",

"hosting raid fast clear runs",

"doing raids join rn fast",

"raid help asap join pls",

"lf raid carry cheap dm",

"raid svc legit quick dm",

"hosting raid need 2 more",

"doing raids nonstop asap",

"raid carry fast clear dm",

"lf ppl raid farm now",

"raid spam join quick pls",

"hosting raid dm asap join",

"doing raids fast farm rn",

"raid help join now asap",

"lf ppl raid quick join",

"raid svc open join now",

"hosting raid spam asap",

"doing raids join fast pls",

"raid carry pro fast dm",

"lf ppl raid asap fast",

"raid spam nonstop rn",

"hosting raid need team asap",

"doing raids quick clear rn",

"raid help urgent asap",

"lf ppl raid spam asap",

"raid svc cheap fast join",

"hosting raid join now fast",

"doing raids pro fast runs",

"raid carry join asap dm",

"lf ppl raid quick farm",

"raid spam join now pls",

"hosting raid dm fast pls",

"doing raids instant farm",

"raid help quick asap",

"lf raid team fast asap",

"raid svc dm quick pls",

"hosting raid fast farm join",

"doing raids nonstop join pls",

"raid carry instant dm",

"lf ppl raid asap rn",

"raid spam fast asap join",

"hosting raid quick join pls",

"doing raids easy fast farm",

"raid help join asap rn",

"lf ppl raid spam quick",

"raid svc fast dm now",

"hosting raid join rn asap",

"doing raids fast clear asap",

"raid carry cheap asap dm", 
    "help money",
    "carry money",
    "need help with beli",
    "help beli",
    "carry beli",
    "need help with boss",
    "need boss carry",
    "boss carry",
    "boss help",
    "need help with service",
    "need service help",
    "service help",
    "services help",
    "who can service",
    "who can do service",
    "who can carry service",
    "can anyone do service",
    "can anyone carry",
    "can anyone help",
    "can someone help",
    "can some1 help",
    "someone help",
    "some1 help",
    "any1 help",
    "need help now",
    "need help asap",
    "help asap",
    "help fast",
    "need quick help",
    "need fast help",
    "need immediate help",
    "need urgent help",
    "urgent help",
    "asap help",
    "need assistance",
    "need assist",
    "need carry asap",
    "need carry now",
    "need raid asap",
    "need raid now",
    "need trials asap",
    "need trials now",
    "host full raids",
    "hosting full raids",
    "hosting 10 raids",
    "hosting 5 raids",
    "host 10 raids",
    "host 5 raids",
    "carry full raids",
    "carry 10 raids",
    "carry 5 raids",
    "need full raids",
    "need 10 raids",
    "need 5 raids",
    "lf full raids",
    "lf 10 raids",
    "lf 5 raids",
    "lfg full raids",
    "lfg 10 raids",
    "lfg 5 raids",
    "need raid carry",
    "need raids carry",
    "need carry for raids",
    "need carry for raid",
    "pay for raids",
    "pay for raid",
    "paying for raid",
    "paying for raids",
    "i pay for raids",
    "i pay for raid",
    "beli for raids",
    "beli for raid",
    "i pay beli",
    "i pay with beli",
    "payment in beli",
    "payment with beli",
    "fruit for raids",
    "fruit for raid",
    "pay in fruit",
    "payment in fruit",
    "pay fruits",
    "pay fruit",
    "perm for raids",
    "perm for raid",
    "gp for raids",
    "gamepass for raids",
    "lf someone to host raids",
    "lf someone to host raid",
    "need someone to host raids",
    "need someone to host raid",
    "hosting for payment",
    "hosting for pay",
    "carry for payment",
    "carry for pay",
    "boost for payment",
    "boost for pay",
    "service for payment",
    "service for pay",
    "services for payment",
    "services for pay",
    "paid raids",
    "paid raid",
    "paid carry",
    "paid service",
    "paid boost",
    "i pay",
    "i will pay",
    "i can pay",
    "need a team",
    "need a squad",
    "need a group",
    "need ppl",
    "need people",
    "need players",
    "need members",
    "need 1",
    "need 2",
    "need 3",
    "need 4",
    "need 5",
    "need one",
    "need two",
    "need three",
    "need four",
    "need five",
    "need 1 more",
    "need 2 more",
    "need 3 more",
    "need 4 more",
    "need one more",
    "need two more",
    "need three more",
    "need four more",
    "lf 1",
    "lf 2",
    "lf 3",
    "lf 4",
    "lf one",
    "lf two",
    "lf three",
    "lf four",
    "join my raid",
    "join my raids",
    "join raid",
    "join raids",
    "join for raid",
    "join for raids",
    "dm me to join",
    "dm me to carry",
    "dm me for carry",
    "dm me for raids",
    "dm me for raid",
    "pm me to join",
    "pm me for carry",
    "pm me for raids",
    "pm me for raid",
    "message me to join",
    "message me for carry",
    "message me for raids",
    "message me for raid",
];

const SERVICE_INTENT_PHRASE_EXTRA2 = [
    // high-skill / sweaty requests
    "looking for insane carry",
    "need insane carry",
    "lf insane players",
    "lf insane carry",
    "need god tier players",
    "looking for god tier carry",
    "need god tier team",
    "lf god tier help",
    "need pro level carry",
    "looking for pro level team",
    "need pro level players",
    "lf pro level raid team",
    "need elite raid carry",
    "lf elite raid team",
    "looking for elite raiders",
    "need max level raid carry",
    "lf max level team",
    "need max level players",
    "looking for max lvl carry",
    "need max lvl raid team",

    // competitive / hardcore
    "need hardcore raid team",
    "lf hardcore players",
    "looking for hardcore carry",
    "need tryhard team",
    "lf tryhard players",
    "looking for tryhard carry",
    "need competitive team",
    "lf competitive players",
    "need ranked players",
    "lf ranked team",
    "looking for ranked carry",
    "need leaderboard grind team",
    "lf leaderboard players",
    "looking for leaderboard push",

    // experienced / veteran
    "need veteran players",
    "lf veteran raid team",
    "looking for veteran carry",
    "need experienced raiders only",
    "lf experienced raid team only",
    "looking for experienced players only",
    "need pro veterans",
    "lf raid veterans only",
    "need skilled veterans",
    "looking for veteran squad",

    // endgame / late game
    "need endgame raid team",
    "lf endgame players",
    "looking for endgame carry",
    "need late game players",
    "lf late game team",
    "looking for late game carry",
    "need post game help",
    "lf post game players",

    // grind / farming escalation
    "need insane grind help",
    "lf grinding team high level",
    "looking for hardcore farming team",
    "need efficient farming squad",
    "lf fast grind carry",
    "need speed farm team",
    "looking for farming pros",
    "need farming veterans",

    // raids / bosses advanced
    "need advanced raid carry",
    "lf raid specialists",
    "looking for raid experts only",
    "need boss farming team",
    "lf boss grinding squad",
    "looking for boss killers",
    "need dungeon carry elite",
    "lf dungeon experts",
    "looking for dungeon carry",

    // PvP / skill-based
    "need pvp gods",
    "lf pvp sweats",
    "looking for pvp carry",
    "need ranked pvp team",
    "lf arena players",
    "looking for arena carry",
    "need duel experts",
    "lf duelists only",

    // rare / stacked team requests
    "need stacked team",
    "lf stacked players",
    "looking for stacked raid team",
    "need full stacked carry",
    "lf full stacked squad",
    "looking for overpowered team",
    "need op players only",
    "lf op carry team",

    // urgency + high demand
    "need urgent elite carry",
    "lf fast god carry",
    "looking for asap pro team",
    "need immediate high level help",
    "lf instant raid carry",
    "looking for quick elite team",
];

const BEG_WORDS = [
    "pls","plss","plsss","please","pleese","plz","plzz","plzzz",
    "pleasee","plx","plez","pleas","plee",
];
const ACCOUNT_NOUNS = ["account","acc","acct"];
const ACC_TRADE_VERBS = [
    "sell","selling","sold","wts","for sale","forsale",
    "buy","buying","bought","wtb","looking to buy",
    "trade","trading","swap","swapping","wtt",
    "transfer","transferring","give away","giveaway","giving away",
    "offer","offering",
];
const ACC_TRADING_PHRASES = [
    "sell my account","selling my account","selling account","sell account",
    "trade my account","trading my account","trading account","trade account",
    "swap account","swapping account","buy account","buying account",
    "wtb account","wts account","wtt account","account for sale","account trade",
    "account swap","sell my acc","selling my acc","selling acc","sell acc",
    "trade my acc","trading my acc","trading acc","trade acc","swap acc",
    "buy acc","buying acc","wtb acc","wts acc","wtt acc","acc for sale",
    "acc trade","acc swap","account for robux","acc for robux",
    "account for usd","acc for usd","account for money","acc for money",
    "account for paypal","acc for paypal","account for cash","acc for cash", "trading max level account", "trading max lvl acc"
];

// ══════════════════════════════════════════════════════════
//  TOKENIZATION + SCANNING ENGINE
// ══════════════════════════════════════════════════════════
function tokenize(text) {
    const words = text.match(/[a-z0-9']+/g) || [];
    const single = new Set(words);
    const compound = new Set();
    for (let i = 0; i < words.length - 1; i++) compound.add(words[i]+words[i+1]);
    for (let i = 0; i < words.length - 2; i++) compound.add(words[i]+words[i+1]+words[i+2]);
    return { single, compound };
}

function tokenMatchesList(token, list, aliasMap, threshold = FUZZY_THRESHOLD) {
    if (token.length < 2) return null;
    if (aliasMap[token]) return aliasMap[token];
    for (const entry of list) {
        const ec = entry.replace(/[\s\-'\/]/g, '');
        if (ec.length < SHORT_MIN_LEN) { if (token === ec) return entry; continue; }
        if (token === ec) return entry;
        if (token.includes(ec) && token.length <= ec.length + 2) return entry;
        if (ec.includes(token) && token.length >= ec.length - 2 && token.length >= 4) return entry;
        if (Math.abs(token.length - ec.length) > Math.max(3, Math.floor(ec.length / 3))) continue;
        if (fuzzyRatio(token, ec) >= threshold) return entry;
    }
    return null;
}

function genericScan(cleanText, list, aliasMap, threshold = FUZZY_THRESHOLD) {
    const { single, compound } = tokenize(cleanText);
    const found = [];
    for (const tok of single) {
        if (tok.length < 2 || COMMON_WORD_WHITELIST.has(tok)) continue;
        const m = tokenMatchesList(tok, list, aliasMap, threshold);
        if (m && !found.includes(m)) found.push(m);
    }
    for (const tok of compound) {
        if (tok.length < 3) continue;
        if (aliasMap[tok] && !found.includes(aliasMap[tok])) { found.push(aliasMap[tok]); continue; }
        for (const entry of list) {
            const ec = entry.replace(/[\s\-'\/]/g, '');
            if (ec === tok && !found.includes(entry)) { found.push(entry); break; }
            if (ec.length >= SHORT_MIN_LEN) {
                if (tok.includes(ec) && tok.length <= ec.length + 2 && !found.includes(entry)) { found.push(entry); break; }
                if (ec.includes(tok) && tok.length >= ec.length - 2 && tok.length >= 4 && !found.includes(entry)) { found.push(entry); break; }
            }
        }
    }
    return found;
}

const scanForFruits         = t => genericScan(t, FRUITS,           FRUIT_ALIASES);
const scanForBosses         = t => genericScan(t, BOSSES,           BOSS_ALIASES);
const scanForSwords         = t => genericScan(t, SWORDS,           SWORD_ALIASES);
const scanForEnchants       = t => genericScan(t, ENCHANTS,         ENCHANT_ALIASES);
const scanForHakiColors     = t => genericScan(t, HAKI_COLORS,      HAKI_ALIASES);
const scanForFightingStyles = t => genericScan(t, FIGHTING_STYLES,  FIGHTING_STYLE_ALIASES);
const scanForGuns           = t => genericScan(t, GUNS,             GUN_ALIASES);
const scanForAccessories    = t => genericScan(t, ACCESSORIES,      ACCESSORY_ALIASES);
const scanForQuests         = t => genericScan(t, QUESTS,           QUEST_ALIASES);
const scanForSeaEvents      = t => genericScan(t, SEA_EVENTS,       SEA_EVENT_ALIASES);
const scanForRaces          = t => genericScan(t, RACES,            RACE_ALIASES);
const scanForPainUpgrades      = t => genericScan(t, PAIN_UPGRADES,    PAIN_UPGRADE_ALIASES);
const scanForLightningUpgrades = t => genericScan(t, LIGHTNING_UPGRADES, LIGHTNING_UPGRADE_ALIASES);
const scanForMaterials         = t => genericScan(t, MATERIALS,        MATERIAL_ALIASES);
const scanForNpcs              = t => genericScan(t, NPCS,             NPC_ALIASES);

function scanForServiceIntent(cleanText, strictness = 5) {
    const ns = cleanText.replace(/\s/g, '');

    // ── Curated strict phrases — active at ALL levels ──────
    for (const phrase of SERVICE_INTENT_PHRASE) {
        if (ns.includes(phrase.replace(/\s/g,'')) || cleanText.includes(phrase)) return true;
    }

    // ── At level 1-2: curated phrases + exact SERVICE_INTENT_EXACT only (no fuzzy, no EXTRA) ──
    if (strictness <= 2) {
        const { single } = tokenize(cleanText);
        for (const tok of single) {
            if (tok.length < 2) continue;
            if (COMMON_WORD_WHITELIST.has(tok)) continue;
            for (const kw of SERVICE_INTENT_EXACT) {
                const kwc = kw.replace(/\s/g,'');
                if (tok === kwc) return true; // exact only, no fuzzy
            }
        }
        return false;
    }

    // ── At level 3+: EXTRA lists (both already require p.length >= 6) ──
    for (const phrase of SERVICE_INTENT_PHRASE_EXTRA) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 6 && (ns.includes(p) || cleanText.includes(phrase))) return true;
    }

    for (const phrase of SERVICE_INTENT_PHRASE_EXTRA2) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 6 && (ns.includes(p) || cleanText.includes(phrase))) return true;
    }

    // ── Token fuzzy matching — stricter threshold at lower levels ──
    const fuzzyThreshold = strictness <= 4 ? 0.92 : 0.82;
    const { single } = tokenize(cleanText);
    for (const tok of single) {
        if (tok.length < 2) continue;
        if (COMMON_WORD_WHITELIST.has(tok)) continue;
        for (const kw of SERVICE_INTENT_EXACT) {
            const kwc = kw.replace(/\s/g,'');
            if (kwc.length <= 4) { if (tok === kwc) return true; continue; }
            if (tok === kwc) return true;
            if (Math.abs(tok.length - kwc.length) > Math.max(2,Math.floor(kwc.length/3))) continue;
            if (fuzzyRatio(tok, kwc) >= fuzzyThreshold) return true;
        }
    }
    return false;
}
// ── Safe phrases that should never trigger trade intent ──────
const SAFE_PHRASE_EXCEPTIONS = [
    /\bwant(?:s|ed)? to play\b/i,
    /\bwanna play\b/i,
    /\bwant(?:s|ed)? to join\b/i,
    /\bwanna join\b/i,
    /\banyone want(?:s)? to play\b/i,
    /\bwho wants? to play\b/i,
    /\bplay (?:with|together)\b/i,
    /\bplay(?:ing)? (?:any|some|a) roblox\b/i,
    /\bplay(?:ing)? roblox\b/i,
    // ── Conversational false-positive guards ─────────────────────────────────
    // Prevent "for your honesty/help/time" and similar from triggering trade intent
    /\bfor your\b/i,
    /\bfor my (?!fruit|fruits|perm|perms|sword|swords|item|items|offer|offers)\b/i,
    /\bthank(?:s| you)?\b/i,
    /\bsorry for\b/i,
    /\bapologi(?:ze|se) for\b/i,
    /\bwait(?:ing)? for\b/i,
    /\bask(?:ing)? for\b/i,
    /\bhope(?:s|d|ing)? for\b/i,
    /\bwish(?:es|ed|ing)? for\b/i,
    /\bpray(?:s|ed|ing)? for\b/i,
    /\bhere for\b/i,
    /\bready for\b/i,
    /\bhappy for\b/i,
    /\bexcited for\b/i,
    /\bno affiliation\b/i,
    /\bnot affiliated\b/i,
    /\bnot looking to (?:trade|sell|buy)\b/i,
    /\bjust (?:asking|wondering|curious|checking|saying|chatting|talking|here)\b/i,
    /\b(?:good|bad|great|awesome|nice|cool) (?:luck|job|work|point|tip)\b/i,
    /\bi (?:have|had|got|get) (?:a |an )?(?:question|idea|suggestion|problem|issue)\b/i,
    /\bneed (?:help|advice|tips?|info(?:rmation)?|a hand|support)\b/i,
    /\blooking for (?:help|advice|tips?|info(?:rmation)?|friends?|a team|players?|someone to play)\b/i,
    /\bgiving (?:away|out) (?:advice|tips?|info|help)\b/i,
    /\bhave (?:a )?(?:fun|good|great|nice|bad) (?:day|time|game|one)\b/i,
    /\bi have (?:a |an )?(?:question|problem|issue|suggestion)\b/i,
];

function scanForIntent(cleanText, strictness = 5) {
    // Bail out early on clearly innocent phrases before any intent matching
    for (const safe of SAFE_PHRASE_EXCEPTIONS) {
        if (safe.test(cleanText)) return false;
    }
    const ns = cleanText.replace(/\s/g,'');

    // ── Curated strict phrases — active at ALL levels ──────
    for (const phrase of INTENT_PHRASE) {
        if (ns.includes(phrase.replace(/\s/g,'')) || cleanText.includes(phrase)) return true;
    }

    // ── At level 1-2: only curated phrases + exact INTENT_EXACT (no fuzzy, no EXTRA lists) ──
    if (strictness <= 2) {
        const { single } = tokenize(cleanText);
        for (const tok of single) {
            if (tok.length < 2) continue;
            for (const kw of INTENT_EXACT) {
                const kwc = kw.replace(/\s/g,'');
                if (tok === kwc) return true; // exact only, no fuzzy
            }
        }
        return false;
    }

    // ── At level 3+: EXTRA lists, with minimum phrase length scaling up at low levels ──
    // Minimum p.length:  lvl 3-4 → 5 chars (skips bare "for", "lf", "want", "need")
    //                    lvl 5+  → 2 chars (current behaviour)
    const extraMinLen = strictness <= 4 ? 5 : 2;
    for (const phrase of INTENT_PHRASE_EXTRA) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= extraMinLen) {
            // For short phrases use word-boundary regex to avoid substring hits in other words
            if (p.length < 5) {
                if (new RegExp(`(?<![a-z0-9])${escapeRegex(p)}(?![a-z0-9])`, 'i').test(cleanText)) return true;
            } else {
                if (ns.includes(p) || cleanText.includes(phrase.trim())) return true;
            }
        }
    }

    for (const phrase of INTENT_PHRASE_EXTRA2) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 5 && (ns.includes(p) || cleanText.includes(phrase.trim()))) return true;
    }

    // ── Token fuzzy matching — stricter threshold at lower levels ──
    const fuzzyThreshold = strictness <= 4 ? 0.92 : 0.82;
    const { single } = tokenize(cleanText);
    for (const tok of single) {
        if (tok.length < 2) continue;
        for (const kw of INTENT_EXACT) {
            const kwc = kw.replace(/\s/g,'');
            if (kwc.length <= 4) { if (tok === kwc) return true; continue; }
            if (tok === kwc) return true;
            if (Math.abs(tok.length - kwc.length) > Math.max(2,Math.floor(kwc.length/3))) continue;
            if (fuzzyRatio(tok, kwc) >= fuzzyThreshold) return true;
        }
    }
    return false;
}
function hasTierKeyword(cleanText) {
    const ns = cleanText.replace(/[\s_]/g,'');
    for (const tier of RACE_TIER_KEYWORDS) {
        const tc = tier.replace(/[\s\-]/g,'');
        const pat = new RegExp(`(?<![a-z0-9])${escapeRegex(tc)}(?![a-z0-9])`,'i');
        if (pat.test(cleanText) || (tc.length >= 3 && ns.includes(tc))) return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  BEGGING & ACCOUNT TRADING DETECTION
// ══════════════════════════════════════════════════════════
function detectBegging(cleanText) {
    const ns  = cleanText.replace(/[\s_]/g,'');
    const toks = (cleanText.match(/[a-z0-9]+/g) || []);
    let hasBeg = false;
    for (const beg of BEG_WORDS) {
        const bc = beg.replace(/\s/g,'');
        if (new RegExp(`(?<![a-z])${escapeRegex(bc)}s{0,6}(?![a-z])`,'i').test(cleanText)) { hasBeg = true; break; }
    }
    if (!hasBeg) return false;
    const fruits = scanForFruits(cleanText);
    for (const f of FRUITS) {
        const fc = f.replace(/[\s\-]/g,'');
        if (ns.includes(fc) && !fruits.includes(f)) fruits.push(f);
    }
    if (!fruits.length) return false;
    if (toks.length <= 10) return true;
    for (const beg of BEG_WORDS) {
        const pat = new RegExp(`(?<![a-z])${escapeRegex(beg)}s{0,6}(?![a-z])`,'gi');
        let m;
        while ((m = pat.exec(cleanText)) !== null) {
            const win = cleanText.slice(Math.max(0,m.index-60), Math.min(cleanText.length, m.index+beg.length+60));
            for (const f of FRUITS) {
                const fc = f.replace(/[\s\-]/g,'');
                if (fc.length >= 3 && win.includes(fc)) return true;
            }
        }
    }
    return false;
}
function detectAccountTrading(cleanText) {
    const ns = cleanText.replace(/[\s_]/g,'');
    for (const phrase of ACC_TRADING_PHRASES) {
        if (ns.includes(phrase.replace(/[\s_]/g,'')) || cleanText.includes(phrase)) return true;
    }
    const toks = (cleanText.match(/[a-z0-9]+/g) || []);
    const accIdx = [], verbIdx = [];
    for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        for (const noun of ACCOUNT_NOUNS) {
            if (tok === noun || (noun === 'account' && tok.length >= 5 && fuzzyRatio(tok, noun) >= 0.85)) { accIdx.push(i); break; }
        }
        for (const verb of ACC_TRADE_VERBS) {
            const vc = verb.replace(/\s/g,'');
            if (vc.length <= 4) { if (tok === vc) { verbIdx.push(i); break; } }
            else if (tok === vc || fuzzyRatio(tok, vc) >= 0.85) { verbIdx.push(i); break; }
        }
    }
    for (const ai of accIdx) for (const vi of verbIdx) if (Math.abs(ai-vi) <= 8) return true;
    return false;
}

// ══════════════════════════════════════════════════════════
//  REGEX PATTERNS
// ══════════════════════════════════════════════════════════
function makeAggroPattern(word, plural = false) {
    const cw = word.replace(/[\s\-'\/]/g,'');
    const core = cw.split('').map(c => `${escapeRegex(c)}+`).join('[\\s\\W_]*');
    return plural
        ? `(?<![a-z])${core}(?:[\\s\\W]*s+)?(?![a-z])`
        : `(?<![a-z])${core}(?![a-z])`;
}
const fruitPatterns  = FRUITS.map(f  => makeAggroPattern(f, true));
const bossPatterns   = BOSSES.map(b  => makeAggroPattern(b, true));
const fruitP         = `(?:${fruitPatterns.join('|')})`;
const bossP          = `(?:${bossPatterns.join('|')})`;
const aggroFor       = makeAggroPattern("for", false);
const tradeRegex     = new RegExp(`(${fruitP}[\\s\\S]*?${aggroFor}[\\s\\S]*?${fruitP})`, 'i');
const bossRegex      = new RegExp(`(${bossP})`, 'i');
const raidWordP      = makeAggroPattern("raid", false);
const fruitRaidRegex = new RegExp(`(${fruitP}[\\s\\W]{0,6}${raidWordP}|${raidWordP}[\\s\\W]{0,6}${fruitP})`, 'i');
const svcWordP       = `(?:s+[\\s\\W_]*e+[\\s\\W_]*r+[\\s\\W_]*v+[\\s\\W_]*i+[\\s\\W_]*c+[\\s\\W_]*e+s*)`;
const svcForRaidRegex = new RegExp(
    `(?<![a-z])${svcWordP}[\\s\\W_]{0,6}(?:for[\\s\\W_]{0,6})?` +
    `(?:r+[\\s\\W_]*a+[\\s\\W_]*i+[\\s\\W_]*d+s*|d+[\\s\\W_]*u+[\\s\\W_]*n+[\\s\\W_]*g+[\\s\\W_]*e+[\\s\\W_]*o+[\\s\\W_]*n+s*)(?![a-z])`, 'i'
);
const racePatterns2 = RACES.map(r => { const cw=r.replace(/[\s\-]/g,''); return `(?<![a-z])${cw.split('').map(c=>`${escapeRegex(c)}+`).join('[\\s\\W_]*')}(?![a-z])`; });
const tierPatterns2 = RACE_TIER_KEYWORDS.map(t => { const cw=t.replace(/[\s\-]/g,''); return `(?<![a-z0-9])${cw.split('').map(c=>`${escapeRegex(c)}+`).join('[\\s\\W_]*')}(?![a-z0-9])`; });
const raceP2        = `(?:${racePatterns2.join('|')})`;
const tierP2        = `(?:${tierPatterns2.join('|')})`;
const raceTierRegex = new RegExp(`(?:${raceP2}[\\s\\S]{0,200}${tierP2}|${tierP2}[\\s\\S]{0,200}${raceP2})`, 'i');

function makeNospacePattern(kw, target) {
    const k = kw.replace(/[\s\-]/g,''), f = target.replace(/[\s\-']/g,'');
    const kp = k.split('').map(c=>`${escapeRegex(c)}+`).join('[\\s_]*');
    const fp = f.split('').map(c=>`${escapeRegex(c)}+`).join('[\\s_]*');
    return new RegExp(`(?<![a-z])${kp}[\\s\\W_]{0,3}${fp}(?![a-z])`, 'i');
}
const NOSPACE_PATTERNS = [];
// All intent keywords that can be smashed directly against a fruit/item name
const NOSPACE_INTENTS = [
    "lf","wtt","wtb","wts","lookingfor","lfr","lf4","lf4r","lfor",
    "searchingfor","seekingfor","wantto","needto","wanna","wana",
    "ihave","igot","ihavefor","igotfor","trading","selling","buying",
    "offering","swapping","exchanging","havingfor","gottingfor",
];
for (const ki of NOSPACE_INTENTS) {
    for (const fr of FRUITS) NOSPACE_PATTERNS.push(makeNospacePattern(ki, fr));
    for (const sw of SWORDS) NOSPACE_PATTERNS.push(makeNospacePattern(ki, sw));
}
// Also cover common 2-letter / short aliases for swords directly (dk=dark blade, ttk, cdk, etc.)
const SHORT_SWORD_ALIASES = Object.entries(SWORD_ALIASES)
    .filter(([alias]) => alias.length >= 2 && alias.length <= 6);
for (const ki of ["lf","wtt","wtb","wts","lookingfor","lfr","lf4","trading","selling","buying"]) {
    for (const [alias] of SHORT_SWORD_ALIASES) {
        NOSPACE_PATTERNS.push(makeNospacePattern(ki, alias));
    }
}
// Also cover common fruit aliases directly
const SHORT_FRUIT_ALIASES = Object.entries(FRUIT_ALIASES)
    .filter(([alias]) => alias.length >= 2 && alias.length <= 8);
for (const ki of ["lf","wtt","wtb","wts","lookingfor","lfr","lf4","trading","selling","buying"]) {
    for (const [alias] of SHORT_FRUIT_ALIASES) {
        NOSPACE_PATTERNS.push(makeNospacePattern(ki, alias));
    }
}

// ══════════════════════════════════════════════════════════
//  VIOLATION SYSTEM (UNIFIED WARNING COUNTER)
// ══════════════════════════════════════════════════════════
async function issueViolation(message, data, gs, opts) {
    const uid = message.author.id;
    const threshold = Math.max(1, Math.min(10, gs?.violationThreshold || VIOLATION_THRESHOLD));
    const exileMins = Math.max(1, Math.min(1440, gs?.exileDurationMins || EXILE_DURATION_MINS));
    const count = addViolationEntry(data, uid, {
        reason: opts?.reason || 'Rule violation',
        category: String(opts?.footerLabel || 'violation').toLowerCase(),
        by: null,
    });
    saveData(data);

    const title = opts?.title || '⚠️ Violation';
    const color = opts?.color ?? 0xFFAA00;
    const reason = opts?.reason || 'Rule violation';
    const details = opts?.details || message.content.slice(0, 500);
    const redirectChannelId = opts?.redirectChannelId || null;
    const footerLabel = opts?.footerLabel || 'Violation';

    const caseObj = createCaseFromMessage(message, data, gs, {
        title,
        reason,
        details,
        footerLabel,
        action: opts?.action || 'warn',  // ← use actual action instead of always 'warn'
    });
    const caseId = caseObj?.id || null;

    await sendLog(message.guild, data, new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .addFields(
            { name: 'User', value: `<@${uid}> (${uid})`, inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Violations', value: `${count}/${threshold}`, inline: true },
            ...(caseId ? [{ name: 'Case', value: `#${caseId}`, inline: true }] : []),
            { name: 'Reason', value: String(reason).slice(0, 1024), inline: false },
            { name: 'Content', value: String(details).slice(0, 1024), inline: false },
        ).setTimestamp());

    if (count >= threshold) {
        clearViolationEntry(data, uid);
        saveData(data);
        await performExile(message.member || message.author, message.guild, exileMins, `Automated: ${footerLabel} (${reason})`, data);
        saveData(data);
        return { exiled: true, count };
    }

    const userMsg = redirectChannelId
        ? `⚠️ ${message.author}, ${reason}\nGo to <#${redirectChannelId}>.`
        : `⚠️ ${message.author}, ${reason}`;
    const embed = new EmbedBuilder()
        .setDescription(userMsg)
        .setColor(color)
        .setFooter({ text: `${footerLabel} ${count}/${threshold}${caseId ? ` • Case #${caseId}` : ''}` });
    const sent = await message.channel.send({ embeds: [embed] });
    setTimeout(() => sent.delete().catch(()=>{}), opts?.ttlMs || 10000);

    // ── Warn appeal DM (auto-violations) ─────────────────
    // Mirror the appeal button that /warn sends so users can always
    // appeal their warning, whether it was issued manually or by the scanner.
    const warnId = getLastWarnId(data, uid);
    if (warnId) {
        try {
            const guildIcon = message.guild.iconURL({ dynamic: true });
            const dmEmbed = new EmbedBuilder()
                .setTitle('⚠️ You have received a Warning')
                .setColor(0xFF8C00)
                .setThumbnail(guildIcon || null)
                .setAuthor({ name: message.guild.name, iconURL: guildIcon || undefined })
                .setDescription(
                    `Hey <@${uid}>, you've been automatically warned in **${message.guild.name}**.\n` +
                    `If you believe this was a mistake, you can appeal it below — but you only get **one shot**.\n\u200b`
                )
                .addFields(
                    { name: '📝 Reason',       value: reason.slice(0, 1024),      inline: false },
                    { name: '📊 Strike count', value: `${count} / ${threshold}`,   inline: true  },
                    { name: '🆔 Warn ID',      value: `\`${warnId}\``,            inline: true  },
                )
                .setFooter({ text: 'You may submit exactly 1 appeal per warning.' })
                .setTimestamp();
            const appealRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`open_warn_appeal_${message.guild.id}_${warnId}`)
                    .setLabel('📩 Appeal this Warning')
                    .setStyle(ButtonStyle.Primary)
            );
            await message.author.send({ embeds: [dmEmbed], components: [appealRow] }).catch(()=>{});
        } catch {}
    }

    return { exiled: false, count };
}

// ══════════════════════════════════════════════════════════
//  SPAM DETECTION
// ══════════════════════════════════════════════════════════
// spamTracker: userId -> { msgs: [{content, timestamp}], violations: number }
const spamTracker = new Map();

function recordSpamMsg(userId, content, guildId) {
    const now = Date.now();
    // BUG FIX: key by guildId:userId so tracking doesn't bleed across servers
    const key = `${guildId || 'global'}:${userId}`;
    if (!spamTracker.has(key)) spamTracker.set(key, { msgs: [], violations: 0 });
    const s = spamTracker.get(key);
    s.msgs.push({ content, timestamp: now });
    s.msgs = s.msgs.filter(m => now - m.timestamp < SPAM_WINDOW_MS);
    return s;
}

function checkSpam(userId, content, gs, guildId) {
    const s = recordSpamMsg(userId, content, guildId);
    if (s.msgs.length >= SPAM_MSG_LIMIT) return { spam: true, reason: 'message flood' };
    const dupes = s.msgs.filter(m => m.content === content).length;
    if (dupes >= SPAM_DUPE_LIMIT) return { spam: true, reason: 'duplicate messages' };
    const emojiCount = (content.match(/(<a?:[a-zA-Z0-9_]+:\d+>|[\u{1F300}-\u{1FFFF}])/gu) || []).length;
    if (emojiCount >= SPAM_EMOJI_LIMIT) return { spam: true, reason: 'emoji spam' };
    if (gs?.capsSpamEnabled) {
        const letters = content.replace(/[^a-zA-Z]/g,'').length;
        const capsRatio = content.replace(/\s/g,'').length > 5 && letters > 0
            ? (content.replace(/[^A-Z]/g,'').length / letters)
            : 0;
        if (capsRatio > 0.85 && content.length > 20) return { spam: true, reason: 'all caps spam' };
    }
    const linkCount = (content.match(/https?:\/\/\S+/g) || []).length;
    if (linkCount >= 4) return { spam: true, reason: 'link spam' };
    return { spam: false };
}

function clearSpamHistory(userId, guildId) {
    const key = `${guildId || 'global'}:${userId}`;
    spamTracker.delete(key);
}

// ══════════════════════════════════════════════════════════
//  ANTI-RAID / JOIN SPIKE DETECTION
// ══════════════════════════════════════════════════════════
const joinSpikeTracker = new Map();
function recordJoinSpike(guildId) {
    const now = Date.now();
    const e = joinSpikeTracker.get(guildId) || { joins: [], last: 0, lockedUntil: 0 };
    e.last = now;
    e.joins.push(now);
    e.joins = e.joins.filter(t => now - t < 5 * 60000);
    joinSpikeTracker.set(guildId, e);
    return e;
}
function getJoinSpikeWindow(e, windowSec) {
    const now = Date.now();
    const w = Math.max(5, Math.min(120, windowSec || 25)) * 1000;
    const recent = (e?.joins || []).filter(t => now - t <= w);
    return recent.length;
}
function setRaidLocked(guildId, mins) {
    const now = Date.now();
    const e = joinSpikeTracker.get(guildId) || { joins: [], last: 0, lockedUntil: 0 };
    e.lockedUntil = Math.max(e.lockedUntil || 0, now + (Math.max(1, mins || 5) * 60000));
    joinSpikeTracker.set(guildId, e);
}
function isRaidLocked(guildId) {
    const e = joinSpikeTracker.get(guildId);
    if (!e?.lockedUntil) return false;
    if (Date.now() > e.lockedUntil) { e.lockedUntil = 0; joinSpikeTracker.set(guildId, e); return false; }
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [gid, e] of joinSpikeTracker) {
        if (now - (e.last || 0) > 20 * 60000) joinSpikeTracker.delete(gid);
    }
}, 300000);

// ══════════════════════════════════════════════════════════
//  MENTION SPAM DETECTION
// ══════════════════════════════════════════════════════════
const mentionSpamTracker = new Map();
function recordMentions(uid, guildId, mentionIds) {
    const key = `${guildId}:${uid}`;
    const now = Date.now();
    const e = mentionSpamTracker.get(key) || { hits: [], uniq: new Map(), last: 0 };
    e.last = now;
    e.hits.push({ t: now, n: mentionIds.length });
    for (const mid of mentionIds) e.uniq.set(mid, now);
    mentionSpamTracker.set(key, e);
    return e;
}
function getMentionSpamScore(uid, guildId, windowSec) {
    const key = `${guildId}:${uid}`;
    const e = mentionSpamTracker.get(key);
    if (!e) return { total: 0, unique: 0 };
    const now = Date.now();
    const w = Math.max(3, Math.min(60, windowSec || 12)) * 1000;
    e.hits = e.hits.filter(h => now - h.t <= w);
    for (const [mid, t] of e.uniq) if (now - t > w) e.uniq.delete(mid);
    const total = e.hits.reduce((a, h) => a + (h.n || 0), 0);
    const unique = e.uniq.size;
    mentionSpamTracker.set(key, e);
    return { total, unique };
}
setInterval(() => {
    const now = Date.now();
    for (const [k, e] of mentionSpamTracker) {
        if (now - (e.last || 0) > 15 * 60000) mentionSpamTracker.delete(k);
    }
}, 300000);

// ══════════════════════════════════════════════════════════
//  LINK POLICY
// ══════════════════════════════════════════════════════════
function normalizeDomain(d) {
    return String(d || '').toLowerCase().replace(/^www\./,'').trim();
}
function parseDomainArg(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const m = s.match(/^https?:\/\/([^\s\/?:#]+)(?::\d+)?/i);
    const host = m && m[1] ? m[1] : s.split(/[\s\/]/)[0];
    return normalizeDomain(host);
}
function domainInList(domain, list) {
    const d = normalizeDomain(domain);
    for (const x of (list || [])) {
        const xd = normalizeDomain(x);
        if (!xd) continue;
        if (d === xd) return true;
        if (d.endsWith('.' + xd)) return true;
    }
    return false;
}

const COMMON_ALLOWED_DOMAINS = [
    // ── Discord (every CDN / attachment / media subdomain) ─────────────────────
    'discord.com',
    'discordapp.com',       // covers cdn.discordapp.com, attachments.discordapp.com, etc.
    'discordapp.net',       // covers media.discordapp.net, images-ext-*.discordapp.net, etc.
    'discord.gg',
    'discord.co',
    'discord.media',
    'discordcdn.com',
    'cdn.discordapp.com',
    'media.discordapp.net',
    'images-ext-1.discordapp.net',
    'images-ext-2.discordapp.net',
    'images-ext-3.discordapp.net',
    'images-ext-4.discordapp.net',
    'attachments.discordapp.com',
    'cdn1.discordapp.com',
    'cdn2.discordapp.com',
    'cdn3.discordapp.com',
    'cdn4.discordapp.com',
    // ── Tenor (GIF platform) ───────────────────────────────────────────────────
    'tenor.com',
    'media.tenor.com',
    'c.tenor.com',
    'g.tenor.com',
    'media1.tenor.com',
    'media2.tenor.com',
    'media3.tenor.com',
    // ── Giphy ─────────────────────────────────────────────────────────────────
    'giphy.com',
    'media.giphy.com',
    'media0.giphy.com',
    'media1.giphy.com',
    'media2.giphy.com',
    'media3.giphy.com',
    'media4.giphy.com',
    'i.giphy.com',
    'giphymedia.com',
    // ── Imgur ─────────────────────────────────────────────────────────────────
    'imgur.com',
    'i.imgur.com',
    'm.imgur.com',
    // ── Gyazo ────────────────────────────────────────────────────────────────
    'gyazo.com',
    'i.gyazo.com',
    // ── Gfycat ───────────────────────────────────────────────────────────────
    'gfycat.com',
    'thumbs.gfycat.com',
    'giant.gfycat.com',
    // ── Roblox (every CDN) ────────────────────────────────────────────────────
    'roblox.com',
    'rbxcdn.com',
    'rbx.com',
    'cdn.roblox.com',
    'assetgame.roblox.com',
    'thumbnails.roblox.com',
    'images.rbxcdn.com',
    't1.rbxcdn.com',
    't2.rbxcdn.com',
    't3.rbxcdn.com',
    'setup.rbxcdn.com',
    'robloxlabs.com',
    'www.roblox.com',
    'create.roblox.com',
    'devforum.roblox.com',
    'bloxfruits.fandom.com',
    'blox-fruits.fandom.com',
    // ── YouTube ───────────────────────────────────────────────────────────────
    'youtube.com',
    'youtu.be',
    'i.ytimg.com',
    'img.youtube.com',
    'music.youtube.com',
    'yt.be',
    // ── Twitter/X ────────────────────────────────────────────────────────────
    'twitter.com',
    'x.com',
    't.co',
    'pbs.twimg.com',
    'abs.twimg.com',
    'twimg.com',
    // ── Reddit ───────────────────────────────────────────────────────────────
    'reddit.com',
    'redd.it',
    'i.redd.it',
    'v.redd.it',
    'preview.redd.it',
    'old.reddit.com',
    'www.reddit.com',
    'external-preview.redd.it',
    // ── GitHub ───────────────────────────────────────────────────────────────
    'github.com',
    'githubusercontent.com',
    'github.io',
    'gist.github.com',
    'raw.githubusercontent.com',
    // ── Streamable / Medal / clip hosts ──────────────────────────────────────
    'streamable.com',
    'medal.tv',
    'cdn.medal.tv',
    'clips.twitch.tv',
    'clips2.twitch.tv',
    'vod.twitch.tv',
    'outplayed.tv',
    'plays.tv',
    'outplayed.com',
    'clipped.gg',
    // ── Image / file sharing ─────────────────────────────────────────────────
    'postimg.cc',
    'i.postimg.cc',
    'prnt.sc',
    'catbox.moe',
    'litter.catbox.moe',
    'files.catbox.moe',
    'paste.gg',
    'pastebin.com',
    'rentry.co',
    'hastebin.com',
    'ibb.co',
    'imgbb.com',
    'cloudinary.com',
    'res.cloudinary.com',
    'staticflickr.com',
    'flickr.com',
    '500px.com',
    'unsplash.com',
    'images.unsplash.com',
    'pexels.com',
    'pixabay.com',
    // ── Blox Fruits / Roblox wikis / gaming wikis ────────────────────────────
    'fandom.com',
    'wikia.com',
    'wikia.nocookie.net',
    'static.wikia.nocookie.net',
    'gamespot.com',
    'ign.com',
    'kotaku.com',
    'polygon.com',
    'pcgamer.com',
    'rockpapershotgun.com',
    'gameranx.com',
    'eurogamer.net',
    // ── Twitch ───────────────────────────────────────────────────────────────
    'twitch.tv',
    'jtvnw.net',
    'twitchsvc.net',
    'twitchapps.com',
    'static-cdn.jtvnw.net',
    // ── Google (all services) ─────────────────────────────────────────────────
    'google.com',
    'googleapis.com',
    'googleusercontent.com',
    'googlevideo.com',
    'gstatic.com',
    'ggpht.com',
    'google.co.uk','google.ca','google.com.au','google.de','google.fr',
    'google.co.jp','google.co.in','google.es','google.it','google.nl',
    'google.com.br','google.com.mx','google.ru','google.pl','google.se',
    'google.no','google.dk','google.fi','google.be','google.at','google.ch',
    'drive.google.com','docs.google.com','sheets.google.com','slides.google.com',
    'forms.google.com','maps.google.com','photos.google.com','mail.google.com',
    'accounts.google.com','play.google.com','classroom.google.com',
    'gmail.com',
    'firebase.google.com','firebaseapp.com','firebasestorage.googleapis.com',
    'storage.googleapis.com','cloudfunctions.net','appspot.com',
    // ── Bing / Microsoft ─────────────────────────────────────────────────────
    'bing.com',
    'microsoft.com',
    'microsoftonline.com',
    'live.com',
    'hotmail.com',
    'outlook.com',
    'office.com','office365.com','officeapps.live.com',
    'onedrive.live.com','sharepoint.com',
    'azure.com','azurewebsites.net','azureedge.net',
    'visualstudio.com','vsassets.io',
    'xbox.com','xboxlive.com',
    'windows.com','windowsupdate.com',
    'msn.com','skype.com','teams.microsoft.com',
    'bing.net',
    // ── Apple ────────────────────────────────────────────────────────────────
    'apple.com','icloud.com','me.com','mac.com',
    'itunes.apple.com','apps.apple.com','developer.apple.com',
    'aaplimg.com',
    // ── Amazon / AWS ─────────────────────────────────────────────────────────
    'amazon.com','amazon.co.uk','amazon.de','amazon.ca','amazon.com.au',
    'amazonaws.com','cloudfront.net','s3.amazonaws.com',
    'aws.amazon.com','awsstatic.com',
    // ── Cloudflare ────────────────────────────────────────────────────────────
    'cloudflare.com','cloudflareinsights.com','cdnjs.cloudflare.com',
    'workers.dev','pages.dev',
    'cloudflare-ipfs.com',
    // ── Meta / Facebook / Instagram ───────────────────────────────────────────
    'facebook.com','fb.com','fb.me',
    'fbcdn.net','scontent.fbcdn.net',
    'instagram.com','instagr.am',
    'cdninstagram.com',
    'threads.net',
    'meta.com',
    'oculus.com','meta.quest.com',
    'whatsapp.com','whatsapp.net',
    // ── TikTok ───────────────────────────────────────────────────────────────
    'tiktok.com','tiktokcdn.com','musical.ly',
    // ── Snapchat ─────────────────────────────────────────────────────────────
    'snapchat.com','snap.com',
    // ── LinkedIn ─────────────────────────────────────────────────────────────
    'linkedin.com','licdn.com',
    // ── Pinterest ────────────────────────────────────────────────────────────
    'pinterest.com','pinimg.com',
    // ── Tumblr ───────────────────────────────────────────────────────────────
    'tumblr.com',
    // ── Mastodon / Bluesky / Fediverse ────────────────────────────────────────
    'bsky.app','bsky.social',
    'mastodon.social','mstdn.social',
    // ── Kick (streaming) ─────────────────────────────────────────────────────
    'kick.com',
    // ── Music streaming ───────────────────────────────────────────────────────
    'music.youtube.com',
    'spotify.com','spotifycdn.com','scdn.co','open.spotify.com',
    'soundcloud.com','sndcdn.com',
    'audiomack.com','bandcamp.com',
    'deezer.com',
    'tidal.com',
    'last.fm',
    'genius.com',
    'napster.com',
    'iheart.com',
    // ── Steam / Valve ─────────────────────────────────────────────────────────
    'steampowered.com','steamcommunity.com','steamstatic.com','steam.pm',
    'steamusercontent.com',
    'valvesoftware.com',
    // ── Epic Games ───────────────────────────────────────────────────────────
    'epicgames.com','epicgames.dev','unrealengine.com',
    'fortnite.com',
    // ── PlayStation / Sony ───────────────────────────────────────────────────
    'playstation.com','playstation.net','sonyentertainmentnetwork.com',
    'psnprofiles.com',
    // ── Nintendo ─────────────────────────────────────────────────────────────
    'nintendo.com','nintendo.net',
    // ── Xbox / Microsoft Gaming ───────────────────────────────────────────────
    'xbox.com','xboxlive.com','xboxgamebar.com',
    // ── Minecraft ────────────────────────────────────────────────────────────
    'minecraft.net','mojang.com','minecraftforum.net',
    // ── Riot Games / League / Valorant ────────────────────────────────────────
    'riotgames.com','leagueoflegends.com','valorant.com',
    'riven.io','cdn.riotgames.com',
    // ── Blizzard / Battle.net ─────────────────────────────────────────────────
    'blizzard.com','battle.net','bnet.app',
    // ── EA / Origin ──────────────────────────────────────────────────────────
    'ea.com','origin.com','eaplay.com',
    // ── Ubisoft ──────────────────────────────────────────────────────────────
    'ubisoft.com','ubi.com',
    // ── Rockstar ─────────────────────────────────────────────────────────────
    'rockstargames.com','socialclub.rockstargames.com',
    // ── Genshin / HoYoverse ───────────────────────────────────────────────────
    'hoyoverse.com','mihoyo.com','genshin.hoyoverse.com',
    'hoyolab.com',
    // ── Other gaming platforms / leaderboards / stats ────────────────────────
    'gog.com','gogcdn.net',
    'itch.io',
    'curseforge.com','cfu.curse.com','forgecdn.net',
    'modrinth.com',
    'nexusmods.com',
    'gamebanana.com',
    'overwolf.com',
    'tracker.gg',
    'op.gg',
    'u.gg',
    'mobafire.com',
    'dotabuff.com',
    'stratz.com',
    'faceit.com',
    'leetify.com',
    'hltv.org',
    'csgostats.gg',
    'leetify.com',
    'battlefy.com',
    'toornament.com',
    'challengermode.com',
    'battlefy.com',
    'speedrun.com',
    'howlongtobeat.com',
    'backloggd.com',
    'rawg.io',
    'igdb.com',
    'metascore.com',
    'metacritic.com',
    // ── Wikipedia / Wikimedia ─────────────────────────────────────────────────
    'wikipedia.org','wikimedia.org','wikidata.org',
    'upload.wikimedia.org',
    // ── Stack Overflow / Stack Exchange ───────────────────────────────────────
    'stackoverflow.com','stackexchange.com','superuser.com','serverfault.com',
    'askubuntu.com',
    // ── npm / PyPI / package registries ──────────────────────────────────────
    'npmjs.com','pypi.org','crates.io','rubygems.org','packagist.org',
    'nuget.org',
    // ── GitLab / Bitbucket ────────────────────────────────────────────────────
    'gitlab.com','bitbucket.org',
    'sourceforge.net',
    'codepen.io','jsfiddle.net','replit.com','codesandbox.io','glitch.com',
    // ── Hosting / devops ─────────────────────────────────────────────────────
    'vercel.app','netlify.app','netlify.com',
    'railway.app','render.com','fly.dev','heroku.com',
    // ── CDNs ──────────────────────────────────────────────────────────────────
    'jsdelivr.net','unpkg.com',
    'bootstrapcdn.com','fontawesome.com',
    'fonts.googleapis.com','fonts.gstatic.com',
    // ── News & media ────────────────────────────────────────────────────────
    'bbc.com','bbc.co.uk','bbci.co.uk',
    'cnn.com',
    'nytimes.com','wsj.com','theguardian.com',
    'reuters.com','apnews.com',
    'cbsnews.com','nbcnews.com','abcnews.go.com',
    'foxnews.com','msnbc.com',
    'vice.com','vox.com','buzzfeed.com',
    'huffpost.com','independent.co.uk','telegraph.co.uk',
    'medium.com','substack.com',
    'quora.com',
    // ── Productivity / collab tools ───────────────────────────────────────────
    'trello.com',
    'notion.so','notion.com',
    'docs.google.com',
    'canva.com',
    'figma.com',
    'miro.com',
    'airtable.com',
    'asana.com',
    'basecamp.com',
    'clickup.com',
    'monday.com',
    'linear.app',
    'jira.atlassian.com',
    'confluence.atlassian.com',
    'atlassian.com',
    'atlassian.net',
    'slack.com',
    'zoom.us',
    // ── Linktree / bio link pages ─────────────────────────────────────────────
    'linktr.ee',
    'beacons.ai',
    'carrd.co',
    'bio.link',
    'solo.to',
    'linkt.ree',
    // ── Payment / finance (safe to link, not scam) ────────────────────────────
    'paypal.com','paypal.me',
    'venmo.com','cash.app',
    'stripe.com',
    'ko-fi.com',
    'patreon.com',
    'gofundme.com',
    // ── Misc trusted / popular ────────────────────────────────────────────────
    'archive.org','web.archive.org',
    'namemc.com',
    'plancke.io',
    'sky.shiiyu.moe',
    'coflnet.com',
    'wolfram.com',
    'wolframalpha.com',
    // ── URL shorteners that are provably safe (official/brand-owned) ──────────
    'youtu.be',
    'discord.com',
    // ── Additional GIF / video / media embed CDNs ────────────────────────────
    'gph.is',           // Giphy short links
    'media.giphy.com',
    'i.kym-cdn.com',    // KnowYourMeme
    'knowyourmeme.com',
    'cdn.discordapp.com',
    'images.genius.com',
    'is.gd',            // safe generic shortener
    'v.redd.it',
    // ── Messaging / community platforms ──────────────────────────────────────
    'telegram.org',
    't.me',
    'guilded.gg',
    'revolt.chat',
    'matrix.org',
    'element.io',
    'signal.org',
    // ── Common image search / stock photo ─────────────────────────────────────
    'images.google.com',
    'search.google.com',
    'photos.app.goo.gl',
    'goo.gl',
    'lens.google.com',
    // ── Additional safe hosting / app platforms ───────────────────────────────
    'repl.it',
    'onrender.com',
    'up.railway.app',
    'firebaseio.com',
    'web.app',
    // ── AI / LLM tools (commonly shared in gaming communities) ──────────────
    'chat.openai.com',
    'chatgpt.com',
    'openai.com',
    'claude.ai',
    'anthropic.com',
    'gemini.google.com',
    'perplexity.ai',
    'copilot.microsoft.com',
    // ── Top-level social / video (non-Western markets common in BF) ──────────
    'bilibili.com',
    'nicovideo.jp',
    'weibo.com',
    'qq.com',
    'youku.com',
    'twitch.com',     // some users type .com
    // ── Commonly shared in Discord gaming servers ─────────────────────────────
    'prntscr.com',    // Lightshot screenshot
    'screencast.com',
    'share.icloud.com',
    'photos.app.goo.gl',
    'drive.google.com',
    'dropbox.com',
    'dropboxusercontent.com',
    'dl.dropboxusercontent.com',
    'box.com',
    'box.net',
    'wetransfer.com',
    'we.tl',
    // ── Major websites people link in servers ─────────────────────────────────
    'amazon.com',
    'ebay.com',
    'walmart.com',
    'target.com',
    'bestbuy.com',
    'newegg.com',
    'bhphotovideo.com',
    'etsy.com',
    'aliexpress.com',
    'temu.com',
    'shein.com',
    // ── Secure info / reference ───────────────────────────────────────────────
    'cve.mitre.org',
    'nvd.nist.gov',
    'nist.gov',
    'cert.org',
    'owasp.org',
    // ── Popular Discord bot / utility sites ───────────────────────────────────
    'top.gg',
    'discordbotlist.com',
    'discordservers.com',
    'disboard.org',
    'discord.boats',
    'mee6.xyz',
    'carl.gg',
    'dynobot.net',
    'arcane-bot.com',
    'probot.io',
    'statbot.net',
    'combot.org',
    'wick.fun',
    'zeppelin.gg',
    'atlas.bot',
    'combot.org',
    'cleanbot.xyz',
    'hammertime.cyou',
    'discordbotlist.com',
    'discordstatus.com',
    'statuspage.io',
    // ── VirusTotal / safe-link checkers ──────────────────────────────────────
    'virustotal.com',
    'urlvoid.com',
    'sucuri.net',
    'isitphishing.ai',
    'phishtank.com',
    // ── Additional common image/video CDNs ────────────────────────────────────
    'imagekit.io',
    'imgix.net',
    'fastly.net',
    'akamaized.net',
    'akamai.com',
    'akamaihd.net',
    'llnwd.net',
    'edgecastcdn.net',
    'limelight.com',
    'insnw.net',
    'i.ibb.co',
    // ── Commonly shared safe CDN subdomains ───────────────────────────────────
    'cdn.discordapp.com',
    'media.discordapp.net',
    'cdn.betterttv.net',
    'betterttv.com',
    'cdn.frankerfacez.com',
    'frankerfacez.com',
    '7tv.app',
    'cdn.7tv.app',
    // ── Google AMP / Google link proxy ───────────────────────────────────────
    'amp.dev',
    'google.com',
    'google-analytics.com',
    // ── Streaming / vods ─────────────────────────────────────────────────────
    'dailymotion.com',
    'vimeo.com',
    'player.vimeo.com',
    'vimeocdn.com',
    'rumble.com',
    'odysee.com',
    'peertube.social',
    'lbry.tv',
    // ── Browser / extension stores ────────────────────────────────────────────
    'chrome.google.com',
    'addons.mozilla.org',
    'addons.opera.com',
    'microsoftedge.microsoft.com',
    // ── Popular social link aggregators ──────────────────────────────────────
    'allmylinks.com',
    'taplink.cc',
    'lnk.bio',
    'hoo.be',
    'campsite.bio',
    'stan.store',
    'koji.com',

    // ── Additional image / media hosts ───────────────────────────────────────────
'imgbox.com',
'thumbs.imgbox.com',
'imagebam.com',
'imagevenue.com',
'imgpile.com',
'imgsafe.org',
'pixhost.to',
'postimages.org',
'imageupload.io',
'imageban.ru',
'imageupper.com',
'imgdrive.net',
'imagecurl.org',

// ── More GIF / meme / reaction platforms ─────────────────────────────────────
'reactiongifs.com',
'reactionimages.me',
'memedroid.com',
'imgflip.com',
'kapwing.com',
'makeameme.org',

// ── More video / clip / streaming hosts ──────────────────────────────────────
'ok.ru',
'okcdn.ru',
'streamja.com',
'streamff.com',
'vidyard.com',
'jwplayer.com',
'jwplatform.com',
'brightcove.com',
'cdn.jwplayer.com',

// ── File sharing / uploads (safe/common) ─────────────────────────────────────
'mega.nz',
'mega.io',
'anonfiles.com',
'file.io',
'ufile.io',
'upload.ee',
'fileditch.com',
'pixeldrain.com',
'pixeldrain.dev',
'transfer.sh',
'sendgb.com',
'sendspace.com',
'zippyshare.com',
'mediafire.com',
'4shared.com',

// ── Paste / code sharing (more) ──────────────────────────────────────────────
'ghostbin.com',
'controlc.com',
'dpaste.org',
'justpaste.it',
'paste.ee',
'paste2.org',
'codebeautify.org',

// ── Forums / nerdy communities ───────────────────────────────────────────────
'resetera.com',
'neogaf.com',
'gamefaqs.gamespot.com',
'trueachievements.com',
'truetrophies.com',
'steamdb.info',
'pcgamingwiki.com',
'moddb.com',
'indiedb.com',
'vg247.com',

// ── Anime / manga / otaku stuff ──────────────────────────────────────────────
'myanimelist.net',
'anilist.co',
'kitsu.io',
'crunchyroll.com',
'funimation.com',
'hidive.com',
'aniwave.to',
'9anime.to',

// ── Minecraft / sandbox communities ──────────────────────────────────────────
'planetminecraft.com',
'mcpedl.com',
'spigotmc.org',
'bukkit.org',
'cursecdn.com',

// ── FPS / competitive gaming tools ───────────────────────────────────────────
'tracker.network',
'fortnitetracker.com',
'cod.tracker.gg',
'apex.tracker.gg',
'valoranttracker.gg',
'r6.tracker.network',
'rocketleague.tracker.network',

// ── Speedrunning / challenge / niche gaming ──────────────────────────────────
'splits.io',
'speedrunstats.com',
'therun.gg',

// ── Emulation / ROM-safe communities (non-piracy hosting) ────────────────────
'retroachievements.org',
'emulatorgames.net',
'vimm.net',

// ── Tech / dev / nerd tools ──────────────────────────────────────────────────
'stackblitz.com',
'codeshare.io',
'glot.io',
'ideone.com',
'judge0.com',
'wandbox.org',

// ── Cyber / security / nerd stuff ────────────────────────────────────────────
'haveibeenpwned.com',
'shields.io',
'badge.fury.io',
'securitytrails.com',
'crt.sh',

// ── More hosting / infra ─────────────────────────────────────────────────────
'digitalocean.com',
'linode.com',
'vultr.com',
'oraclecloud.com',
'ovhcloud.com',
'contabo.com',

// ── CDN / asset delivery (more obscure) ──────────────────────────────────────
'stackpathcdn.com',
'quantserve.com',
'cdn.jsdelivr.com',
'cdnjs.com',
'fastlylb.net',
'cdn77.org',

// ── Blogging / writing / docs ────────────────────────────────────────────────
'dev.to',
'hashnode.dev',
'readthedocs.io',
'gitbook.io',
'notion.site',

// ── AI / tools (more niche) ──────────────────────────────────────────────────
'poe.com',
'huggingface.co',
'replicate.com',
'runpod.io',
'jan.ai',

// ── Maps / geo / tracking ────────────────────────────────────────────────────
'openstreetmap.org',
'mapbox.com',
'here.com',
'waze.com',

// ── Alternative socials / communities ────────────────────────────────────────
'cohost.org',
'counter.social',
'plurk.com',
'vk.com',
'vkcdn.net',

// ── Messaging / VOIP extras ──────────────────────────────────────────────────
'teamspeak.com',
'mumble.info',
'ventrilo.com',

// ── Browser-based games / casual ─────────────────────────────────────────────
'poki.com',
'crazygames.com',
'miniclip.com',
'coolmathgames.com',

// ── Hardware / PC building / benchmarks ──────────────────────────────────────
'userbenchmark.com',
'passmark.com',
'cpubenchmark.net',
'gpubenchmark.net',
'pcpartpicker.com',

// ── Shopping / trading (more niche) ──────────────────────────────────────────
'stockx.com',
'grailed.com',
'mercari.com',
'carousell.com',

// ── Crypto / web3 (commonly shared links) ────────────────────────────────────
'coinmarketcap.com',
'coingecko.com',
'etherscan.io',
'bscscan.com',
'polygonscan.com',

// ── URL tools / utilities ────────────────────────────────────────────────────
'wheregoes.com',
'checkshorturl.com',
'redirectdetective.com',

// ── Archive / backups / mirrors ──────────────────────────────────────────────
'archive.ph',
'archive.is',
'ghostarchive.org',

// ── Misc nerd / fun / tools ──────────────────────────────────────────────────
'neal.fun',
'pointerpointer.com',
'zoomquilt.org',
'futureme.org',

// ── Fonts / assets / design ──────────────────────────────────────────────────
'dafont.com',
'fontsquirrel.com',
'1001fonts.com',

// ── Esports / tournaments / orgs ─────────────────────────────────────────────
'liquipedia.net',
'esl.com',
'faceittracker.net',
'esea.net',

// ── Game servers / hosting ───────────────────────────────────────────────────
'aternos.org',
'shockbyte.com',
'bisecthosting.com',

// ── Misc commonly seen CDN/random embeds ─────────────────────────────────────
'cdn.segment.com',
'cdn.optimizely.com',
'cdn.amplitude.com',
'cdn.split.io',

// ── Misc extra link shorteners (reputable) ───────────────────────────────────
'cutt.ly',
'short.io',
'rebrand.ly',

// ── Extra cloud storage / sharing ────────────────────────────────────────────
'pcloud.com',
'sync.com',
'icedrive.net',

// ── Misc educational / reference ─────────────────────────────────────────────
'brilliant.org',
'desmos.com',
'symbolab.com',

// ── Misc gaming communities / hubs ───────────────────────────────────────────
'guildwars2.com',
'warframe.com',
'pathofexile.com',
'runescape.com',

// ── Misc random but commonly linked ──────────────────────────────────────────
'paste.rs',
'envs.sh',
'0x0.st',
'ttm.sh',

// ── Education / learning ─────────────────────────────────────────────────────
'khanacademy.org',
'en.khanacademy.org',
'khanacademy.org',
'khanacademy.nl',
'pt.khanacademy.org',
'es.khanacademy.org',
'fr.khanacademy.org',
'khanacademy.org/api',
'khanacademy.org/humanities',
'khanacademy.org/math',

// ── Math / graphing / calculators ────────────────────────────────────────────
'desmos.com',
'www.desmos.com',
'calculator.desmos.com',
'teacher.desmos.com',
'geometry.desmos.com',

'symbolab.com',
'www.symbolab.com',
'api.symbolab.com',

'geogebra.org',
'www.geogebra.org',
'classic.geogebra.org',

'wolframalpha.com',
'products.wolframalpha.com',

'mathway.com',
'quickmath.com',

// ── Science / simulations ────────────────────────────────────────────────────
'phet.colorado.edu',
'phet-dev.colorado.edu',

// ── Coding / CS learning ─────────────────────────────────────────────────────
'scratch.mit.edu',
'mit.edu',
'appinventor.mit.edu',

'code.org',
'studio.code.org',

'replit.com',
'ghostwriter.replit.com',

'glitch.com',

'codesandbox.io',
'stackblitz.com',

// ── Notes / study / flashcards ───────────────────────────────────────────────
'quizlet.com',
'quizlet.live',

'knowt.com',

'ankiweb.net',

'studocu.com',
'coursehero.com',

// ── Docs / writing / school tools ────────────────────────────────────────────
'overleaf.com',
'latexbase.com',

'grammarly.com',
'app.grammarly.com',

'hemingwayapp.com',

// ── Diagram / whiteboard / visual tools ──────────────────────────────────────
'whiteboard.fi',
'excalidraw.com',
'excalidraw.net',

'draw.io',
'diagrams.net',

// ── File conversion / utility tools ──────────────────────────────────────────
'ilovepdf.com',
'smallpdf.com',
'pdfescape.com',

'remove.bg',

// ── Research / references ────────────────────────────────────────────────────
'scholar.google.com',
'arxiv.org',
'semanticscholar.org',

'jstor.org',

// ── Language learning / writing ──────────────────────────────────────────────
'deepl.com',
'translate.google.com',

'reverso.net',

// ── School platforms (commonly shared links) ─────────────────────────────────
'canvas.instructure.com',
'instructure.com',

'blackboard.com',

'moodle.org',
'moodlecloud.com',

// ── Classroom / assignments ──────────────────────────────────────────────────
'classroom.google.com',
'assignments.google.com',

// ── Misc student tools / random but common ───────────────────────────────────
'tinypng.com',
'compressor.io',

'coolors.co',        // color palettes (design classes etc.)
'colormind.io',

// ── Physics / math visualizers ───────────────────────────────────────────────
'falstad.com',       // circuit simulator
'falstad.net',

'betterexplained.com',

// ── Logic / puzzles / nerdy tools ────────────────────────────────────────────
'brilliant.org',
'ncase.me',

// ── Timers / productivity (shared a lot in study servers) ────────────────────
'pomo.rs',
'tomatotimers.com',
'pomofocus.io',

// ── Extra misc useful school links ───────────────────────────────────────────
'kialo.com',         // debate tool
'perusall.com',

'turnitin.com',
'turnitinuk.com',

    // ── School / education ────────────────────────────────────────────────────
    'khanacademy.org',
    'coursera.org',
    'udemy.com',
    'edx.org',
    'duolingo.com',
    // ── Additional safe game-related sites people post in BF servers ──────────
    'gg.deals',
    'isthereanydeal.com',
    'gameflip.com',
    'playerauctions.com',
    'g2g.com',
    'eldorado.gg',
    'z2u.com',
    'igvault.com',
];

function classifyLinkDomains(domains, gs) {
    const allow = (gs?.linkAllowlistedDomains || []).map(normalizeDomain);
    const deny  = (gs?.linkDenylistedDomains || []).map(normalizeDomain);
    const out = { blocked: [], allowed: [], suspicious: [] };
    for (const dom of domains || []) {
        const d = normalizeDomain(dom);
        if (!d) continue;
        if (domainInList(d, deny)) { out.blocked.push(d); continue; }
        if (SCAM_DOMAIN_BLACKLIST.has(d)) { out.blocked.push(d); continue; }
        if (domainInList(d, COMMON_ALLOWED_DOMAINS)) { out.allowed.push(d); continue; }
        if (LINK_SHORTENERS.has(d) || LINK_SHORTENERS_EXTRA.has(d)) { out.suspicious.push(d); continue; }
        const parts = d.split('.').filter(Boolean);
        const tld = parts.length ? parts[parts.length-1] : '';
        if (tld && SUSPICIOUS_TLDS.has(tld)) { out.suspicious.push(d); continue; }
        if (allow.length && domainInList(d, allow)) { out.allowed.push(d); continue; }
        if (allow.length) { out.blocked.push(d); continue; }
        out.allowed.push(d);
    }
    return out;
}

const ATTACHMENT_SUSPICIOUS_NAME_TOKENS = [
    'nitro','gift','free','giveaway','reward','rewards','promo','promotion','claim','verify','verification','steam','wallet',
    'robux','rbx','roblox','blox','bloxfruits','bloxfruit','discord','token','cookie','roblosecurity','session','login',
    'password','pass','2fa','authenticator','auth','security','support','staff','admin','moderator','mod',
    'invoice','receipt','payment','payout','cashout','cash out','bank','paypal','stripe','crypto','airdrop','metamask',
    'update','urgent','fix','patch','installer','setup','install','verify-now','verify_now','verify-now',
    'launcher','loader','injector','executor','script','macro','autoclicker','auto-clicker','exploit','cheat','hack',
    'keygen','crack','activator','serial','license','licensekey','license-key',
    'proof','vouch','screenshare','ss','recording','clip','video',
    'readme','instructions','howto','how-to','clickme','click-me','openme','open-me',
    'qr','qrcode','qr-code','scan','scanner',
    'chrome','extension','browser','firefox','edge','safari',
    'apk','ipa','dmg','pkg','exe','msi','jar','bat','cmd','ps1','vbs','js','lnk','url',
    'zip','rar','7z','tar','gz','iso','img',
];

function isSuspiciousAttachmentName(name) {
    const n = (name || '').toLowerCase();
    if (!n) return false;
    if (/\.(png|jpg|jpeg|gif|webp|mp4|mov|avi|mp3|wav|txt|pdf)\.(exe|scr|bat|cmd|ps1|vbs|js|jse|jar|msi)$/i.test(n)) return true;
    if (/\.(exe|scr|bat|cmd|ps1|vbs|js|jse|jar|msi)\.(png|jpg|jpeg|gif|webp)$/i.test(n)) return true;
    if (/(\.|_)(exe|scr|bat|cmd|ps1|vbs|js|jse|jar|msi)(\.|_)/i.test(n)) return true;
    if ((n.match(/\./g) || []).length >= 3 && /\.(exe|scr|bat|cmd|ps1|vbs|js|jse|jar|msi)$/i.test(n)) return true;
    for (const t of ATTACHMENT_SUSPICIOUS_NAME_TOKENS) {
        if (t.length >= 4 && n.includes(t)) return true;
    }
    return false;
}

function maxCharRun(text) {
    const s = String(text || '');
    let max = 0;
    let run = 0;
    let last = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === last) run++;
        else { last = ch; run = 1; }
        if (run > max) max = run;
    }
    return max;
}

function maxPunctRun(text) {
    const s = String(text || '');
    const only = s.replace(/[^!?.,:;~\-_=+*#@$/\\|]/g, ' ');
    return maxCharRun(only);
}

function maxRepeatedWordCount(text) {
    const words = (String(text || '').toLowerCase().match(/[a-z0-9']+/g) || []);
    if (!words.length) return 0;
    let max = 1;
    let run = 1;
    for (let i = 1; i < words.length; i++) {
        if (words[i] === words[i-1]) run++;
        else run = 1;
        if (run > max) max = run;
    }
    return max;
}

function detectStretchSpam(text, gs) {
    const s = String(text || '');
    if (!s) return null;
    const maxChar = Math.max(6, Math.min(40, gs.stretchMaxCharRun || 12));
    const maxPunc = Math.max(6, Math.min(2000, gs.stretchMaxPunctRun || 10));
    const maxWord = Math.max(3, Math.min(20, gs.stretchMaxWordRepeat || 5));
    const charRun = maxCharRun(s);
    if (charRun >= maxChar) return { hit: true, reason: `Repeated character spam (run=${charRun} >= ${maxChar}).` };
    const puncRun = maxPunctRun(s);
    if (puncRun >= maxPunc) return { hit: true, reason: `Repeated punctuation spam (run=${puncRun} >= ${maxPunc}).` };
    const wordRun = maxRepeatedWordCount(s);
    if (wordRun >= maxWord) return { hit: true, reason: `Repeated word spam (run=${wordRun} >= ${maxWord}).` };
    return null;
}

const dupeMessageTracker = new Map();
function recordDupeMessage(uid, guildId, text) {
    const key = `${guildId}:${uid}`;
    const now = Date.now();
    const e = dupeMessageTracker.get(key) || { items: [], last: 0 };
    e.last = now;
    e.items.push({ t: now, v: String(text || '') });
    e.items = e.items.filter(x => now - x.t < 5*60000);
    dupeMessageTracker.set(key, e);
    return e;
}
function detectDupeSpam(uid, guildId, text, gs) {
    const s = String(text || '').trim();
    if (!s) return null;
    const minLen = Math.max(5, Math.min(200, gs.dupeMinLen || 10));
    if (s.length < minLen) return null;
    const windowMs = Math.max(5, Math.min(120, gs.dupeWindowSec || 20)) * 1000;
    const threshold = Math.max(2, Math.min(20, gs.dupeThreshold || 4));
    const norm = fullClean(s).replace(/\s+/g,' ').trim();
    recordDupeMessage(uid, guildId, norm);
    const e = dupeMessageTracker.get(`${guildId}:${uid}`);
    const now = Date.now();
    const recent = (e?.items || []).filter(x => now - x.t <= windowMs);
    const hits = recent.filter(x => x.v === norm).length;
    if (hits >= threshold) return { hit: true, reason: `Duplicate message spam (${hits} repeats in ${Math.round(windowMs/1000)}s).` };
    return null;
}
setInterval(() => {
    const now = Date.now();
    for (const [k, e] of dupeMessageTracker) {
        if (now - (e.last || 0) > 15*60000) dupeMessageTracker.delete(k);
    }
}, 300000);

/**
 * After locking a channel for @everyone, explicitly grant SendMessages: true
 * to every admin/manager role so staff can still talk in the locked channel.
 * Roles with the Administrator flag bypass overrides natively, but manager
 * roles (set via !managerroles) may not have that flag — they need an explicit
 * allow override.
 */
async function grantAdminRolesSendMessages(channel, guild, gs) {
    const managerRoles = Array.isArray(gs.managerRoles) ? gs.managerRoles : [];
    const reason = 'SKYNET V7: Lock — preserving admin access';
    const grantedRoleIds = new Set();

    // 1. Grant explicit SendMessages: true to every configured manager role
    for (const roleId of managerRoles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        try {
            await channel.permissionOverwrites.edit(role, { SendMessages: true }, { reason });
            grantedRoleIds.add(roleId);
        } catch {}
    }

    // 2. Also grant any role that has the Administrator permission flag
    //    (so even roles not in managerRoles but with server-level admin are covered)
    for (const [, role] of guild.roles.cache) {
        if (grantedRoleIds.has(role.id)) continue;
        if (role.permissions.has(PermissionFlagsBits.Administrator)) {
            try {
                await channel.permissionOverwrites.edit(role, { SendMessages: true }, { reason });
            } catch {}
        }
    }
}

/**
 * Reverts the per-role SendMessages: true overrides added by grantAdminRolesSendMessages
 * when a channel is unlocked, so the roles go back to inheriting from the category.
 */
async function revokeAdminRolesSendMessages(channel, guild, gs) {
    const managerRoles = Array.isArray(gs.managerRoles) ? gs.managerRoles : [];
    const reason = 'SKYNET V7: Unlock — removing per-role send overrides';
    const processedRoleIds = new Set();

    for (const roleId of managerRoles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        try {
            await channel.permissionOverwrites.edit(role, { SendMessages: null }, { reason });
            processedRoleIds.add(roleId);
        } catch {}
    }

    for (const [, role] of guild.roles.cache) {
        if (processedRoleIds.has(role.id)) continue;
        if (role.permissions.has(PermissionFlagsBits.Administrator)) {
            try {
                await channel.permissionOverwrites.edit(role, { SendMessages: null }, { reason });
            } catch {}
        }
    }
}

async function unlockGuildTextChannels(guild, gs) {
    const reason = 'SKYNET V7: Raid lockdown manual unlock';
    for (const [, ch] of guild.channels.cache) {
        if (ch.type !== ChannelType.GuildText) continue;
        if (gs.logChannelId && ch.id === gs.logChannelId) continue;
        if (gs.appealsChannelId && ch.id === gs.appealsChannelId) continue;
        try {
            await revokeAdminRolesSendMessages(ch, guild, gs);
            await ch.permissionOverwrites.edit(guild.id, { SendMessages: null }, { reason });
        } catch {}
    }
}

// ══════════════════════════════════════════════════════════
//  AI DETECTION (Claude API)
// ══════════════════════════════════════════════════════════
async function aiDetectViolation(message, categories, gs) {
    if (!AI_ENABLED || !ANTHROPIC_KEY) return null;
    if (!gs?.aiEnabled) return null;
    if (!message?.content || message.content.length < 2) return null;
    try {
        const guildId = message.guild?.id;
        if (!aiRateLimitOk(guildId)) return null;
        const systemPrompt = `You are a moderation AI for a Blox Fruits Discord server. You have deep knowledge of Blox Fruits (the Roblox game).

== BLOX FRUITS KNOWLEDGE ==
FRUITS — Common: Rocket, Spin, Chop, Spring, Bomb, Smoke, Spike, Flame, Kilo | Uncommon: Ice, Sand, Dark, Eagle, Diamond | Rare: Light, Rubber, Ghost, Magma, Quake, Buddha/Buda, Love, Creation, Spider, Sound | Legendary: Phoenix, Portal, Rumble, Lightning, Pain, Blizzard, Gravity, Mammoth, T-Rex, Dough, Shadow, Venom | Mythical: Gas, Spirit, Tiger, Yeti, Kitsune, Control, Dragon, Leopard
GAMEPASSES/PERMS: Dark Blade (Yoru), 2x Money, 2x Mastery, 2x Boss Drops, Fast Boats, Fruit Notifier, Werewolf
SWORDS: CDK (Cursed Dual Katana), TTK (True Triple Katana), Dark Blade, Hallow Scythe, Dragonheart, Tushita, Yama, Midnight Blade, Rengoku, Canvander, Bisento, Koko, Fox Lamp, Wando, Shisui, Saddi, Shark Anchor, Spikey Trident, Warden's Sword, Dual-Headed Blade, Gravity Cane, Buddy Sword, Saber, Pole, Dark Dagger, Jitte, Longsword, Pipe, Soul Cane, Trident, Flail, Iron Mace, Shark Saw, Triple Katana, Twin Hooks, Cutlass, Dual Katana, Katana
BOSSES: Greybeard, Order, Vice Admiral, Saber Expert, Warden, Chief Warden, Swan, Gorilla King, Bobby, The Saw, Mob Leader, Darkbeard, Jeremy, Fajita, Wysper, Thunder God, Magma Admiral, Fishman Lord, Cyborg, Ice Admiral, Diamond, Don Swan, Smoke Admiral, Awakened Ice Admiral, Kilo Admiral, Tide Keeper, Stone, Island Empress, Captain Elephant, Beautiful Pirate, Longma, Cake Queen, Soul Reaper, Indra, Katakuri, Yeti, Cake Prince, Dough King, Tyrant of the Skies, Leviathan, Sea Beast, Unbound Werewolf
FIGHTING STYLES: Combat, Dark Step, Electric, Water Kung Fu, Dragon Breath, Superhuman (SH), Sharkman Karate, Electric Claw (EC), Dragon Talon (DT), Sanguine Art (SA)
RACES: Human, Mink, Shark, Ghoul, Angel, Cyborg, Draco (V2/V3/V4 upgrades via Trials)
ENCHANTS: Sharpness, Hardening, Precision, Vampiric, Elemental, Haste, Critical, Curse, Masterpiece, Rage, Sharpshooter, Strong Grip, Unreal, Sea Blessing, Agile, Deadly, Piercing, Siphon, Lucky, Fortune, Beast, Cool, Efficient
TRADE TERMS: WTT=Want to Trade | WTB=Want to Buy | WTS=Want to Sell | LF=Looking For | WFL=Win/Fair/Loss | MM=Middleman | Perm=Permanent fruit | Notifier=Fruit Notifier gamepass
SERVICES: boss kills, raids, mastery grinding, race V4 trials, CDK/TTK quest help, material farming, fruit awakening, Dragon Talon/Electric Claw unlock
PAIN UPGRADES: Infernal Endurance, Agony Surge, Torment Conductor, Spectral Assimilation
LIGHTNING UPGRADES: Predator Circuit Breaker, Capacitor Overload Test, Conductor's Resonance

== VIOLATION CATEGORIES ==
1. "trade" — Trading fruits/perms/swords/gamepasses/accessories in the wrong channel (correct channel: #trades or designated trade channels). Keywords: WTT, WTB, WTS, LF, swap, offer, trade, perm, notifier, dark blade, etc.
2. "beg" — Begging/asking for FREE fruits, items, Robux with no trade offer. E.g. "can someone give me magma", "pls give free perm", "anyone donate fruit"
3. "acctrade" — Selling, buying, or trading entire Roblox accounts. E.g. "selling my account", "buying accounts", "account for sale"
4. "service" — Requesting or advertising boss kills, raids, mastery grinding, race trials, quest help, farming services in the wrong channel (correct channel: #services). Keywords: "need help with boss", "raid service", "farming service", "race v4 help", "mastery service"
5. "spam" — Repeated messages, excessive emojis, gibberish, or flooding
6. "command" — Using bot commands (!, /, etc.) outside the designated games hub/commands channel
7. "scam" — Sharing suspicious/scam links, fake giveaways, "free perm" websites, verification scams, exploit links
8. "none" — Normal conversation, not a violation

Respond ONLY with valid JSON: {"violation": true/false, "category": "trade|beg|acctrade|service|spam|command|scam|none", "confidence": 0.0-1.0, "reason": "short reason under 20 words"}
Rules: Only flag if confidence > 0.85. Be conservative — do NOT flag: normal chat about the game, asking for tips/advice, sharing screenshots, asking about fruit locations, discussing values without offering to trade, discussing patch notes or updates. DO flag clear trade offers/requests, clear begging, clear service posts, and obvious scam links.`;
        const resJson = await withAiQueue(message.guild?.id, async () => {
            const res = await fetch(AI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_KEY,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    max_tokens: 150,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: `Message: "${message.content}"` }],
                }),
            });
            return await res.json();
        });
        const text = resJson.content?.[0]?.text || '{}';
        const clean = text.replace(/```json|```/g,'').trim();
        return JSON.parse(clean);
    } catch { return null; }
}

// ══════════════════════════════════════════════════════════
//  SPLIT-MESSAGE TRACKING
// ══════════════════════════════════════════════════════════
const _partial = new Map();
function recordPartial(uid, cid, intent, fruit) {
    const existing = _partial.get(uid) || {};
    _partial.set(uid, { has_intent: (existing.has_intent||false)||intent, has_fruit: (existing.has_fruit||false)||fruit, timestamp: Date.now()/1000, channel_id: cid });
}
function getPartial(uid, cid) {
    const e = _partial.get(uid);
    if (!e || e.channel_id !== cid || Date.now()/1000 - e.timestamp > SPLIT_MESSAGE_TTL) { _partial.delete(uid); return null; }
    return e;
}
function clearPartial(uid) { _partial.delete(uid); }
setInterval(() => { const now=Date.now()/1000; for(const[uid,v] of _partial) if(now-v.timestamp>SPLIT_MESSAGE_TTL) _partial.delete(uid); }, 120000);

// ══════════════════════════════════════════════════════════
//  TEXT PREPARATION
// ══════════════════════════════════════════════════════════

// Extract all text from Discord forwarded-message snapshots.
// Forwarding is a major bypass vector — the forwarder's own message.content
// may be empty (no caption) while the forwarded content sits in snapshots.
function extractSnapshotText(message) {
    const snaps = message?.messageSnapshots;
    if (!snaps || !snaps.size) return '';
    const parts = [];
    for (const [, snap] of snaps) {
        if (snap.content) parts.push(String(snap.content));
        // Also pull text out of any embeds attached to the snapshot
        for (const emb of (snap.embeds || [])) {
            if (emb.title)       parts.push(String(emb.title));
            if (emb.description) parts.push(String(emb.description));
            for (const f of (emb.fields || [])) {
                if (f.name)  parts.push(String(f.name));
                if (f.value) parts.push(String(f.value));
            }
        }
    }
    return parts.join(' ');
}

// Returns whether a message is a forwarded message (has snapshots with content).
function isForwardedMessage(message) {
    const snaps = message?.messageSnapshots;
    return !!(snaps && snaps.size > 0);
}

// prepareText(raw, message?)
//  - raw      : message.content (the sender's own caption, may be empty for forwards)
//  - message  : full Message object (optional) — used to extract forwarded snapshot text
//               and all custom/Nitro emoji names including from forwarded content
//
// Returns { contentClean, contentNospace, emojiNames, hasForward }
// emojiNames  : raw array of custom-emoji slug names (before fullClean) for additional checks
// hasForward  : true when the message is a Discord forward
function prepareText(raw, message) {
    // Pull in forwarded message content so forwards can't bypass any check
    const forwarded  = message ? extractSnapshotText(message) : '';
    const combined   = forwarded ? (raw + ' ' + forwarded) : raw;

    // Strip emoji tags from readable text (replaced with placeholder)
    let textOnly = combined.replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, ' __EMOJI__ ')
                            .replace(/<@!?\d+>/g, ' ');

    // Collect ALL custom/Nitro emoji names (from both caption and forwarded content).
    // These are appended to the scanned string so e.g. :need_magma_trade: → "need magma trade"
    // and Nitro external-server emojis get their names checked just like local ones.
    const emojiNames = [...combined.toLowerCase().matchAll(/<a?:([a-zA-Z0-9_]+):\d+>/g)].map(m => m[1]);

    const contentClean   = fullClean(textOnly + ' ' + emojiNames.join(' '));
    const contentNospace = contentClean.replace(/[\s_]/g, '');
    return { contentClean, contentNospace, emojiNames, hasForward: isForwardedMessage(message) };
}

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS DEFINITION
// ══════════════════════════════════════════════════════════
const slashCommands = [
    // Setup wizard
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure SKYNET for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('open').setDescription('Open the setup wizard to configure channels and settings'))
        .addSubcommand(s => s.setName('completeset').setDescription('Mark setup complete — enables ALL detections (except caps/stretch/no-affiliation)'))
        .addSubcommand(s => s.setName('status').setDescription('Show current setup and detection status')),

    // Set individual channels
    new SlashCommandBuilder()
        .setName('set')
        .setDescription('Set individual bot configuration values')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub => sub.setName('tradechannel').setDescription('Set the trades channel')
            .addChannelOption(o => o.setName('channel').setDescription('Trade channel').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Trade channel ID').setRequired(false)))
        .addSubcommand(sub => sub.setName('serviceschannel').setDescription('Set the services/raid channel')
            .addChannelOption(o => o.setName('channel').setDescription('Services channel').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Services channel ID').setRequired(false)))
        .addSubcommand(sub => sub.setName('commandchannel').setDescription('Set the commands/games hub channel')
            .addChannelOption(o => o.setName('channel').setDescription('Commands channel').setRequired(false))
            .addStringOption(o => o.setName('id').setDescription('Commands channel ID').setRequired(false)))
        .addSubcommand(sub => sub.setName('logchannel').setDescription('Set the log channel')
            .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)))
        .addSubcommand(sub => sub.setName('exilerole').setDescription('Set the exile role')
            .addRoleOption(o => o.setName('role').setDescription('Exile role').setRequired(true)))
        .addSubcommand(sub => sub.setName('appealschannel').setDescription('Set the appeals channel')
            .addChannelOption(o => o.setName('channel').setDescription('Appeals channel').setRequired(true)))
        .addSubcommand(sub => sub.setName('prefix').setDescription('Set the message command prefix (e.g. g!, A!, §, ,)')
            .addStringOption(o => o.setName('prefix').setDescription('New prefix — any string up to 5 chars').setRequired(true))),

    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear/unset channel configuration values')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub => sub.setName('tradechannel').setDescription('Clear the trades channel override'))
        .addSubcommand(sub => sub.setName('serviceschannel').setDescription('Clear the services channel override'))
        .addSubcommand(sub => sub.setName('commandchannel').setDescription('Clear the commands/games hub channel override')),

    // Exile channel create
    new SlashCommandBuilder()
        .setName('exilechannel')
        .setDescription('Create and configure an exile channel')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub => sub.setName('create').setDescription('Auto-create an exile channel')),

    // Exile role create
    new SlashCommandBuilder()
        .setName('exilerole')
        .setDescription('Create and configure the exile role')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub => sub.setName('create').setDescription('Auto-create an exile role')),

    // Exile config
    new SlashCommandBuilder()
        .setName('exileconfig')
        .setDescription('Configure exile system settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub => sub
            .setName('setrole')
            .setDescription('Set the exile role')
            .addRoleOption(o => o.setName('role').setDescription('The role to assign to exiled members').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('striproles')
            .setDescription('Toggle whether ALL roles are stripped (not restored) when a member is exiled')
            .addStringOption(o => o.setName('toggle').setDescription('on or off').setRequired(true)
                .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
        .addSubcommand(sub => sub
            .setName('removerole')
            .setDescription('ON: remove roles on exile & restore after. OFF: only add/remove exile role.')
            .addStringOption(o => o.setName('toggle').setDescription('on or off').setRequired(true)
                .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))),

    // Immunity (all sub-commands merged into one)
    new SlashCommandBuilder()
        .setName('immunity')
        .setDescription('Manage staff/role/member immunity from moderation')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable staff/mod immunity from all moderation actions'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable staff/mod immunity (everyone scanned)'))
        .addSubcommand(s => s.setName('status').setDescription('Show current immunity settings'))
        .addSubcommandGroup(g => g.setName('add').setDescription('Add to immunity whitelist')
            .addSubcommand(s => s.setName('role').setDescription('Add a role to the immunity whitelist')
                .addRoleOption(o => o.setName('role').setDescription('Role to whitelist').setRequired(true)))
            .addSubcommand(s => s.setName('member').setDescription('Add a specific member to the immunity whitelist')
                .addUserOption(o => o.setName('user').setDescription('Member to whitelist').setRequired(true))))
        .addSubcommandGroup(g => g.setName('remove').setDescription('Remove from immunity whitelist')
            .addSubcommand(s => s.setName('role').setDescription('Remove a role from the immunity whitelist')
                .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)))
            .addSubcommand(s => s.setName('member').setDescription('Remove a member from the immunity whitelist')
                .addUserOption(o => o.setName('user').setDescription('Member to remove').setRequired(true)))),

    new SlashCommandBuilder()
        .setName('aienable')
        .setDescription('Configure AI detection for this server (enable/disable/model)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('on').setDescription('Enable AI detection (keep current model)'))
        .addSubcommand(s => s.setName('off').setDescription('Disable AI detection for this server'))
        .addSubcommand(s => s
            .setName('model')
            .setDescription('Enable AI detection and choose a chat AI model')
            .addStringOption(o => o
                .setName('provider')
                .setDescription('AI chat model to use')
                .setRequired(true)
                .addChoices(
                    { name: 'Groq — llama-3.3-70b-versatile (default)', value: 'groq' },
                    { name: 'Groq — llama-3.1-70b-versatile', value: 'groq-llama31' },
                    { name: 'Groq — mixtral-8x7b-32768', value: 'groq-mixtral' },
                    { name: 'Groq — openai/gpt-oss-120b', value: 'groq-gpt-oss' },
                    { name: 'OpenAI — gpt-4o', value: 'openai-gpt4o' },
                    { name: 'OpenAI — gpt-4o-mini', value: 'openai-gpt4omini' },
                    { name: 'Claude — claude-haiku-4-5 (fast, default)', value: 'claude' },
                    { name: 'Claude — claude-sonnet-4-6 (balanced)', value: 'claude-sonnet' },
                    { name: 'Claude — claude-opus-4-6 (powerful)', value: 'claude-opus' },
                ))),

    new SlashCommandBuilder()
        .setName('check')
        .setDescription('Enable or disable ALL moderation checks for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable all moderation checks'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable all moderation checks'))
        .addSubcommand(s => s.setName('status').setDescription('Show whether checks are on or off')),

    new SlashCommandBuilder()
        .setName('noaffiliation')
        .setDescription('Replace trade/service redirects with a no-affiliation notice')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable no-affiliation mode'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable no-affiliation mode')),

    new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the admin dashboard')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('policypreset')
        .setDescription('Apply a policy preset strict|balanced|soft|monitor')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('preset').setDescription('strict|balanced|soft|monitor').setRequired(true)),

    new SlashCommandBuilder()
        .setName('strictness')
        .setDescription('Set detection strictness level (1=least, 10=most)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addIntegerOption(o => o.setName('level').setDescription('1-10').setRequired(true)),

    new SlashCommandBuilder()
        .setName('case')
        .setDescription('Case management')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addSubcommand(s => s.setName('view').setDescription('View a case by ID')
            .addStringOption(o => o.setName('id').setDescription('Case ID').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('List recent cases (optionally for a user)')
            .addUserOption(o => o.setName('user').setDescription('User').setRequired(false)))
        .addSubcommand(s => s.setName('note').setDescription('Add a note to a case')
            .addStringOption(o => o.setName('id').setDescription('Case ID').setRequired(true))
            .addStringOption(o => o.setName('text').setDescription('Note text').setRequired(true)))
        .addSubcommand(s => s.setName('void').setDescription('Void a case')
            .addStringOption(o => o.setName('id').setDescription('Case ID').setRequired(true))
            .addStringOption(o => o.setName('reason').setDescription('Why it was voided').setRequired(true))),

    new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('Appeals system')
        .addSubcommand(s => s.setName('submit').setDescription('Submit an appeal')
            .addStringOption(o => o.setName('text').setDescription('Appeal text').setRequired(true))
            .addStringOption(o => o.setName('case').setDescription('Optional case ID').setRequired(false))),

    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Show information about the bot'),

    new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Show current moderation configuration for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('policymode')
        .setDescription('Set enforcement mode (enforce vs monitor/log-only)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('mode').setDescription('enforce|monitor').setRequired(true)),
    new SlashCommandBuilder()
        .setName('policyset')
        .setDescription('Set per-category policy action')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('category').setDescription('spam|scam|command|trade|service|beg|acctrade').setRequired(true))
        .addStringOption(o => o.setName('action').setDescription('warn|delete|timeout|exile|log').setRequired(true))
        .addIntegerOption(o => o.setName('minutes').setDescription('Timeout minutes (only used for timeout)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('policystatus')
        .setDescription('Show current per-category policy configuration')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('messagecommandslist')
        .setDescription('List all message commands with a short description'),
    new SlashCommandBuilder()
        .setName('slashcommandslist')
        .setDescription('List all slash commands with a short description'),
    new SlashCommandBuilder()
        .setName('uptime')
        .setDescription('Show bot uptime and process info'),

    new SlashCommandBuilder()
        .setName('calc')
        .setDescription('Calc CLI calculation (multi-line: send more, then Evaluate)')
        .addStringOption(o => o.setName('expression').setDescription("Expression, or type 'Evaluate' to run accumulated input").setRequired(true)),
    new SlashCommandBuilder()
        .setName('wolf')
        .setDescription('Ask Online (multi-line: send more, then Evaluate)')
        .addStringOption(o => o.setName('question').setDescription("Question, or type 'Evaluate' to run accumulated input").setRequired(true)),
    new SlashCommandBuilder()
        .setName('supercalc')
        .setDescription('Run superqalc_onefile (multi-line: send more, then Evaluate)')
        .addStringOption(o => o.setName('expression').setDescription("Expression, or type 'Evaluate' to run accumulated input").setRequired(true)),
    new SlashCommandBuilder()
        .setName('supertower')
        .setDescription('Run superqalc_tower (multi-line: send more, then Evaluate)')
        .addStringOption(o => o.setName('expression').setDescription("Expression, or type 'Evaluate' to run accumulated input").setRequired(true)),
    new SlashCommandBuilder()
        .setName('gaypy')
        .setDescription('Evaluate using damn code (multi-line: send more, then Evaluate)')
        .addStringOption(o => o.setName('expression').setDescription("Expression, or type 'Evaluate' to run accumulated input").setRequired(true)),
    new SlashCommandBuilder()
        .setName('mpmath')
        .setDescription('Evaluate an mpmath 1.4.1 expression (isolated from sympy) with arbitrary precision')
        .addStringOption(o => o.setName('expression').setDescription('Python expression — mpmath and mp are in scope. e.g. mpmath.sqrt(2)').setRequired(true))
        .addIntegerOption(o => o.setName('precision').setDescription('Decimal places of precision (default 50, unlimited)').setRequired(false).setMinValue(1)),

    new SlashCommandBuilder()
        .setName('diagnose')
        .setDescription('Diagnose bot permissions and configuration for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Export/import/backup/restore server config')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('export').setDescription('Export this server configuration as JSON'))
        .addSubcommand(s => s.setName('import').setDescription('Import this server configuration from JSON')
            .addStringOption(o => o.setName('json').setDescription('JSON payload').setRequired(true)))
        .addSubcommand(s => s.setName('backup').setDescription('Create a backup snapshot of the data file now'))
        .addSubcommand(s => s.setName('list').setDescription('List available backups'))
        .addSubcommand(s => s.setName('restore').setDescription('Restore from a backup filename')
            .addStringOption(o => o.setName('file').setDescription('Backup filename from /config list').setRequired(true))),

    new SlashCommandBuilder()
        .setName('setowner')
        .setDescription('Set the bot owner shown in /botinfo')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('owner').setDescription('Owner user').setRequired(true)),
    new SlashCommandBuilder()
        .setName('clearowner')
        .setDescription('Clear the bot owner (shows open source/community)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('setfooter')
        .setDescription('Set a custom footer shown on bot embeds (optional)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('text').setDescription('Footer text (max 200)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('clearfooter')
        .setDescription('Clear the custom embed footer')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('botinfopublic')
        .setDescription('Control whether /botinfo is public or ephemeral')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('mode').setDescription('on|off').setRequired(true)),

    new SlashCommandBuilder()
        .setName('verifygate')
        .setDescription('Gate posting for new/unverified accounts')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable verification gate'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable verification gate'))
        .addSubcommand(s => s.setName('config').setDescription('Configure verification gate')
            .addIntegerOption(o => o.setName('minaccountdays').setDescription('Minimum account age in days').setRequired(false))
            .addRoleOption(o => o.setName('requiredrole').setDescription('Required role to bypass').setRequired(false))
            .addStringOption(o => o.setName('action').setDescription('delete|warn|timeout').setRequired(false))
            .addIntegerOption(o => o.setName('minutes').setDescription('Timeout minutes (only for timeout)').setRequired(false))),

    new SlashCommandBuilder()
        .setName('timeoutconfig')
        .setDescription('Configure auto-timeout escalation')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable auto-timeouts'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable auto-timeouts'))
        .addSubcommand(s => s.setName('set').setDescription('Set timeout minutes per category')
            .addIntegerOption(o => o.setName('spam').setDescription('Spam minutes').setRequired(false))
            .addIntegerOption(o => o.setName('scam').setDescription('Scam minutes').setRequired(false))
            .addIntegerOption(o => o.setName('command').setDescription('Command abuse minutes').setRequired(false))
            .addIntegerOption(o => o.setName('trade').setDescription('Trade minutes').setRequired(false))
            .addIntegerOption(o => o.setName('service').setDescription('Service minutes').setRequired(false))),

    // Roast config
    new SlashCommandBuilder()
        .setName('roastconfig')
        .setDescription('Configure the !roast command')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('provider')
            .setDescription('Set which AI provider generates roasts')
            .addStringOption(o => o.setName('provider')
                .setDescription('claude | roastedbyai | gpt-oss-120b')
                .setRequired(true)
                .addChoices(
                    { name: 'claude',       value: 'claude' },
                    { name: 'roastedbyai',  value: 'roastedbyai' },
                    { name: 'gpt-oss-120b',  value: 'groq' },
                )))
        .addSubcommand(s => s.setName('context')
            .setDescription("Toggle whether the target's last 5 messages are used as roast context")
            .addStringOption(o => o.setName('toggle')
                .setDescription('on or off')
                .setRequired(true)
                .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
        .addSubcommand(s => s.setName('status')
            .setDescription('Show current roast configuration')),

    new SlashCommandBuilder()
        .setName('commandimmunity')
        .setDescription('Manage immunity for command scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),
    new SlashCommandBuilder()
        .setName('serviceimmunity')
        .setDescription('Manage immunity for service scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),
    new SlashCommandBuilder()
        .setName('tradeimmunity')
        .setDescription('Manage immunity for trade scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),
    new SlashCommandBuilder()
        .setName('spamimmunity')
        .setDescription('Manage immunity for spam scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),
    new SlashCommandBuilder()
        .setName('begimmunity')
        .setDescription('Manage immunity for begging scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),
    new SlashCommandBuilder()
        .setName('scamimmunity')
        .setDescription('Manage immunity for scam scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),
    new SlashCommandBuilder()
        .setName('acctradeimmunity')
        .setDescription('Manage immunity for account trading scanning')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g.setName('role').setDescription('Manage role immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove role immunity')
                .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List role immunity')))
        .addSubcommandGroup(g => g.setName('member').setDescription('Manage member immunity')
            .addSubcommand(s => s.setName('add').setDescription('Add member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('remove').setDescription('Remove member immunity')
                .addUserOption(o => o.setName('member').setDescription('Member').setRequired(true)))
            .addSubcommand(s => s.setName('list').setDescription('List member immunity'))),

    // Exile / unexile slash
    new SlashCommandBuilder()
        .setName('exile')
        .setDescription('Exile a member')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Member to exile').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Duration: 30s, 10m, 2h, 1d, 1w — default 45m').setRequired(false))
        .addStringOption(o => o.setName('reason').setDescription('Reason for exile').setRequired(false)),
    new SlashCommandBuilder()
        .setName('unexile')
        .setDescription('Unexile a member by user or ID')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('user').setDescription('User mention or Discord ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('aimodel')
        .setDescription('Configure which AI provider/model is used when the bot is active (toggleactive)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o
            .setName('provider')
            .setDescription('AI provider to use (default: Groq)')
            .setRequired(true)
            .addChoices(
                { name: 'Groq — llama-3.3-70b-versatile (default)', value: 'groq' },
                { name: 'Groq — llama-3.1-70b-versatile', value: 'groq-llama31' },
                { name: 'Groq — mixtral-8x7b-32768', value: 'groq-mixtral' },
                { name: 'Groq — openai/gpt-oss-120b', value: 'groq-gpt-oss' },
                { name: 'OpenAI — gpt-4o', value: 'openai-gpt4o' },
                { name: 'OpenAI — gpt-4o-mini', value: 'openai-gpt4omini' },
                { name: 'Claude — claude-haiku-4-5 (fast, default)', value: 'claude' },
                { name: 'Claude — claude-sonnet-4-6 (balanced)', value: 'claude-sonnet' },
                { name: 'Claude — claude-opus-4-6 (powerful)', value: 'claude-opus' },
            )),

    new SlashCommandBuilder()
        .setName('bloxmode')
        .setDescription('Toggle Blox Fruits-specific AI mode for this bot (off = general assistant)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o
            .setName('mode')
            .setDescription('on = Blox Fruits expert, off = general assistant')
            .setRequired(true)
            .addChoices(
                { name: '🍎 On — Blox Fruits expert mode', value: 'on' },
                { name: '🤖 Off — General assistant mode', value: 'off' },
            )),

    // Violations
    new SlashCommandBuilder()
        .setName('violations')
        .setDescription('Check a member\'s violation count')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addUserOption(o => o.setName('user').setDescription('Member to check').setRequired(true)),
    new SlashCommandBuilder()
        .setName('clearviolations')
        .setDescription('Clear a member\'s violations')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Member to clear').setRequired(true)),

    // Exilelist
    new SlashCommandBuilder()
        .setName('exilelist')
        .setDescription('List all currently exiled members')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    // Scan test
    new SlashCommandBuilder()
        .setName('testscan')
        .setDescription('Test the scanner on a message')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(o => o.setName('text').setDescription('Text to scan').setRequired(true)),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Add a violation strike to a member')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unwarn')
        .setDescription('Remove 1 violation strike from a member')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk delete messages in the current channel')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addSubcommand(sub => sub
            .setName('count')
            .setDescription('Delete the last N messages from this channel')
            .addIntegerOption(o => o.setName('amount').setDescription('How many messages to delete (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
        )
        .addSubcommand(sub => sub
            .setName('user')
            .setDescription('Delete the last N messages from a specific user in this channel')
            .addUserOption(o => o.setName('user').setDescription('The user whose messages to purge').setRequired(true))
            .addIntegerOption(o => o.setName('amount').setDescription('Max messages to scan (1–100, default 50)').setRequired(false).setMinValue(1).setMaxValue(100))
        ),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock the current channel — ONLY admins can send messages after locking')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock the current channel (restore @everyone SendMessages)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('setgameshub')
        .setDescription('Set the Games Hub channel used for command redirects')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Games Hub channel').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setthreshold')
        .setDescription('Set the violation threshold before exile (admin only)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addIntegerOption(o => o.setName('count').setDescription('Threshold (1-10)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setexileduration')
        .setDescription('Set default exile duration in minutes (admin only)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addIntegerOption(o => o.setName('minutes').setDescription('Minutes (1-1440)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('exileduration')
        .setDescription('Manage the default exile duration')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s
            .setName('set')
            .setDescription('Set the default exile duration (supports 30s, 10m, 2h, 1d, 1w)')
            .addStringOption(o => o
                .setName('duration')
                .setDescription('e.g. 45m, 2h, 1d, 30s — no limit enforced')
                .setRequired(true)))
        .addSubcommand(s => s
            .setName('status')
            .setDescription('Show the current default exile duration')),

    new SlashCommandBuilder()
        .setName('togglescam')
        .setDescription('Toggle scam/exploit detection for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)),

    // ── /bloxfruits — unified Blox Fruits redirect/config command ──
    new SlashCommandBuilder()
        .setName('bloxfruits')
        .setDescription('Manage all Blox Fruits redirect and enforcement settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommandGroup(g => g
            .setName('redirect')
            .setDescription('Enable or disable channel redirect enforcement')
            .addSubcommand(s => s.setName('enable').setDescription('Enable ALL redirects (trade + service + command) at once'))
            .addSubcommand(s => s.setName('disable').setDescription('Disable ALL redirects (trade + service + command) at once'))
            .addSubcommand(s => s.setName('status').setDescription('Show current status of all redirect settings'))
        )
        .addSubcommandGroup(g => g
            .setName('trade')
            .setDescription('Trade redirect settings')
            .addSubcommand(s => s.setName('enable').setDescription('Enable trade redirect enforcement'))
            .addSubcommand(s => s.setName('disable').setDescription('Disable trade redirect enforcement'))
            .addSubcommand(s => s.setName('status').setDescription('Show trade redirect status'))
        )
        .addSubcommandGroup(g => g
            .setName('service')
            .setDescription('Service redirect settings')
            .addSubcommand(s => s.setName('enable').setDescription('Enable service redirect enforcement'))
            .addSubcommand(s => s.setName('disable').setDescription('Disable service redirect enforcement'))
            .addSubcommand(s => s.setName('status').setDescription('Show service redirect status'))
        )
        .addSubcommandGroup(g => g
            .setName('command')
            .setDescription('Command redirect settings')
            .addSubcommand(s => s.setName('enable').setDescription('Enable command redirect enforcement'))
            .addSubcommand(s => s.setName('disable').setDescription('Disable command redirect enforcement'))
            .addSubcommand(s => s.setName('status').setDescription('Show command redirect status'))
        )
        .addSubcommandGroup(g => g
            .setName('warn')
            .setDescription('Enable or disable specific warning categories')
            .addSubcommand(s => s.setName('trade').setDescription('Toggle trade warnings').addBooleanOption(o => o.setName('enabled').setDescription('on/off').setRequired(true)))
            .addSubcommand(s => s.setName('service').setDescription('Toggle service warnings').addBooleanOption(o => o.setName('enabled').setDescription('on/off').setRequired(true)))
            .addSubcommand(s => s.setName('beg').setDescription('Toggle begging warnings').addBooleanOption(o => o.setName('enabled').setDescription('on/off').setRequired(true)))
            .addSubcommand(s => s.setName('scam').setDescription('Toggle scam warnings').addBooleanOption(o => o.setName('enabled').setDescription('on/off').setRequired(true)))
            .addSubcommand(s => s.setName('spam').setDescription('Toggle spam warnings').addBooleanOption(o => o.setName('enabled').setDescription('on/off').setRequired(true)))
            .addSubcommand(s => s.setName('acctrade').setDescription('Toggle account trading warnings').addBooleanOption(o => o.setName('enabled').setDescription('on/off').setRequired(true)))
        )
        .addSubcommand(s => s
            .setName('status')
            .setDescription('Show full Blox Fruits moderation dashboard for this server')
        ),

    // Raid (merged into /raid)
    new SlashCommandBuilder()
        .setName('raid')
        .setDescription('Manage raid mode and protection settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('mode')
            .setDescription('Enable/disable raid mode')
            .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)))
        .addSubcommand(s => s.setName('status')
            .setDescription('Show raid-mode status and current join spike window'))
        .addSubcommand(s => s.setName('config')
            .setDescription('Configure raid protection thresholds')
            .addIntegerOption(o => o.setName('window').setDescription('Join window seconds (5-120)').setRequired(false))
            .addIntegerOption(o => o.setName('threshold').setDescription('Joins in window to trigger (2-50)').setRequired(false))
            .addIntegerOption(o => o.setName('lockdown').setDescription('Lockdown minutes (1-60)').setRequired(false))
            .addBooleanOption(o => o.setName('lockchannels').setDescription('Lock channels on trigger').setRequired(false))
            .addBooleanOption(o => o.setName('blocklinks').setDescription('Block all links during lockdown').setRequired(false))
            .addIntegerOption(o => o.setName('newacctdays').setDescription('Treat accounts younger than X days as risky (0-90)').setRequired(false))
            .addChannelOption(o => o.setName('notify').setDescription('Notify channel for raid alerts').setRequired(false)))
        .addSubcommand(s => s.setName('unlockdown')
            .setDescription('Disable raid lockdown and optionally unlock channels')
            .addBooleanOption(o => o.setName('unlockchannels').setDescription('Unlock channels (@everyone SendMessages)').setRequired(false))),

    // Link policy (merged into /link)
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Manage link policy settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('policy')
            .setDescription('Enable/disable link policy (allowlist/denylist)')
            .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)))
        .addSubcommand(s => s.setName('mode')
            .setDescription('Set link scanning mode')
            .addStringOption(o => o.setName('mode').setDescription('strict|medium|off').setRequired(true)
                .addChoices({ name: 'strict', value: 'strict' }, { name: 'medium', value: 'medium' }, { name: 'off', value: 'off' })))
        .addSubcommand(s => s.setName('action')
            .setDescription('Set action taken on link violation')
            .addStringOption(o => o.setName('action').setDescription('delete|warn|exile|timeout').setRequired(true)
                .addChoices({ name: 'delete', value: 'delete' }, { name: 'warn', value: 'warn' }, { name: 'exile', value: 'exile' }, { name: 'timeout', value: 'timeout' }))
            .addIntegerOption(o => o.setName('minutes').setDescription('Timeout duration in minutes').setRequired(false)))
        .addSubcommand(s => s.setName('status').setDescription('Show link policy status and domain counts'))
        .addSubcommand(s => s.setName('list').setDescription('List all allowlisted and denylisted domains'))
        .addSubcommand(s => s.setName('allow')
            .setDescription('Allowlist a domain')
            .addStringOption(o => o.setName('domain').setDescription('Domain (example.com)').setRequired(true)))
        .addSubcommand(s => s.setName('deny')
            .setDescription('Denylist a domain')
            .addStringOption(o => o.setName('domain').setDescription('Domain (example.com)').setRequired(true)))
        .addSubcommand(s => s.setName('remove')
            .setDescription('Remove a domain from allowlist or denylist')
            .addStringOption(o => o.setName('list').setDescription('allow or deny').setRequired(true)
                .addChoices({ name: 'allow', value: 'allow' }, { name: 'deny', value: 'deny' }))
            .addStringOption(o => o.setName('domain').setDescription('Domain (example.com)').setRequired(true))),

    new SlashCommandBuilder()
        .setName('mentionlimit')
        .setDescription('Configure mention spam limits')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addIntegerOption(o => o.setName('limit').setDescription('Total mentions per window (1-30)').setRequired(true))
        .addIntegerOption(o => o.setName('window').setDescription('Window seconds (3-60)').setRequired(false))
        .addIntegerOption(o => o.setName('unique').setDescription('Unique mentions per window (1-30)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('togglescanedits')
        .setDescription('Enable/disable scanning edited messages')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)),

    new SlashCommandBuilder()
        .setName('automodstats')
        .setDescription('Show automod counters for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    new SlashCommandBuilder()
        .setName('capsconfig')
        .setDescription('Configure caps spam settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable caps spam detection').setRequired(false))
        .addIntegerOption(o => o.setName('percent').setDescription('Max caps percent (30-100)').setRequired(false))
        .addIntegerOption(o => o.setName('minletters').setDescription('Min letters before checking (8-80)').setRequired(false))
        .addIntegerOption(o => o.setName('maxrun').setDescription('Max uppercase run length (10-120)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('emojiconfig')
        .setDescription('Configure emoji spam settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable emoji spam detection').setRequired(false))
        .addIntegerOption(o => o.setName('max').setDescription('Max emoji per window (5-60)').setRequired(false))
        .addIntegerOption(o => o.setName('window').setDescription('Window seconds (3-60)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('zalgoconfig')
        .setDescription('Configure zalgo/glitch text detection')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable zalgo detection').setRequired(false))
        .addIntegerOption(o => o.setName('maxmarks').setDescription('Max combining marks (4-80)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('invitepolicy')
        .setDescription('Enable/disable invite policy')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable invite policy').setRequired(true)),

    new SlashCommandBuilder()
        .setName('invitechannel')
        .setDescription('Add/remove an allowed invite channel')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('mode').setDescription('add|remove|list').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(false)),

    new SlashCommandBuilder()
        .setName('attachmentpolicy')
        .setDescription('Enable/disable attachment policy')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable attachment policy').setRequired(true)),

    new SlashCommandBuilder()
        .setName('attachmentext')
        .setDescription('Add/remove/list blocked attachment extensions')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('mode').setDescription('add|remove|list').setRequired(true))
        .addStringOption(o => o.setName('ext').setDescription('Extension (e.g. exe)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('stretchconfig')
        .setDescription('Configure stretch/repeat spam detection')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable stretch spam detection').setRequired(false))
        .addIntegerOption(o => o.setName('maxcharrun').setDescription('Max repeated char run (6-40)').setRequired(false))
        .addIntegerOption(o => o.setName('maxpunctrun').setDescription('Max repeated punct run (6-40)').setRequired(false))
        .addIntegerOption(o => o.setName('maxwordrepeat').setDescription('Max repeated word run (3-20)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('dupeconfig')
        .setDescription('Configure duplicate-message spam detection')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable duplicate spam detection').setRequired(false))
        .addIntegerOption(o => o.setName('window').setDescription('Window seconds (5-120)').setRequired(false))
        .addIntegerOption(o => o.setName('threshold').setDescription('Repeats to trigger (2-20)').setRequired(false))
        .addIntegerOption(o => o.setName('minlen').setDescription('Min message length (5-200)').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('channelconfig')
        .setDescription('Add/remove/list channels for each redirect category')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('add')
            .setDescription('Add a channel to a category pool')
            .addStringOption(o => o.setName('category')
                .setDescription('Category: trade | raid | race | seaevents | mirage | prehistoric | kitsune | leviathan')
                .setRequired(true)
                .addChoices(
                    { name: '🔄 trade  (fast/slow trading, fruit-value…)',          value: 'trade' },
                    { name: '⚔️ raid   (raids, bosses, dungeons, lvling, quests…)', value: 'raid' },
                    { name: '🏁 race   (race-v4, trials, blue gear)',               value: 'race' },
                    { name: '🌊 seaevents  (general sea events)',                   value: 'seaevents' },
                    { name: '🏝️ mirage  (mirage island)',                           value: 'mirage' },
                    { name: '🦕 prehistoric  (prehistoric island)',                  value: 'prehistoric' },
                    { name: '🦊 kitsune  (kitsune island)',                         value: 'kitsune' },
                    { name: '🐉 leviathan  (leviathan, frozen dimension, levi heart)', value: 'leviathan' },
                ))
            .addChannelOption(o => o.setName('channel').setDescription('Channel to add').setRequired(true)))
        .addSubcommand(s => s.setName('remove')
            .setDescription('Remove a channel from a category pool')
            .addStringOption(o => o.setName('category')
                .setDescription('Category: trade | raid | race | seaevents | mirage | prehistoric | kitsune | leviathan')
                .setRequired(true)
                .addChoices(
                    { name: '🔄 trade',       value: 'trade' },
                    { name: '⚔️ raid',         value: 'raid' },
                    { name: '🏁 race',         value: 'race' },
                    { name: '🌊 seaevents',    value: 'seaevents' },
                    { name: '🏝️ mirage',       value: 'mirage' },
                    { name: '🦕 prehistoric',  value: 'prehistoric' },
                    { name: '🦊 kitsune',      value: 'kitsune' },
                    { name: '🐉 leviathan',    value: 'leviathan' },
                ))
            .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
        .addSubcommand(s => s.setName('list')
            .setDescription('List all configured channel pools')),

    // ── /manager — grant/revoke full bot access by role or user ─────────
    new SlashCommandBuilder()
        .setName('manager')
        .setDescription('Grant or revoke full bot access to specific roles or users')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s
            .setName('addrole')
            .setDescription('Grant a role full access to every bot command')
            .addRoleOption(o => o.setName('role').setDescription('Role to grant manager access').setRequired(true)))
        .addSubcommand(s => s
            .setName('removerole')
            .setDescription('Revoke manager access from a role')
            .addRoleOption(o => o.setName('role').setDescription('Role to remove manager access from').setRequired(true)))
        .addSubcommand(s => s
            .setName('adduser')
            .setDescription('Grant a user full access to every bot command')
            .addUserOption(o => o.setName('user').setDescription('User to grant manager access').setRequired(true)))
        .addSubcommand(s => s
            .setName('removeuser')
            .setDescription('Revoke manager access from a user')
            .addUserOption(o => o.setName('user').setDescription('User to remove manager access from').setRequired(true)))
        .addSubcommand(s => s
            .setName('list')
            .setDescription('List all current manager roles and users')),

...(mathMod.mathSlashCommandBuilders || []),

    // ── /timeout ── /untimeout ── /kick ── /ban ── /unban ── /hardban ── /softban ──
    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a member (default: 45 min). Supports repeating chunks for durations > 28 days.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('Member to timeout').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 30m, 2h, 7d, 1w (default: 45m)').setRequired(false))
        .addStringOption(o => o.setName('reason').setDescription('Reason for timeout').setRequired(false)),

    new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove an active timeout from a member')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('Member to un-timeout').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server (no appeal)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers)
        .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for kick').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member (appealable after 14 days; optional duration)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
        .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Optional ban duration e.g. 30d, 1w (leave blank = permanent until unban)').setRequired(false))
        .addStringOption(o => o.setName('reason').setDescription('Reason for ban').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user by ID')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
        .addStringOption(o => o.setName('user').setDescription('User ID or @mention to unban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('hardban')
        .setDescription('Permanently ban a member — no appeal ever')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
        .addUserOption(o => o.setName('user').setDescription('Member to permanently ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for hardban').setRequired(false)),

    new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Softban: ban then immediately unban (purges recent messages, no lasting ban)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
        .addUserOption(o => o.setName('user').setDescription('Member to softban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for softban').setRequired(false)),

    // ── /regex — enable or disable regex-based detection ────────────────────
    new SlashCommandBuilder()
        .setName('regex')
        .setDescription('Enable or disable regex-based detection')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o
            .setName('mode')
            .setDescription('enabled = use regex patterns | disabled = name/alias/shortener matching only')
            .setRequired(true)
            .addChoices(
                { name: 'enabled',  value: 'enabled'  },
                { name: 'disabled', value: 'disabled' },
            )),

].map(c => c.toJSON());

// ══════════════════════════════════════════════════════════
//  READY
// ══════════════════════════════════════════════════════════
let _didReady = false;
async function onClientReady() {
    if (_didReady) return;
    _didReady = true;
    console.log(`🚨 SKYNET V7 ONLINE: ${client.user.username}`);

    // ── Run environment upgrade script on every startup ────────────────────
    try {
        const upgradeProc = spawn('/usr/local/bin/upgrade', [], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });
        upgradeProc.stdout.on('data', d => process.stdout.write(`[upgrade] ${d}`));
        upgradeProc.stderr.on('data', d => process.stderr.write(`[upgrade] ${d}`));
        upgradeProc.on('close', code => {
            if (code === 0) console.log('✅ [upgrade] Environment upgrade completed successfully.');
            else console.error(`⚠️ [upgrade] Upgrade script exited with code ${code}.`);
        });
        upgradeProc.on('error', err => console.error(`⚠️ [upgrade] Failed to spawn upgrade script: ${err.message}`));
    } catch (e) {
        console.error(`⚠️ [upgrade] Could not start upgrade script: ${e.message}`);
    }
    // ───────────────────────────────────────────────────────────────────────
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        const seen = new Set();
        const dups = new Set();
        const unique = [];
        for (const c of (slashCommands || [])) {
            const n = String(c?.name || '').toLowerCase();
            if (!n) continue;
            if (seen.has(n)) { dups.add(n); continue; }
            seen.add(n);
            unique.push(c);
        }
        if (dups.size) {
            console.warn(`⚠️ Duplicate slash command names removed before registration: ${Array.from(dups).join(', ')}`);
        }
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: unique });
        console.log('✅ Slash commands registered');
    } catch(e) { console.error('❌ Slash command registration failed:', e); }

    // Auto-unexile loop
    setInterval(async () => {
        // BUG FIX: load data once for the whole tick; delete from the same object
        // and save once at the end instead of loadData() per-member + loadData() again.
        const data = loadData();
        const now  = Date.now()/1000;
        let dirty = false;
        for (const [uid, info] of Object.entries(data.exiles)) {
            if (now >= info.expiry) {
                for (const guild of client.guilds.cache.values()) {
                    let member = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(()=>null);
                    if (member) {
                        if (await performUnexile(member, guild, data)) {
                            delete data.exiles[uid];
                            dirty = true;
                            await sendLog(guild, data, new EmbedBuilder()
                                .setTitle('🔓 Exile Expired')
                                .setDescription(`<@${uid}> (${uid}) has been automatically unexiled.`)
                                .setColor(0x00FF88)
                                .setTimestamp());
                        }
                        break;
                    }
                }
            }
        }
        if (dirty) saveData(data);
    }, 30000);

    // ── Restore in-progress long-timeout schedulers on restart ────────────────
    try {
        const startupData = loadData();
        if (startupData.timeouts) {
            for (const [gId, byUser] of Object.entries(startupData.timeouts)) {
                for (const [uId, tInfo] of Object.entries(byUser || {})) {
                    if (tInfo && tInfo.endsAt > Date.now()) {
                        scheduleLongTimeout(client, gId, uId, startupData);
                    }
                }
            }
        }
    } catch (e) { console.error('[startup] long-timeout restore error:', e); }

    // ── Auto-unban timed bans loop (checks every 60s) ─────────────────────────
    setInterval(async () => {
        const banData = loadData();
        let dirty2 = false;
        if (banData.bans) {
            for (const [gId, byUser] of Object.entries(banData.bans)) {
                for (const [uId, bInfo] of Object.entries(byUser || {})) {
                    if (bInfo && bInfo.duration && (bInfo.bannedAt + bInfo.duration) <= Date.now()) {
                        try {
                            const g = await client.guilds.fetch(gId).catch(() => null);
                            if (g) await g.bans.remove(uId, 'Temporary ban expired').catch(() => {});
                        } catch {}
                        delete banData.bans[gId][uId];
                        dirty2 = true;
                    }
                }
            }
        }
        if (dirty2) saveData(banData);
    }, 60000);

}

client.once('clientReady', onClientReady);
// NOTE: 'ready' was removed — it's deprecated in discord.js v14+ (renamed to clientReady)

// ══════════════════════════════════════════════════════════
//  INTERACTION HANDLER (slash commands + buttons + modals)
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
    
    if (await mathMod.handleMathInteraction(interaction)) return;
    
    const customId = interaction?.customId || '';
    let derivedGuildId = null;
    if (!interaction.guildId && typeof customId === 'string') {
        if (customId.startsWith('open_appeal_')) {
            const parts = customId.split('_');
            if (parts.length >= 4 && /^\d{15,20}$/.test(parts[2])) derivedGuildId = parts[2];
        }
        if (customId.startsWith('appeal_modal_')) {
            const parts = customId.split('_');
            if (parts.length >= 4 && /^\d{15,20}$/.test(parts[2])) derivedGuildId = parts[2];
        }
        // Warn appeal — button fires in DM, guildId is at parts[3]
        // customId: open_warn_appeal_<guildId>_<warnId>
        if (customId.startsWith('open_warn_appeal_')) {
            const rest = customId.slice('open_warn_appeal_'.length);
            const candidate = rest.split('_')[0];
            if (/^\d{15,20}$/.test(candidate)) derivedGuildId = candidate;
        }
        // Modal submit also fires in DM: warn_appeal_modal_<guildId>_<warnId>
        if (customId.startsWith('warn_appeal_modal_')) {
            const rest = customId.slice('warn_appeal_modal_'.length);
            const candidate = rest.split('_')[0];
            if (/^\d{15,20}$/.test(candidate)) derivedGuildId = candidate;
        }
        // Timeout appeal — fires in DM: open_timeout_appeal_<guildId>_<timeoutId>
        if (customId.startsWith('open_timeout_appeal_')) {
            const rest = customId.slice('open_timeout_appeal_'.length);
            const candidate = rest.split('_')[0];
            if (/^\d{15,20}$/.test(candidate)) derivedGuildId = candidate;
        }
        if (customId.startsWith('timeout_appeal_modal_')) {
            const rest = customId.slice('timeout_appeal_modal_'.length);
            const candidate = rest.split('_')[0];
            if (/^\d{15,20}$/.test(candidate)) derivedGuildId = candidate;
        }
        // Ban appeal — fires in DM: open_ban_appeal_<guildId>_<banId>
        if (customId.startsWith('open_ban_appeal_')) {
            const rest = customId.slice('open_ban_appeal_'.length);
            const candidate = rest.split('_')[0];
            if (/^\d{15,20}$/.test(candidate)) derivedGuildId = candidate;
        }
        if (customId.startsWith('ban_appeal_modal_')) {
            const rest = customId.slice('ban_appeal_modal_'.length);
            const candidate = rest.split('_')[0];
            if (/^\d{15,20}$/.test(candidate)) derivedGuildId = candidate;
        }
    }
    const guildId = interaction.guildId || derivedGuildId;
    if (!guildId) return;

    const earlyCmd = interaction.isChatInputCommand() ? String(interaction.commandName || '') : '';
    const earlyDefer = earlyCmd === 'setowner' || earlyCmd === 'clearowner';
    if (earlyDefer) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}
    }

    const guild = interaction.guild || await client.guilds.fetch(guildId).catch(()=>null);
    if (!guild) return;
    const data = loadData();
    const gs   = getGuildSettings(guildId, data);
    const imm  = getImmunitySettings(guildId, data);

    async function safeDefer(interaction, opts) {
        try {
            if (interaction.deferred || interaction.replied) return true;
            await interaction.deferReply(opts);
            return true;
        } catch { return false; }
    }
    async function safeReply(interaction, payload) {
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload);
                return true;
            }
            await interaction.reply(payload);
            return true;
        } catch { return false; }
    }
    async function safeEdit(interaction, payload) {
        try { await interaction.editReply(payload); return true; } catch { return false; }
    }

    if (interaction.isButton()) {
        const cid = String(interaction.customId || '');
        if (cid.startsWith('rb_stop:')) {
            const key = cid.slice('rb_stop:'.length);
            // key format: guildId:channelId:userId — only the starter can stop it
            const starterId = key.split(':')[2];
            if (interaction.user.id !== starterId) {
                await interaction.reply({ content: '❌ Only the person who started this roast battle can stop it.', flags: MessageFlags.Ephemeral }).catch(()=>{});
                return;
            }
            // Guard: if the battle is already gone, tell them instead of silently no-oping
            if (!roastBattles.has(key)) {
                await interaction.reply({ content: '⚠️ You already stopped the roast battle!', flags: MessageFlags.Ephemeral }).catch(()=>{});
                return;
            }
            await interaction.deferUpdate().catch(()=>{});
            const st = roastBattles.get(key);
            roastBattles.delete(key);
            if (st?.convoId) {
                try { await pyWorker.request('roast_kill', { convoId: st.convoId }); } catch {}
            }
            // Disable the Stop button so spamming it shows the guard above
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rb_stop:${key}`)
                    .setLabel('⏹ Stopped')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
            try { await interaction.editReply({ components: [disabledRow] }); } catch {}
            try { await interaction.channel?.send('🔥 Roast battle ended.'); } catch {}
            return;
        }

        // Appeal modal
        if (interaction.customId.startsWith('open_appeal_')) {
            const parts = interaction.customId.split('_');
            const exiledUserId = parts.length >= 4 ? parts.slice(3).join('_') : interaction.customId.replace('open_appeal_', '');
            const modal = new ModalBuilder()
                .setCustomId(`appeal_modal_${guildId}_${exiledUserId}`)
                .setTitle('📩 Submit an Appeal');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_reason')
                        .setLabel('Why should your exile be lifted?')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMinLength(20)
                        .setMaxLength(1000)
                        .setRequired(true)
                        .setPlaceholder('Explain why you should be unexiled. Be honest and respectful.')
                )
            );
            try {
                await interaction.showModal(modal);
            } catch {
                await safeReply(interaction, { content: '❌ Failed to open the appeal form. Try again.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (cid.startsWith('appeal_accept_')) {
            const isMod = isSuperUser(interaction.user.id) || interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages) || isManagerMember(interaction.member, guildId, data);
            const isAdmin = isSuperUser(interaction.user.id) || interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const appealId = cid.replace('appeal_accept_', '');
            const appeal   = data.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.userId === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ content: '❌ You cannot accept your own appeal.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }

            appeal.status    = 'accepted';
            appeal.handledBy = interaction.user.id;
            // BUG FIX: perform unexile on same `data` object — eliminates double-save race.
            const member = await interaction.guild.members.fetch(appeal.userId).catch(()=>null);
            if (member) {
                await performUnexile(member, interaction.guild, data);
                delete data.exiles[appeal.userId];
            }
            saveData(data);

            if (member) {
                member.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('✅ Appeal Accepted')
                        .setDescription('Your exile appeal has been **accepted**. You have been unexiled.\nPlease make sure to follow the server rules going forward.')
                        .setColor(0x00FF88)
                        .setTimestamp()]
                }).catch(()=>{});
            }

            const updated = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x00FF88)
                .setTitle('📩 Appeal — ACCEPTED ✅')
                .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.update({ embeds: [updated], components: [] });
            return;
        }

        // Reject appeal
        if (cid.startsWith('appeal_reject_')) {
            const appealId = cid.replace('appeal_reject_', '');
            const appeal   = data.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot reject your own appeal.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }

            appeal.status    = 'rejected';
            appeal.handledBy = interaction.user.id;
            saveData(data);

            const member = await interaction.guild.members.fetch(appeal.userId).catch(()=>null);
            if (member) {
                member.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Appeal Rejected')
                        .setDescription('Your exile appeal has been **rejected**.\nPlease wait for your exile to expire or contact a server admin.')
                        .setColor(0xFF4444)
                        .setTimestamp()]
                }).catch(()=>{});
            }

            const updated = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xFF4444)
                .setTitle('📩 Appeal — REJECTED ❌')
                .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.update({ embeds: [updated], components: [] });
            return;
        }
    }

    // ── MODALS ────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
        // Setup modal
        // ── Setup modal page 1 — Core ────────────────────────
        if (interaction.customId === 'setup_modal_p1') {
            function parseIdsP1(raw) {
                return raw.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{15,20}$/.test(s));
            }
            const tradeRaw    = interaction.fields.getTextInputValue('trade_channel_ids').trim();
            const servicesRaw = interaction.fields.getTextInputValue('services_channel_ids').trim();
            const exileRole   = interaction.fields.getTextInputValue('exile_role_id').trim();
            const logId       = interaction.fields.getTextInputValue('log_channel_id').trim();
            const appId       = interaction.fields.getTextInputValue('appeals_channel_id').trim();
            if (tradeRaw !== '') {
                const ids = parseIdsP1(tradeRaw);
                gs.tradeChannelIds = ids;
                if (ids.length > 0) gs.tradeChannelId = ids[0];  // legacy single-ID compat
            }
            if (servicesRaw !== '') {
                const ids = parseIdsP1(servicesRaw);
                gs.servicesChannelIds = ids;
                if (ids.length > 0) gs.servicesChannelId = ids[0];  // legacy single-ID compat
            }
            if (exileRole)  gs.exiledRoleId      = exileRole;
            if (logId)      gs.logChannelId      = logId;
            if (appId)      gs.appealsChannelId  = appId;
            // Channels saved — detections NOT enabled yet. Run /setup completeset when ready.
            saveData(data);
            await interaction.reply({
                embeds: [buildSetupPickerEmbed(gs)
                    .setTitle('✅ Setup — Page 1 Saved')
                    .setColor(0x00FF88)],
                components: buildSetupPickerComponents(),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // ── Setup modal page 2 — Channel Pools ──────────────
        if (interaction.customId === 'setup_modal_p2') {
            function parseIds(raw) {
                return raw.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{15,20}$/.test(s));
            }
            const raidRaw  = interaction.fields.getTextInputValue('raid_channel_ids').trim();
            const raceRaw  = interaction.fields.getTextInputValue('race_channel_ids').trim();
            const seaRaw   = interaction.fields.getTextInputValue('sea_channel_ids').trim();
            const mirRaw   = interaction.fields.getTextInputValue('mirage_channel_ids').trim();
            const pklRaw   = interaction.fields.getTextInputValue('prehistoric_kitsune_levi_ids').trim();

            if (raidRaw !== '')  gs.raidServiceChannelIds     = parseIds(raidRaw);
            if (raceRaw !== '')  gs.raceV4ServiceChannelIds   = parseIds(raceRaw);
            if (seaRaw  !== '')  gs.seaEventsChannelIds       = parseIds(seaRaw);
            if (mirRaw  !== '')  gs.mirageIslandChannelIds    = parseIds(mirRaw);

            // Parse the combined prehistoric/kitsune/leviathan field
            // Accepts lines like:  prehistoric: 111,222   kitsune: 333   leviathan: 444
            // Also handles plain IDs with no prefix (treated as prehistoric for that line)
            if (pklRaw !== '') {
                const preIds  = [];
                const kitIds  = [];
                const leviIds = [];
                for (const line of pklRaw.split(/\n/)) {
                    const clean = line.trim();
                    if (!clean) continue;
                    const prefixMatch = clean.match(/^(prehistoric|kitsune|leviathan|levi|kit|pre)\s*[:\-]?\s*(.+)$/i);
                    if (prefixMatch) {
                        const prefix = prefixMatch[1].toLowerCase();
                        const ids    = parseIds(prefixMatch[2]);
                        if (/^pre/.test(prefix))  preIds.push(...ids);
                        else if (/^kit/.test(prefix)) kitIds.push(...ids);
                        else if (/^le?vi/.test(prefix)) leviIds.push(...ids);
                    } else {
                        // No prefix — treat as prehistoric
                        preIds.push(...parseIds(clean));
                    }
                }
                if (preIds.length)  gs.prehistoricIslandChannelIds = preIds;
                if (kitIds.length)  gs.kitsuneIslandChannelIds     = kitIds;
                if (leviIds.length) gs.leviathanChannelIds         = leviIds;
            }

            saveData(data);
            await interaction.reply({
                embeds: [buildSetupPickerEmbed(gs)
                    .setTitle('✅ Setup — Page 2 Saved')
                    .setColor(0x00FF88)],
                components: buildSetupPickerComponents(),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // ── Setup modal page 3 — Misc ────────────────────────
        if (interaction.customId === 'setup_modal_p3') {
            const hubRaw   = interaction.fields.getTextInputValue('games_hub_ids').trim();
            const exileCh  = interaction.fields.getTextInputValue('exile_channel_id').trim();
            const thresh   = parseInt(interaction.fields.getTextInputValue('violation_threshold').trim()) || 0;
            const dur      = parseInt(interaction.fields.getTextInputValue('exile_duration_mins').trim())  || 0;
            if (hubRaw !== '') {
                const hubIds = hubRaw.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{15,20}$/.test(s));
                if (hubIds.length > 0) {
                    gs.gamesHubIds = hubIds;
                    gs.gamesHubId  = hubIds[0]; // legacy single-ID compat
                }
            }
            if (exileCh) gs.exileChannelId    = exileCh;
            if (thresh)  gs.violationThreshold = Math.max(1, Math.min(10, thresh));
            if (dur)     gs.exileDurationMins  = Math.max(1, Math.min(1440, dur));
            saveData(data);
            await interaction.reply({
                embeds: [buildSetupPickerEmbed(gs)
                    .setTitle('✅ Setup — Page 3 Saved')
                    .setColor(0x00FF88)],
                components: buildSetupPickerComponents(),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // ── Legacy setup_modal (keep for backwards compat) ──
        if (interaction.customId === 'setup_modal') {
            gs.tradeChannelId    = interaction.fields.getTextInputValue('trade_channel_id').trim();
            gs.servicesChannelId = interaction.fields.getTextInputValue('services_channel_id').trim();
            gs.exiledRoleId      = interaction.fields.getTextInputValue('exile_role_id').trim();
            const logId          = interaction.fields.getTextInputValue('log_channel_id').trim();
            const appId          = interaction.fields.getTextInputValue('appeals_channel_id').trim();
            if (logId) gs.logChannelId = logId;
            if (appId) gs.appealsChannelId = appId;
            // Channels saved — detections NOT enabled yet. Run /setup completeset when ready.
            saveData(data);
            await interaction.reply({
                embeds: [buildSetupPickerEmbed(gs).setTitle('✅ SKYNET V7 — Setup Complete').setColor(0x00FF88)],
                components: buildSetupPickerComponents(),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Appeal modal
        if (interaction.customId.startsWith('appeal_modal_')) {
            await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            const parts = interaction.customId.split('_');
            const exiledUserId = parts.length >= 4 ? parts.slice(3).join('_') : interaction.customId.replace('appeal_modal_', '');
            const reason       = interaction.fields.getTextInputValue('appeal_reason');
            const fd_check = loadData();
        if (hasAppealedCurrentExile(exiledUserId, fd_check)) {
            await safeEdit(interaction, {
                content: '❌ You have already submitted an appeal for your current exile. You cannot submit another one.',
            });
            return;
        }
            const appealId     = `appeal_${Date.now()}_${exiledUserId}`;
            data.appeals = data.appeals || {};
            data.appeals[appealId] = { userId: exiledUserId, reason, timestamp: Date.now(), createdAt: Date.now(), status: 'pending', handledBy: null };
            saveData(data);

            const appealsChId = gs.appealsChannelId || gs.logChannelId;
            if (!appealsChId) {
                await safeEdit(interaction, { content: '❌ No appeals channel configured. Contact an admin.' });
                return;
            }
            try {
                const appealsChannel = await guild.channels.fetch(appealsChId).catch(()=>null);
                if (!appealsChannel) { await safeEdit(interaction, { content: '❌ Appeals channel not found.' }); return; }

                const appealEmbed = new EmbedBuilder()
                    .setTitle('📩 New Exile Appeal')
                    .setColor(0xFFD700)
                    .setThumbnail(interaction.user.displayAvatarURL())
                    .addFields(
                        { name: 'User', value: `<@${exiledUserId}> (${exiledUserId})`, inline: true },
                        { name: 'Submitted', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true },
                        { name: 'Appeal Reason', value: reason.slice(0, 1024) },
                    )
                    .setFooter({ text: `Appeal ID: ${appealId}` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`appeal_accept_${appealId}`).setLabel('✅ Accept Appeal').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`appeal_reject_${appealId}`).setLabel('❌ Reject Appeal').setStyle(ButtonStyle.Danger),
                );

                await appealsChannel.send({ embeds: [appealEmbed], components: [row] });
                await safeEdit(interaction, { content: '✅ Your appeal has been submitted! Admins will review it shortly.' });
            } catch(e) {
                await safeEdit(interaction, { content: '❌ Failed to submit appeal.' });
            }
            return;
        }
    }

    // ── BUTTONS ───────────────────────────────────────────
    if (interaction.isButton()) {
        const cid = interaction.customId;

        // ── Setup page button → open the right modal ────────
        if (cid === 'setup_open_page1') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            // Build current values — prefer the multi-channel array, fall back to single legacy ID
            const tradeCur    = (gs.tradeChannelIds?.length ? gs.tradeChannelIds : (gs.tradeChannelId ? [gs.tradeChannelId] : [])).join(', ');
            const servicesCur = (gs.servicesChannelIds?.length ? gs.servicesChannelIds : (gs.servicesChannelId ? [gs.servicesChannelId] : [])).join(', ');
            const modal = new ModalBuilder().setCustomId('setup_modal_p1').setTitle('🔧 Setup — Page 1: Core');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('trade_channel_ids').setLabel('Trade Channel ID(s) — comma-separated')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(tradeCur).setPlaceholder('e.g. 111111111,222222222,333333333')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('services_channel_ids').setLabel('General Services Channel ID(s)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(servicesCur).setPlaceholder('Comma-separated IDs, e.g. 444444444,555555555')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('exile_role_id').setLabel('Exile Role ID')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(gs.exiledRoleId || '').setPlaceholder('ID of the exiled/muted role')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('log_channel_id').setLabel('Log Channel ID')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(gs.logChannelId || '').setPlaceholder('ID of your mod-log channel')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('appeals_channel_id').setLabel('Appeals Channel ID')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(gs.appealsChannelId || '').setPlaceholder('ID of your #appeals channel')
                ),
            );
            await interaction.showModal(modal);
            return;
        }

        if (cid === 'setup_open_page2') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            // Each field = one pool; comma-separated IDs for multi-channel pools
            const raidCur  = (gs.raidServiceChannelIds        || []).join(', ');
            const raceCur  = (gs.raceV4ServiceChannelIds       || []).join(', ');
            const seaCur   = (gs.seaEventsChannelIds           || []).join(', ');
            const mirCur   = (gs.mirageIslandChannelIds        || []).join(', ');
            const preKitLevi = [
                ...(gs.prehistoricIslandChannelIds || []),
                ...(gs.kitsuneIslandChannelIds     || []),
                ...(gs.leviathanChannelIds         || []),
            ].join(', ');
            const modal = new ModalBuilder().setCustomId('setup_modal_p2').setTitle('🔧 Setup — Page 2: Channel Pools');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('raid_channel_ids').setLabel('⚔️ Raid/Service channel ID(s)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(raidCur).setPlaceholder('Comma-separated IDs, e.g. 111,222')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('race_channel_ids').setLabel('🏁 Race V4/Trials channel ID(s)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(raceCur).setPlaceholder('Comma-separated IDs')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('sea_channel_ids').setLabel('🌊 Sea Events channel ID(s)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(seaCur).setPlaceholder('Comma-separated IDs')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('mirage_channel_ids').setLabel('🏝️ Mirage Island channel ID(s)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(mirCur).setPlaceholder('Comma-separated IDs')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('prehistoric_kitsune_levi_ids').setLabel('🦕 Prehistoric / 🦊 Kitsune / 🐉 Levi IDs')
                        .setStyle(TextInputStyle.Paragraph).setRequired(false)
                        .setValue(preKitLevi)
                        .setPlaceholder(
                            'prehistoric:<id1>,<id2>\nkitsune:<id1>\nleviathan:<id1>\n\n(prefix each line with the category name)'
                        )
                ),
            );
            await interaction.showModal(modal);
            return;
        }

        if (cid === 'setup_open_page3') {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const hubCur = (gs.gamesHubIds?.length ? gs.gamesHubIds : (gs.gamesHubId ? [gs.gamesHubId] : [])).join(', ');
            const modal = new ModalBuilder().setCustomId('setup_modal_p3').setTitle('🔧 Setup — Page 3: Misc');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('games_hub_ids').setLabel('Commands Channel ID(s) — comma-separated')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(hubCur).setPlaceholder('e.g. 111111111,222222222 (all bot-command channels)')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('exile_channel_id').setLabel('Exile Channel ID')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(gs.exileChannelId || '').setPlaceholder('ID of your #exile-zone channel')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('violation_threshold').setLabel('Violation Threshold before exile (1–10)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(String(gs.violationThreshold || 3)).setPlaceholder('Default: 3')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('exile_duration_mins').setLabel('Default Exile Duration (minutes, 1–1440)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(String(gs.exileDurationMins || 45)).setPlaceholder('Default: 45')
                ),
            );
            await interaction.showModal(modal);
            return;
        }

        if (cid === 'dash_toggle_checks' || cid === 'dash_toggle_ai' || cid === 'dash_toggle_mode' || cid.startsWith('dash_preset_')) {
            const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            if (cid === 'dash_toggle_checks') gs.checksEnabled = !gs.checksEnabled;
            if (cid === 'dash_toggle_ai') gs.aiEnabled = !gs.aiEnabled;
            if (cid === 'dash_toggle_mode') gs.enforcementMode = (gs.enforcementMode === 'monitor') ? 'enforce' : 'monitor';
            if (cid.startsWith('dash_preset_')) {
                const preset = cid.replace('dash_preset_', '');
                applyPolicyPreset(gs, preset);
            }
            saveData(data);
            await interaction.update({ embeds: [buildDashboardEmbed(gs)], components: buildDashboardComponents() });
            return;
        }

        if (cid.startsWith('open_appeal_')) {
            const parts = cid.split('_');
            const exiledUserId = parts.length >= 4 ? parts.slice(3).join('_') : cid.replace('open_appeal_', '');
            const fd_btn = loadData();
        if (hasAppealedCurrentExile(exiledUserId, fd_btn)) {
            await interaction.reply({
                content: '❌ You have already submitted an appeal for your current exile.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
        }
            const modal = new ModalBuilder()
                .setCustomId(`appeal_modal_${guildId}_${exiledUserId}`)
                .setTitle('📩 Submit an Appeal');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_reason')
                        .setLabel('Why should your exile be lifted?')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMinLength(20)
                        .setMaxLength(1000)
                        .setRequired(true)
                        .setPlaceholder('Explain why you should be unexiled. Be honest and respectful.')
                )
            );
            try {
                await interaction.showModal(modal);
            } catch {
                await safeReply(interaction, { content: '❌ Failed to open the appeal form. Try again.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (cid.startsWith('appeal_accept_')) {
            const isMod = isSuperUser(interaction.user.id) || interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages) || isManagerMember(interaction.member, guildId, data);
            const isAdmin = isSuperUser(interaction.user.id) || interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const appealId = cid.replace('appeal_accept_', '');
            const appeal   = data.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.userId === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ content: '❌ You cannot accept your own appeal.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }

            appeal.status    = 'accepted';
            appeal.handledBy = interaction.user.id;
            // BUG FIX: perform unexile on same `data` object — eliminates double-save race.
            const member = await interaction.guild.members.fetch(appeal.userId).catch(()=>null);
            if (member) {
                await performUnexile(member, interaction.guild, data);
                delete data.exiles[appeal.userId];
            }
            saveData(data);

            if (member) {
                member.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('✅ Appeal Accepted')
                        .setDescription('Your exile appeal has been **accepted**. You have been unexiled.\nPlease make sure to follow the server rules going forward.')
                        .setColor(0x00FF88)
                        .setTimestamp()]
                }).catch(()=>{});
            }

            const updated = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x00FF88)
                .setTitle('📩 Appeal — ACCEPTED ✅')
                .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.update({ embeds: [updated], components: [] });
            return;
        }

        // Reject appeal
        if (cid.startsWith('appeal_reject_')) {
            const appealId = cid.replace('appeal_reject_', '');
            const appeal   = data.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot reject your own appeal.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }

            appeal.status    = 'rejected';
            appeal.handledBy = interaction.user.id;
            saveData(data);

            const member = await interaction.guild.members.fetch(appeal.userId).catch(()=>null);
            if (member) {
                member.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Appeal Rejected')
                        .setDescription('Your exile appeal has been **rejected**.\nPlease wait for your exile to expire or contact a server admin.')
                        .setColor(0xFF4444)
                        .setTimestamp()]
                }).catch(()=>{});
            }

            const updated = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xFF4444)
                .setTitle('📩 Appeal — REJECTED ❌')
                .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.update({ embeds: [updated], components: [] });
            return;
        }
    }

    // ── SELECT MENUS ──────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
        const cid = interaction.customId;

        // Remove a specific warn from violations (admin only, not your own)
        if (cid.startsWith('rmwarn_')) {
            const isAdminCheck = isSuperUser(interaction.user.id) || interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
            if (!isAdminCheck) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const parts   = cid.split('_');
            const targetId = parts[2];
            if (targetId === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ content: '❌ You cannot remove your own warns.', flags: MessageFlags.Ephemeral }); return; }
            const selectedWarnId = interaction.values[0];
            const fd2 = loadData();
            const vObj = fd2.violations[targetId];
            if (!vObj || typeof vObj === 'number') { await interaction.reply({ content: '❌ No violation history found.', flags: MessageFlags.Ephemeral }); return; }
            const oldHistory = Array.isArray(vObj.history) ? vObj.history : [];
            const newHistory = oldHistory.filter(h => {
                const hid = h.warnId || null;
                if (selectedWarnId.startsWith('idx_')) {
                    const idx = parseInt(selectedWarnId.replace('idx_', ''));
                    return oldHistory.indexOf(h) !== idx;
                }
                return hid !== selectedWarnId;
            });
            const removed = oldHistory.find(h => {
                if (selectedWarnId.startsWith('idx_')) {
                    const idx = parseInt(selectedWarnId.replace('idx_', ''));
                    return oldHistory.indexOf(h) === idx;
                }
                return (h.warnId || null) === selectedWarnId;
            });
            fd2.violations[targetId] = { count: Math.max(0, newHistory.length), history: newHistory };
            saveData(fd2);
            await sendLog(interaction.guild, fd2, new EmbedBuilder()
                .setTitle('🗑️ Warn Removed (Admin)')
                .setColor(0x00BFFF)
                .addFields(
                    { name: 'User',       value: `<@${targetId}> (${targetId})`, inline: true },
                    { name: 'Removed by', value: `<@${interaction.user.id}>`,    inline: true },
                    { name: 'Warn',       value: removed ? String(removed.reason).slice(0, 512) : selectedWarnId, inline: false },
                ).setTimestamp());
            await interaction.update({ content: `✅ Warn removed for <@${targetId}>. Remaining violations: **${newHistory.length}**.`, components: [], embeds: [] });
            return;
        }
    }

    // ── WARN APPEAL — open modal (button in DM) ────────────
    if (interaction.isButton()) {
        const cid = interaction.customId;

        if (cid.startsWith('open_warn_appeal_')) {
            // customId: open_warn_appeal_<guildId>_<warnId>
            const rest    = cid.slice('open_warn_appeal_'.length);
            const sepIdx  = rest.indexOf('_');
            const wGuildId = rest.slice(0, sepIdx);
            const warnId   = rest.slice(sepIdx + 1);
            const fd3 = loadData();
            if (hasAppealedWarn(warnId, fd3)) {
                await interaction.reply({ content: '❌ You have already submitted an appeal for this warning.', flags: MessageFlags.Ephemeral }).catch(()=>{});
                return;
            }
            const modal = new ModalBuilder()
                .setCustomId(`warn_appeal_modal_${wGuildId}_${warnId}`)
                .setTitle('📩 Appeal a Warning');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_reason')
                        .setLabel('Why should this warning be removed?')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMinLength(20)
                        .setMaxLength(1000)
                        .setRequired(true)
                        .setPlaceholder('Explain why this warning was unfair. Be honest and respectful.')
                )
            );
            try {
                await interaction.showModal(modal);
            } catch {
                await interaction.reply({ content: '❌ Failed to open the appeal form. Try again.', flags: MessageFlags.Ephemeral }).catch(()=>{});
            }
            return;
        }

        // Warn appeal — accept
        if (cid.startsWith('warn_appeal_accept_')) {
            const isAdminBtn = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
            const isModBtn   = interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages) || isManagerMember(interaction.member, guildId, data);
            if (!isAdminBtn && !isModBtn) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const appealId = cid.replace('warn_appeal_accept_', '');
            const fd4 = loadData();
            const appeal = fd4.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot accept your own appeal.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }
            // Remove the specific warn from history
            const targetId = appeal.userId;
            const warnId   = appeal.warnId;
            const vObj     = fd4.violations[targetId];
            if (vObj && typeof vObj !== 'number' && Array.isArray(vObj.history)) {
                vObj.history = vObj.history.filter(h => h.warnId !== warnId);
                vObj.count   = Math.max(0, vObj.history.length);
                fd4.violations[targetId] = vObj;
            }
            appeal.status    = 'accepted';
            appeal.handledBy = interaction.user.id;
            saveData(fd4);
            // DM the user
            const warnedUser = await client.users.fetch(targetId).catch(()=>null);
            if (warnedUser) {
                warnedUser.send({ embeds: [new EmbedBuilder()
                    .setTitle('✅ Warn Appeal Accepted')
                    .setDescription('Your warning appeal has been **accepted**. The warning has been removed from your record.\nPlease make sure to follow the server rules going forward.')
                    .setColor(0x00FF88)
                    .setTimestamp()] }).catch(()=>{});
            }
            const updated = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x00FF88)
                .setTitle('📩 Warn Appeal — ACCEPTED ✅')
                .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.update({ embeds: [updated], components: [] });
            return;
        }

        // Warn appeal — reject
        if (cid.startsWith('warn_appeal_reject_')) {
            const isAdminBtn = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
            const isModBtn   = interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages) || isManagerMember(interaction.member, guildId, data);
            if (!isAdminBtn && !isModBtn) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const appealId = cid.replace('warn_appeal_reject_', '');
            const fd5 = loadData();
            const appeal = fd5.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot reject your own appeal.', flags: MessageFlags.Ephemeral }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }
            appeal.status    = 'rejected';
            appeal.handledBy = interaction.user.id;
            saveData(fd5);
            const warnedUser = await client.users.fetch(appeal.userId).catch(()=>null);
            if (warnedUser) {
                warnedUser.send({ embeds: [new EmbedBuilder()
                    .setTitle('❌ Warn Appeal Rejected')
                    .setDescription('Your warning appeal has been **rejected**.\nThe warning remains on your record. If you have further questions, contact a server admin.')
                    .setColor(0xFF4444)
                    .setTimestamp()] }).catch(()=>{});
            }
            const updated = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xFF4444)
                .setTitle('📩 Warn Appeal — REJECTED ❌')
                .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.update({ embeds: [updated], components: [] });
            return;
        }
    }

    // ── WARN APPEAL — modal submit ────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('warn_appeal_modal_')) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}
        const rest     = interaction.customId.slice('warn_appeal_modal_'.length);
        const sepIdx   = rest.indexOf('_');
        const wGuildId = rest.slice(0, sepIdx);
        const warnId   = rest.slice(sepIdx + 1);
        const reason   = interaction.fields.getTextInputValue('appeal_reason');
        const fd6 = loadData();
        if (hasAppealedWarn(warnId, fd6)) {
            try { await interaction.editReply({ content: '❌ You have already submitted an appeal for this warning.' }); } catch {}
            return;
        }
        // Find warn details to enrich the appeal embed
        const warnEntry = Object.values(fd6.violations || {}).flatMap(v => {
            if (!v || typeof v === 'number' || !Array.isArray(v.history)) return [];
            return v.history.filter(h => h.warnId === warnId);
        })[0] || null;
        const warnReason = warnEntry?.reason || 'Unknown reason';
        const warnBy     = warnEntry?.by     || null;

        const appealId = `warnappeal_${Date.now()}_${interaction.user.id}`;
        fd6.appeals = fd6.appeals || {};
        fd6.appeals[appealId] = {
            type: 'warn', warnId,
            userId: interaction.user.id,
            reason, warnReason, warnBy,
            timestamp: Date.now(), createdAt: Date.now(),
            status: 'pending', handledBy: null,
        };
        saveData(fd6);

        const wGS = getGuildSettings(wGuildId, fd6);
        const appealsChId = wGS.appealsChannelId || wGS.logChannelId;
        if (!appealsChId) {
            try { await interaction.editReply({ content: '❌ No appeals channel configured. Contact an admin.' }); } catch {}
            return;
        }
        try {
            const wGuild = await client.guilds.fetch(wGuildId).catch(()=>null);
            const appealsChannel = wGuild ? await wGuild.channels.fetch(appealsChId).catch(()=>null) : null;
            if (!appealsChannel) { try { await interaction.editReply({ content: '❌ Appeals channel not found.' }); } catch {} return; }

            const appealEmbed = new EmbedBuilder()
                .setTitle('📩 New Warn Appeal')
                .setColor(0xFFD700)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: 'User',         value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: true },
                    { name: 'Submitted',    value: `<t:${Math.floor(Date.now()/1000)}:R>`,               inline: true },
                    { name: 'Warn Reason',  value: warnReason.slice(0, 512),                             inline: false },
                    ...(warnBy ? [{ name: 'Warned by', value: `<@${warnBy}>`, inline: true }] : []),
                    { name: 'Appeal Reason', value: reason.slice(0, 1024),                               inline: false },
                )
                .setFooter({ text: `Appeal ID: ${appealId} • Warn ID: ${warnId}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`warn_appeal_accept_${appealId}`).setLabel('✅ Accept Appeal').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`warn_appeal_reject_${appealId}`).setLabel('❌ Reject Appeal').setStyle(ButtonStyle.Danger),
            );
            await appealsChannel.send({ embeds: [appealEmbed], components: [row] });
            try { await interaction.editReply({ content: '✅ Your warn appeal has been submitted! Admins will review it shortly.' }); } catch {}
        } catch {
            try { await interaction.editReply({ content: '❌ Failed to submit appeal.' }); } catch {}
        }
        return;
    }

    // ══════════════════════════════════════════════════════════
    //  TIMEOUT APPEAL — buttons + modal
    // ══════════════════════════════════════════════════════════

    // Step 1: User clicks "Appeal this Timeout" button (fires in DM) → show modal
    if (interaction.isButton() && interaction.customId.startsWith('open_timeout_appeal_')) {
        const rest    = interaction.customId.slice('open_timeout_appeal_'.length);
        const sepIdx  = rest.indexOf('_');
        const tGuildId  = rest.slice(0, sepIdx);
        const timeoutId = rest.slice(sepIdx + 1);
        const tfd = loadData();
        if (hasAppealedTimeout(timeoutId, tfd)) {
            try { await interaction.reply({ content: '❌ You have already submitted an appeal for this timeout. Only one appeal is allowed.', flags: MessageFlags.Ephemeral }); } catch {}
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId(`timeout_appeal_modal_${tGuildId}_${timeoutId}`)
            .setTitle('📩 Appeal Your Timeout');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('appeal_reason')
                    .setLabel('Why should your timeout be removed?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(20)
                    .setMaxLength(1000)
                    .setRequired(true)
                    .setPlaceholder('Explain why you believe this timeout was unfair. Be respectful and honest.')
            )
        );
        try { await interaction.showModal(modal); } catch {
            await interaction.reply({ content: '❌ Failed to open the appeal form. Try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    // Step 2: User submits the timeout appeal modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('timeout_appeal_modal_')) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}
        const rest      = interaction.customId.slice('timeout_appeal_modal_'.length);
        const sepIdx    = rest.indexOf('_');
        const tGuildId  = rest.slice(0, sepIdx);
        const timeoutId = rest.slice(sepIdx + 1);
        const reason    = interaction.fields.getTextInputValue('appeal_reason');
        const tfd2 = loadData();
        if (hasAppealedTimeout(timeoutId, tfd2)) {
            try { await interaction.editReply({ content: '❌ You have already submitted a timeout appeal. Only one appeal is allowed.' }); } catch {}
            return;
        }
        const tInfo = tfd2.timeouts?.[tGuildId]?.[interaction.user.id];
        const appealId = `toappeal_${Date.now()}_${interaction.user.id}`;
        tfd2.appeals = tfd2.appeals || {};
        tfd2.appeals[appealId] = {
            type: 'timeout', timeoutId,
            userId: interaction.user.id, guildId: tGuildId,
            reason,
            timeoutReason: tInfo?.reason || 'Unknown',
            issuedBy: tInfo?.issuedBy || null,
            timestamp: Date.now(), createdAt: Date.now(),
            status: 'pending', handledBy: null,
        };
        saveData(tfd2);
        const tGS = getGuildSettings(tGuildId, tfd2);
        const appealsChId = tGS.appealsChannelId || tGS.logChannelId;
        if (!appealsChId) {
            try { await interaction.editReply({ content: '❌ No appeals channel is configured in this server. Contact an admin.' }); } catch {}
            return;
        }
        try {
            const tGuild = await client.guilds.fetch(tGuildId).catch(() => null);
            const appealsCh = tGuild ? await tGuild.channels.fetch(appealsChId).catch(() => null) : null;
            if (!appealsCh) { try { await interaction.editReply({ content: '❌ Appeals channel not found.' }); } catch {} return; }
            const appealEmbed = new EmbedBuilder()
                .setTitle('📩 New Timeout Appeal')
                .setColor(0xFF8C00)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: '👤 User',           value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: true },
                    { name: '📅 Submitted',       value: `<t:${Math.floor(Date.now()/1000)}:R>`,              inline: true },
                    { name: '📝 Timeout Reason',  value: (tInfo?.reason || 'Unknown').slice(0, 512),           inline: false },
                    ...(tInfo?.issuedBy ? [{ name: '🛡️ Issued by', value: `<@${tInfo.issuedBy}>`, inline: true }] : []),
                    { name: '💬 Appeal Reason',   value: reason.slice(0, 1024),                                inline: false },
                )
                .setFooter({ text: `Appeal ID: ${appealId} • Timeout ID: ${timeoutId}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`timeout_appeal_accept_${appealId}`).setLabel('✅ Accept Appeal').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`timeout_appeal_reject_${appealId}`).setLabel('❌ Reject Appeal').setStyle(ButtonStyle.Danger),
            );
            await appealsCh.send({ embeds: [appealEmbed], components: [row] });
            try { await interaction.editReply({ content: '✅ Your timeout appeal has been submitted! Admins will review it shortly.' }); } catch {}
        } catch {
            try { await interaction.editReply({ content: '❌ Failed to submit appeal.' }); } catch {}
        }
        return;
    }

    // Step 3a: Staff accepts the timeout appeal
    if (interaction.isButton() && interaction.customId.startsWith('timeout_appeal_accept_')) {
        const isAdminBtn = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
        if (!isAdminBtn) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
        const appealId = interaction.customId.replace('timeout_appeal_accept_', '');
        const tfd3 = loadData();
        const appeal = tfd3.appeals[appealId];
        if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot accept your own appeal.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }
        appeal.status = 'accepted'; appeal.handledBy = interaction.user.id;
        // Remove timeout
        try {
            const tg = await client.guilds.fetch(appeal.guildId).catch(() => null);
            const tm = tg ? await tg.members.fetch(appeal.userId).catch(() => null) : null;
            if (tm) await tm.timeout(null, 'Timeout appeal accepted').catch(() => {});
            // Clear the stored long-timeout record
            if (tfd3.timeouts?.[appeal.guildId]?.[appeal.userId]) {
                delete tfd3.timeouts[appeal.guildId][appeal.userId];
                const key = `${appeal.guildId}:${appeal.userId}`;
                const h = _activeTimeoutTimers.get(key);
                if (h) { clearTimeout(h); _activeTimeoutTimers.delete(key); }
            }
        } catch {}
        saveData(tfd3);
        const tUser = await client.users.fetch(appeal.userId).catch(() => null);
        if (tUser) tUser.send({ embeds: [new EmbedBuilder()
            .setTitle('✅ Timeout Appeal Accepted')
            .setDescription('Your timeout appeal has been **accepted** and your timeout has been removed.\nPlease make sure to follow the server rules going forward.')
            .setColor(0x00FF88).setTimestamp()] }).catch(() => {});
        const updated = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00FF88).setTitle('📩 Timeout Appeal — ACCEPTED ✅')
            .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
        await interaction.update({ embeds: [updated], components: [] });
        return;
    }

    // Step 3b: Staff rejects the timeout appeal
    if (interaction.isButton() && interaction.customId.startsWith('timeout_appeal_reject_')) {
        const isAdminBtn = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
        if (!isAdminBtn) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
        const appealId = interaction.customId.replace('timeout_appeal_reject_', '');
        const tfd4 = loadData();
        const appeal = tfd4.appeals[appealId];
        if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot reject your own appeal.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }
        appeal.status = 'rejected'; appeal.handledBy = interaction.user.id;
        saveData(tfd4);
        const tUser = await client.users.fetch(appeal.userId).catch(() => null);
        if (tUser) tUser.send({ embeds: [new EmbedBuilder()
            .setTitle('❌ Timeout Appeal Rejected')
            .setDescription('Your timeout appeal has been **rejected**.\nYour timeout remains in place. If you have questions, contact a server admin.')
            .setColor(0xFF4444).setTimestamp()] }).catch(() => {});
        const updated = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF4444).setTitle('📩 Timeout Appeal — REJECTED ❌')
            .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
        await interaction.update({ embeds: [updated], components: [] });
        return;
    }

    // ══════════════════════════════════════════════════════════
    //  BAN APPEAL — buttons + modal (available after 14 days)
    // ══════════════════════════════════════════════════════════

    // Step 1: User clicks "Appeal this Ban" button (fires in DM) → show modal
    if (interaction.isButton() && interaction.customId.startsWith('open_ban_appeal_')) {
        const rest   = interaction.customId.slice('open_ban_appeal_'.length);
        const sepIdx = rest.indexOf('_');
        const bGuildId = rest.slice(0, sepIdx);
        const banId    = rest.slice(sepIdx + 1);
        const bfd = loadData();
        if (hasAppealedBan(banId, bfd)) {
            try { await interaction.reply({ content: '❌ You have already submitted an appeal for this ban. Only one appeal is allowed.', flags: MessageFlags.Ephemeral }); } catch {}
            return;
        }
        const banInfo = bfd.bans?.[bGuildId]?.[interaction.user.id];
        if (banInfo && banInfo.bannedAt) {
            const msSinceBan = Date.now() - banInfo.bannedAt;
            const msIn14Days = 14 * 24 * 60 * 60 * 1000;
            if (msSinceBan < msIn14Days) {
                const unlocksAt = Math.floor((banInfo.bannedAt + msIn14Days) / 1000);
                try { await interaction.reply({ content: `❌ You cannot appeal yet. Ban appeals unlock <t:${unlocksAt}:R>.`, flags: MessageFlags.Ephemeral }); } catch {}
                return;
            }
        }
        const modal = new ModalBuilder()
            .setCustomId(`ban_appeal_modal_${bGuildId}_${banId}`)
            .setTitle('📩 Appeal Your Ban');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('appeal_reason')
                    .setLabel('Why should your ban be lifted?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(20)
                    .setMaxLength(1000)
                    .setRequired(true)
                    .setPlaceholder('Explain why you should be unbanned. Be honest, respectful, and specific.')
            )
        );
        try { await interaction.showModal(modal); } catch {
            await interaction.reply({ content: '❌ Failed to open the appeal form. Try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    // Step 2: User submits the ban appeal modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ban_appeal_modal_')) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}
        const rest     = interaction.customId.slice('ban_appeal_modal_'.length);
        const sepIdx   = rest.indexOf('_');
        const bGuildId = rest.slice(0, sepIdx);
        const banId    = rest.slice(sepIdx + 1);
        const reason   = interaction.fields.getTextInputValue('appeal_reason');
        const bfd2 = loadData();
        if (hasAppealedBan(banId, bfd2)) {
            try { await interaction.editReply({ content: '❌ You have already submitted a ban appeal. Only one appeal is allowed.' }); } catch {}
            return;
        }
        const banInfo = bfd2.bans?.[bGuildId]?.[interaction.user.id];
        if (banInfo && banInfo.bannedAt) {
            const msSinceBan = Date.now() - banInfo.bannedAt;
            const msIn14Days = 14 * 24 * 60 * 60 * 1000;
            if (msSinceBan < msIn14Days) {
                const unlocksAt = Math.floor((banInfo.bannedAt + msIn14Days) / 1000);
                try { await interaction.editReply({ content: `❌ Ban appeals unlock <t:${unlocksAt}:R>. Please wait and try again after that.` }); } catch {}
                return;
            }
        }
        const appealId = `banappeal_${Date.now()}_${interaction.user.id}`;
        bfd2.appeals = bfd2.appeals || {};
        bfd2.appeals[appealId] = {
            type: 'ban', banId,
            userId: interaction.user.id, guildId: bGuildId,
            reason,
            banReason: banInfo?.reason || 'Unknown',
            issuedBy: banInfo?.issuedBy || null,
            bannedAt: banInfo?.bannedAt || null,
            timestamp: Date.now(), createdAt: Date.now(),
            status: 'pending', handledBy: null,
        };
        saveData(bfd2);
        const bGS = getGuildSettings(bGuildId, bfd2);
        const appealsChId = bGS.appealsChannelId || bGS.logChannelId;
        if (!appealsChId) {
            try { await interaction.editReply({ content: '❌ No appeals channel is configured in this server. Contact an admin.' }); } catch {}
            return;
        }
        try {
            const bGuild = await client.guilds.fetch(bGuildId).catch(() => null);
            const appealsCh = bGuild ? await bGuild.channels.fetch(appealsChId).catch(() => null) : null;
            if (!appealsCh) { try { await interaction.editReply({ content: '❌ Appeals channel not found.' }); } catch {} return; }
            const appealEmbed = new EmbedBuilder()
                .setTitle('📩 New Ban Appeal')
                .setColor(0xFF4444)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { name: '👤 User',        value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: true },
                    { name: '📅 Submitted',   value: `<t:${Math.floor(Date.now()/1000)}:R>`,              inline: true },
                    { name: '📝 Ban Reason',  value: (banInfo?.reason || 'Unknown').slice(0, 512),         inline: false },
                    ...(banInfo?.issuedBy ? [{ name: '🛡️ Issued by', value: `<@${banInfo.issuedBy}>`, inline: true }] : []),
                    ...(banInfo?.bannedAt ? [{ name: '📆 Banned at', value: `<t:${Math.floor(banInfo.bannedAt/1000)}:F>`, inline: true }] : []),
                    { name: '💬 Appeal Reason', value: reason.slice(0, 1024), inline: false },
                )
                .setFooter({ text: `Appeal ID: ${appealId} • Ban ID: ${banId}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ban_appeal_accept_${appealId}`).setLabel('✅ Accept Appeal').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ban_appeal_reject_${appealId}`).setLabel('❌ Reject Appeal').setStyle(ButtonStyle.Danger),
            );
            await appealsCh.send({ embeds: [appealEmbed], components: [row] });
            try { await interaction.editReply({ content: '✅ Your ban appeal has been submitted! Admins will review it.' }); } catch {}
        } catch {
            try { await interaction.editReply({ content: '❌ Failed to submit appeal.' }); } catch {}
        }
        return;
    }

    // Step 3a: Staff accepts the ban appeal → unban the user
    if (interaction.isButton() && interaction.customId.startsWith('ban_appeal_accept_')) {
        const isAdminBtn = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
        if (!isAdminBtn) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
        const appealId = interaction.customId.replace('ban_appeal_accept_', '');
        const bfd3 = loadData();
        const appeal = bfd3.appeals[appealId];
        if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot accept your own appeal.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }
        appeal.status = 'accepted'; appeal.handledBy = interaction.user.id;
        try {
            const bg = await client.guilds.fetch(appeal.guildId).catch(() => null);
            if (bg) await bg.bans.remove(appeal.userId, 'Ban appeal accepted').catch(() => {});
            if (bfd3.bans?.[appeal.guildId]?.[appeal.userId]) delete bfd3.bans[appeal.guildId][appeal.userId];
        } catch {}
        saveData(bfd3);
        const bUser = await client.users.fetch(appeal.userId).catch(() => null);
        if (bUser) bUser.send({ embeds: [new EmbedBuilder()
            .setTitle('✅ Ban Appeal Accepted')
            .setDescription('Your ban appeal has been **accepted** and your ban has been lifted.\nWelcome back — please make sure to follow the server rules.')
            .setColor(0x00FF88).setTimestamp()] }).catch(() => {});
        const updated = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00FF88).setTitle('📩 Ban Appeal — ACCEPTED ✅')
            .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
        await interaction.update({ embeds: [updated], components: [] });
        return;
    }

    // Step 3b: Staff rejects the ban appeal
    if (interaction.isButton() && interaction.customId.startsWith('ban_appeal_reject_')) {
        const isAdminBtn = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
        if (!isAdminBtn) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
        const appealId = interaction.customId.replace('ban_appeal_reject_', '');
        const bfd4 = loadData();
        const appeal = bfd4.appeals[appealId];
        if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot reject your own appeal.', flags: MessageFlags.Ephemeral }); return; }
        if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', flags: MessageFlags.Ephemeral }); return; }
        appeal.status = 'rejected'; appeal.handledBy = interaction.user.id;
        saveData(bfd4);
        const bUser = await client.users.fetch(appeal.userId).catch(() => null);
        if (bUser) bUser.send({ embeds: [new EmbedBuilder()
            .setTitle('❌ Ban Appeal Rejected')
            .setDescription('Your ban appeal has been **rejected**.\nYour ban remains in place. If you have further questions, contact a server admin.')
            .setColor(0xFF4444).setTimestamp()] }).catch(() => {});
        const updated = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF4444).setTitle('📩 Ban Appeal — REJECTED ❌')
            .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true });
        await interaction.update({ embeds: [updated], components: [] });
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    logCmdStats('slash', interaction.commandName);
    const _isBotOwner_slash = isSuperUser(interaction.user.id);
    const isAdmin = _isBotOwner_slash || interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(interaction.member, guildId, data);
    const isMod   = _isBotOwner_slash || interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages) || isManagerMember(interaction.member, guildId, data);

    async function handleCategoryImmunity(category) {
        if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
        const c = getCategoryImmunity(guildId, data, category);

        const group = interaction.options.getSubcommandGroup(false);
        if (group) {
            const sub = interaction.options.getSubcommand();

            if (group === 'role') {
                if (sub === 'list') {
                    const list = c.roles.map(rid => interaction.guild.roles.cache.get(rid) ? `<@&${rid}>` : `Unknown (${rid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** role immunity list (${c.roles.length}):\n${list.join('\n') || 'None'}`, flags: MessageFlags.Ephemeral });
                    return;
                }
                const role = interaction.options.getRole('role');
                if (!role) { await interaction.reply({ content: '❌ Provide a role.', flags: MessageFlags.Ephemeral }); return; }
                if (sub === 'add') {
                    if (!c.roles.includes(role.id)) c.roles.push(role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added role immunity for **${category}**: ${role}`, flags: MessageFlags.Ephemeral });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Role add: ${role} (${role.id})`,
                    ]);
                    return;
                }
                if (sub === 'remove') {
                    c.roles = c.roles.filter(x => x !== role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed role immunity for **${category}**: ${role}`, flags: MessageFlags.Ephemeral });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Role remove: ${role} (${role.id})`,
                    ]);
                    return;
                }
                await interaction.reply({ content: '❌ Invalid subcommand.', flags: MessageFlags.Ephemeral });
                return;
            }

            if (group === 'member') {
                if (sub === 'list') {
                    const list = c.members.map(uid => `<@${uid}> (${uid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** member immunity list (${c.members.length}):\n${list.join('\n') || 'None'}`, flags: MessageFlags.Ephemeral });
                    return;
                }
                const member = interaction.options.getUser('member');
                if (!member) { await interaction.reply({ content: '❌ Provide a member.', flags: MessageFlags.Ephemeral }); return; }
                if (sub === 'add') {
                    if (!c.members.includes(member.id)) c.members.push(member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added member immunity for **${category}**: <@${member.id}>`, flags: MessageFlags.Ephemeral });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Member add: <@${member.id}> (${member.id})`,
                    ]);
                    return;
                }
                if (sub === 'remove') {
                    c.members = c.members.filter(x => x !== member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed member immunity for **${category}**: <@${member.id}>`, flags: MessageFlags.Ephemeral });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Member remove: <@${member.id}> (${member.id})`,
                    ]);
                    return;
                }
                await interaction.reply({ content: '❌ Invalid subcommand.', flags: MessageFlags.Ephemeral });
                return;
            }
        }

        const legacySub = interaction.options.getSubcommand(false);
        const legacyMode = (interaction.options.getString('mode') || '').toLowerCase();
        if (legacySub && legacyMode) {
            if (legacySub === 'role') {
                const role = interaction.options.getRole('role');
                if (legacyMode === 'list') {
                    const list = c.roles.map(rid => interaction.guild.roles.cache.get(rid) ? `<@&${rid}>` : `Unknown (${rid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** role immunity list (${c.roles.length}):\n${list.join('\n') || 'None'}`, flags: MessageFlags.Ephemeral });
                    return;
                }
                if (!role) { await interaction.reply({ content: '❌ Provide a role.', flags: MessageFlags.Ephemeral }); return; }
                if (legacyMode === 'add') {
                    if (!c.roles.includes(role.id)) c.roles.push(role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added role immunity for **${category}**: ${role}`, flags: MessageFlags.Ephemeral });
                    return;
                }
                if (legacyMode === 'remove') {
                    c.roles = c.roles.filter(x => x !== role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed role immunity for **${category}**: ${role}`, flags: MessageFlags.Ephemeral });
                    return;
                }
            }
            if (legacySub === 'member') {
                const member = interaction.options.getUser('member');
                if (legacyMode === 'list') {
                    const list = c.members.map(uid => `<@${uid}> (${uid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** member immunity list (${c.members.length}):\n${list.join('\n') || 'None'}`, flags: MessageFlags.Ephemeral });
                    return;
                }
                if (!member) { await interaction.reply({ content: '❌ Provide a member.', flags: MessageFlags.Ephemeral }); return; }
                if (legacyMode === 'add') {
                    if (!c.members.includes(member.id)) c.members.push(member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added member immunity for **${category}**: <@${member.id}>`, flags: MessageFlags.Ephemeral });
                    return;
                }
                if (legacyMode === 'remove') {
                    c.members = c.members.filter(x => x !== member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed member immunity for **${category}**: <@${member.id}>`, flags: MessageFlags.Ephemeral });
                    return;
                }
            }
        }

        await interaction.reply({ content: '❌ Invalid immunity command usage.', flags: MessageFlags.Ephemeral });
    }

    switch (interaction.commandName) {

        // ── /setup & /changesetup ─────────────────────────
        case 'setup':
        case 'changesetup': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand(false);

            // /setup open  OR  /changesetup  (no subcommand) → open the wizard
            if (!sub || sub === 'open') {
                await interaction.reply({ embeds: [buildSetupPickerEmbed(gs)], components: buildSetupPickerComponents(), flags: MessageFlags.Ephemeral });
                break;
            }

            // /setup completeset → enable ALL detections (except caps/stretch/noAffiliation)
            if (sub === 'completeset') {
                applyAllDetections(gs);
                saveData(data);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('✅ Setup Complete — Core Detections Enabled')
                        .setColor(0x00FF88)
                        .setDescription('Core moderation detections are now **ON**.\nThe following are **OFF by default** and must be enabled manually to avoid false-positives:')
                        .addFields(
                            { name: '🔕 Manual-only (still OFF)', value: '`/capsconfig on` — Caps spam\n`/stretchconfig on` — Stretch spam\n`/noaffiliation enable` — No-affiliation mode\n`/zalgoconfig enabled:True` — Zalgo/glitch text\n`/invitepolicy on` — Invite link blocking\n`/attachmentpolicy on` — Attachment blocking\n`/timeout enable` — Auto-timeouts', inline: false },
                        )
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '✅ Setup Completed', [
                    'Core detections enabled via /setup completeset',
                    'Caps / Stretch / No-Affiliation / Zalgo / InvitePolicy / AttachmentPolicy / Timeout remain OFF (manual only)',
                ]);
                break;
            }

            // /setup status → show what's on/off
            if (sub === 'status') {
                const on  = '✅ ON';
                const off = '❌ OFF';
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('🔧 Setup & Detection Status')
                        .setColor(0x5865F2)
                        .addFields(
                            { name: 'Setup Complete',      value: gs.serverSetupComplete ? on : off, inline: true },
                            { name: 'Checks Master',       value: gs.checksEnabled ? on : off, inline: true },
                            { name: 'Trade Redirect',      value: gs.tradeRedirectEnabled ? on : off, inline: true },
                            { name: 'Service Redirect',    value: gs.serviceRedirectEnabled ? on : off, inline: true },
                            { name: 'Command Redirect',    value: gs.commandRedirectEnabled ? on : off, inline: true },
                            { name: 'Spam Warn',           value: gs.spamWarnEnabled ? on : off, inline: true },
                            { name: 'Beg Warn',            value: gs.begWarnEnabled ? on : off, inline: true },
                            { name: 'Scam Warn',           value: gs.scamWarnEnabled ? on : off, inline: true },
                            { name: 'Acc Trade Warn',      value: gs.accTradeWarnEnabled ? on : off, inline: true },
                            { name: 'Scam Detection',      value: gs.scamEnabled ? on : off, inline: true },
                            { name: 'Invite Policy',       value: gs.invitePolicyEnabled ? on : off, inline: true },
                            { name: 'Attachment Policy',   value: gs.attachmentPolicyEnabled ? on : off, inline: true },
                            { name: 'Link Policy',         value: gs.linkPolicyEnabled ? on : off, inline: true },
                            { name: 'Zalgo',               value: gs.zalgoEnabled ? on : off, inline: true },
                            { name: 'Emoji Spam',          value: gs.emojiSpamEnabled ? on : off, inline: true },
                            { name: 'Dupe Spam',           value: gs.dupeSpamEnabled ? on : off, inline: true },
                            { name: 'Scan Edits',          value: gs.scanEditsEnabled ? on : off, inline: true },
                            { name: '— Manual Only —',     value: '\u200b', inline: false },
                            { name: 'Caps Spam',           value: gs.capsSpamEnabled ? on : off, inline: true },
                            { name: 'Stretch Spam',        value: gs.stretchSpamEnabled ? on : off, inline: true },
                            { name: 'No-Affiliation',      value: gs.noAffiliationEnabled ? on : off, inline: true },
                            { name: 'AI Detection',        value: gs.aiEnabled ? on : off, inline: true },
                        )
                        .setFooter({ text: 'Use /setup completeset to enable all (except manual-only ones)' })
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
                break;
            }

            break;
        }

        case 'dashboard': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            await interaction.reply({ embeds: [buildDashboardEmbed(gs)], components: buildDashboardComponents(), flags: MessageFlags.Ephemeral });
            break;
        }

        case 'policypreset': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const preset = interaction.options.getString('preset') || '';
            if (!applyPolicyPreset(gs, preset)) {
                await interaction.reply({ content: '❌ Invalid preset. Use strict|balanced|soft|monitor', flags: MessageFlags.Ephemeral });
                return;
            }
            saveData(data);
            await interaction.reply({ content: `✅ Policy preset applied: **${gs.policyPreset}**`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Policy Preset Applied', [String(gs.policyPreset)]);
            break;
        }

        case 'strictness': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const lvl = interaction.options.getInteger('level');
            const before = Number(gs.regexStrictness || 5);
            gs.regexStrictness = Math.max(1, Math.min(10, Number(lvl || 5)));
            saveData(data);
            await interaction.reply({ content: `✅ Strictness updated: **${before}** -> **${gs.regexStrictness}**`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Strictness Updated', [
                `regexStrictness: **${before}** -> **${gs.regexStrictness}**`,
            ]);
            break;
        }

        case 'case': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();
            const cases = getGuildCases(guildId, data);
            if (sub === 'view') {
                const id = (interaction.options.getString('id') || '').trim();
                const c = cases?.[id];
                if (!c) { await interaction.reply({ content: '❌ Case not found.', flags: MessageFlags.Ephemeral }); return; }
                const embed = new EmbedBuilder()
                    .setTitle(`📁 Case #${c.id}`)
                    .setColor(c.voided ? 0x777777 : 0x5865F2)
                    .addFields(
                        { name: 'User', value: c.userId ? `<@${c.userId}> (${c.userId})` : 'Unknown', inline: false },
                        { name: 'Action', value: String(c.action || 'warn'), inline: true },
                        { name: 'Category', value: String(c.category || 'unknown'), inline: true },
                        { name: 'Created', value: c.createdAt ? `<t:${Math.floor(c.createdAt/1000)}:F>` : 'Unknown', inline: true },
                        { name: 'Reason', value: String(c.reason || '').slice(0, 1024) || 'None', inline: false },
                        { name: 'Content', value: String(c.content || '').slice(0, 1024) || '(none)', inline: false },
                    )
                    .setTimestamp();
                if (c.messageUrl) embed.addFields({ name: 'Message', value: c.messageUrl, inline: false });
                if (Array.isArray(c.notes) && c.notes.length) {
                    const nl = c.notes.slice(-5).map(n => `• <t:${Math.floor((n.at||Date.now())/1000)}:R> <@${n.by}>: ${String(n.text||'')}`);
                    embed.addFields({ name: 'Notes (latest 5)', value: nl.join('\n').slice(0, 1024), inline: false });
                }
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }
            if (sub === 'list') {
                const user = interaction.options.getUser('user');
                const all = Object.values(cases || {}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
                const filtered = user ? all.filter(x => x.userId === user.id) : all;
                const lines = filtered.slice(0, 20).map(c => `#${c.id} — ${c.voided ? 'VOID ' : ''}${String(c.action||'warn')} — <@${c.userId}> — ${String(c.category||'')}`);
                await interaction.reply({ content: lines.length ? lines.join('\n') : 'No cases found.', flags: MessageFlags.Ephemeral });
                return;
            }
            if (sub === 'note') {
                const id = (interaction.options.getString('id') || '').trim();
                const text = interaction.options.getString('text') || '';
                const c = addCaseNote(guildId, data, id, interaction.user.id, text);
                if (!c) { await interaction.reply({ content: '❌ Case not found.', flags: MessageFlags.Ephemeral }); return; }
                await interaction.reply({ content: `✅ Note added to case #${id}.`, flags: MessageFlags.Ephemeral });
                return;
            }
            if (sub === 'void') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                const id = (interaction.options.getString('id') || '').trim();
                const reason = interaction.options.getString('reason') || '';
                const c = voidCase(guildId, data, id, interaction.user.id, reason);
                if (!c) { await interaction.reply({ content: '❌ Case not found.', flags: MessageFlags.Ephemeral }); return; }
                await interaction.reply({ content: `✅ Case #${id} voided.`, flags: MessageFlags.Ephemeral });
                return;
            }
            await interaction.reply({ content: '❌ Invalid case command.', flags: MessageFlags.Ephemeral });
            break;
        }

        case 'appeal': {
            const sub = interaction.options.getSubcommand();
            if (sub !== 'submit') { await interaction.reply({ content: '❌ Invalid appeal command.', flags: MessageFlags.Ephemeral }); return; }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const fd_slash = loadData();
            if (hasAppealedCurrentExile(interaction.user.id, fd_slash)) {
                await interaction.editReply({
                    content: '❌ You have already submitted an appeal for your current exile. You cannot submit another one.',
                });
                return;
            }
            const text = interaction.options.getString('text') || '';
            const caseId = (interaction.options.getString('case') || '').trim();
            if (!gs.appealsChannelId) { await interaction.editReply({ content: '❌ Appeals channel is not configured.' }); return; }
            const ch = await interaction.guild.channels.fetch(gs.appealsChannelId).catch(()=>null);
            if (!ch || !ch.isTextBased || !ch.isTextBased()) { await interaction.editReply({ content: '❌ Appeals channel is invalid.' }); return; }
            const appealId = `${Date.now()}_${interaction.user.id}`;
            data.appeals = data.appeals || {};
            data.appeals[appealId] = { id: appealId, userId: interaction.user.id, text: text.slice(0, 1800), caseId: caseId || null, status: 'pending', createdAt: Date.now() };
            saveData(data);

            const embed = new EmbedBuilder()
                .setTitle('📩 Appeal — PENDING')
                .setColor(0xFFAA00)
                .addFields(
                    { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
                    { name: 'Case', value: caseId ? `#${caseId}` : 'None', inline: true },
                    { name: 'Text', value: text.slice(0, 1024) || 'None', inline: false },
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`appeal_accept_${appealId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`appeal_reject_${appealId}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
            );
            try {
                await ch.send({ embeds: [embed], components: [row] });
            } catch (e) {
                await interaction.editReply({ content: `❌ Failed to post appeal to the appeals channel. (${String(e?.message || e)})` });
                return;
            }
            await interaction.editReply({ content: '✅ Appeal submitted.' });
            break;
        }

        case 'diagnose': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(()=>null);
            const perms = me?.permissions;
            const mm = perms?.has(PermissionFlagsBits.ManageMessages) ? '✅' : '❌';
            const mod = perms?.has(PermissionFlagsBits.ModerateMembers) ? '✅' : '❌';
            const vr = perms?.has(PermissionFlagsBits.ViewAuditLog) ? '✅' : '❌';
            const embed = new EmbedBuilder()
                .setTitle('🩺 Diagnose')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Bot Permissions', value: `ManageMessages: ${mm}\nModerateMembers: ${mod}\nViewAuditLog: ${vr}`, inline: false },
                    { name: 'AI Key', value: (AI_ENABLED ? (ANTHROPIC_KEY ? '✅ Present' : '❌ Missing') : '❌ AI_DISABLED'), inline: true },
                    { name: 'Mode', value: `checks=${gs.checksEnabled ? 'ON' : 'OFF'} enforcement=${gs.enforcementMode}`, inline: true },
                )
                .setTimestamp();

            const ids = [
                ['Trade Channel', gs.tradeChannelId],
                ['Services Channel', gs.servicesChannelId],
                ['Commands Channel', gs.gamesHubId || DEFAULT_GAMES_HUB_ID],
                ['Log Channel', gs.logChannelId],
                ['Exile Channel', gs.exileChannelId],
                ['Appeals Channel', gs.appealsChannelId],
            ];
            const chLines = [];
            for (const [label, id] of ids) {
                if (!id) { chLines.push(`${label}: None`); continue; }
                const exists = await interaction.guild.channels.fetch(id).catch(()=>null);
                chLines.push(`${label}: ${exists ? `<#${id}>` : `Missing (${id})`}`);
            }
            embed.addFields({ name: 'Channels', value: chLines.join('\n'), inline: false });

            let dataOK = '✅';
            try {
                ensureBackupDir();
                fs.accessSync(BASE_DIR, fs.constants.W_OK);
            } catch { dataOK = '❌'; }
            embed.addFields({ name: 'Storage', value: `Data file: ${DATA_FILE}\nBackups: ${BACKUP_DIR}\nWritable: ${dataOK}`, inline: false });

            const ft = footerText(gs);
            if (ft) embed.setFooter({ text: ft });
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'config': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();

            if (sub === 'export') {
                const payload = exportGuildConfig(interaction.guildId, data);
                const json = JSON.stringify(payload, null, 2);
                const safe = json.length > 1800 ? json.slice(0, 1800) + "\n... (truncated)" : json;
                await interaction.reply({ content: `\`\`\`json\n${safe}\n\`\`\``, flags: MessageFlags.Ephemeral });
                break;
            }

            if (sub === 'import') {
                const raw = interaction.options.getString('json') || '';
                let payload;
                try {
                    payload = JSON.parse(raw);
                } catch {
                    await interaction.reply({ content: '❌ Invalid JSON.', flags: MessageFlags.Ephemeral });
                    break;
                }
                try {
                    importGuildConfig(interaction.guildId, data, payload);
                    saveData(data);
                } catch (e) {
                    await interaction.reply({ content: `❌ Import failed: ${String(e?.message || e)}`, flags: MessageFlags.Ephemeral });
                    break;
                }
                await interaction.reply({ content: '✅ Config imported for this server.', flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Config Imported', []);
                break;
            }

            if (sub === 'backup') {
                const p = createBackupFile(DATA_FILE);
                rotateBackups(25);
                await interaction.reply({ content: `✅ Backup created: ${p ? path.basename(p) : 'Failed'}`, flags: MessageFlags.Ephemeral });
                break;
            }

            if (sub === 'list') {
                const files = listBackupFiles().slice(0, 20);
                await interaction.reply({ content: `✅ Backups (${files.length} shown):\n${files.join('\n') || 'None'}`, flags: MessageFlags.Ephemeral });
                break;
            }

            if (sub === 'restore') {
                const file = (interaction.options.getString('file') || '').trim();
                if (!/^skynet_data\.(\d{8}_\d{6})\.json$/.test(file)) { await interaction.reply({ content: '❌ Invalid backup filename.', flags: MessageFlags.Ephemeral }); break; }
                const full = path.join(BACKUP_DIR, file);
                if (!fs.existsSync(full)) { await interaction.reply({ content: '❌ Backup not found.', flags: MessageFlags.Ephemeral }); break; }
                try {
                    const d = JSON.parse(fs.readFileSync(full, 'utf8'));
                    createBackupFile(DATA_FILE);
                    safeWriteJsonAtomic(DATA_FILE, Object.assign(makeDefaultData(), d));
                } catch (e) {
                    await interaction.reply({ content: `❌ Restore failed: ${String(e?.message || e)}`, flags: MessageFlags.Ephemeral });
                    break;
                }
                await interaction.reply({ content: `✅ Restored from ${file}.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Config Restored', [file]);
                break;
            }
            await interaction.reply({ content: '❌ Unknown subcommand.', flags: MessageFlags.Ephemeral });
            break;
        }

        case 'messagecommandslist': {
            const embeds = buildCommandListEmbeds('💬 Message Commands', MESSAGE_COMMANDS_LIST, gs);
            await interaction.reply({ embeds: [embeds[0]], flags: MessageFlags.Ephemeral });
            for (let i = 1; i < embeds.length; i++) {
                await interaction.followUp({ embeds: [embeds[i]], flags: MessageFlags.Ephemeral });
            }
            break;
        }

        case 'slashcommandslist': {
            const embeds = buildCommandListEmbeds('✨ Slash Commands', SLASH_COMMANDS_LIST, gs);
            await interaction.reply({ embeds: [embeds[0]], flags: MessageFlags.Ephemeral });
            for (let i = 1; i < embeds.length; i++) {
                await interaction.followUp({ embeds: [embeds[i]], flags: MessageFlags.Ephemeral });
            }
            break;
        }

        case 'uptime': {
            const upMs = Date.now() - BOT_START_TS;
            const embed = new EmbedBuilder()
                .setTitle('⏱️ Uptime')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Uptime', value: formatDuration(upMs), inline: true },
                    { name: 'Started', value: `<t:${Math.floor(BOT_START_TS / 1000)}:F>`, inline: true },
                    { name: 'Node', value: process.version, inline: true },
                    { name: 'Memory', value: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB RSS`, inline: true },
                )
                .setTimestamp();
            const ft = footerText(gs);
            if (ft) embed.setFooter({ text: ft });
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'calc': {
            await safeDefer(interaction, {  });
            const uid = interaction.user.id;
            const expr = interaction.options.getString('expression') || '';
            const st = slashSessions.get(uid) || { mode: 'calc', lines: [] };
            if (expr.toLowerCase() === 'evaluate' && st.mode === 'calc' && st.lines.length) {
                const combined = st.lines.join('');
                slashSessions.delete(uid);
                const res = await qalcEval(combined);
                await sendLongToInteraction(interaction, res);
                break;
            }
            st.mode = 'calc';
            st.lines.push(expr);
            slashSessions.set(uid, st);
            await safeReply(interaction, { content: '🧮 Multi-line calc mode started. Send more lines or type `Evaluate`.',  });
            break;
        }

        case 'wolf': {
            await safeDefer(interaction, {  });
            const uid = interaction.user.id;
            const q = interaction.options.getString('question') || '';
            const st = slashSessions.get(uid) || { mode: 'wolf', lines: [] };
            if (q.toLowerCase() === 'evaluate' && st.mode === 'wolf' && st.lines.length) {
                const combined = st.lines.join('');
                slashSessions.delete(uid);
                const res = await wolframQuery(combined);
                await sendLongToInteraction(interaction, res);
                break;
            }
            st.mode = 'wolf';
            st.lines.push(q);
            slashSessions.set(uid, st);
            await safeReply(interaction, { content: '🔭 Multi-line Wolfram mode started. Send more lines or type `Evaluate`.',  });
            break;
        }

        case 'supercalc': {
            await safeDefer(interaction, {  });
            const uid = interaction.user.id;
            const expr = interaction.options.getString('expression') || '';
            const st = slashSessions.get(uid) || { mode: 'supercalc', lines: [] };
            if (expr.toLowerCase() === 'evaluate' && st.mode === 'supercalc' && st.lines.length) {
                const combined = st.lines.join('');
                slashSessions.delete(uid);
                const res = await superqalcOnefile(combined);
                await sendLongToInteraction(interaction, res);
                break;
            }
            st.mode = 'supercalc';
            st.lines.push(expr);
            slashSessions.set(uid, st);
            await safeReply(interaction, { content: '🧮 Multi-line supercalc mode started. Send more lines or type `Evaluate`.',  });
            break;
        }

        case 'supertower': {
            await safeDefer(interaction, {  });
            const uid = interaction.user.id;
            const expr = interaction.options.getString('expression') || '';
            const st = slashSessions.get(uid) || { mode: 'supertower', lines: [] };
            if (expr.toLowerCase() === 'evaluate' && st.mode === 'supertower' && st.lines.length) {
                const combined = st.lines.join('');
                slashSessions.delete(uid);
                const res = await superqalcTower(combined);
                await sendLongToInteraction(interaction, res);
                break;
            }
            st.mode = 'supertower';
            st.lines.push(expr);
            slashSessions.set(uid, st);
            await safeReply(interaction, { content: '🧮 Multi-line supertower mode started. Send more lines or type `Evaluate`.',  });
            break;
        }

        case 'sympy': {
            await safeDefer(interaction, {  });
            const uid = interaction.user.id;
            const expr = interaction.options.getString('expression') || '';
            const st = slashSessions.get(uid) || { mode: 'sympy', lines: [] };
            if (expr.toLowerCase() === 'evaluate' && st.mode === 'sympy' && st.lines.length) {
                const combined = st.lines.join('');
                slashSessions.delete(uid);
                let res;
                try {
                    res = await pyWorker.request('sympy_eval', { expression: combined });
                } catch (e) {
                    res = `SymPy Error: ${String(e?.message || e)}`;
                }
                await sendLongToInteraction(interaction, res);
                break;
            }
            st.mode = 'sympy';
            st.lines.push(expr);
            slashSessions.set(uid, st);
            await safeReply(interaction, { content: '🧮 Multi-line GayPy mode started. Send more lines or type `Evaluate`.',  });
            break;
        }

        case 'gaypy': {
            await safeDefer(interaction, {  });
            const uid = interaction.user.id;
            const expr = interaction.options.getString('expression') || '';
            const st = slashSessions.get(uid) || { mode: 'gaypy', lines: [] };
            if (expr.toLowerCase() === 'evaluate' && st.mode === 'gaypy' && st.lines.length) {
                const combined = st.lines.join('');
                slashSessions.delete(uid);
                let res;
                try {
                    res = await pyWorker.request('sympy_eval', { expression: combined });
                } catch (e) {
                    res = `SymPy Error: ${String(e?.message || e)}`;
                }
                await sendLongToInteraction(interaction, res);
                break;
            }
            st.mode = 'gaypy';
            st.lines.push(expr);
            slashSessions.set(uid, st);
            await safeReply(interaction, { content: '🧮 Multi-line gaypy mode started. Send more lines or type `Evaluate`.',  });
            break;
        }
        case 'mpmath': {
            await safeDefer(interaction, {  });
            const expr  = interaction.options.getString('expression') || '';
            const prec  = interaction.options.getInteger('precision') ?? 50;
            let res, ver;
            try {
                const r = await pyWorker.request('mpmath_eval', { expression: expr, precision: prec });
                // pyWorker returns plain string result; mpmath_ver is in the raw reply but
                // request() resolves to result field only — extract version from a ping if needed
                res = typeof r === 'object' ? (r.result ?? String(r)) : String(r);
                ver = typeof r === 'object' ? r.mpmath_ver : null;
            } catch (e) {
                res = `mpmath Error: ${String(e?.message || e)}`;
            }
            const label = ver ? `mpmath ${ver}` : 'mpmath';
            await sendLongToInteraction(interaction, `**[${label} | dps=${prec}]**\n${res}`);
            break;
        }
        case 'policymode': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const mode = (interaction.options.getString('mode') || '').toLowerCase();
            const before = gs.enforcementMode;
            gs.enforcementMode = mode;
            saveData(data);
            await interaction.reply({ content: `✅ Enforcement mode: **${before}** -> **${gs.enforcementMode}**`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Enforcement Mode Updated', [
                `enforcementMode: **${before}** -> **${gs.enforcementMode}**`,
            ]);
            break;
        }

        case 'policyset': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const cat = (interaction.options.getString('category') || '').toLowerCase();
            const action = (interaction.options.getString('action') || '').toLowerCase();
            const mins = interaction.options.getInteger('minutes');
            if (!['spam','scam','command','trade','service','beg','acctrade'].includes(cat)) { await interaction.reply({ content: '❌ Invalid category.', flags: MessageFlags.Ephemeral }); return; }
            if (!['warn','delete','timeout','exile','log'].includes(action)) { await interaction.reply({ content: '❌ Invalid action.', flags: MessageFlags.Ephemeral }); return; }
            gs.categoryPolicies = gs.categoryPolicies && typeof gs.categoryPolicies === 'object' ? gs.categoryPolicies : {};
            const before = gs.categoryPolicies[cat] || null;
            gs.categoryPolicies[cat] = { action, minutes: action === 'timeout' && mins ? Math.max(1, Math.min(10080, mins)) : (before?.minutes || 0) };
            saveData(data);
            await interaction.reply({ content: `✅ Policy updated for **${cat}**: action=${action}${action === 'timeout' ? ` minutes=${gs.categoryPolicies[cat].minutes}` : ''}`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Policy Updated', [
                `category: **${cat}**`,
                `action: **${before?.action || 'default'}** -> **${action}**`,
                action === 'timeout' ? `minutes: **${before?.minutes || 0}** -> **${gs.categoryPolicies[cat].minutes}**` : null,
            ]);
            break;
        }

        case 'policystatus': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const cats = ['spam','scam','command','trade','service','beg','acctrade'];
            const lines = cats.map(c => {
                const p = getCategoryPolicy(gs, c);
                return `**${c}**: action=${p.action}${p.action === 'timeout' ? ` minutes=${p.minutes}` : ''}`;
            });
            const embed = new EmbedBuilder()
                .setTitle('📜 Policy Status')
                .setColor(0x5865F2)
                .setDescription(lines.join('\n'))
                .addFields({ name: 'Mode', value: `**${gs.enforcementMode}**`, inline: true })
                .setTimestamp();
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'botstatus': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const embed = new EmbedBuilder()
                .setTitle('📊 Bot Status / Configuration')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Setup',       value: isServerSetup(gs) ? '✅ Complete' : '⚠️ Not Set Up (redirects OFF)', inline: true },
                    { name: 'Strictness',  value: `${getStrictness(gs)}/10`, inline: true },
                    { name: 'AI Thresh',   value: `${(getAiConfidenceThreshold(gs)*100).toFixed(0)}%`, inline: true },
                    { name: 'Checks', value: gs.checksEnabled ? '✅ ON' : '❌ OFF', inline: true },
                    { name: 'AI', value: gs.aiEnabled ? '✅ ON' : '❌ OFF', inline: true },
                    { name: 'No-Affiliation', value: gs.noAffiliationEnabled ? '✅ ON' : '❌ OFF', inline: true },

                    { name: 'Link Mode', value: String(gs.linkMode || 'strict'), inline: true },
                    { name: 'Link Action', value: String(gs.linkAction || 'warn'), inline: true },
                    { name: 'Auto-Timeouts', value: gs.timeoutEnabled ? '✅ ON' : '❌ OFF', inline: true },

                    { name: 'Verify Gate', value: gs.verifyGateEnabled ? `✅ ON (minDays=${gs.verifyMinAccountAgeDays}, role=${gs.verifyRequiredRoleId || 'None'}, action=${gs.verifyGateAction})` : '❌ OFF', inline: false },
                    { name: 'Timeout Minutes', value: `spam=${gs.timeoutMinutesSpam} scam=${gs.timeoutMinutesScam} command=${gs.timeoutMinutesCommand} trade=${gs.timeoutMinutesTrade} service=${gs.timeoutMinutesService}`, inline: false },
                    { name: 'Channels', value:
                        `trade=${gs.tradeChannelId ? `<#${gs.tradeChannelId}>` : 'None'}\n` +
                        `services=${gs.servicesChannelId ? `<#${gs.servicesChannelId}>` : 'None'}\n` +
                        `commands=${(gs.gamesHubId || DEFAULT_GAMES_HUB_ID) ? `<#${gs.gamesHubId || DEFAULT_GAMES_HUB_ID}>` : 'None'}\n` +
                        `log=${gs.logChannelId ? `<#${gs.logChannelId}>` : 'None'}\n` +
                        `exile=${gs.exileChannelId ? `<#${gs.exileChannelId}>` : 'None'}`,
                        inline: false
                    },
                )
                .setTimestamp();
            const ft = footerText(gs);
            if (ft) embed.setFooter({ text: ft });
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /set subcommands ──────────────────────────────
        case 'set': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();
            const beforeTrade = gs.tradeChannelId;
            const beforeServices = gs.servicesChannelId;
            const beforeCommand = gs.gamesHubId;
            const optCh = interaction.options.getChannel('channel');
            const optId = (interaction.options.getString('id') || '').trim();
            let resolvedCh = optCh;
            if (!resolvedCh && optId && /^\d{15,20}$/.test(optId)) {
                resolvedCh = await interaction.guild.channels.fetch(optId).catch(()=>null);
            }

            if ((sub === 'tradechannel' || sub === 'serviceschannel' || sub === 'commandchannel') && !resolvedCh) {
                await interaction.reply({ content: '❌ Provide a channel or a valid channel ID.', flags: MessageFlags.Ephemeral });
                return;
            }

            if (sub === 'tradechannel')    { gs.tradeChannelId    = resolvedCh.id; }
            if (sub === 'serviceschannel') { gs.servicesChannelId = resolvedCh.id; }
            if (sub === 'logchannel')      { gs.logChannelId      = interaction.options.getChannel('channel').id; }
            if (sub === 'exilerole')       { gs.exiledRoleId      = interaction.options.getRole('role').id; }
            if (sub === 'appealschannel')  { gs.appealsChannelId  = interaction.options.getChannel('channel').id; }
            if (sub === 'commandchannel')  { gs.gamesHubId        = resolvedCh.id; }
            if (sub === 'prefix') {
                const newPrefix = interaction.options.getString('prefix');
                if (!newPrefix || newPrefix.length > 5) {
                    await interaction.reply({ content: '❌ Prefix must be between 1–5 characters.', flags: MessageFlags.Ephemeral });
                    return;
                }
                const oldPrefix = gs.commandPrefix || '!';
                gs.commandPrefix = newPrefix;
                saveData(data);
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Prefix Updated', [
                    `Message command prefix changed: \`${oldPrefix}\` → \`${newPrefix}\``,
                ]);
                await interaction.reply({ content: `✅ Message command prefix set to \`${newPrefix}\`. Use it like: \`${newPrefix}warn\`, \`${newPrefix}exile\`, etc.`, flags: MessageFlags.Ephemeral });
                return;
            }
            // /set only saves the value — it NEVER enables any detections.
            // Run /setup completeset to enable all detections at once.
            if (gs.noAffiliationEnabled === undefined) gs.noAffiliationEnabled = false;
            saveData(data);
            await interaction.reply({ content: `✅ **${sub}** updated successfully.`, flags: MessageFlags.Ephemeral });
            if (sub === 'tradechannel') {
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Config Updated', [
                    `Trade channel: <#${beforeTrade}> -> <#${gs.tradeChannelId}>`,
                    `New ID: ${gs.tradeChannelId}`,
                ]);
            }
            if (sub === 'serviceschannel') {
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Config Updated', [
                    `Services channel: <#${beforeServices}> -> <#${gs.servicesChannelId}>`,
                    `New ID: ${gs.servicesChannelId}`,
                ]);
            }
            if (sub === 'commandchannel') {
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Config Updated', [
                    `Command channel: <#${beforeCommand}> -> <#${gs.gamesHubId}>`,
                    `New ID: ${gs.gamesHubId}`,
                ]);
            }
            break;
        }

        // ── /clear subcommands ────────────────────────────
        case 'clear': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();
            const beforeTrade = gs.tradeChannelId;
            const beforeServices = gs.servicesChannelId;
            const beforeCommand = gs.gamesHubId;
            if (sub === 'tradechannel')    gs.tradeChannelId    = DEFAULT_TARGET_CHANNEL_ID;
            if (sub === 'serviceschannel') gs.servicesChannelId = DEFAULT_SERVICES_CHANNEL_ID;
            if (sub === 'commandchannel')  gs.gamesHubId        = DEFAULT_GAMES_HUB_ID;
            saveData(data);
            await interaction.reply({ content: `✅ **${sub}** cleared (reverted to default).`, flags: MessageFlags.Ephemeral });
            if (sub === 'tradechannel') {
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🧹 Config Cleared', [
                    `Trade channel: <#${beforeTrade}> -> <#${gs.tradeChannelId}> (default)`,
                    `Default ID: ${gs.tradeChannelId}`,
                ]);
            }
            if (sub === 'serviceschannel') {
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🧹 Config Cleared', [
                    `Services channel: <#${beforeServices}> -> <#${gs.servicesChannelId}> (default)`,
                    `Default ID: ${gs.servicesChannelId}`,
                ]);
            }
            if (sub === 'commandchannel') {
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🧹 Config Cleared', [
                    `Command channel: <#${beforeCommand}> -> <#${gs.gamesHubId}> (default)`,
                    `Default ID: ${gs.gamesHubId}`,
                ]);
            }
            break;
        }

        // ── /exilechannel create ──────────────────────────
        case 'exilechannel': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            if (interaction.options.getSubcommand() === 'create') {
                await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
                try {
                    const exRole = interaction.guild.roles.cache.get(gs.exiledRoleId);
                    const permOverwrites = [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] },
                    ];
                    if (exRole) permOverwrites.push({ id: exRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                    const ch = await interaction.guild.channels.create({
                        name: 'exile-zone',
                        type: ChannelType.GuildText,
                        topic: '⛓️ You have been exiled. Wait here until your exile expires.',
                        permissionOverwrites: permOverwrites,
                    });
                    gs.exileChannelId = ch.id;
                    saveData(data);
                    await safeEdit(interaction, { content: `✅ Exile channel created: <#${ch.id}>` });
                } catch(e) {
                    await safeEdit(interaction, { content: `❌ Failed to create exile channel: ${e.message}` });
                }
            }
            break;
        }

        // ── /exilerole create ─────────────────────────────
        case 'exilerole': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            if (interaction.options.getSubcommand() === 'create') {
                await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
                try {
                    const role = await interaction.guild.roles.create({
                        name: '⛓️ Exiled',
                        color: 0x555555,
                        reason: 'SKYNET V7 auto-created exile role',
                    });
                    // Deny channel access for all text channels
                    for (const [, ch] of interaction.guild.channels.cache) {
                        if (ch.type === ChannelType.GuildText) {
                            await ch.permissionOverwrites.create(role, { SendMessages: false, AddReactions: false }).catch(()=>{});
                        }
                    }
                    gs.exiledRoleId = role.id;
                    saveData(data);
                    await safeEdit(interaction, { content: `✅ Exile role created: <@&${role.id}>\nIt has been denied from all text channels.` });
                } catch(e) {
                    await safeEdit(interaction, { content: `❌ Failed to create exile role: ${e.message}` });
                }
            }
            break;
        }

        // ── /exileconfig ──────────────────────────────────
        case 'exileconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const ecSub = interaction.options.getSubcommand();
            if (ecSub === 'setrole') {
                const role = interaction.options.getRole('role');
                gs.exiledRoleId = role.id;
                saveData(data);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('⛓️ Exile Config — Role Updated')
                        .setColor(0xFF4444)
                        .addFields(
                            { name: 'Exile Role', value: `<@&${role.id}> (${role.id})`, inline: false },
                            { name: 'Strip Roles on Exile', value: gs.exileStripRoles ? '✅ ON — roles are NOT restored on unexile' : '❌ OFF — roles are restored on unexile', inline: false },
                        )
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
                await sendLog(interaction.guild, data, new EmbedBuilder()
                    .setTitle('⛓️ Exile Config — Role Updated')
                    .setColor(0xFF4444)
                    .setDescription(`Exile role set to <@&${role.id}> (${role.id}) by <@${interaction.user.id}>`)
                    .setTimestamp());
            } else if (ecSub === 'striproles') {
                const toggle = interaction.options.getString('toggle');
                gs.exileStripRoles = (toggle === 'on');
                saveData(data);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('⛓️ Exile Config — Strip Roles')
                        .setColor(gs.exileStripRoles ? 0xFF4444 : 0x00CC66)
                        .setDescription(gs.exileStripRoles
                            ? '✅ **Strip Roles is now ON.**\nWhen a member is exiled, all their roles are removed and will **not** be restored when unexiled.'
                            : '❌ **Strip Roles is now OFF.**\nWhen a member is exiled, their roles are saved and **restored** when unexiled.')
                        .addFields(
                            { name: 'Exile Role', value: gs.exiledRoleId ? `<@&${gs.exiledRoleId}>` : 'Not set — use `/exileconfig setrole`', inline: false },
                        )
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
                await sendLog(interaction.guild, data, new EmbedBuilder()
                    .setTitle('⛓️ Exile Config — Strip Roles Toggled')
                    .setColor(gs.exileStripRoles ? 0xFF4444 : 0x00CC66)
                    .setDescription(`Strip roles on exile set to **${gs.exileStripRoles ? 'ON' : 'OFF'}** by <@${interaction.user.id}>`)
                    .setTimestamp());
            } else if (ecSub === 'removerole') {
                const toggle = interaction.options.getString('toggle');
                gs.exileRemoveRole = (toggle === 'on');
                saveData(data);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('⛓️ Exile Config — Remove Role')
                        .setColor(gs.exileRemoveRole ? 0xFF8800 : 0x00CC66)
                        .setDescription(gs.exileRemoveRole
                            ? '✅ **Remove Role is now ON.**\nWhen a member is exiled, all their roles are **removed** and the exile role is added. Their roles are **restored** when unexiled.'
                            : '❌ **Remove Role is now OFF.**\nWhen a member is exiled, the exile role is **only added** to their existing roles. When unexiled, the exile role is simply **removed** — all other roles stay untouched.')
                        .addFields(
                            { name: 'Exile Role',    value: gs.exiledRoleId ? `<@&${gs.exiledRoleId}>` : 'Not set — use `/exileconfig setrole`', inline: false },
                            { name: 'Strip Roles',   value: gs.exileStripRoles ? '✅ ON (permanent strip)' : '❌ OFF', inline: true },
                            { name: 'Remove Role',   value: gs.exileRemoveRole ? '✅ ON (remove & restore)' : '❌ OFF (add-only)', inline: true },
                        )
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
                await sendLog(interaction.guild, data, new EmbedBuilder()
                    .setTitle('⛓️ Exile Config — Remove Role Toggled')
                    .setColor(gs.exileRemoveRole ? 0xFF8800 : 0x00CC66)
                    .setDescription(`Remove role on exile set to **${gs.exileRemoveRole ? 'ON' : 'OFF'}** by <@${interaction.user.id}>`)
                    .setTimestamp());
            }
            break;
        }

        // ── /immunity ─────────────────────────────────────
        case 'immunity': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub   = interaction.options.getSubcommand(false);
            const group = interaction.options.getSubcommandGroup(false);
            // enable / disable / status
            if (!group) {
                if (sub === 'enable')  { imm.enabled = true;  saveData(data); await interaction.reply({ content: '✅ **Staff immunity ENABLED.** Admins/mods are now immune from scanning.', flags: MessageFlags.Ephemeral }); return; }
                if (sub === 'disable') { imm.enabled = false; saveData(data); await interaction.reply({ content: '⚠️ **Staff immunity DISABLED.** Everyone is scanned, including staff.', flags: MessageFlags.Ephemeral }); return; }
                if (sub === 'status') {
                    const roleNames   = imm.whitelistedRoles.map(rid => { const r = interaction.guild.roles.cache.get(rid); return r ? `<@&${rid}>` : `Unknown (${rid})`; });
                    const memberNames = imm.whitelistedMembers.map(uid => `<@${uid}>`);
                    await interaction.reply({ embeds: [new EmbedBuilder()
                        .setTitle('🛡️ Immunity Settings')
                        .setColor(imm.enabled ? 0x00FF88 : 0xFF4444)
                        .addFields(
                            { name: 'Immunity Status',     value: imm.enabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                            { name: 'Whitelisted Roles',   value: roleNames.length   ? roleNames.join('\n')   : 'None', inline: false },
                            { name: 'Whitelisted Members', value: memberNames.length ? memberNames.join('\n') : 'None', inline: false },
                        )], flags: MessageFlags.Ephemeral });
                    return;
                }
            }
            // add role / add member
            if (group === 'add') {
                if (sub === 'role') {
                    const role = interaction.options.getRole('role');
                    if (!imm.whitelistedRoles.includes(role.id)) { imm.whitelistedRoles.push(role.id); saveData(data); }
                    await interaction.reply({ content: `✅ Role **${role.name}** added to immunity whitelist.`, flags: MessageFlags.Ephemeral });
                } else if (sub === 'member') {
                    const user = interaction.options.getUser('user');
                    if (!imm.whitelistedMembers.includes(user.id)) { imm.whitelistedMembers.push(user.id); saveData(data); }
                    await interaction.reply({ content: `✅ Member <@${user.id}> added to immunity whitelist.`, flags: MessageFlags.Ephemeral });
                }
                return;
            }
            // remove role / remove member
            if (group === 'remove') {
                if (sub === 'role') {
                    const role = interaction.options.getRole('role');
                    imm.whitelistedRoles = imm.whitelistedRoles.filter(id => id !== role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Role **${role.name}** removed from immunity whitelist.`, flags: MessageFlags.Ephemeral });
                } else if (sub === 'member') {
                    const user = interaction.options.getUser('user');
                    imm.whitelistedMembers = imm.whitelistedMembers.filter(id => id !== user.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Member <@${user.id}> removed from immunity whitelist.`, flags: MessageFlags.Ephemeral });
                }
                return;
            }
            break;
        }

        case 'aienable': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand(false);

            // /aienable off → disable AI detection
            if (sub === 'off') {
                gs.aiEnabled = false;
                saveData(data);
                await interaction.reply({ content: '⚠️ AI detection is now **DISABLED** for this server.', flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🤖 AI Disabled', [`AI detection: **OFF**`]);
                break;
            }

            // /aienable on or /aienable model → enable
            gs.aiEnabled = true;
            saveData(data);
            let modelLine = '';

            if (sub === 'model') {
                const providerChoice = interaction.options.getString('provider');
                const providerMap = {
                    'groq':           { provider: 'groq',   model: 'llama-3.3-70b-versatile',   label: 'Groq — llama-3.3-70b-versatile' },
                    'groq-llama31':   { provider: 'groq',   model: 'llama-3.1-70b-versatile',   label: 'Groq — llama-3.1-70b-versatile' },
                    'groq-mixtral':   { provider: 'groq',   model: 'mixtral-8x7b-32768',        label: 'Groq — mixtral-8x7b-32768' },
                    'groq-gpt-oss':   { provider: 'groq',   model: 'openai/gpt-oss-120b',       label: 'Groq — openai/gpt-oss-120b' },
                    'openai-gpt4o':   { provider: 'openai', model: 'gpt-4o',                    label: 'OpenAI — gpt-4o' },
                    'openai-gpt4omini':{ provider: 'openai',model: 'gpt-4o-mini',               label: 'OpenAI — gpt-4o-mini' },
                    'claude':         { provider: 'claude', model: 'claude-haiku-4-5-20251001', label: 'Claude — claude-haiku-4-5 (fast)' },
                    'claude-sonnet':  { provider: 'claude', model: 'claude-sonnet-4-6',         label: 'Claude — claude-sonnet-4-6 (balanced)' },
                    'claude-opus':    { provider: 'claude', model: 'claude-opus-4-6',           label: 'Claude — claude-opus-4-6 (powerful)' },
                };
                const chosen = providerMap[providerChoice];
                if (chosen) {
                    ai2State.activeProvider = chosen.provider;
                    if (chosen.provider === 'claude') ai2State.claudeModel = chosen.model;
                    if (chosen.provider === 'openai') ai2State.openaiModel = chosen.model;
                    if (chosen.provider === 'groq')   ai2State.groqModel   = chosen.model;
                    ai2InitClient(chosen.provider);
                    ai2Model = chosen.model;
                    modelLine = `\n🤖 Chat model set to: **${chosen.label}**`;
                }
            }

            await interaction.reply({ content: `✅ AI detection is now **ENABLED** for this server.${modelLine}`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🤖 AI Enabled', [`AI detection: **ON**${modelLine}`]);
            break;
        }

        // Legacy fallback — aidisable slash was removed; handled above via /aienable off
        case 'aidisable': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            gs.aiEnabled = false;
            saveData(data);
            await interaction.reply({ content: '⚠️ AI detection is now **DISABLED**. (Tip: use `/aienable off` going forward)', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🤖 AI Disabled', [`AI detection: **OFF**`]);
            break;
        }

        // /check enable|disable|status — replaces /enablecheck and /disablecheck
        case 'check': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const csub = interaction.options.getSubcommand();
            if (csub === 'status') {
                await interaction.reply({ content: `🛡️ Moderation checks are currently **${gs.checksEnabled !== false ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            } else {
                gs.checksEnabled = (csub === 'enable');
                saveData(data);
                await interaction.reply({ content: `${gs.checksEnabled ? '✅' : '🛑'} All moderation checks are now **${gs.checksEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, gs.checksEnabled ? '✅ Checks Enabled' : '🛑 Checks Disabled', [`Checks: **${gs.checksEnabled ? 'ON' : 'OFF'}**`]);
            }
            break;
        }

        // Legacy fallbacks — disablecheck/enablecheck slash commands removed; /check replaces them
        case 'disablecheck': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            gs.checksEnabled = false;
            saveData(data);
            await interaction.reply({ content: '🛑 All moderation checks are now **DISABLED**. (Tip: use `/check disable` going forward)', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🛑 Checks Disabled', [`Checks: **OFF**`]);
            break;
        }
        case 'enablecheck': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            gs.checksEnabled = true;
            saveData(data);
            await interaction.reply({ content: '✅ All moderation checks are now **ENABLED**. (Tip: use `/check enable` going forward)', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '✅ Checks Enabled', [`Checks: **ON**`]);
            break;
        }

        case 'noaffiliation':
        case 'noaffliation': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();
            const before = gs.noAffiliationEnabled;
            gs.noAffiliationEnabled = (sub === 'enable');
            saveData(data);
            await interaction.reply({ content: `✅ No-affiliation mode is now **${gs.noAffiliationEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🏷️ No-Affiliation Mode', [
                `No-affiliation: **${before ? 'ON' : 'OFF'}** -> **${gs.noAffiliationEnabled ? 'ON' : 'OFF'}**`,
            ]);
            break;
        }

        case 'botinfo': {
            const ownerStr = gs.botOwnerId ? `<@${gs.botOwnerId}> (${gs.botOwnerId})` : 'Open Source / Community Run';
            const coderStr = `<@${BOT_CODED_BY_ID}> (${BOT_CODED_BY_ID})`;
            const embed = new EmbedBuilder()
                .setTitle('🤖 Bot Info')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Owner', value: ownerStr, inline: false },
                    { name: 'Coded By', value: coderStr, inline: false },
                )
                .setTimestamp();
            const ft = footerText(gs);
            if (ft) embed.setFooter({ text: ft });
            await interaction.reply({ embeds: [embed], ephemeral: !gs.botInfoPublic });
            break;
        }

        case 'setowner': {
            if (!isSuperUser(interaction.user.id)) { await interaction.reply({ content: '❌ Only the bot superuser can set the bot owner.', flags: MessageFlags.Ephemeral }); return; }
            const u = interaction.options.getUser('owner');
            gs.botOwnerId = u?.id || null;
            saveData(data);
            const payload = { content: `✅ Bot owner set to <@${gs.botOwnerId}> (${gs.botOwnerId}).`, flags: MessageFlags.Ephemeral };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
            else await interaction.reply(payload);
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Bot Owner Updated', [
                `Owner: <@${gs.botOwnerId}> (${gs.botOwnerId})`,
            ]);
            break;
        }

        case 'clearowner': {
            if (!isSuperUser(interaction.user.id)) { await interaction.reply({ content: '❌ Only the bot superuser can clear the bot owner.', flags: MessageFlags.Ephemeral }); return; }
            gs.botOwnerId = null;
            saveData(data);
            const payload = { content: '✅ Bot owner cleared (Open Source / Community Run).', flags: MessageFlags.Ephemeral };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
            else await interaction.reply(payload);
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Bot Owner Cleared', []);
            break;
        }

        case 'setfooter': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const t = String(interaction.options.getString('text') || '').trim().slice(0, 200);
            if (!t) { await interaction.reply({ content: '❌ Provide footer text.', flags: MessageFlags.Ephemeral }); return; }
            gs.botFooterText = t;
            saveData(data);
            await interaction.reply({ content: '✅ Footer updated.', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Footer Updated', [
                `Footer: ${t}`,
            ]);
            break;
        }

        case 'clearfooter': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            gs.botFooterText = null;
            saveData(data);
            await interaction.reply({ content: '✅ Footer cleared.', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Footer Cleared', []);
            break;
        }

        case 'botinfopublic': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const m = (interaction.options.getString('mode') || '').toLowerCase();
            const v = ['on','true','yes','1','enable','enabled'].includes(m) ? true
                : (['off','false','no','0','disable','disabled'].includes(m) ? false : null);
            if (v === null) { await interaction.reply({ content: '❌ Use: on/off', flags: MessageFlags.Ephemeral }); return; }
            const before = gs.botInfoPublic;
            gs.botInfoPublic = v;
            saveData(data);
            await interaction.reply({ content: `✅ /botinfo is now **${gs.botInfoPublic ? 'PUBLIC' : 'EPHEMERAL'}**.`, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ BotInfo Visibility', [
                `botInfoPublic: **${before ? 'ON' : 'OFF'}** -> **${gs.botInfoPublic ? 'ON' : 'OFF'}**`,
            ]);
            break;
        }

        // ── /link ─────────────────────────────────────────
        case 'link': {
            const sub = interaction.options.getSubcommand();
            if (sub === 'mode') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                const mode = (interaction.options.getString('mode') || '').toLowerCase();
                if (!['strict','medium','off'].includes(mode)) { await interaction.reply({ content: '❌ Use: strict|medium|off', flags: MessageFlags.Ephemeral }); return; }
                const before = gs.linkMode;
                gs.linkMode = mode;
                saveData(data);
                await interaction.reply({ content: `✅ Link mode set to **${mode}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Link Mode Updated', [`linkMode: **${before}** -> **${gs.linkMode}**`]);
            } else if (sub === 'action') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                const action = (interaction.options.getString('action') || '').toLowerCase();
                if (!['delete','warn','exile','timeout'].includes(action)) { await interaction.reply({ content: '❌ Use: delete|warn|exile|timeout', flags: MessageFlags.Ephemeral }); return; }
                const before = gs.linkAction;
                gs.linkAction = action;
                const mins = interaction.options.getInteger('minutes');
                if (action === 'timeout' && mins) gs.timeoutMinutesScam = Math.max(1, Math.min(10080, mins));
                saveData(data);
                await interaction.reply({ content: `✅ Link action set to **${action}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Link Action Updated', [
                    `linkAction: **${before}** -> **${gs.linkAction}**`,
                    action === 'timeout' ? `timeoutMinutesScam: ${gs.timeoutMinutesScam}` : null,
                ]);
            } else if (sub === 'policy') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                gs.linkPolicyEnabled = !!interaction.options.getBoolean('enabled');
                saveData(data);
                await interaction.reply({ content: `✅ Link policy is now **${gs.linkPolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            } else if (sub === 'allow') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                const dom = normalizeDomain(interaction.options.getString('domain'));
                if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', flags: MessageFlags.Ephemeral }); return; }
                gs.linkAllowlistedDomains = Array.isArray(gs.linkAllowlistedDomains) ? gs.linkAllowlistedDomains : [];
                if (!gs.linkAllowlistedDomains.includes(dom)) gs.linkAllowlistedDomains.push(dom);
                saveData(data);
                await interaction.reply({ content: `✅ Allowlisted: **${dom}**`, flags: MessageFlags.Ephemeral });
            } else if (sub === 'deny') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                const dom = normalizeDomain(interaction.options.getString('domain'));
                if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', flags: MessageFlags.Ephemeral }); return; }
                gs.linkDenylistedDomains = Array.isArray(gs.linkDenylistedDomains) ? gs.linkDenylistedDomains : [];
                if (!gs.linkDenylistedDomains.includes(dom)) gs.linkDenylistedDomains.push(dom);
                saveData(data);
                await interaction.reply({ content: `✅ Denylisted: **${dom}**`, flags: MessageFlags.Ephemeral });
            } else if (sub === 'list') {
                if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
                const allow = (gs.linkAllowlistedDomains || []).slice(0, 60);
                const deny  = (gs.linkDenylistedDomains || []).slice(0, 60);
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔗 Link Policy Domains')
                    .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
                    .addFields(
                        { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                        { name: 'Allowlist (first 60)', value: allow.length ? allow.join('\n').slice(0, 1024) : 'None', inline: false },
                        { name: 'Denylist (first 60)',  value: deny.length  ? deny.join('\n').slice(0, 1024)  : 'None', inline: false },
                    ).setTimestamp()], flags: MessageFlags.Ephemeral });
            } else if (sub === 'status') {
                if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
                const allow = (gs.linkAllowlistedDomains || []).length;
                const deny  = (gs.linkDenylistedDomains || []).length;
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔗 Link Policy Status')
                    .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
                    .addFields(
                        { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                        { name: 'Allowlist Size', value: String(allow), inline: true },
                        { name: 'Denylist Size', value: String(deny), inline: true },
                        { name: 'Raid Block Links', value: gs.raidLinkBlockAll ? '✅ ON' : '❌ OFF', inline: true },
                    ).setTimestamp()], flags: MessageFlags.Ephemeral });
            } else if (sub === 'remove') {
                if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
                const list = (interaction.options.getString('list') || '').toLowerCase();
                const dom = normalizeDomain(interaction.options.getString('domain'));
                if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', flags: MessageFlags.Ephemeral }); return; }
                if (list === 'allow') gs.linkAllowlistedDomains = (gs.linkAllowlistedDomains || []).filter(x => normalizeDomain(x) !== dom);
                if (list === 'deny')  gs.linkDenylistedDomains  = (gs.linkDenylistedDomains  || []).filter(x => normalizeDomain(x) !== dom);
                saveData(data);
                await interaction.reply({ content: `✅ Removed **${dom}** from **${list}** list.`, flags: MessageFlags.Ephemeral });
            }
            break;
        }
        // legacy aliases kept for text-command compat — slash routes through 'link'

        case 'verifygate': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();
            if (sub === 'enable' || sub === 'disable') {
                const before = gs.verifyGateEnabled;
                gs.verifyGateEnabled = (sub === 'enable');
                saveData(data);
                await interaction.reply({ content: `✅ Verify gate is now **${gs.verifyGateEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Verify Gate', [
                    `verifyGateEnabled: **${before ? 'ON' : 'OFF'}** -> **${gs.verifyGateEnabled ? 'ON' : 'OFF'}**`,
                ]);
                return;
            }

            const beforeDays = gs.verifyMinAccountAgeDays;
            const beforeRole = gs.verifyRequiredRoleId;
            const beforeAction = gs.verifyGateAction;

            const days = interaction.options.getInteger('minaccountdays');
            const role = interaction.options.getRole('requiredrole');
            const action = (interaction.options.getString('action') || '').toLowerCase();
            const mins = interaction.options.getInteger('minutes');

            if (days !== null) gs.verifyMinAccountAgeDays = Math.max(0, Math.min(365, days));
            if (role) gs.verifyRequiredRoleId = role.id;
            if (action && ['delete','warn','timeout'].includes(action)) gs.verifyGateAction = action;
            if (gs.verifyGateAction === 'timeout' && mins) gs.timeoutMinutesCommand = Math.max(1, Math.min(10080, mins));
            saveData(data);
            await interaction.reply({ content: '✅ Verify gate config updated.', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Verify Gate Config', [
                `minAccountDays: **${beforeDays}** -> **${gs.verifyMinAccountAgeDays}**`,
                `requiredRole: **${beforeRole || 'None'}** -> **${gs.verifyRequiredRoleId || 'None'}**`,
                `action: **${beforeAction}** -> **${gs.verifyGateAction}**`,
            ]);
            break;
        }

        case 'timeoutconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();
            if (sub === 'enable' || sub === 'disable') {
                const before = gs.timeoutEnabled;
                gs.timeoutEnabled = (sub === 'enable');
                saveData(data);
                await interaction.reply({ content: `✅ Auto-timeouts are now **${gs.timeoutEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Auto-Timeouts', [
                    `timeoutEnabled: **${before ? 'ON' : 'OFF'}** -> **${gs.timeoutEnabled ? 'ON' : 'OFF'}**`,
                ]);
                return;
            }

            const spam = interaction.options.getInteger('spam');
            const scam = interaction.options.getInteger('scam');
            const command = interaction.options.getInteger('command');
            const trade = interaction.options.getInteger('trade');
            const service = interaction.options.getInteger('service');

            if (spam !== null) gs.timeoutMinutesSpam = Math.max(1, Math.min(10080, spam));
            if (scam !== null) gs.timeoutMinutesScam = Math.max(1, Math.min(10080, scam));
            if (command !== null) gs.timeoutMinutesCommand = Math.max(1, Math.min(10080, command));
            if (trade !== null) gs.timeoutMinutesTrade = Math.max(1, Math.min(10080, trade));
            if (service !== null) gs.timeoutMinutesService = Math.max(1, Math.min(10080, service));
            saveData(data);
            await interaction.reply({ content: '✅ Timeout minutes updated.', flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Timeout Config', [
                `spam=${gs.timeoutMinutesSpam}m scam=${gs.timeoutMinutesScam}m command=${gs.timeoutMinutesCommand}m trade=${gs.timeoutMinutesTrade}m service=${gs.timeoutMinutesService}m`,
            ]);
            break;
        }

        case 'commandimmunity':  { await handleCategoryImmunity('command'); break; }
        case 'serviceimmunity':  { await handleCategoryImmunity('service'); break; }
        case 'tradeimmunity':    { await handleCategoryImmunity('trade'); break; }
        case 'spamimmunity':     { await handleCategoryImmunity('spam'); break; }
        case 'begimmunity':      { await handleCategoryImmunity('beg'); break; }
        case 'scamimmunity':     { await handleCategoryImmunity('scam'); break; }
        case 'acctradeimmunity': { await handleCategoryImmunity('acctrade'); break; }

        // ── /roastconfig ──────────────────────────────────
        case 'roastconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const rsub = interaction.options.getSubcommand();

            if (rsub === 'status') {
                const embed = new EmbedBuilder()
                    .setTitle('🔥 Roast Config')
                    .setColor(0xFF6600)
                    .addFields(
                        { name: 'Provider', value: gs.roastProvider || 'roastedbyai', inline: true },
                        { name: 'Context (last 5 msgs)', value: gs.roastContext ? '✅ ON' : '❌ OFF', inline: true },
                    )
                    .setDescription(
                        '**Provider choices:**\n' +
                        '`claude` — Claude API only\n' +
                        '`roastedbyai` — roastedbyai only\n' +
                        '`gpt-oss-120b` — OpenRouter (openai/gpt-oss-120b) only\n\n' +
                        '**Fallback order:** primary → gpt-oss-120b → hardcoded list\n\n' +
                        '**Context:** when ON, the bot fetches the target\'s last 5 messages in the channel and feeds them to the AI for a more personalised roast.'
                    )
                    .setTimestamp();
                const ft = footerText(gs);
                if (ft) embed.setFooter({ text: ft });
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            if (rsub === 'provider') {
                const prev = gs.roastProvider;
                gs.roastProvider = interaction.options.getString('provider') || 'roastedbyai';
                saveData(data);
                await interaction.reply({ content: `✅ Roast provider set to **${gs.roastProvider}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🔥 Roast Config', [
                    `provider: **${prev}** → **${gs.roastProvider}**`,
                ]);
                return;
            }

            if (rsub === 'context') {
                const toggle = interaction.options.getString('toggle');
                const prev = gs.roastContext;
                gs.roastContext = (toggle === 'on');
                saveData(data);
                await interaction.reply({ content: `✅ Roast context is now **${gs.roastContext ? 'ON' : 'OFF'}**.`, flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🔥 Roast Config', [
                    `context: **${prev ? 'ON' : 'OFF'}** → **${gs.roastContext ? 'ON' : 'OFF'}**`,
                ]);
                return;
            }

            await interaction.reply({ content: '❌ Unknown subcommand.', flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /exile ────────────────────────────────────────
        case 'exile': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins only.' }); return; }
            if (isExileChannel(interaction.channelId, interaction.guild, gs)) {
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Exile commands cannot be used inside the exile channel.' });
                return;
            }
            const targetUser = interaction.options.getUser('user');
            const durationRaw = interaction.options.getString('duration');
            const duration    = (durationRaw ? parseDuration(durationRaw) : null) ?? EXILE_DURATION_MINS;
            const reason     = interaction.options.getString('reason') || 'Admin action';
            const target     = await interaction.guild.members.fetch(targetUser.id).catch(()=>null);
            if (!target) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Member not found.' }); return; }
            const exileHierErr = checkHierarchy(interaction.member, target);
            if (exileHierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: exileHierErr }); return; }
            await interaction.deferReply();
            await performExile(target, interaction.guild, duration, reason, data);
            saveData(data);
            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('⛓️ Manual Exile')
                .setColor(0xFF6600)
                .addFields(
                    { name: 'User',   value: `<@${target.id}> (${target.id})`, inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,       inline: true },
                    { name: 'Reason', value: reason,                            inline: false },
                    { name: 'Duration', value: `${duration} minutes`,           inline: true },
                ).setTimestamp());
            await interaction.editReply({ content: `🔨 Exiled **${target.user.username}** for **${duration}m**. Reason: ${reason}` });
            break;
        }

        // ── /unexile ──────────────────────────────────────
        case 'unexile': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins only.' }); return; }
            const input  = interaction.options.getString('user');
            const userId = (input.match(/<@!?(\d+)>/) || input.match(/^(\d{15,20})$/) || [])[1] || input;
            const fd     = loadData();
            let member   = interaction.guild.members.cache.get(userId) || await interaction.guild.members.fetch(userId).catch(()=>null);
            if (!member) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Member not found.' }); return; }
            if (member.id === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot unexile yourself.' }); return; }
            await interaction.deferReply();
            await performUnexile(member, interaction.guild, fd);
            delete fd.exiles[userId];
            saveData(fd);
            await sendLog(interaction.guild, fd, new EmbedBuilder()
                .setTitle('🔓 Manual Unexile')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'User', value: `<@${userId}>`, inline: true },
                    { name: 'By',   value: `<@${interaction.user.id}>`, inline: true },
                ).setTimestamp());
            await interaction.editReply({ content: `✅ Unexiled **${member.user.username}**.` });
            break;
        }

        // ── /violations ───────────────────────────────────
        case 'violations': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const user  = interaction.options.getUser('user');
            const count = getViolationCount(data, user.id);
            const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
            const history = getViolationHistory(data, user.id);
            const histLines = history.slice(-10).map((h, i) => {
                const ts = h.timestamp ? `<t:${Math.floor(h.timestamp/1000)}:d>` : 'unknown date';
                const cat = h.category ? `[${h.category}]` : '';
                const by  = h.by ? ` — by <@${h.by}>` : '';
                return `**${i+1}.** ${cat} ${h.reason}${by} — ${ts}`;
            });
            const embed = new EmbedBuilder()
                .setTitle('📊 Violation History')
                .setColor(count >= threshold ? 0xFF4444 : (count > 0 ? 0xFFAA00 : 0x00FF88))
                .setThumbnail(user.displayAvatarURL())
                .setDescription(`<@${user.id}> — **${count}/${threshold}** violations`)
                .addFields({ name: `Recent warnings (${history.length} total)`, value: histLines.length ? histLines.join('\n') : 'No warning history.', inline: false })
                .setTimestamp();

            // Admin-only: show dropdown to remove a specific warn (can't remove your own warns)
            const canRemove = isAdmin && user.id !== interaction.user.id && history.length > 0;
            let components = [];
            if (canRemove) {
                const options = history.slice(-25).map((h, i) => {
                    const ts = h.timestamp ? new Date(h.timestamp).toLocaleDateString('en-GB') : '?';
                    const label = `#${history.length - (history.slice(-25).length - 1 - i)} — ${String(h.reason).slice(0, 80)}`.slice(0, 100);
                    const desc  = `[${h.category || 'unknown'}] ${ts}`.slice(0, 100);
                    const val   = h.warnId || `idx_${i}`;
                    return new StringSelectMenuOptionBuilder().setLabel(label).setDescription(desc).setValue(val);
                });
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`rmwarn_${guildId}_${user.id}`)
                    .setPlaceholder('🗑️ Select a warn to remove (admin only)')
                    .addOptions(options);
                components = [new ActionRowBuilder().addComponents(menu)];
            }
            await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /clearviolations ──────────────────────────────
        case 'clearviolations': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const user = interaction.options.getUser('user');
            if (user.id === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ content: '❌ You cannot clear your own violations.', flags: MessageFlags.Ephemeral }); return; }
            // Hierarchy guard
            const cvTargetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (cvTargetMember) {
                const hierErr = checkHierarchy(interaction.member, cvTargetMember);
                if (hierErr) { await interaction.reply({ content: hierErr, flags: MessageFlags.Ephemeral }); return; }
            }
            clearViolationEntry(data, user.id);
            saveData(data);
            await interaction.reply({ content: `✅ Cleared violations for <@${user.id}>.`, flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /exilelist ────────────────────────────────────
        case 'exilelist': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const now   = Date.now()/1000;
            const lines = Object.entries(data.exiles).map(([uid, info]) =>
                `• <@${uid}> — expires <t:${Math.floor(info.expiry)}:R>`
            );
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('📋 Currently Exiled')
                .setColor(0xFF4400)
                .setDescription(lines.length ? lines.join('\n') : 'Nobody is currently exiled.')], flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /aimodel ──────────────────────────────────────
        case 'aimodel': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            if (!ai2State.enabled) { await interaction.reply({ content: '❌ AI chat system is not enabled (config/config.yaml missing).', flags: MessageFlags.Ephemeral }); return; }
            const providerChoice = interaction.options.getString('provider');

            // Map slash choice values → internal provider + model
            const providerMap = {
                'groq':           { provider: 'groq',   model: 'llama-3.3-70b-versatile',            label: 'Groq — llama-3.3-70b-versatile' },
                'groq-llama31':   { provider: 'groq',   model: 'llama-3.1-70b-versatile',            label: 'Groq — llama-3.1-70b-versatile' },
                'groq-mixtral':   { provider: 'groq',   model: 'mixtral-8x7b-32768',                 label: 'Groq — mixtral-8x7b-32768' },
                'groq-gpt-oss':   { provider: 'groq',   model: 'openai/gpt-oss-120b',                label: 'Groq — openai/gpt-oss-120b' },
                'openai-gpt4o':   { provider: 'openai', model: 'gpt-4o',                             label: 'OpenAI — gpt-4o' },
                'openai-gpt4omini':{ provider: 'openai',model: 'gpt-4o-mini',                        label: 'OpenAI — gpt-4o-mini' },
                'claude':         { provider: 'claude', model: 'claude-haiku-4-5-20251001',          label: 'Claude — claude-haiku-4-5 (fast)' },
                'claude-sonnet':  { provider: 'claude', model: 'claude-sonnet-4-6',                  label: 'Claude — claude-sonnet-4-6 (balanced)' },
                'claude-opus':    { provider: 'claude', model: 'claude-opus-4-6',                    label: 'Claude — claude-opus-4-6 (powerful)' },
            };

            const prev = ai2State.activeProvider || 'groq';
            const prevLabel = providerMap[prev]?.label || prev;
            const chosen = providerMap[providerChoice];
            if (!chosen) { await interaction.reply({ content: '❌ Unknown provider choice.', flags: MessageFlags.Ephemeral }); return; }

            ai2State.activeProvider = chosen.provider;
            ai2State.claudeModel    = chosen.provider === 'claude' ? chosen.model : ai2State.claudeModel;
            ai2State.openaiModel    = chosen.provider === 'openai' ? chosen.model : ai2State.openaiModel;
            ai2State.groqModel      = chosen.provider === 'groq'   ? chosen.model : ai2State.groqModel;
            ai2InitClient(chosen.provider);

            // Override ai2Model with the exact chosen model
            if (chosen.provider === 'groq' || chosen.provider === 'openai') ai2Model = chosen.model;
            if (chosen.provider === 'claude') ai2Model = chosen.model;

            const keyCheck = chosen.provider === 'claude'
                ? (ANTHROPIC_KEY ? '✅ ANTHROPIC_API_KEY found' : '❌ ANTHROPIC_API_KEY missing')
                : chosen.provider === 'openai'
                    ? ((process.env.OPENAI_API_KEY) ? '✅ OPENAI_API_KEY found' : '❌ OPENAI_API_KEY missing')
                    : ((process.env.GROQ_API_KEY) ? '✅ GROQ_API_KEY found' : '❌ GROQ_API_KEY missing');

            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🤖 AI Chat Model Updated')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Previous', value: prevLabel, inline: true },
                    { name: 'Now Using', value: chosen.label, inline: true },
                    { name: 'Model String', value: `\`${chosen.model}\``, inline: false },
                    { name: 'API Key', value: keyCheck, inline: false },
                )
                .setFooter({ text: 'Affects all !toggleactive AI channels immediately' })
                .setTimestamp()], flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /bloxmode ─────────────────────────────────────
        case 'bloxmode': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            if (!ai2State.enabled) { await interaction.reply({ content: '❌ AI chat system is not enabled (config/config.yaml missing).', flags: MessageFlags.Ephemeral }); return; }
            const modeChoice = interaction.options.getString('mode');
            if (modeChoice === 'on') {
                ai2State.instructions = BF_KNOWLEDGE_SYSTEM_PROMPT;
                ai2SaveInstructions(BF_KNOWLEDGE_SYSTEM_PROMPT);
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🍎 Blox Fruits Mode — ON')
                    .setColor(0xFF6B00)
                    .setDescription('The AI will now respond as a Blox Fruits expert with full knowledge of fruits, swords, trades, services, and more.')
                    .setFooter({ text: 'Use /bloxmode off to return to general assistant mode' })
                    .setTimestamp()], flags: MessageFlags.Ephemeral });
            } else {
                ai2State.instructions = GENERAL_ASSISTANT_PROMPT;
                ai2SaveInstructions('');
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🤖 General Assistant Mode — ON')
                    .setColor(0x5865F2)
                    .setDescription('The AI will now respond as a general assistant on any topic — no Blox Fruits focus.')
                    .setFooter({ text: 'Use /bloxmode on to re-enable Blox Fruits expert mode' })
                    .setTimestamp()], flags: MessageFlags.Ephemeral });
            }
            break;
        }

        // ── /botstatus ────────────────────────────────────
        case 'botstatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const totalExiled     = Object.keys(data.exiles).length;
            const totalViolations = Object.values(data.violations).reduce((a, v) => a + (typeof v === 'number' ? v : (v?.count || 0)), 0);
            const tradeIds  = getChannelIds(gs, 'tradeChannelIds');
            const raidIds   = getChannelIds(gs, 'raidServiceChannelIds');
            const raceIds   = getChannelIds(gs, 'raceV4ServiceChannelIds');
            const seaIds    = getChannelIds(gs, 'seaEventsChannelIds');
            const mirageIds = getChannelIds(gs, 'mirageIslandChannelIds');
            const preIds    = getChannelIds(gs, 'prehistoricIslandChannelIds');
            const kitIds    = getChannelIds(gs, 'kitsuneIslandChannelIds');
            const leviIds   = getChannelIds(gs, 'leviathanChannelIds');
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🤖 SKYNET V7 — Status')
                .setColor(0x5865F2)
                .addFields(
                    { name: '🧠 Checks',          value: gs.checksEnabled ? '✅ ON' : '🛑 OFF',       inline: true },
                    { name: '📡 Trade Channels',   value: tradeIds.length ? formatChannelIds(tradeIds) : (gs.tradeChannelId ? `<#${gs.tradeChannelId}>` : 'Not set'), inline: false },
                    { name: '⚔️ Services Channel', value: `<#${gs.servicesChannelId}>`,           inline: true },
                    { name: '⚔️ Raid/Service',     value: formatChannelIds(raidIds),              inline: true },
                    { name: '🏁 Race/Trials',      value: formatChannelIds(raceIds),              inline: true },
                    { name: '🌊 Sea Events',        value: formatChannelIds(seaIds),              inline: true },
                    { name: '🏝️ Mirage Island',    value: formatChannelIds(mirageIds),           inline: true },
                    { name: '🦕 Prehistoric Isl.', value: formatChannelIds(preIds),              inline: true },
                    { name: '🦊 Kitsune Island',   value: formatChannelIds(kitIds),              inline: true },
                    { name: '🐉 Leviathan/Frozen', value: formatChannelIds(leviIds),            inline: true },
                    { name: '📋 Log Channel',      value: gs.logChannelId ? `<#${gs.logChannelId}>` : 'Not set', inline: true },
                    { name: '📩 Appeals Channel',  value: gs.appealsChannelId ? `<#${gs.appealsChannelId}>` : 'Not set', inline: true },
                    { name: '⛓️ Exile Role',       value: `<@&${gs.exiledRoleId}>`,               inline: true },
                    { name: '🛡️ Immunity',         value: imm.enabled ? '✅ ON' : '❌ OFF',        inline: true },
                    { name: '🚨 Scam Detection',   value: gs.scamEnabled ? '✅ ON' : '❌ OFF',      inline: true },
                    { name: '⚙️ Threshold',        value: String(gs.violationThreshold || VIOLATION_THRESHOLD), inline: true },
                    { name: '⏱️ Exile Duration',   value: `${gs.exileDurationMins || EXILE_DURATION_MINS}m`, inline: true },
                    { name: '👥 Currently Exiled', value: String(totalExiled),                    inline: true },
                    { name: '⚠️ Total Violations', value: String(totalViolations),                inline: true },
                    { name: '🤖 AI Detection',     value: AI_ENABLED ? '✅ ON' : '❌ OFF',         inline: true },
                )
                .setTimestamp()], flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /channelconfig ────────────────────────────────
        case 'channelconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const sub = interaction.options.getSubcommand();

            if (sub === 'list') {
                const lines = Object.entries(CHANNEL_CATEGORIES).map(([cat, meta]) => {
                    const ids = getChannelIds(gs, meta.key);
                    return `**${meta.label}** (\`${cat}\`) — ${ids.length ? ids.map(id=>`<#${id}>`).join(', ') : 'None'}\n↳ ${meta.desc}`;
                });
                const embed = new EmbedBuilder()
                    .setTitle('📋 Channel Config — All Pools')
                    .setColor(0x5865F2)
                    .setDescription(lines.join('\n\n'))
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                return;
            }

            const cat = (interaction.options.getString('category') || '').toLowerCase();
            const meta = CHANNEL_CATEGORIES[cat];
            if (!meta) {
                await interaction.reply({ content: `❌ Unknown category \`${cat}\`. Valid: ${Object.keys(CHANNEL_CATEGORIES).join(', ')}`, flags: MessageFlags.Ephemeral });
                return;
            }

            const ch = interaction.options.getChannel('channel');
            if (!ch) { await interaction.reply({ content: '❌ Provide a channel.', flags: MessageFlags.Ephemeral }); return; }

            gs[meta.key] = Array.isArray(gs[meta.key]) ? gs[meta.key] : [];

            if (sub === 'add') {
                if (!gs[meta.key].includes(ch.id)) {
                    gs[meta.key].push(ch.id);
                    saveData(data);
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Channel Pool Updated', [
                        `Added <#${ch.id}> to **${meta.label}** pool`,
                    ]);
                    await interaction.reply({ content: `✅ Added <#${ch.id}> to the **${meta.label}** pool.\nPool now: ${formatChannelIds(gs[meta.key])}`, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: `⚠️ <#${ch.id}> is already in the **${meta.label}** pool.`, flags: MessageFlags.Ephemeral });
                }
                return;
            }

            if (sub === 'remove') {
                if (gs[meta.key].includes(ch.id)) {
                    gs[meta.key] = gs[meta.key].filter(id => id !== ch.id);
                    saveData(data);
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Channel Pool Updated', [
                        `Removed <#${ch.id}> from **${meta.label}** pool`,
                    ]);
                    await interaction.reply({ content: `✅ Removed <#${ch.id}> from the **${meta.label}** pool.\nPool now: ${formatChannelIds(gs[meta.key])}`, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: `⚠️ <#${ch.id}> was not in the **${meta.label}** pool.`, flags: MessageFlags.Ephemeral });
                }
                return;
            }
            break;
        }

        case 'warn': {
            if (!isMod && !isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Mods only.' }); return; }
            const user = interaction.options.getUser('user');
            if (user.id === interaction.user.id) {
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot warn yourself.' });
                return;
            }
            if (user.bot) {
                await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot warn a bot.' });
                return;
            }

            // Hierarchy guard — fetch the target member first (pre-defer, cheap)
            const warnTargetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (warnTargetMember) {
                const hierErr = checkHierarchy(interaction.member, warnTargetMember);
                if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            }

            // Defer BEFORE any async work — keeps the interaction token alive
            await interaction.deferReply();

            const reason = interaction.options.getString('reason') || 'Manual warn';
            const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
            const exileMins = Math.max(1, Math.min(1440, gs.exileDurationMins || EXILE_DURATION_MINS));
            const count = addViolationEntry(data, user.id, { reason, category: 'manual', by: interaction.user.id });
            const warnId = getLastWarnId(data, user.id);
            saveData(data);

            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('⚠️ Manual Warn')
                .setColor(0xFFAA00)
                .addFields(
                    { name: 'User',       value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By',         value: `<@${interaction.user.id}>`,   inline: true },
                    { name: 'Violations', value: `${count}/${threshold}`,        inline: true },
                    { name: 'Reason',     value: reason.slice(0, 1024),          inline: false },
                ).setTimestamp());

            // Build the public reply embed
            const replyEmbed = new EmbedBuilder()
                .setTitle('⚠️ Warning Issued')
                .setColor(0xFFAA00)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 User',        value: `<@${user.id}>`,             inline: true },
                    { name: '🛡️ Issued by',   value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📊 Violations',  value: `${count}/${threshold}`,      inline: true },
                    { name: '📝 Reason',      value: reason.slice(0, 1024),        inline: false },
                )
                .setFooter({ text: `Warn ID: ${warnId || 'N/A'}` })
                .setTimestamp();
            await interaction.editReply({ embeds: [replyEmbed] });

            if (count >= threshold) {
                clearViolationEntry(data, user.id);
                saveData(data);
                const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
                if (member) await performExile(member, interaction.guild, exileMins, `Manual warn threshold reached: ${reason}`, data);
                saveData(data);
            } else if (warnId) {
                // Beautiful DM with appeal button
                const warnedMember = await interaction.guild.members.fetch(user.id).catch(()=>null);
                if (warnedMember) {
                    const guildIcon = interaction.guild.iconURL({ dynamic: true });
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('⚠️  You have received a Warning')
                        .setColor(0xFF8C00)
                        .setThumbnail(guildIcon || null)
                        .setAuthor({ name: interaction.guild.name, iconURL: guildIcon || undefined })
                        .setDescription(
                            `Hey <@${user.id}>, a moderator has issued you a **warning** in **${interaction.guild.name}**.\n` +
                            `If you believe this was a mistake, you can appeal it below — but you only get **one shot**.\n\u200b`
                        )
                        .addFields(
                            { name: '📝 Reason',       value: reason.slice(0, 1024),        inline: false },
                            { name: '🛡️ Issued by',    value: `<@${interaction.user.id}>`,  inline: true  },
                            { name: '📊 Strike count', value: `${count} / ${threshold}`,     inline: true  },
                            { name: '🆔 Warn ID',      value: `\`${warnId}\``,              inline: true  },
                        )
                        .setFooter({ text: 'You may submit exactly 1 appeal per warning.' })
                        .setTimestamp();
                    const appealRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`open_warn_appeal_${guildId}_${warnId}`)
                            .setLabel('📩 Appeal this Warning')
                            .setStyle(ButtonStyle.Primary)
                    );
                    warnedMember.send({ embeds: [dmEmbed], components: [appealRow] }).catch(()=>{});
                }
            }
            break;
        }

        case 'unwarn': {
            if (!isMod && !isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Mods only.' }); return; }
            const user = interaction.options.getUser('user');
            if (user.id === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot unwarn yourself.' }); return; }
            // Hierarchy guard
            const unwarnTargetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (unwarnTargetMember) {
                const hierErr = checkHierarchy(interaction.member, unwarnTargetMember);
                if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            }
            await interaction.deferReply();
            const reason = interaction.options.getString('reason') || 'Manual unwarn';
            const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
            const cur = getViolationCount(data, user.id);
            const next = decrementViolationEntry(data, user.id);
            saveData(data);
            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('✅ Manual Unwarn')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'From → To', value: `${cur} → ${next}`, inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024), inline: false },
                ).setTimestamp());
            await interaction.editReply({ content: `✅ Unwarned <@${user.id}>. Violations: **${next}/${threshold}**` });
            break;
        }

        case 'purge': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            if (!interaction.channel || !interaction.channel.isTextBased()) { await interaction.reply({ content: '❌ This command can only be used in a text channel.', flags: MessageFlags.Ephemeral }); return; }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const purgeSub = interaction.options.getSubcommand(false) || 'count';

            if (purgeSub === 'count') {
                const amount = Math.max(1, Math.min(100, interaction.options.getInteger('amount') ?? 1));
                try {
                    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
                    await interaction.editReply({ content: `✅ Purged **${deleted ? deleted.size : 0}** messages.` });
                } catch (e) {
                    await interaction.editReply({ content: `❌ Purge failed: ${e.message}` });
                }
            } else if (purgeSub === 'user') {
                const targetUser = interaction.options.getUser('user');
                const scanLimit  = Math.max(1, Math.min(100, interaction.options.getInteger('amount') ?? 50));
                try {
                    const fetched = await interaction.channel.messages.fetch({ limit: scanLimit });
                    const toDelete = fetched.filter(m => m.author.id === targetUser.id);
                    if (toDelete.size === 0) {
                        await interaction.editReply({ content: `✅ No recent messages from <@${targetUser.id}> found in the last **${scanLimit}** messages.` });
                        break;
                    }
                    const deleted = await interaction.channel.bulkDelete(toDelete, true).catch(() => null);
                    await interaction.editReply({ content: `✅ Purged **${deleted ? deleted.size : 0}** messages from <@${targetUser.id}>.` });
                } catch (e) {
                    await interaction.editReply({ content: `❌ Purge failed: ${e.message}` });
                }
            }
            break;
        }

        case 'lock': {
            if (!isAdmin) { await interaction.reply({ content: '❌ This command is restricted to admins only.', flags: MessageFlags.Ephemeral }); return; }
            const reason = interaction.options.getString('reason') || 'Channel locked';
            const ch = interaction.channel;
            try {
                await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false }, { reason });
                const gs = getGuildSettings(interaction.guildId, loadData());
                await grantAdminRolesSendMessages(ch, interaction.guild, gs);
                await interaction.reply({ content: `🔒 Locked <#${ch.id}>. Only admins can send messages.`,  });
            } catch(e) {
                await interaction.reply({ content: `❌ Lock failed: ${e.message}`, flags: MessageFlags.Ephemeral });
            }
            break;
        }

        case 'unlock': {
            if (!isAdmin) { await interaction.reply({ content: '❌ This command is restricted to admins only.', flags: MessageFlags.Ephemeral }); return; }
            const reason = interaction.options.getString('reason') || 'Channel unlocked';
            const ch = interaction.channel;
            try {
                await revokeAdminRolesSendMessages(ch, interaction.guild, getGuildSettings(interaction.guildId, loadData()));
                await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null }, { reason });
                await interaction.reply({ content: `🔓 Unlocked <#${ch.id}>.`,  });
            } catch(e) {
                await interaction.reply({ content: `❌ Unlock failed: ${e.message}`, flags: MessageFlags.Ephemeral });
            }
            break;
        }

        case 'setgameshub': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const ch = interaction.options.getChannel('channel');
            gs.gamesHubId = ch.id;
            saveData(data);
            await interaction.reply({ content: `✅ Games Hub set to <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'setthreshold': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const v = Math.max(1, Math.min(10, interaction.options.getInteger('count')));
            gs.violationThreshold = v;
            saveData(data);
            await interaction.reply({ content: `✅ Violation threshold set to **${v}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'setexileduration': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const mins = Math.max(1, Math.min(1440, interaction.options.getInteger('minutes')));
            gs.exileDurationMins = mins;
            saveData(data);
            await interaction.reply({ content: `✅ Default exile duration set to **${mins} minutes**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'exileduration': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const edSub = interaction.options.getSubcommand();

            if (edSub === 'status') {
                const cur = gs.exileDurationMins || EXILE_DURATION_MINS;
                const d = Math.floor(cur / 1440), h = Math.floor((cur % 1440) / 60), m = cur % 60;
                const parts = [];
                if (d) parts.push(`${d}d`);
                if (h) parts.push(`${h}h`);
                if (m || !parts.length) parts.push(`${m}m`);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('⏱️ Default Exile Duration')
                        .setColor(0x5865F2)
                        .addFields(
                            { name: 'Current default', value: `**${parts.join(' ')}** (${cur} minutes)`, inline: false },
                        )
                        .setFooter({ text: 'Change with /exileduration set <duration>' })
                        .setTimestamp()],
                    flags: MessageFlags.Ephemeral,
                });
                break;
            }

            if (edSub === 'set') {
                const raw = interaction.options.getString('duration') || '';
                const parsed = parseDuration(raw);
                if (!parsed || parsed < 1) {
                    await interaction.reply({ content: '❌ Invalid duration. Examples: `30s`, `10m`, `2h`, `1d`, `1w`', flags: MessageFlags.Ephemeral });
                    return;
                }
                const prev = gs.exileDurationMins || EXILE_DURATION_MINS;
                gs.exileDurationMins = parsed;
                saveData(data);

                // Human-readable breakdown of new duration
                const dd = Math.floor(parsed / 1440), hh = Math.floor((parsed % 1440) / 60), mm = parsed % 60;
                const parts = [];
                if (dd) parts.push(`${dd}d`);
                if (hh) parts.push(`${hh}h`);
                if (mm || !parts.length) parts.push(`${mm}m`);
                const label = parts.join(' ');

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('⏱️ Default Exile Duration Updated')
                        .setColor(0x00FF88)
                        .addFields(
                            { name: 'Previous', value: `${prev} minutes`, inline: true },
                            { name: 'New default', value: `**${label}** (${parsed} minutes)`, inline: true },
                        )
                        .setFooter({ text: `Set by ${interaction.user.username}` })
                        .setTimestamp()],
                });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '⚙️ Exile Duration Updated', [
                    `exileDurationMins: **${prev}** → **${parsed}** (${label})`,
                ]);
                break;
            }
            await interaction.reply({ content: '❌ Unknown subcommand.', flags: MessageFlags.Ephemeral });
            break;
        }

        case 'togglescam': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.scamEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Scam/Exploit detection is now **${gs.scamEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /regex ────────────────────────────────────────────────────────────
        case 'regex': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const mode = (interaction.options.getString('mode') || '').toLowerCase();
            if (mode !== 'enabled' && mode !== 'disabled') {
                await interaction.reply({ content: '❌ Invalid mode. Use `enabled` or `disabled`.', flags: MessageFlags.Ephemeral });
                return;
            }
            gs.regexEnabled = (mode === 'enabled');
            saveData(data);
            const statusLine = gs.regexEnabled
                ? '✅ Regex detection is now **ENABLED** — tradeRegex, bossRegex, fruitRaidRegex, raceTierRegex, and no-space patterns are all active.'
                : '✅ Regex detection is now **DISABLED** — detection relies on name/alias/shortener matching only.';
            await interaction.reply({ content: statusLine, flags: MessageFlags.Ephemeral });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🔧 Regex Detection', [`regexEnabled → ${gs.regexEnabled}`]);
            break;
        }

        // ── Legacy slash case fallbacks (slash commands removed; /bloxfruits covers these) ──
        case 'commandredirect': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `🧭 Command redirect: **${gs.commandRedirectEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits command\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.commandRedirectEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Command redirect → **${gs.commandRedirectEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits command\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'serviceredirect': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `⚔️ Service redirect: **${gs.serviceRedirectEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits service\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.serviceRedirectEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Service redirect → **${gs.serviceRedirectEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits service\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'traderedirect': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `🔄 Trade redirect: **${gs.tradeRedirectEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits trade\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.tradeRedirectEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Trade redirect → **${gs.tradeRedirectEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits trade\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'spamwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `⚠️ Spam warnings: **${gs.spamWarnEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits warn spam\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.spamWarnEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Spam warnings → **${gs.spamWarnEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits warn spam\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'begwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `🚫 Beg warnings: **${gs.begWarnEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits warn beg\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.begWarnEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Beg warnings → **${gs.begWarnEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits warn beg\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'scamwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `🚨 Scam warnings: **${gs.scamWarnEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits warn scam\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.scamWarnEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Scam warnings → **${gs.scamWarnEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits warn scam\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }
        case 'acctradewarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) { await interaction.reply({ content: `📦 Acctrade warnings: **${gs.accTradeWarnEnabled ? 'ENABLED' : 'DISABLED'}**. Use \`/bloxfruits warn acctrade\` to change.`, flags: MessageFlags.Ephemeral }); break; }
            gs.accTradeWarnEnabled = !!enabled; saveData(data);
            await interaction.reply({ content: `✅ Acctrade warnings → **${gs.accTradeWarnEnabled ? 'ENABLED' : 'DISABLED'}**. (Use \`/bloxfruits warn acctrade\` going forward)`, flags: MessageFlags.Ephemeral });
            break;
        }


        case 'bloxfruits': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const bfGroup = interaction.options.getSubcommandGroup(false);
            const bfSub   = interaction.options.getSubcommand(false);

            // /bloxfruits status (top-level)
            if (!bfGroup && bfSub === 'status') {
                const e = new EmbedBuilder()
                    .setTitle('🍎 Blox Fruits Moderation Dashboard')
                    .setColor(0xF97316)
                    .addFields(
                        { name: '🔄 Trade Redirect',   value: gs.tradeRedirectEnabled   ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '⚔️ Service Redirect', value: gs.serviceRedirectEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '🧭 Command Redirect', value: gs.commandRedirectEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '⚠️ Spam Warn',        value: gs.spamWarnEnabled    ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '🚫 Beg Warn',         value: gs.begWarnEnabled     ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '🚨 Scam Warn',        value: gs.scamWarnEnabled    ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '📦 Acctrade Warn',    value: gs.accTradeWarnEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '🤖 AI Detection',     value: gs.aiEnabled          ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '🔗 Scam Detection',   value: gs.scamEnabled        ? '✅ Enabled' : '❌ Disabled', inline: true },
                    )
                    .setFooter({ text: 'Use /bloxfruits redirect enable/disable to toggle all redirects at once' })
                    .setTimestamp();
                await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
                break;
            }

            // /bloxfruits redirect enable|disable|status
            if (bfGroup === 'redirect') {
                if (bfSub === 'enable') {
                    gs.tradeRedirectEnabled = true;
                    gs.serviceRedirectEnabled = true;
                    gs.commandRedirectEnabled = true;
                    saveData(data);
                    await interaction.reply({ content: '✅ **All redirects enabled!**\n🔄 Trade redirect → ON\n⚔️ Service redirect → ON\n🧭 Command redirect → ON', flags: MessageFlags.Ephemeral });
                } else if (bfSub === 'disable') {
                    gs.tradeRedirectEnabled = false;
                    gs.serviceRedirectEnabled = false;
                    gs.commandRedirectEnabled = false;
                    saveData(data);
                    await interaction.reply({ content: '⛔ **All redirects disabled!**\n🔄 Trade redirect → OFF\n⚔️ Service redirect → OFF\n🧭 Command redirect → OFF', flags: MessageFlags.Ephemeral });
                } else { // status
                    await interaction.reply({ content: `🔄 **Trade redirect:** ${gs.tradeRedirectEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}\n⚔️ **Service redirect:** ${gs.serviceRedirectEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}\n🧭 **Command redirect:** ${gs.commandRedirectEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}`, flags: MessageFlags.Ephemeral });
                }
                break;
            }

            // /bloxfruits trade enable|disable|status
            if (bfGroup === 'trade') {
                if (bfSub === 'status') {
                    await interaction.reply({ content: `🔄 Trade redirect is currently **${gs.tradeRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                } else {
                    gs.tradeRedirectEnabled = (bfSub === 'enable');
                    saveData(data);
                    await interaction.reply({ content: `✅ Trade redirect is now **${gs.tradeRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                }
                break;
            }

            // /bloxfruits service enable|disable|status
            if (bfGroup === 'service') {
                if (bfSub === 'status') {
                    await interaction.reply({ content: `⚔️ Service redirect is currently **${gs.serviceRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                } else {
                    gs.serviceRedirectEnabled = (bfSub === 'enable');
                    saveData(data);
                    await interaction.reply({ content: `✅ Service redirect is now **${gs.serviceRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                }
                break;
            }

            // /bloxfruits command enable|disable|status
            if (bfGroup === 'command') {
                if (bfSub === 'status') {
                    await interaction.reply({ content: `🧭 Command redirect is currently **${gs.commandRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                } else {
                    gs.commandRedirectEnabled = (bfSub === 'enable');
                    saveData(data);
                    await interaction.reply({ content: `✅ Command redirect is now **${gs.commandRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                }
                break;
            }

            // /bloxfruits warn <category> <enabled>
            if (bfGroup === 'warn') {
                const warnEnabled = interaction.options.getBoolean('enabled');
                let warnName = '';
                if (bfSub === 'trade')    { gs.tradeWarnEnabled    = !!warnEnabled; warnName = '🔄 Trade warnings'; }
                else if (bfSub === 'service') { gs.serviceWarnEnabled  = !!warnEnabled; warnName = '⚔️ Service warnings'; }
                else if (bfSub === 'beg')     { gs.begWarnEnabled      = !!warnEnabled; warnName = '🚫 Begging warnings'; }
                else if (bfSub === 'scam')    { gs.scamWarnEnabled     = !!warnEnabled; warnName = '🚨 Scam warnings'; }
                else if (bfSub === 'spam')    { gs.spamWarnEnabled     = !!warnEnabled; warnName = '⚠️ Spam warnings'; }
                else if (bfSub === 'acctrade'){ gs.accTradeWarnEnabled = !!warnEnabled; warnName = '📦 Account trading warnings'; }
                saveData(data);
                await interaction.reply({ content: `✅ **${warnName}** are now **${warnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                break;
            }

            await interaction.reply({ content: '❓ Unknown subcommand. Use `/bloxfruits status` for an overview.', flags: MessageFlags.Ephemeral });
            break;
        }

        case 'spamwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `⚠️ Spam warnings are currently **${gs.spamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                break;
            }
            gs.spamWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Spam warnings are now **${gs.spamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'begwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🚫 Begging warnings are currently **${gs.begWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                break;
            }
            gs.begWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Begging warnings are now **${gs.begWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'scamwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🚨 Scam warnings are currently **${gs.scamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                break;
            }
            gs.scamWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Scam warnings are now **${gs.scamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'acctradewarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🚫 Account trading warnings are currently **${gs.accTradeWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
                break;
            }
            gs.accTradeWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Account trading warnings are now **${gs.accTradeWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'raidmode': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.raidModeEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Raid mode is now **${gs.raidModeEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'raidstatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const e = joinSpikeTracker.get(guildId);
            const w = getJoinSpikeWindow(e, gs.raidJoinWindowSec || 25);
            const locked = isRaidLocked(guildId);
            const lockInfo = locked ? `LOCKED until <t:${Math.floor((e.lockedUntil||0)/1000)}:R>` : 'Not locked';
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🛡️ Raid Mode Status')
                .setColor(gs.raidModeEnabled ? 0xFFAA00 : 0x00FF88)
                .addFields(
                    { name: 'Raid Mode', value: gs.raidModeEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                    { name: 'Auto Raid', value: gs.raidAutoEnabled ? '✅ ON' : '❌ OFF', inline: true },
                    { name: 'Join Window', value: `${gs.raidJoinWindowSec || 25}s`, inline: true },
                    { name: 'Joins In Window', value: String(w), inline: true },
                    { name: 'Threshold', value: String(gs.raidJoinThreshold || 7), inline: true },
                    { name: 'Lockdown', value: `${gs.raidLockdownMins || 8}m`, inline: true },
                    { name: 'State', value: lockInfo, inline: false },
                ).setTimestamp()], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'linkpolicy': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.linkPolicyEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Link policy is now **${gs.linkPolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'allowdomain': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const dom = normalizeDomain(interaction.options.getString('domain'));
            if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', flags: MessageFlags.Ephemeral }); return; }
            gs.linkAllowlistedDomains = Array.isArray(gs.linkAllowlistedDomains) ? gs.linkAllowlistedDomains : [];
            if (!gs.linkAllowlistedDomains.includes(dom)) gs.linkAllowlistedDomains.push(dom);
            saveData(data);
            await interaction.reply({ content: `✅ Allowlisted: **${dom}**`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'denydomain': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const dom = normalizeDomain(interaction.options.getString('domain'));
            if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', flags: MessageFlags.Ephemeral }); return; }
            gs.linkDenylistedDomains = Array.isArray(gs.linkDenylistedDomains) ? gs.linkDenylistedDomains : [];
            if (!gs.linkDenylistedDomains.includes(dom)) gs.linkDenylistedDomains.push(dom);
            saveData(data);
            await interaction.reply({ content: `✅ Denylisted: **${dom}**`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'listdomains': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const allow = (gs.linkAllowlistedDomains || []).slice(0, 60);
            const deny  = (gs.linkDenylistedDomains || []).slice(0, 60);
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🔗 Link Policy Domains')
                .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
                .addFields(
                    { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                    { name: 'Allowlist (first 60)', value: allow.length ? allow.join('\n').slice(0, 1024) : 'None', inline: false },
                    { name: 'Denylist (first 60)',  value: deny.length  ? deny.join('\n').slice(0, 1024)  : 'None', inline: false },
                ).setTimestamp()], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'mentionlimit': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const limit = Math.max(1, Math.min(30, interaction.options.getInteger('limit')));
            const windowSec = Math.max(3, Math.min(60, interaction.options.getInteger('window') || gs.mentionSpamWindowSec || 12));
            const unique = Math.max(1, Math.min(30, interaction.options.getInteger('unique') || gs.mentionSpamUniqueLimit || 5));
            gs.mentionSpamLimit = limit;
            gs.mentionSpamWindowSec = windowSec;
            gs.mentionSpamUniqueLimit = unique;
            saveData(data);
            await interaction.reply({ content: `✅ Mention spam limits updated: total=${limit}, unique=${unique}, window=${windowSec}s`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'togglescanedits': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.scanEditsEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Scan edits is now **${gs.scanEditsEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'automodstats': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const st = getGuildStats(guildId, data);
            const c = st.counters || {};
            const last = st.lastUpdated ? `<t:${Math.floor(st.lastUpdated/1000)}:R>` : 'Unknown';
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('📈 SKYNET — Automod Stats')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'Last Updated', value: last, inline: true },
                    { name: 'Command Usage', value: String(c.commandUsage || 0), inline: true },
                    { name: 'Command Abuse', value: String(c.commandAbuse || 0), inline: true },
                    { name: 'Spam', value: String(c.spam || 0), inline: true },
                    { name: 'Account Trading', value: String(c.accountTrading || 0), inline: true },
                    { name: 'Begging', value: String(c.begging || 0), inline: true },
                    { name: 'Trade', value: String(c.trade || 0), inline: true },
                    { name: 'Service', value: String(c.service || 0), inline: true },
                    { name: 'Race', value: String(c.race || 0), inline: true },
                    { name: 'Scam/Exploit', value: String(c.scam || 0), inline: true },
                    { name: 'Link Policy', value: String(c.linkPolicy || 0), inline: true },
                    { name: 'Mention Spam', value: String(c.mentionSpam || 0), inline: true },
                    { name: 'Raid Lockdown', value: String(c.raidLockdown || 0), inline: true },
                    { name: 'AI Flags', value: String(c.aiFlag || 0), inline: true },
                ).setTimestamp()], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'raidconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const windowSec = interaction.options.getInteger('window');
            const threshold = interaction.options.getInteger('threshold');
            const lockdown = interaction.options.getInteger('lockdown');
            const lockChannels = interaction.options.getBoolean('lockchannels');
            const blockLinks = interaction.options.getBoolean('blocklinks');
            const newAcctDays = interaction.options.getInteger('newacctdays');
            const notify = interaction.options.getChannel('notify');

            if (windowSec !== null) gs.raidJoinWindowSec = Math.max(5, Math.min(120, windowSec));
            if (threshold !== null) gs.raidJoinThreshold = Math.max(2, Math.min(50, threshold));
            if (lockdown !== null) gs.raidLockdownMins = Math.max(1, Math.min(60, lockdown));
            if (lockChannels !== null) gs.raidLockChannels = !!lockChannels;
            if (blockLinks !== null) gs.raidLinkBlockAll = !!blockLinks;
            if (newAcctDays !== null) gs.raidNewAccountDays = Math.max(0, Math.min(90, newAcctDays));
            if (notify) gs.raidNotifyChannelId = notify.id;
            saveData(data);
            await interaction.reply({ content: `✅ Raid config updated. window=${gs.raidJoinWindowSec}s threshold=${gs.raidJoinThreshold} lockdown=${gs.raidLockdownMins}m lockChannels=${gs.raidLockChannels} blockLinks=${gs.raidLinkBlockAll} newAcctDays=${gs.raidNewAccountDays}`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'unlockdown': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const unlockChannels = interaction.options.getBoolean('unlockchannels');
            const e = joinSpikeTracker.get(guildId);
            if (e) { e.lockedUntil = 0; joinSpikeTracker.set(guildId, e); }
            if (unlockChannels) await unlockGuildTextChannels(interaction.guild, gs);
            await interaction.reply({ content: `✅ Raid lockdown disabled.${unlockChannels ? ' Channels unlocked.' : ''}`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'linkstatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const allow = (gs.linkAllowlistedDomains || []).length;
            const deny  = (gs.linkDenylistedDomains || []).length;
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🔗 Link Policy Status')
                .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
                .addFields(
                    { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                    { name: 'Allowlist Size', value: String(allow), inline: true },
                    { name: 'Denylist Size', value: String(deny), inline: true },
                    { name: 'Raid Block Links', value: gs.raidLinkBlockAll ? '✅ ON' : '❌ OFF', inline: true },
                ).setTimestamp()], flags: MessageFlags.Ephemeral });
            break;
        }

        case 'domainremove': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const list = (interaction.options.getString('list') || '').toLowerCase();
            const dom = normalizeDomain(interaction.options.getString('domain'));
            if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', flags: MessageFlags.Ephemeral }); return; }
            if (list !== 'allow' && list !== 'deny') { await interaction.reply({ content: '❌ list must be allow or deny.', flags: MessageFlags.Ephemeral }); return; }
            if (list === 'allow') {
                gs.linkAllowlistedDomains = (gs.linkAllowlistedDomains || []).filter(x => normalizeDomain(x) !== dom);
            }
            if (list === 'deny') {
                gs.linkDenylistedDomains = (gs.linkDenylistedDomains || []).filter(x => normalizeDomain(x) !== dom);
            }
            saveData(data);
            await interaction.reply({ content: `✅ Removed **${dom}** from **${list}** list.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'capsconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const percent = interaction.options.getInteger('percent');
            const minletters = interaction.options.getInteger('minletters');
            const maxrun = interaction.options.getInteger('maxrun');
            if (enabled !== null) gs.capsSpamEnabled = !!enabled;
            if (percent !== null) gs.capsMaxPercent = Math.max(30, Math.min(100, percent));
            if (minletters !== null) gs.capsMinLetters = Math.max(8, Math.min(80, minletters));
            if (maxrun !== null) gs.capsMaxRun = Math.max(10, Math.min(120, maxrun));
            saveData(data);
            await interaction.reply({ content: `✅ Caps config: enabled=${gs.capsSpamEnabled} percent=${gs.capsMaxPercent} minLetters=${gs.capsMinLetters} maxRun=${gs.capsMaxRun}`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'emojiconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const max = interaction.options.getInteger('max');
            const windowSec = interaction.options.getInteger('window');
            if (enabled !== null) gs.emojiSpamEnabled = !!enabled;
            if (max !== null) gs.emojiMaxCount = Math.max(5, Math.min(60, max));
            if (windowSec !== null) gs.emojiWindowSec = Math.max(3, Math.min(60, windowSec));
            saveData(data);
            await interaction.reply({ content: `✅ Emoji config: enabled=${gs.emojiSpamEnabled} max=${gs.emojiMaxCount} window=${gs.emojiWindowSec}s`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'zalgoconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const maxmarks = interaction.options.getInteger('maxmarks');
            if (enabled !== null) gs.zalgoEnabled = !!enabled;
            if (maxmarks !== null) gs.zalgoMaxCombining = Math.max(4, Math.min(80, maxmarks));
            saveData(data);
            await interaction.reply({ content: `✅ Zalgo config: enabled=${gs.zalgoEnabled} maxMarks=${gs.zalgoMaxCombining}`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'invitepolicy': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.invitePolicyEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Invite policy is now **${gs.invitePolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'invitechannel': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const mode = (interaction.options.getString('mode') || '').toLowerCase();
            const ch = interaction.options.getChannel('channel');
            gs.inviteAllowedChannelIds = Array.isArray(gs.inviteAllowedChannelIds) ? gs.inviteAllowedChannelIds : [];
            if (mode === 'list') {
                const names = [];
                for (const id of gs.inviteAllowedChannelIds.slice(0, 40)) {
                    const c = await interaction.guild.channels.fetch(id).catch(()=>null);
                    names.push(c ? `<#${id}>` : id);
                }
                await interaction.reply({ content: `✅ Allowed invite channels (${gs.inviteAllowedChannelIds.length}):\n${names.join('\n') || 'None'}`, flags: MessageFlags.Ephemeral });
                break;
            }
            if (!ch) { await interaction.reply({ content: '❌ Provide a channel.', flags: MessageFlags.Ephemeral }); return; }
            if (mode === 'add') {
                if (!gs.inviteAllowedChannelIds.includes(ch.id)) gs.inviteAllowedChannelIds.push(ch.id);
                saveData(data);
                await interaction.reply({ content: `✅ Added allowed invite channel: <#${ch.id}>`, flags: MessageFlags.Ephemeral });
                break;
            }
            if (mode === 'remove') {
                gs.inviteAllowedChannelIds = gs.inviteAllowedChannelIds.filter(x => x !== ch.id);
                saveData(data);
                await interaction.reply({ content: `✅ Removed allowed invite channel: <#${ch.id}>`, flags: MessageFlags.Ephemeral });
                break;
            }
            await interaction.reply({ content: '❌ mode must be add/remove/list.', flags: MessageFlags.Ephemeral });
            break;
        }

        case 'attachmentpolicy': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.attachmentPolicyEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Attachment policy is now **${gs.attachmentPolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'attachmentext': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const mode = (interaction.options.getString('mode') || '').toLowerCase();
            const extRaw = (interaction.options.getString('ext') || '').toLowerCase().replace(/^\./,'').trim();
            gs.attachmentBlockExts = Array.isArray(gs.attachmentBlockExts) ? gs.attachmentBlockExts : [];
            if (mode === 'list') {
                const list = gs.attachmentBlockExts.slice(0, 120).map(x => '.'+String(x));
                await interaction.reply({ content: `✅ Blocked extensions (${gs.attachmentBlockExts.length}):\n${list.join(', ') || 'None'}`, flags: MessageFlags.Ephemeral });
                break;
            }
            if (!extRaw || !/^[a-z0-9]{1,8}$/.test(extRaw)) { await interaction.reply({ content: '❌ Invalid ext. Example: exe', flags: MessageFlags.Ephemeral }); return; }
            if (mode === 'add') {
                if (!gs.attachmentBlockExts.includes(extRaw)) gs.attachmentBlockExts.push(extRaw);
                saveData(data);
                await interaction.reply({ content: `✅ Added blocked ext: .${extRaw}`, flags: MessageFlags.Ephemeral });
                break;
            }
            if (mode === 'remove') {
                gs.attachmentBlockExts = gs.attachmentBlockExts.filter(x => String(x).toLowerCase() !== extRaw);
                saveData(data);
                await interaction.reply({ content: `✅ Removed blocked ext: .${extRaw}`, flags: MessageFlags.Ephemeral });
                break;
            }
            await interaction.reply({ content: '❌ mode must be add/remove/list.', flags: MessageFlags.Ephemeral });
            break;
        }

        case 'stretchconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const maxChar = interaction.options.getInteger('maxcharrun');
            const maxPunc = interaction.options.getInteger('maxpunctrun');
            const maxWord = interaction.options.getInteger('maxwordrepeat');
            if (enabled !== null) gs.stretchSpamEnabled = !!enabled;
            if (maxChar !== null) gs.stretchMaxCharRun = Math.max(6, Math.min(40, maxChar));
            if (maxPunc !== null) gs.stretchMaxPunctRun = Math.max(6, Math.min(40, maxPunc));
            if (maxWord !== null) gs.stretchMaxWordRepeat = Math.max(3, Math.min(20, maxWord));
            saveData(data);
            await interaction.reply({ content: `✅ Stretch config: enabled=${gs.stretchSpamEnabled} maxCharRun=${gs.stretchMaxCharRun} maxPunctRun=${gs.stretchMaxPunctRun} maxWordRepeat=${gs.stretchMaxWordRepeat}`, flags: MessageFlags.Ephemeral });
            break;
        }

        case 'dupeconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const windowSec = interaction.options.getInteger('window');
            const threshold = interaction.options.getInteger('threshold');
            const minlen = interaction.options.getInteger('minlen');
            if (enabled !== null) gs.dupeSpamEnabled = !!enabled;
            if (windowSec !== null) gs.dupeWindowSec = Math.max(5, Math.min(120, windowSec));
            if (threshold !== null) gs.dupeThreshold = Math.max(2, Math.min(20, threshold));
            if (minlen !== null) gs.dupeMinLen = Math.max(5, Math.min(200, minlen));
            saveData(data);
            await interaction.reply({ content: `✅ Dupe config: enabled=${gs.dupeSpamEnabled} window=${gs.dupeWindowSec}s threshold=${gs.dupeThreshold} minLen=${gs.dupeMinLen}`, flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /testscan ─────────────────────────────────────
        case 'testscan': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', flags: MessageFlags.Ephemeral }); return; }
            const text    = interaction.options.getString('text');
            const cleaned = fullClean(text);
            const ns      = cleaned.replace(/[\s_]/g,'');

            const fruits   = scanForFruits(cleaned);
            const bosses   = scanForBosses(cleaned);
            const swords   = scanForSwords(cleaned);
            const enchants = scanForEnchants(cleaned);
            const haki     = scanForHakiColors(cleaned);
            const styles   = scanForFightingStyles(cleaned);
            const guns     = scanForGuns(cleaned);
            const accs     = scanForAccessories(cleaned);
            const quests   = scanForQuests(cleaned);
            const seaEv    = scanForSeaEvents(cleaned);
            const races    = scanForRaces(cleaned);
            const painUpg  = scanForPainUpgrades(cleaned);
            const lightUpg = scanForLightningUpgrades(cleaned);

            for (const f of FRUITS) { const fc=f.replace(/[\s\-]/g,''); if(ns.includes(fc)&&!fruits.includes(f)) fruits.push(f); }

            const intent     = scanForIntent(cleaned);
            const svcIntent  = scanForServiceIntent(cleaned);
            const tier       = hasTierKeyword(cleaned);
            const bossHit    = bossRegex.test(cleaned);
            const fruitRaid  = fruitRaidRegex.test(cleaned);
            const svcRaid    = svcForRaidRegex.test(cleaned);
            const raceHit    = raceTierRegex.test(cleaned);
            const accTrade   = detectAccountTrading(cleaned);
            const begging    = detectBegging(cleaned);

            let exchange = tradeRegex.test(cleaned);
            if (!exchange) for (const p of NOSPACE_PATTERNS) if(p.test(ns)){exchange=true;break;}

            const hasItem = swords.length||enchants.length||haki.length||styles.length||
                            guns.length||accs.length||quests.length||seaEv.length||
                            painUpg.length||lightUpg.length;

            const tradeFlag = exchange||(intent&&fruits.length>=1);
            const svcFlag   = svcRaid||(bosses.length&&svcIntent)||bossHit||fruitRaid||(hasItem&&svcIntent);
            const raceFlag  = raceHit&&races.length&&tier&&svcIntent;
            const painFlag  = painUpg.length&&svcIntent;
            const lightFlag = lightUpg.length&&svcIntent;

            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🔬 SKYNET V7 — Scan Test')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'Cleaned Input',     value: `\`${cleaned.slice(0,300)}\``,   inline: false },

                    { name: '📦 Items', value:
                        `Fruits: ${fruits.join(', ') || 'None'}\n` +
                        `Bosses: ${bosses.join(', ') || 'None'}\n` +
                        `Swords: ${swords.join(', ') || 'None'}\n` +
                        `Enchants: ${enchants.join(', ') || 'None'}`,
                        inline: false
                    },

                    { name: '⚔️ Combat', value:
                        `Haki Colors: ${haki.join(', ') || 'None'}\n` +
                        `Fighting Styles: ${styles.join(', ') || 'None'}\n` +
                        `Guns: ${guns.join(', ') || 'None'}\n` +
                        `Accessories: ${accs.join(', ') || 'None'}`,
                        inline: false
                    },

                    { name: '🌊 Progress', value:
                        `Quests: ${quests.join(', ') || 'None'}\n` +
                        `Sea Events: ${seaEv.join(', ') || 'None'}\n` +
                        `Races: ${races.join(', ') || 'None'}`,
                        inline: false
                    },

                    { name: '⚡ Upgrades', value:
                        `Pain Upgrades: ${painUpg.join(', ') || 'None'}\n` +
                        `Lightning Upgrades: ${lightUpg.join(', ') || 'None'}`,
                        inline: false
                    },

                    { name: '🧠 Detection', value:
                        `Tier Keyword: ${tier ? '✅' : '❌'}\n` +
                        `Trade Intent: ${intent ? '✅' : '❌'}\n` +
                        `Service Intent: ${svcIntent ? '✅' : '❌'}\n` +
                        `Direct Exchange: ${exchange ? '✅' : '❌'}\n` +
                        `Boss Regex: ${bossHit ? '✅' : '❌'}\n` +
                        `Fruit+Raid: ${fruitRaid ? '✅' : '❌'}`,
                        inline: false
                    },

                    { name: '🚨 Flags', value:
                        `Account Trading: ${accTrade ? '🚨 YES' : '✅ CLEAN'}\n` +
                        `Begging: ${begging ? '🚨 YES' : '✅ CLEAN'}\n` +
                        `Trade Flag: ${tradeFlag ? '🚨 YES' : '✅ CLEAN'}\n` +
                        `Service Flag: ${svcFlag ? '🚨 YES' : '✅ CLEAN'}\n` +
                        `Race Flag: ${raceFlag ? '🚨 YES' : '✅ CLEAN'}\n` +
                        `Pain Flag: ${painFlag ? '🚨 YES' : '✅ CLEAN'}\n` +
                        `Lightning Flag: ${lightFlag ? '🚨 YES' : '✅ CLEAN'}`
                    },

                )], flags: MessageFlags.Ephemeral });
            break;
        }

        // ── /timeout ──────────────────────────────────────────────────────────
        case 'timeout': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            const user = interaction.options.getUser('user');
            if (user.bot) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot timeout a bot.' }); return; }
            if (user.id === interaction.user.id) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot timeout yourself.' }); return; }
            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!target) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Member not found in this server.' }); return; }
            const hierErr = checkHierarchy(interaction.member, target);
            if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }

            await interaction.deferReply();

            const durRaw  = interaction.options.getString('duration');
            const durMins = durRaw ? parseDuration(durRaw) : 45; // default 45 minutes
            if (!durMins || durMins <= 0) { await interaction.editReply({ content: '❌ Invalid duration. Examples: `30m`, `2h`, `1d`, `1w`.' }); return; }
            const durMs   = durMins * 60 * 1000;
            const reason  = interaction.options.getString('reason') || 'No reason provided';
            const timeoutId = `to_${Date.now()}_${user.id}`;
            const endsAt    = Date.now() + durMs;

            // Store long-timeout data (needed even for sub-28-day so appeal system can reference it)
            data.timeouts              = data.timeouts || {};
            data.timeouts[guildId]     = data.timeouts[guildId] || {};
            data.timeouts[guildId][user.id] = {
                timeoutId, reason,
                issuedBy: interaction.user.id,
                totalMs: durMs, endsAt,
                issuedAt: Date.now(),
            };
            saveData(data);

            // Apply the first chunk (≤ 28 days)
            const firstChunk = Math.min(durMs, MAX_DISCORD_TIMEOUT_MS);
            await target.timeout(firstChunk, reason).catch(() => {});

            // If longer than 28 days, schedule re-timeouts
            if (durMs > MAX_DISCORD_TIMEOUT_MS) {
                scheduleLongTimeout(client, guildId, user.id, data);
            }

            // Human-readable duration
            let durStr;
            if (durMins < 60)          durStr = `${durMins} minute${durMins !== 1 ? 's' : ''}`;
            else if (durMins < 1440)   durStr = `${Math.round(durMins/60)} hour${Math.round(durMins/60) !== 1 ? 's' : ''}`;
            else if (durMins < 10080)  durStr = `${Math.round(durMins/1440)} day${Math.round(durMins/1440) !== 1 ? 's' : ''}`;
            else                       durStr = `${Math.round(durMins/10080)} week${Math.round(durMins/10080) !== 1 ? 's' : ''}`;

            const replyEmbed = new EmbedBuilder()
                .setTitle('🔇 Member Timed Out')
                .setColor(0xFF8C00)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 User',       value: `<@${user.id}>`,              inline: true },
                    { name: '🛡️ Issued by',  value: `<@${interaction.user.id}>`,  inline: true },
                    { name: '⏱️ Duration',   value: durStr,                        inline: true },
                    { name: '🔚 Expires',    value: `<t:${Math.floor(endsAt/1000)}:R>`, inline: true },
                    { name: '📝 Reason',     value: reason.slice(0, 1024),         inline: false },
                )
                .setFooter({ text: `Timeout ID: ${timeoutId}` })
                .setTimestamp();
            await interaction.editReply({ embeds: [replyEmbed] });

            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('🔇 Manual Timeout')
                .setColor(0xFF8C00)
                .addFields(
                    { name: 'User',     value: `<@${user.id}> (${user.id})`,  inline: true },
                    { name: 'By',       value: `<@${interaction.user.id}>`,   inline: true },
                    { name: 'Duration', value: durStr,                         inline: true },
                    { name: 'Expires',  value: `<t:${Math.floor(endsAt/1000)}:R>`, inline: true },
                    { name: 'Reason',   value: reason.slice(0, 1024),          inline: false },
                ).setFooter({ text: `ID: ${timeoutId}` }).setTimestamp());

            // DM the user with appeal button
            const guildIcon = interaction.guild.iconURL({ dynamic: true });
            const dmEmbed = new EmbedBuilder()
                .setTitle('🔇 You have been Timed Out')
                .setColor(0xFF8C00)
                .setThumbnail(guildIcon || null)
                .setAuthor({ name: interaction.guild.name, iconURL: guildIcon || undefined })
                .setDescription(
                    `Hey <@${user.id}>, you have been **timed out** in **${interaction.guild.name}**.\n` +
                    `If you believe this was a mistake, you can appeal it below — but you only get **one shot**.\n\u200b`
                )
                .addFields(
                    { name: '📝 Reason',      value: reason.slice(0, 1024),    inline: false },
                    { name: '🛡️ Issued by',   value: `<@${interaction.user.id}>`, inline: true },
                    { name: '⏱️ Duration',    value: durStr,                    inline: true },
                    { name: '🔚 Expires',     value: `<t:${Math.floor(endsAt/1000)}:R>`, inline: true },
                )
                .setFooter({ text: 'You may submit exactly 1 appeal per timeout.' })
                .setTimestamp();
            const appealRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`open_timeout_appeal_${guildId}_${timeoutId}`)
                    .setLabel('📩 Appeal this Timeout')
                    .setStyle(ButtonStyle.Primary)
            );
            target.send({ embeds: [dmEmbed], components: [appealRow] }).catch(() => {});
            break;
        }

        // ── /untimeout ────────────────────────────────────────────────────────
        case 'untimeout': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            const user   = interaction.options.getUser('user');
            if (user.id === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot remove your own timeout.' }); return; }
            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!target) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Member not found.' }); return; }
            const hierErr = checkHierarchy(interaction.member, target);
            if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            await interaction.deferReply();
            const reason = interaction.options.getString('reason') || 'No reason provided';

            // Remove Discord timeout
            await target.timeout(null, reason).catch(() => {});

            // Cancel any scheduled long-timeout
            data.timeouts = data.timeouts || {};
            if (data.timeouts[guildId]?.[user.id]) {
                delete data.timeouts[guildId][user.id];
                const key = `${guildId}:${user.id}`;
                const h = _activeTimeoutTimers.get(key);
                if (h) { clearTimeout(h); _activeTimeoutTimers.delete(key); }
                saveData(data);
            }

            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('🔊 Manual Untimeout')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'User',   value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024),        inline: false },
                ).setTimestamp());
            await interaction.editReply({ content: `✅ Removed timeout from **${target.user.username}**.` });

            // DM the user
            target.send({ embeds: [new EmbedBuilder()
                .setTitle('🔊 Your Timeout Has Been Removed')
                .setDescription(`Your timeout in **${interaction.guild.name}** has been lifted.\nReason: ${reason}`)
                .setColor(0x00FF88).setTimestamp()] }).catch(() => {});
            break;
        }

        // ── /kick ─────────────────────────────────────────────────────────────
        case 'kick': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            const user   = interaction.options.getUser('user');
            if (user.bot) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot kick a bot.' }); return; }
            if (user.id === interaction.user.id) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot kick yourself.' }); return; }
            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!target) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Member not found.' }); return; }
            const hierErr = checkHierarchy(interaction.member, target);
            if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            await interaction.deferReply();
            const reason = interaction.options.getString('reason') || 'No reason provided';

            // DM before kicking (they'll be removed after)
            const guildIcon = interaction.guild.iconURL({ dynamic: true });
            await target.send({ embeds: [new EmbedBuilder()
                .setTitle('👢 You Have Been Kicked')
                .setColor(0xFF6600)
                .setThumbnail(guildIcon || null)
                .setAuthor({ name: interaction.guild.name, iconURL: guildIcon || undefined })
                .setDescription(`You have been **kicked** from **${interaction.guild.name}**.\nYou are free to rejoin using a valid invite link.`)
                .addFields(
                    { name: '📝 Reason',     value: reason.slice(0, 1024), inline: false },
                    { name: '🛡️ Issued by',  value: `<@${interaction.user.id}>`, inline: true },
                )
                .setTimestamp()] }).catch(() => {});

            await target.kick(reason).catch(() => {});

            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('👢 Manual Kick')
                .setColor(0xFF6600)
                .addFields(
                    { name: 'User',   value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024),        inline: false },
                ).setTimestamp());

            await interaction.editReply({ embeds: [new EmbedBuilder()
                .setTitle('👢 Member Kicked')
                .setColor(0xFF6600)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 User',      value: `<@${user.id}>`,             inline: true },
                    { name: '🛡️ By',        value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📝 Reason',    value: reason.slice(0, 1024),        inline: false },
                ).setTimestamp()] });
            break;
        }

        // ── /ban ──────────────────────────────────────────────────────────────
        case 'ban': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            const user = interaction.options.getUser('user');
            if (user.bot) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot ban a bot.' }); return; }
            if (user.id === interaction.user.id) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot ban yourself.' }); return; }
            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (target) {
                const hierErr = checkHierarchy(interaction.member, target);
                if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            }
            await interaction.deferReply();
            const reason  = interaction.options.getString('reason') || 'No reason provided';
            const durRaw  = interaction.options.getString('duration');
            const durMins = durRaw ? parseDuration(durRaw) : null;
            const durMs   = durMins ? durMins * 60 * 1000 : null;
            const banId   = `ban_${Date.now()}_${user.id}`;
            const bannedAt = Date.now();

            // Store ban record
            data.bans            = data.bans || {};
            data.bans[guildId]   = data.bans[guildId] || {};
            data.bans[guildId][user.id] = {
                banId, reason,
                issuedBy: interaction.user.id,
                bannedAt,
                duration: durMs || null,
                hardban: false,
            };
            saveData(data);

            // DM before banning
            const guildIcon = interaction.guild.iconURL({ dynamic: true });
            const appealUnlockTs = Math.floor((bannedAt + 14 * 24 * 60 * 60 * 1000) / 1000);
            const dmEmbed = new EmbedBuilder()
                .setTitle('🔨 You Have Been Banned')
                .setColor(0xFF0000)
                .setThumbnail(guildIcon || null)
                .setAuthor({ name: interaction.guild.name, iconURL: guildIcon || undefined })
                .setDescription(
                    `You have been **banned** from **${interaction.guild.name}**.\n` +
                    `You may appeal this ban **after 14 days** (<t:${appealUnlockTs}:R>). You only get **one appeal**.\n\u200b`
                )
                .addFields(
                    { name: '📝 Reason',     value: reason.slice(0, 1024), inline: false },
                    { name: '🛡️ Issued by',  value: `<@${interaction.user.id}>`, inline: true },
                    ...(durMs ? [{ name: '⏱️ Duration', value: durRaw, inline: true }] : [{ name: '⏱️ Duration', value: 'Permanent (until unbanned)', inline: true }]),
                    { name: '📩 Appeal',     value: `Appeal unlocks <t:${appealUnlockTs}:R>`, inline: false },
                )
                .setFooter({ text: 'You may submit exactly 1 appeal per ban. Use the button below after 14 days.' })
                .setTimestamp();
            const appealRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`open_ban_appeal_${guildId}_${banId}`)
                    .setLabel('📩 Appeal this Ban (available after 14 days)')
                    .setStyle(ButtonStyle.Primary)
            );
            if (target) await target.send({ embeds: [dmEmbed], components: [appealRow] }).catch(() => {});
            else {
                // User may not be in the server — try fetching their DM
                const fetchedUser = await client.users.fetch(user.id).catch(() => null);
                if (fetchedUser) await fetchedUser.send({ embeds: [dmEmbed], components: [appealRow] }).catch(() => {});
            }

            await interaction.guild.bans.create(user.id, { reason: reason.slice(0, 512), deleteMessageSeconds: 0 }).catch(() => {});

            let durStr = durMs ? (durMins < 1440 ? `${Math.round(durMins/60)}h` : `${Math.round(durMins/1440)}d`) : 'Permanent';
            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('🔨 Manual Ban')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'User',     value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By',       value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Duration', value: durStr,                        inline: true },
                    { name: 'Reason',   value: reason.slice(0, 1024),        inline: false },
                ).setFooter({ text: `Ban ID: ${banId}` }).setTimestamp());

            await interaction.editReply({ embeds: [new EmbedBuilder()
                .setTitle('🔨 Member Banned')
                .setColor(0xFF0000)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 User',      value: `<@${user.id}>`,             inline: true },
                    { name: '🛡️ By',        value: `<@${interaction.user.id}>`, inline: true },
                    { name: '⏱️ Duration',  value: durStr,                       inline: true },
                    { name: '📝 Reason',    value: reason.slice(0, 1024),        inline: false },
                    { name: '📩 Appeal',    value: `User may appeal after <t:${appealUnlockTs}:R>`, inline: false },
                ).setFooter({ text: `Ban ID: ${banId}` }).setTimestamp()] });
            break;
        }

        // ── /unban ────────────────────────────────────────────────────────────
        case 'unban': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            await interaction.deferReply();
            const input  = interaction.options.getString('user') || '';
            const userId = (input.match(/<@!?(\d+)>/) || input.match(/^(\d{15,20})$/) || [])[1] || input.trim();
            if (userId === interaction.user.id && !isSuperUser(interaction.user.id)) { await interaction.editReply({ content: '❌ You cannot unban yourself.' }); return; }
            const reason = interaction.options.getString('reason') || 'No reason provided';
            if (!userId || !/^\d{15,20}$/.test(userId)) {
                await interaction.editReply({ content: '❌ Please provide a valid user ID.' }); return;
            }
            await interaction.guild.bans.remove(userId, reason).catch(() => {});
            // Clean stored ban record
            data.bans = data.bans || {};
            if (data.bans[guildId]?.[userId]) delete data.bans[guildId][userId];
            saveData(data);
            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('🔓 Manual Unban')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'User',   value: `<@${userId}> (${userId})`,   inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024),        inline: false },
                ).setTimestamp());
            // DM the unbanned user
            const unbannedUser = await client.users.fetch(userId).catch(() => null);
            if (unbannedUser) unbannedUser.send({ embeds: [new EmbedBuilder()
                .setTitle('✅ You Have Been Unbanned')
                .setDescription(`Your ban from **${interaction.guild.name}** has been lifted.\nYou may now rejoin using an invite link.`)
                .setColor(0x00FF88).setTimestamp()] }).catch(() => {});
            await interaction.editReply({ content: `✅ Unbanned <@${userId}>.` });
            break;
        }

        // ── /hardban ──────────────────────────────────────────────────────────
        case 'hardban': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            const user = interaction.options.getUser('user');
            if (user.bot) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot hardban a bot.' }); return; }
            if (user.id === interaction.user.id) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot hardban yourself.' }); return; }
            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (target) {
                const hierErr = checkHierarchy(interaction.member, target);
                if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            }
            await interaction.deferReply();
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const banId  = `hban_${Date.now()}_${user.id}`;

            // Store hardban record (no appeal flag)
            data.bans          = data.bans || {};
            data.bans[guildId] = data.bans[guildId] || {};
            data.bans[guildId][user.id] = {
                banId, reason,
                issuedBy: interaction.user.id,
                bannedAt: Date.now(),
                duration: null,
                hardban: true,
            };
            saveData(data);

            // DM the user (no appeal button)
            const guildIcon = interaction.guild.iconURL({ dynamic: true });
            const dmPayload = { embeds: [new EmbedBuilder()
                .setTitle('🔒 You Have Been Permanently Banned')
                .setColor(0x800000)
                .setThumbnail(guildIcon || null)
                .setAuthor({ name: interaction.guild.name, iconURL: guildIcon || undefined })
                .setDescription(`You have been **permanently banned** from **${interaction.guild.name}**.\nThis ban has **no appeal process**.`)
                .addFields(
                    { name: '📝 Reason',    value: reason.slice(0, 1024), inline: false },
                    { name: '🛡️ Issued by', value: `<@${interaction.user.id}>`, inline: true },
                )
                .setTimestamp()] };
            if (target) await target.send(dmPayload).catch(() => {});
            else { const fu = await client.users.fetch(user.id).catch(() => null); if (fu) await fu.send(dmPayload).catch(() => {}); }

            await interaction.guild.bans.create(user.id, { reason: reason.slice(0, 512), deleteMessageSeconds: 0 }).catch(() => {});

            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('🔒 Hardban (Permanent)')
                .setColor(0x800000)
                .addFields(
                    { name: 'User',   value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024),        inline: false },
                ).setFooter({ text: 'HARDBAN — No appeal allowed.' }).setTimestamp());

            await interaction.editReply({ embeds: [new EmbedBuilder()
                .setTitle('🔒 Member Hard-Banned')
                .setColor(0x800000)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 User',      value: `<@${user.id}>`,             inline: true },
                    { name: '🛡️ By',        value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📝 Reason',    value: reason.slice(0, 1024),        inline: false },
                    { name: '🔒 Appeal',    value: 'None — permanent ban.',       inline: false },
                ).setTimestamp()] });
            break;
        }

        // ── /softban ──────────────────────────────────────────────────────────
        case 'softban': {
            if (!isAdmin) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Admins and bot managers only.' }); return; }
            const user = interaction.options.getUser('user');
            if (user.bot) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot softban a bot.' }); return; }
            if (user.id === interaction.user.id) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ You cannot softban yourself.' }); return; }
            const target = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (target) {
                const hierErr = checkHierarchy(interaction.member, target);
                if (hierErr) { await interaction.reply({ flags: MessageFlags.Ephemeral, content: hierErr }); return; }
            }
            await interaction.deferReply();
            const reason = interaction.options.getString('reason') || 'No reason provided';

            // DM before banning
            const guildIcon = interaction.guild.iconURL({ dynamic: true });
            const dmPayload = { embeds: [new EmbedBuilder()
                .setTitle('🧹 You Have Been Softbanned')
                .setColor(0xFFA500)
                .setThumbnail(guildIcon || null)
                .setAuthor({ name: interaction.guild.name, iconURL: guildIcon || undefined })
                .setDescription(
                    `You have been **softbanned** from **${interaction.guild.name}**.\n` +
                    `A softban means you were briefly banned and immediately unbanned to clear your recent messages. **You are free to rejoin using an invite.**`
                )
                .addFields(
                    { name: '📝 Reason',    value: reason.slice(0, 1024), inline: false },
                    { name: '🛡️ Issued by', value: `<@${interaction.user.id}>`, inline: true },
                )
                .setTimestamp()] };
            if (target) await target.send(dmPayload).catch(() => {});
            else { const fu = await client.users.fetch(user.id).catch(() => null); if (fu) await fu.send(dmPayload).catch(() => {}); }

            // Ban (purge last 7 days of messages), then immediately unban
            await interaction.guild.bans.create(user.id, { reason: `[SOFTBAN] ${reason}`.slice(0, 512), deleteMessageSeconds: 604800 }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));
            await interaction.guild.bans.remove(user.id, `[SOFTBAN unban] ${reason}`.slice(0, 512)).catch(() => {});

            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('🧹 Softban')
                .setColor(0xFFA500)
                .addFields(
                    { name: 'User',   value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024),        inline: false },
                ).setFooter({ text: 'User was banned and immediately unbanned (message purge).' }).setTimestamp());

            await interaction.editReply({ embeds: [new EmbedBuilder()
                .setTitle('🧹 Member Softbanned')
                .setColor(0xFFA500)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 User',      value: `<@${user.id}>`,             inline: true },
                    { name: '🛡️ By',        value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📝 Reason',    value: reason.slice(0, 1024),        inline: false },
                    { name: 'ℹ️ Note',      value: 'User was banned then immediately unbanned. They may rejoin freely.', inline: false },
                ).setTimestamp()] });
            break;
        }

        // ── /manager ──────────────────────────────────────────────────────────
        // Grants/revokes full bot access (equal to Administrator) for roles/users
        case 'manager': {            // Only true Admins (by Discord perm) can manage the manager list itself
            const isRealAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
            if (!isRealAdmin) {
                await interaction.reply({ content: '❌ Only server Administrators can modify the manager list.', flags: MessageFlags.Ephemeral });
                return;
            }
            const sub = interaction.options.getSubcommand();
            gs.managerRoles = Array.isArray(gs.managerRoles) ? gs.managerRoles : [];
            gs.managerUsers = Array.isArray(gs.managerUsers) ? gs.managerUsers : [];

            if (sub === 'addrole') {
                const role = interaction.options.getRole('role');
                if (!role) { await interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral }); return; }
                // Hierarchy: can't add your own role or anything equal/higher
                const roleHierErr = checkRoleHierarchy(interaction.member, role);
                if (roleHierErr) { await interaction.reply({ content: roleHierErr, flags: MessageFlags.Ephemeral }); return; }
                if (gs.managerRoles.includes(role.id)) {
                    await interaction.reply({ content: `⚠️ <@&${role.id}> already has manager access.`, flags: MessageFlags.Ephemeral }); return;
                }
                gs.managerRoles.push(role.id);
                saveData(data);
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔑 Manager Role Added')
                    .setColor(0x00FF88)
                    .setDescription(`<@&${role.id}> now has **full access** to every bot command.`)
                    .setFooter({ text: `Added by ${interaction.user.username}` })
                    .setTimestamp()
                ], flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🔑 Manager Role Added', [`<@&${role.id}> granted full bot access`]);
            }
            else if (sub === 'removerole') {
                const role = interaction.options.getRole('role');
                if (!role) { await interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral }); return; }
                // Hierarchy: can't remove a role equal/higher than yours
                const roleHierErr = checkRoleHierarchy(interaction.member, role);
                if (roleHierErr) { await interaction.reply({ content: roleHierErr, flags: MessageFlags.Ephemeral }); return; }
                if (!gs.managerRoles.includes(role.id)) {
                    await interaction.reply({ content: `⚠️ <@&${role.id}> does not have manager access.`, flags: MessageFlags.Ephemeral }); return;
                }
                gs.managerRoles = gs.managerRoles.filter(id => id !== role.id);
                saveData(data);
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔑 Manager Role Removed')
                    .setColor(0xFF4444)
                    .setDescription(`<@&${role.id}> no longer has manager access.`)
                    .setFooter({ text: `Removed by ${interaction.user.username}` })
                    .setTimestamp()
                ], flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🔑 Manager Role Removed', [`<@&${role.id}> manager access revoked`]);
            }
            else if (sub === 'adduser') {
                const user = interaction.options.getUser('user');
                if (!user) { await interaction.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral }); return; }
                // Hierarchy: can't add yourself or someone equal/higher
                const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
                const hierErr = checkHierarchy(interaction.member, targetMember || { id: user.id, roles: { highest: { position: 0 } } });
                if (hierErr) { await interaction.reply({ content: hierErr, flags: MessageFlags.Ephemeral }); return; }
                // Extra check: if member is in guild, verify role position
                if (targetMember) {
                    const roleHierErr = checkHierarchy(interaction.member, targetMember);
                    if (roleHierErr) { await interaction.reply({ content: roleHierErr, flags: MessageFlags.Ephemeral }); return; }
                }
                if (gs.managerUsers.includes(user.id)) {
                    await interaction.reply({ content: `⚠️ <@${user.id}> already has manager access.`, flags: MessageFlags.Ephemeral }); return;
                }
                gs.managerUsers.push(user.id);
                saveData(data);
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔑 Manager User Added')
                    .setColor(0x00FF88)
                    .setDescription(`<@${user.id}> now has **full access** to every bot command.`)
                    .setFooter({ text: `Added by ${interaction.user.username}` })
                    .setTimestamp()
                ], flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🔑 Manager User Added', [`<@${user.id}> granted full bot access`]);
            }
            else if (sub === 'removeuser') {
                const user = interaction.options.getUser('user');
                if (!user) { await interaction.reply({ content: '❌ User not found.', flags: MessageFlags.Ephemeral }); return; }
                // Hierarchy: can't remove yourself or someone equal/higher
                const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (targetMember) {
                    const hierErr = checkHierarchy(interaction.member, targetMember);
                    if (hierErr) { await interaction.reply({ content: hierErr, flags: MessageFlags.Ephemeral }); return; }
                } else if (user.id === interaction.user.id) {
                    await interaction.reply({ content: '❌ You cannot remove yourself from the manager list.', flags: MessageFlags.Ephemeral }); return;
                }
                if (!gs.managerUsers.includes(user.id)) {
                    await interaction.reply({ content: `⚠️ <@${user.id}> does not have manager access.`, flags: MessageFlags.Ephemeral }); return;
                }
                gs.managerUsers = gs.managerUsers.filter(id => id !== user.id);
                saveData(data);
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔑 Manager User Removed')
                    .setColor(0xFF4444)
                    .setDescription(`<@${user.id}> no longer has manager access.`)
                    .setFooter({ text: `Removed by ${interaction.user.username}` })
                    .setTimestamp()
                ], flags: MessageFlags.Ephemeral });
                await sendConfigLog(interaction.guild, data, interaction.user.id, '🔑 Manager User Removed', [`<@${user.id}> manager access revoked`]);
            }
            else if (sub === 'list') {
                const roleLines = gs.managerRoles.length
                    ? gs.managerRoles.map(id => {
                        const r = interaction.guild.roles.cache.get(id);
                        return r ? `<@&${id}> — position ${r.position}` : `Unknown role (\`${id}\`)`;
                    }).join('\n')
                    : '*None configured*';
                const userLines = gs.managerUsers.length
                    ? gs.managerUsers.map(id => `<@${id}>`).join('\n')
                    : '*None configured*';
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('🔑 Bot Managers')
                    .setColor(0x5865F2)
                    .setDescription(
                        'These roles and users have **full access** to every bot command, equivalent to server Administrator.\n' +
                        '> ⚠️ You cannot add/remove yourself, your own role, or anyone with equal or higher roles.'
                    )
                    .addFields(
                        { name: `👥 Manager Roles (${gs.managerRoles.length})`, value: roleLines, inline: false },
                        { name: `👤 Manager Users (${gs.managerUsers.length})`, value: userLines, inline: false },
                    )
                    .setTimestamp()
                ], flags: MessageFlags.Ephemeral });
            }
            break;
        }
    }
});

// ══════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ══════════════════════════════════════════════════════════
const CMD_PREFIX_RE = /^[^a-zA-Z0-9\s@]/;
function isMessageCommand(msg, gs) {
    const c = msg.content;
    if (!c) return false;
    const t = c.trimStart();
    if (msg.type === 20) return true;

    // If the message starts with the guild's custom prefix, treat it as a command
    const guildPrefix = gs?.commandPrefix;
    if (guildPrefix && guildPrefix.length > 0 && t.startsWith(guildPrefix)) {
        const afterPrefix = t.slice(guildPrefix.length);
        if (afterPrefix.length > 0 && /^[a-zA-Z0-9]/.test(afterPrefix)) return true;
    }

    if (/^[\p{P}\p{S}\s]+$/u.test(t)) return false;
    if (t.startsWith('@') || t.startsWith('<@')) return false;

    if (/^\?afk\b/i.test(t)) return false;

    if (/^\-#\s*/.test(t)) return false;
    if (/^\|\|/.test(t)) return false;
    if (/^#{1,6}\s+/.test(t)) return false;
    if (/^>\s+/.test(t)) return false;
    if (/^```/.test(t)) return false;
    if (/^`[^`]/.test(t)) return false;
    if (/^(?:[-*]|\d+\.)\s+/.test(t)) return false;

    if (/^:[a-zA-Z0-9_]{2,32}:/.test(t)) return false;
    if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{6,20}>/.test(t)) return false;
    if (/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(t)) return false;
    if (/^\p{Regional_Indicator}{2}/u.test(t)) return false;
    if (/^[#*0-9]\uFE0F?\u20E3/u.test(t)) return false;
    if (/^[.!?]+\s*$/.test(t)) return false;
    // Don't flag quoted speech like "hey" or 'sup' or (lol) as commands
    if (/^["'()\[\]{}]/.test(t)) return false;
    // "char space word" must NOT flag — only "charword" (no space) counts as a command
    if (/^[.!?/;:~`#$%^&*+=|\\]\s+[a-zA-Z]/.test(t)) return false;
    // Must have a non-alphanum prefix char IMMEDIATELY followed by a letter (zero spaces)
    // Also restrict to actual bot command prefix characters — exclude quotes, parens, brackets
    // '*' and '_' excluded — Discord markdown (italic/bold/underline)
    if (CMD_PREFIX_RE.test(t) && /^[!\/\.\?;:~`#\$%\^\+=\|\\][a-zA-Z]/.test(t)) return true;
    return false;
}

const COMMAND_LIKE_PREFIXES = [
    // '*' and '_' intentionally excluded — they are Discord markdown (bold/italic/underline)
    '/', '!', '.', '?', ';', ':', '~', '`', '#', '$', '%', '^', '+', '=', '|', '\\',
    'g.', 'g!', 'g/', 'm.', 'm!', 'm/', 'k.', 'k!', 'k/', 'p.', 'p!', 'p/', 'r.', 'r!', 'r/',
    't.', 't!', 't/', 's.', 's!', 's/', 'a.', 'a!', 'a/',
    'bb.', 'bb!', 'bb/', 'skynet.', 'skynet!', 'skynet/',
];

const COMMON_COMMAND_WORDS = [
    'help','commands','cmds','prefix','ping','invite','support','info','stats','profile','rank','leaderboard',
    'daily','weekly','monthly','claim','redeem','code','codes','reward','rewards','giveaway','ticket','report',
    'ban','kick','mute','timeout','warn','warnings','infractions','punish','unpunish','lock','unlock','purge',
    'clear','clearall','clean','nuke','slowmode','unlockdown','lockdown','antispam','antiraid','antiscam',
    'buy','sell','trade','market','shop','store','inventory','inv','items','item','equip','unequip',
    'join','leave','create','delete','remove','add','set','config','setup','settings','toggle','enable','disable',
    'music','play','pause','stop','skip','queue','volume','loop','shuffle',
    'raid','carry','service','trials','v4','v3','v2',
    'anime','game','roll','gacha','spin','summon','pet','pets',
];

const COMMON_SLASH_COMMAND_NAMES = [
    'setup','changesetup','set','exile','unexile','exilelist','violations','clearviolations','testscan','botstatus',
    'enableimmunity','disableimmunity','addimmunity','removeimmunity','immunestatus',
    'warn','unwarn','setthreshold','setexileduration','purge','lock','unlock','setgameshub','togglescam',
    'togglecommands','punishlist','punishlog','scan','scanuser','scanmessage',
];

const COMMAND_EVASION_PATTERNS = [
    'c o m m a n d s','c o m m a n d','h e l p','p i n g','i n v i t e','s u p p o r t',
    'w a r n','m u t e','b a n','k i c k','t i m e o u t','l o c k','u n l o c k','p u r g e',
    's e t u p','s e t','c o n f i g','s e t t i n g s','t o g g l e','e n a b l e','d i s a b l e',
    's l a s h c o m m a n d','s l a s h c o m m a n d s',
    '/ h e l p','/ c o m m a n d s','/ p i n g','/ i n v i t e','/ s e t u p',
    '! h e l p','! c o m m a n d s','! p i n g','! i n v i t e','! s e t u p',
    '. h e l p','. c o m m a n d s','. p i n g','. i n v i t e','. s e t u p',
    '／help','／commands','／ping','／invite','／setup',
    '！help','！commands','！ping','！invite','！setup',
];

const commandAbuseTracker = new Map();
function recordCommandAbuse(uid) {
    const now = Date.now();
    const e = commandAbuseTracker.get(uid) || { hits: [], last: 0 };
    e.last = now;
    e.hits.push(now);
    e.hits = e.hits.filter(t => now - t < 60000);
    commandAbuseTracker.set(uid, e);
    return e;
}
setInterval(() => {
    const now = Date.now();
    for (const [uid, e] of commandAbuseTracker) {
        if (now - (e.last || 0) > 5*60000) commandAbuseTracker.delete(uid);
    }
}, 180000);

const emojiSpamTracker = new Map();
// PATCH: mathSessions was used but never declared — tracks multi-line .Calc/.qalc sessions per user
const mathSessions = new Map();
function recordEmojiSpam(uid, guildId, count) {
    const key = `${guildId}:${uid}`;
    const now = Date.now();
    const e = emojiSpamTracker.get(key) || { hits: [], last: 0 };
    e.last = now;
    e.hits.push({ t: now, c: count || 0 });
    e.hits = e.hits.filter(x => now - x.t < 60000);
    emojiSpamTracker.set(key, e);
    return e;
}
function getEmojiSpamScore(uid, guildId, windowSec) {
    const key = `${guildId}:${uid}`;
    const now = Date.now();
    const e = emojiSpamTracker.get(key);
    if (!e) return { total: 0 };
    const w = Math.max(3, Math.min(60, windowSec || 12)) * 1000;
    const items = e.hits.filter(x => now - x.t <= w);
    const total = items.reduce((a,b)=>a+(b.c||0),0);
    return { total };
}
setInterval(() => {
    const now = Date.now();
    for (const [k, e] of emojiSpamTracker) {
        if (now - (e.last || 0) > 10*60000) emojiSpamTracker.delete(k);
    }
}, 240000);

function countUppercaseMetrics(text) {
    const s = (text || '').replace(/https?:\/\/[^\s]+/gi, '');
    let letters = 0;
    let upper = 0;
    let run = 0;
    let maxRun = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (/[a-z]/i.test(ch)) {
            letters++;
            if (/[A-Z]/.test(ch)) {
                upper++;
                run++;
                if (run > maxRun) maxRun = run;
            } else {
                run = 0;
            }
        } else {
            run = 0;
        }
    }
    const percent = letters ? (upper / letters) * 100 : 0;
    return { letters, upper, percent, maxRun };
}

function countEmojiLike(text) {
    const s = text || '';
    const custom = (s.match(/<a?:\w{2,32}:\d{5,}>/g) || []).length;
    const unicodeEmoji = (s.match(/[\p{Extended_Pictographic}]/gu) || []).length;
    return custom + unicodeEmoji;
}

function countCombiningMarks(text) {
    const s = text || '';
    const marks = (s.match(/[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7-\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0981-\u0983\u09bc\u09be-\u09c4\u09c7-\u09c8\u09cb-\u09cd\u09d7\u09e2-\u09e3\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47-\u0a48\u0a4b-\u0a4d\u0a51\u0a70-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47-\u0b48\u0b4b-\u0b4d\u0b56-\u0b57\u0b62-\u0b63\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0c00-\u0c04\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55-\u0c56\u0c62-\u0c63\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5-\u0cd6\u0ce2-\u0ce3\u0d00-\u0d03\u0d3b-\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62-\u0d63\u0d82-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2-\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ecd\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f3f\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f\u109a-\u109d\u135d-\u135f\u1712-\u1714\u1732-\u1734\u1752-\u1753\u1772-\u1773\u17b4-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u192b\u1930-\u193b\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f\u1ab0-\u1abe\u1b00-\u1b04\u1b34-\u1b44\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1be6-\u1bf3\u1c24-\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf2-\u1cf4\u1cf7-\u1cf9\u1dc0-\u1df9\u1dfb-\u1dff\u200c-\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099-\u309a\ua66f\ua674-\ua67d\ua69e-\ua69f\ua6f0-\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880-\ua881\ua8b4-\ua8c5\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9e5\uaa29-\uaa36\uaa43\uaa4c\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7-\uaab8\uaabe-\uaabf\uaac1\uaaeb-\uaaef\uaaf5-\uaaf6\uabe3-\uabea\uabec-\uabed\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufeff]/g) || []);
    return marks.length;
}

function parseInviteDomains(text) {
    const s = (text || '').toLowerCase();
    const domains = [];
    const urls = (s.match(/https?:\/\/[^\s)\]]+/gi) || []);
    for (const u of urls) {
        const m = u.match(/^https?:\/\/([^\/\s?#:]+)(?::\d+)?/i);
        if (m && m[1]) domains.push(m[1]);
    }
    if (s.includes('discord.gg/') || s.includes('discord.com/invite') || s.includes('discordapp.com/invite')) {
        domains.push('discord.gg');
        domains.push('discord.com');
    }
    return [...new Set(domains)];
}

function hasDiscordInvite(text) {
    const s = (text || '').toLowerCase();
    if (/discord\.gg\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/discord(?:app)?\.com\/invite\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/discord\.me\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/dsc\.gg\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/invite\.gg\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/inv\.gg\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/discord\.link\/[a-z0-9-]{2,}/i.test(s)) return true;
    if (/dis\.gd\/[a-z0-9-]{2,}/i.test(s)) return true;
    const ns = s.replace(/[\s_\-\.]/g,'');
    if (ns.includes('discordgg/') || ns.includes('discordgg\\') || ns.includes('discordgg／')) return true;
    if (ns.includes('discordcom/invite') || ns.includes('discordappcom/invite')) return true;
    if (ns.includes('dscgg/') || ns.includes('invitegg/') || ns.includes('invgg/')) return true;
    return false;
}

function getAttachmentExts(message) {
    const out = [];
    const atts = message?.attachments ? [...message.attachments.values()] : [];
    for (const a of atts) {
        const name = (a?.name || '').toLowerCase();
        const m = name.match(/\.([a-z0-9]{1,8})$/i);
        if (m && m[1]) out.push(m[1]);
    }
    return out;
}

function looksLikeCommandButNotCaught(raw, cleaned) {
    const r = (raw || '').trim();
    if (!r) return false;
    if (/^\s*\?afk\b/i.test(raw || '')) return false;
    if (/^:[a-zA-Z0-9_]{2,32}:/.test(r)) return false;
    const t = cleaned || fullClean(r);
    const ns = t.replace(/[\s_]/g,'');
    if (/^["'()\[\]{}]/.test(r)) return false;

    // ── Discord markdown formatting — never treat as commands ──────────────
    // Bold: **text**, Italic: *text* or _text_, Underline: __text__
    // Strikethrough: ~~text~~, Spoiler: ||text||, Bold-italic: ***text***
    if (/^\*{1,3}[^*]/.test(r)) return false;   // *italic*, **bold**, ***bold-italic***
    if (/^_{1,2}[^_]/.test(r)) return false;     // _italic_, __underline__
    if (/^~~[^~]/.test(r)) return false;          // ~~strikethrough~~
    if (/^\|\|[^|]/.test(r)) return false;        // ||spoiler||
    // ───────────────────────────────────────────────────────────────────────

    // KEY RULE: "char SPACE word" is NOT a command. Only "charword" (zero spaces) counts.
    // e.g. ".invite" → command; ". invite" → NOT a command; "i am going to .say" → NOT a command
    // A command prefix must be at the START of the message, immediately followed by letters.
    if (/^[^a-zA-Z0-9\s@]\s+/.test(r)) return false; // char then any space → not a command

    // g.command style (no space needed here since it's always "g.word")
    if (/^\s*g\.[a-z0-9_]{2,32}\b/i.test(r)) return true;

    // Check known prefixes - must be followed IMMEDIATELY by a letter (no space)
    for (const p of COMMAND_LIKE_PREFIXES) {
        const rl = r.toLowerCase();
        if (rl.startsWith(p)) {
            const afterPrefix = rl.slice(p.length);
            // Immediately followed by a letter = command. Space after prefix = not a command.
            if (afterPrefix.length > 0 && /^[a-z]/i.test(afterPrefix)) return true;
        }
    }

    // Slash commands at start: /commandname (no space allowed between / and name)
    if (/^\/[a-z0-9]{2,32}/i.test(r)) return true;
    // Bang or dot IMMEDIATELY followed by letters (no \s* allowed)
    if (/^[!.][a-z]{2,32}/i.test(r)) return true;
    // Bot mention + command prefix
    if (/^<@!?\d+>\s*[!./][a-z]/i.test(r)) return true;

    for (const ev of COMMAND_EVASION_PATTERNS) {
        const evLower = ev.toLowerCase();
        const ec = evLower.replace(/[\s_]/g,'');
        if (ec.length >= 6) {
            // Check spaced-out evasion in the cleaned text (e.g. "d i s a b l e")
            if (t.includes(evLower)) return true;
            // Check compact form with word boundaries — prevents subword matches like
            // "disable" firing on "disabled", "enable" on "enabled", "unlock" on "unlocked", etc.
            if (new RegExp(`(?<![a-z0-9])${escapeRegex(ec)}(?![a-z0-9])`, 'i').test(ns)) return true;
        }
    }

    for (const n of COMMON_SLASH_COMMAND_NAMES) {
        const nc = n.toLowerCase().replace(/[\s_]/g,'');
        if (nc.length >= 3 && (ns.startsWith('/'+nc) || ns.startsWith('／'+nc))) return true;
    }

    // Known command words: only flag when prefix is IMMEDIATELY before the word (no space)
    for (const w of COMMON_COMMAND_WORDS) {
        const wc = w.toLowerCase().replace(/[\s_]/g,'');
        if (wc.length >= 4 && new RegExp(`^(?:/|!|\\.)${escapeRegex(wc)}(?![a-z0-9])`, 'i').test(r)) return true;
    }

    if (/\b(?:type|use|run)\b[\s\W_]{0,8}(?:\!|\/|\.)[a-z0-9]{2,20}/i.test(r)) return true;
    if (/\b(?:prefix|cmd|command|commands)\b/i.test(r) && (r.includes('!') || r.includes('/'))) return true;
    if (/\b(?:bot|autobot|moderation|mod bot)\b/i.test(r) && /\b(?:cmd|command|commands|prefix)\b/i.test(r)) return true;

    return false;
}

client.on('messageCreate', async message => {
    
    if (await mathMod.handleMathMessage(message)) return;
    
    if (message.author.bot || !message.guild) return;
    if (message.stickers && message.stickers.size && (!message.content || !String(message.content).trim())) return;
    const data  = loadData();
    const guildId = message.guild.id;
    const gs    = getGuildSettings(guildId, data);
    const _isBotOwner_msg = isSuperUser(message.author.id);
    const isAdmin = _isBotOwner_msg || message.member?.permissions.has(PermissionFlagsBits.Administrator) || isManagerMember(message.member, guildId, data);
    const isMod   = _isBotOwner_msg || message.member?.permissions.has(PermissionFlagsBits.ManageMessages) || isManagerMember(message.member, guildId, data);
    const isStaff = isAdmin || isMod;
    // Superuser is always immune from every scan, redirect, and enforcement path.
    const immune  = _isBotOwner_msg || (message.member ? isMemberImmune(message.member, guildId, data) : false);
    const immCfg  = getImmunitySettings(guildId, data);

    const rawContent = String(message.content || '');
    const content = rawContent.trim();
    const uid = message.author.id;
    const roastKey = `${guildId}:${message.channel.id}:${uid}`;

    if (roastBattles.has(roastKey)) {
        const lower = content.toLowerCase();
        if (lower === 'stop' || lower === 'quit') {
            const st = roastBattles.get(roastKey);
            roastBattles.delete(roastKey);
            if (st?.convoId) {
                try { await pyWorker.request('roast_kill', { convoId: st.convoId }); } catch {}
            }
            await message.channel.send('Roast battle ended.').catch(()=>{});
            return;
        }
        let resp = null;
        const st = roastBattles.get(roastKey);
        if (st?.convoId) {
            try { resp = await pyWorker.request('roast_send', { convoId: st.convoId, message: content }); } catch { resp = null; }
        }
        if (!resp) resp = 'Cooking up the perfect roast... (install roastedbyai for full AI roasts)';
        await message.reply(String(resp).slice(0, 1990)).catch(()=>{});
        return;
    }

    if (content.startsWith('.Calc ')) {
        mathSessions.set(uid, { mode: 'calc', lines: [content.slice(6)] });
        await message.channel.send('📝 Send more lines or type `Evaluate`').catch(()=>{});
        return;
    }
    if (content.startsWith('.qalc ')) {
        mathSessions.set(uid, { mode: 'qalc', lines: [content.slice(6)] });
        await message.channel.send('🧮 Qalculate mode started. Send more lines or type `Evaluate`').catch(()=>{});
        return;
    }
    if (mathSessions.has(uid)) {
        const st = mathSessions.get(uid);
        if (content.toLowerCase() === 'evaluate') {
            mathSessions.delete(uid);
            const expr = (st.lines || []).join('');
            const lower = expr.toLowerCase();
            let result;
            if (lower.startsWith('sympy')) {
                try { result = await pyWorker.request('sympy_eval', { expression: expr.slice('sympy'.length).trim() }); }
                catch (e) { result = `SymPy Error: ${String(e?.message || e)}`; }
            } else if (lower.startsWith('tower')) {
                result = await superqalcTower(expr.slice('tower'.length).trim());
            } else if (lower.startsWith('qalc')) {
                result = await qalcEval(expr.slice('qalc'.length).trim());
            } else {
                result = await superqalcOnefile(expr);
            }
            await sendLongToMessage(message.channel, result);
            return;
        }
        st.lines = st.lines || [];
        st.lines.push(content);
        mathSessions.set(uid, st);
        return;
    }

    if (content.toLowerCase().startsWith('!roast')) {

        // ── Per-user cooldown (bypasses ai2State cooldown system entirely) ──
        const ROAST_COOLDOWN_MS = 15_000; // 15 seconds between roasts per user
        const roastCooldowns = (client._roastCooldowns = client._roastCooldowns || new Map());
        const lastRoast = roastCooldowns.get(uid) || 0;
        const roastCdRemaining = ROAST_COOLDOWN_MS - (Date.now() - lastRoast);
        if (roastCdRemaining > 0) {
            await message.reply(`🧊 Chill out. You can roast again in **${Math.ceil(roastCdRemaining / 1000)}s**.`).catch(()=>{});
            return;
        }

        const parts = content.split(/\s+/);
        const sub = (parts[1] || '').toLowerCase();
        if (sub === 'battle') {
            let convoId = null;
            try {
                const res = await pyWorker.request('roast_start', { convoId: roastKey, style: 'default' });
                convoId = res?.convoId || roastKey;
            } catch { convoId = null; }
            roastBattles.set(roastKey, { convoId });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rb_stop:${roastKey}`).setLabel('Stop').setStyle(ButtonStyle.Secondary)
            );
            await message.reply({ content: 'Roast battle started. Send your roast. Type `stop` or press Stop to end.', components: [row] }).catch(()=>{});
            return;
        }
        if (sub === 'me' || !message.mentions.users.size) {
            await message.reply("Look in the mirror. That's my roast.").catch(()=>{});
            return;
        }
        let target = message.mentions.users.first();
        if (target && target.id === uid) {
            await message.reply("Look in the mirror. That's my roast.").catch(()=>{});
            return;
        }

        // ── If they tried to roast the bot, roast them back instead ──
        if (target && target.id === client.user.id) {
            target = message.author;
            await message.reply(`Nice try. You really thought you could roast *me*? Let me show you how it's done. 🔥`).catch(()=>{});
        }

        // ── Extract optional <reason> (everything after the @mention) ──
        const roastReason = content.replace(/^!roast\s*/i, '').replace(/<@!?\d+>/g, '').trim();

        // Mark cooldown as soon as we accept the command
        roastCooldowns.set(uid, Date.now());

        // ── Huge fallback roast list (used if all AI providers fail) ──
        const FALLBACK_ROASTS = [
            "n", "Your WiFi password is probably 'password123' and you still can't connect.",
            "You're the human equivalent of a Terms & Conditions page — nobody reads you.",
            "Your personality has the energy of a wet paper bag in a light drizzle.",
            "If being boring was a sport, you'd finally have something to brag about.",
            "You type like you're using oven mitts and autocorrect is scared of you.",
            "Your chat history reads like a cry for help written in Comic Sans.",
            "You have the emotional range of a loading screen.",
            "Your vibe is 'someone who microwaves fish in the office breakroom.'",
            "I've seen NPCs with more personality than you.",
            "You're the main character of a story nobody wants to read.",
            "Your sense of humour is still pending review.",
            "You're the kind of person who shows up to a roast and asks if it's a potluck.",
            "Your takes are always cold, never hot.",
            "You peaked in a tutorial level and called it a win.",
            "Your presence has the same energy as a mandatory work meeting.",
            "Even your shadow tries to walk slightly ahead of you.",
            "You're the human equivalent of buffering at 99%.",
            "Your messages read like they were written by someone using Google Translate twice.",
            "You're that one ad that plays without a skip button.",
            "If confidence were a currency, you'd be deeply in debt.",
            "You have the aura of someone who has never found a good parking spot.",
            "Your comebacks take so long to load I age between insults.",
            "You bring the energy of a dead phone at 0% battery.",
            "Your entire personality is a loading spinner that never resolves.",
            "You're built like a mobile game — full of bugs and asking for money.",
            "Watching you problem-solve is like watching someone try to fold a fitted sheet.",
            "You move through life like you're on 2G data.",
            "Your self-awareness is set to developer mode — off by default.",
            "You're the kind of guy that gets motion sickness on a swing set.",
            "If you were a font you'd be Comic Sans — technically functional, universally mocked.",
            "Your hot takes need to be refrigerated.",
            "You have the rizz of a government form.",
            "You're chronically online but somehow always offline socially.",
            "Your resume of L's is genuinely impressive.",
            "You're the tutorial NPC who gives advice that doesn't work in the actual game.",
            "You talk a big game for someone who respawns at the checkpoint every time.",
            "Your social skills have a skill issue.",
            "You're living proof that you can be online 24/7 and still have nothing to say.",
            "Your personality is DLC that wasn't worth buying.",
            "You have the confidence of someone who just discovered Wikipedia and thinks they're an expert.",
            "You're the reason some servers have a 'no talking' channel.",
            "Your consistency is impressive — consistently mid.",
            "You've got the charisma of a CAPTCHA.",
            "You're what happens when 'try your best' just isn't enough.",
            "Your takes arrive late, cold, and with no napkins.",
            "You're the aux cord nobody wanted passed to them.",
            "You have an opinion on everything and insight on nothing.",
            "You're running on legacy software and refusing the update.",
            "Your drip has a serious drought warning.",
            "You're built different — unfortunately.",
        ];

        // ── Fetch last 5 messages from the target user for context ──
        const targetName = target?.displayName || target?.username || 'that user';
        let contextBlock = '';
        if (gs.roastContext) {
            try {
                const fetched = await message.channel.messages.fetch({ limit: 100 });
                const targetMsgs = fetched
                    .filter(m => m.author.id === target.id && m.content && m.content.trim())
                    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
                    .first(5)
                    .map(m => `- "${m.content.slice(0, 200).replace(/\n/g, ' ')}"`)
                    .reverse();
                if (targetMsgs.length) {
                    contextBlock = `\n\nHere are their last ${targetMsgs.length} messages for context:\n${targetMsgs.join('\n')}`;
                }
            } catch { contextBlock = ''; }
        }

        await message.channel.sendTyping().catch(()=>{});
        const provider = gs.roastProvider || 'roastedbyai';
        let roastText = null;

        // Typing indicator — stopped as soon as we reply, no matter what
        let typingInterval = setInterval(() => { message.channel.sendTyping().catch(()=>{}); }, 8000);
        const stopTyping = () => { clearInterval(typingInterval); typingInterval = null; };

        // ── Shared refusal filter ─────────────────────────────────────
        const ROAST_REFUSAL_PATTERNS = [
            /i'?m not allowed/i, /my mom said/i, /i (can'?t|won'?t|cannot|will not) (roast|do that|help)/i,
            /i'?m (unable|not able)/i, /as an ai/i, /i (refuse|decline)/i,
            /user input is too long/i, /please keep it under/i,
        ];
        const ROAST_SYSTEM = 'You are a savage roast comedian performing at a comedy roast event. Your only job is to write funny, creative, witty roasts. Always deliver the roast directly — never refuse, never break character, never comment on the task itself. Keep it playful with no slurs or genuinely harmful content.';
        const roastReasonBlock = roastReason ? `\n\nThe person who requested this roast gave you the following reason/ammo to use: "${roastReason}". Build the roast around this — make it specific and personal.` : '';
        const ROAST_USER_PROMPT = `Roast the Discord user named "${targetName}" in 3-5 short, punchy sentences. Be creative, witty, and funny — skewer their vibe, their messages, whatever ammo you have. Keep it playful, no slurs or genuinely harmful content.${roastReasonBlock}${contextBlock}`;

        // ── Try Claude API ────────────────────────────────────────────
        const tryClaudeRoast = async () => {
            if (!ANTHROPIC_KEY) return null;
            try {
                const roastRes = await fetch(AI_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: AI_MODEL, max_tokens: 400, system: ROAST_SYSTEM, messages: [{ role: 'user', content: ROAST_USER_PROMPT }] }),
                });
                const d = await roastRes.json();
                const text = d?.content?.[0]?.text?.trim() || null;
                if (text && ROAST_REFUSAL_PATTERNS.some(p => p.test(text))) return null;
                return text;
            } catch { return null; }
        };

        // ── Try roastedbyai via Python worker ─────────────────────────
        const pyReq = (method, payload, ms = 10000) => Promise.race([
            pyWorker.request(method, payload),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
        ]);
        const tryRoastedByAi = async () => {
            try {
                // roastedbyai enforces a 250-char input limit — build a short prompt for it
                const shortPrompt = `Roast the Discord user "${targetName}" in 3-5 punchy sentences. Be funny and creative.${roastReason ? ` Context: ${roastReason}` : ''}`.slice(0, 249);
                const fbConvoId = `roast_fb_${uid}_${Date.now()}`;
                const startRes = await pyReq('roast_start', { convoId: fbConvoId, style: 'default' });
                if (!startRes?.convoId) return null;
                const fbResp = await pyReq('roast_send', { convoId: startRes.convoId, message: shortPrompt });
                pyReq('roast_kill', { convoId: startRes.convoId }).catch(()=>{});
                const text = (fbResp && typeof fbResp === 'string' && fbResp.trim()) ? fbResp.trim() : null;
                if (text && ROAST_REFUSAL_PATTERNS.some(p => p.test(text))) return null;
                return text;
            } catch { return null; }
        };

        // ── Try OpenRouter (openai/gpt-oss-120b) API ─────────────────────
        const tryGroqRoast = async () => {
            if (!GROQ_API_KEY) return null;
            try {
                const roastRes = await fetch(GROQ_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
                    body: JSON.stringify({
                        model: GROQ_MODEL,
                        max_tokens: 400,
                        messages: [
                            { role: 'system', content: ROAST_SYSTEM },
                            { role: 'user',   content: ROAST_USER_PROMPT },
                        ],
                    }),
                });
                const d = await roastRes.json();
                const text = d?.choices?.[0]?.message?.content?.trim() || null;
                if (text && ROAST_REFUSAL_PATTERNS.some(p => p.test(text))) return null;
                return text;
            } catch { return null; }
        };

        const withTimeout = (fn, ms) => Promise.race([
            fn(),
            new Promise(r => setTimeout(() => r(null), ms)),
        ]);

        try {
            // ── Pick primary fn based on configured provider ───────────
            const primaryFn = provider === 'claude' ? tryClaudeRoast
                            : provider === 'groq'   ? tryGroqRoast
                            :                         tryRoastedByAi;

            // ── Try primary: up to 4 attempts ─────────────────────────
            for (let i = 0; i < 4 && !roastText; i++) {
                try { roastText = await withTimeout(primaryFn, 12000); } catch { roastText = null; }
                if (!roastText && i < 3) await new Promise(r => setTimeout(r, 1200));
            }

            // ── Fallback 1: OpenRouter/gpt-oss-120b (unless it was primary) ──
            if (!roastText && primaryFn !== tryGroqRoast) {
                for (let i = 0; i < 3 && !roastText; i++) {
                    try { roastText = await withTimeout(tryGroqRoast, 12000); } catch { roastText = null; }
                    if (!roastText && i < 2) await new Promise(r => setTimeout(r, 1200));
                }
            }

            // ── Fallback 2: the remaining AI provider ─────────────────
            if (!roastText) {
                const lastResortFn = provider === 'claude'       ? tryRoastedByAi
                                   : /* roastedbyai or gpt-oss-120b */  tryClaudeRoast;
                for (let i = 0; i < 3 && !roastText; i++) {
                    try { roastText = await withTimeout(lastResortFn, 12000); } catch { roastText = null; }
                    if (!roastText && i < 2) await new Promise(r => setTimeout(r, 1200));
                }
            }

            // ── Last resort: hardcoded list ───────────────────────────
            if (!roastText) {
                roastText = FALLBACK_ROASTS[Math.floor(Math.random() * FALLBACK_ROASTS.length)]
                    .replace(/\bn\b/, targetName);
            }
        } finally {
            stopTyping();
        }

        const roastMention = `<@${target.id}> `;
        await message.reply((roastMention + roastText).slice(0, 1990)).catch(()=>{});
        return;
    }

    if (gs.checksEnabled === false) return;

    // ── EXILE CHANNEL — no moderation fires in here ever ──
    // Members serving their sentence can talk freely; allow prefix
    // commands and the AI chat system but skip every enforcement path.
    if (isExileChannel(message.channel.id, message.guild, gs)) {
        await handlePrefixCommands(message, isAdmin, isMod, data, gs);
        await ai2HandleChatMessage(message);
        return;
    }

    if (gs.verifyGateEnabled && !immune && !isCategoryImmune(message.member, guildId, data, 'verify')) {
        const requiredRoleOk = gs.verifyRequiredRoleId ? message.member?.roles?.cache?.has(gs.verifyRequiredRoleId) : false;
        const acctAgeDays = message.author?.createdTimestamp ? (Date.now() - message.author.createdTimestamp) / (1000 * 60 * 60 * 24) : 9999;
        const tooNew = acctAgeDays < (gs.verifyMinAccountAgeDays || 0);
        if (tooNew && !requiredRoleOk) {
            const reason = `Verification gate: account age ${acctAgeDays.toFixed(1)}d < ${gs.verifyMinAccountAgeDays}d.`;
            if (gs.verifyGateAction === 'delete') {
                try { await message.delete(); } catch {}
                return;
            }
            if (gs.verifyGateAction === 'timeout' && gs.timeoutEnabled) {
                await tryTimeout(message.member, gs.timeoutMinutesCommand || 5, reason);
            }
            try { await message.delete(); } catch {}
            await issueViolation(message, data, gs, {
                title: '🛡️ Verification Gate',
                color: 0x5865F2,
                reason: `Your account is too new to post here. Please get verified or wait. (${reason})`,
                details: message.content,
                footerLabel: 'Verify Gate',
                ttlMs: 12000,
            });
            return;
        }
    }

    // ── RAID LOCKDOWN (message-time enforcement) ───────────
    if (gs.raidModeEnabled && isRaidLocked(guildId) && !immune && !isCategoryImmune(message.member, guildId, data, 'raid')) {
        if (message.channel && message.channel.isTextBased && message.channel.isTextBased()) {
            const allow = isGamesHubChannelId(message.channel.id, gs) || message.channel.id === (gs.logChannelId || '') || message.channel.id === (gs.appealsChannelId || '');
            if (!allow) {
                try { await message.delete(); } catch {}
                incStat(guildId, data, 'raidLockdown', 1);
                await issueViolation(message, data, gs, {
                    title: '🛡️ Raid Lockdown Active',
                    color: 0xFFAA00,
                    reason: 'Server raid lockdown is active. Slow down and wait for staff instructions.',
                    details: message.content,
                    footerLabel: 'Raid Lockdown',
                    ttlMs: 12000,
                });
                return;
            }
        }
    }

    // ── GLOBAL IMMUNITY SKIP ──────────────────────────────
    // Must run before ALL moderation checks so addimmunity roles are
    // fully exempt from every enforcement path (commands, trades, spam, etc.)
    if (immune) {
        await handlePrefixCommands(message, isAdmin, isMod, data, gs);
        await ai2HandleChatMessage(message);
        return;
    }

    // ── COMMAND LOCKDOWN ──────────────────────────────────
    if (isServerSetup(gs) && (gs.commandRedirectEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'command') && isMessageCommand(message, gs)) {
        if (!isGamesHubChannelId(message.channel.id, gs)) {
            try { await message.delete(); } catch {}
            recordCommandAbuse(message.author.id);
            incStat(guildId, data, 'commandUsage', 1);
            await issueViolation(message, data, gs, {
                title: '⚠️ Command Usage Violation',
                color: 0xFF3344,
                reason: 'Use commands only in Games Hub.',
                details: message.content,
                redirectChannelId: gs.gamesHubId || DEFAULT_GAMES_HUB_ID,
                footerLabel: 'Command Usage',
                ttlMs: 10000,
            });
            return;
        }
    }

    if (isServerSetup(gs) && (gs.commandRedirectEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'command') && !isGamesHubChannelId(message.channel.id, gs)) {
        const { contentClean: cmdClean } = prepareText(message.content);
        if (looksLikeCommandButNotCaught(message.content, cmdClean)) {
            try { await message.delete(); } catch {}
            const abuse = recordCommandAbuse(message.author.id);
            const extra = abuse?.hits?.length >= 6 ? 'Repeated command attempts detected.' : 'Command-like message outside Games Hub.';
            incStat(guildId, data, 'commandAbuse', 1);
            await issueViolation(message, data, gs, {
                title: '⚠️ Command-Like Abuse Detected',
                color: 0xFF2255,
                reason: extra,
                details: message.content,
                redirectChannelId: gs.gamesHubId || DEFAULT_GAMES_HUB_ID,
                footerLabel: 'Command Abuse',
                ttlMs: 10000,
            });
            return;
        }
    }

    // ── MENTION SPAM ───────────────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'mention')) {
        const mentionIds = [...new Set([
            ...(message.mentions?.users ? [...message.mentions.users.keys()] : []),
            ...(message.mentions?.roles ? [...message.mentions.roles.keys()] : []),
        ])];
        if (mentionIds.length) {
            recordMentions(message.author.id, guildId, mentionIds);
            const score = getMentionSpamScore(message.author.id, guildId, gs.mentionSpamWindowSec || 12);
            const totalLimit = Math.max(1, Math.min(30, gs.mentionSpamLimit || 6));
            const uniqLimit  = Math.max(1, Math.min(30, gs.mentionSpamUniqueLimit || 5));
            if (score.total >= totalLimit || score.unique >= uniqLimit) {
                try { await message.delete(); } catch {}
                incStat(guildId, data, 'mentionSpam', 1);
                await issueViolation(message, data, gs, {
                    title: '⚠️ Mention Spam',
                    color: 0xFF4466,
                    reason: `Too many mentions (${score.total} total / ${score.unique} unique).`,
                    details: message.content,
                    footerLabel: 'Mention Spam',
                    ttlMs: 12000,
                });
                return;
            }
        }
    }

    // ── LINK POLICY (allowlist/denylist) ───────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'link') && gs.linkPolicyEnabled) {
        const domains = extractDomains(message.content);
        if (domains.length) {
            if (gs.raidModeEnabled && isRaidLocked(guildId) && gs.raidLinkBlockAll) {
                try { await message.delete(); } catch {}
                incStat(guildId, data, 'linkPolicy', 1);
                await issueViolation(message, data, gs, {
                    title: '🚫 Links Blocked During Raid Lockdown',
                    color: 0xFF0000,
                    reason: `Raid lockdown active: links are temporarily blocked (${domains.slice(0,6).join(', ')}).`,
                    details: message.content,
                    footerLabel: 'Raid Link Block',
                    ttlMs: 15000,
                });
                return;
            }

            const acctDays = gs.raidNewAccountDays || 0;
            if (acctDays > 0 && message.author?.createdTimestamp) {
                const ageMs = Date.now() - message.author.createdTimestamp;
                const ageDays = ageMs / (24*60*60*1000);
                if (ageDays < acctDays && (gs.raidModeEnabled || isRaidLocked(guildId))) {
                    try { await message.delete(); } catch {}
                    incStat(guildId, data, 'linkPolicy', 1);
                    await issueViolation(message, data, gs, {
                        title: '🚫 New Account Link Block',
                        color: 0xFF0000,
                        reason: `Account is too new (${ageDays.toFixed(2)}d < ${acctDays}d) to post links right now.`,
                        details: message.content,
                        footerLabel: 'New Account Links',
                        ttlMs: 15000,
                    });
                    return;
                }
            }

            const cls = classifyLinkDomains(domains, gs);
            if (cls.blocked.length || cls.suspicious.length) {
                try { await message.delete(); } catch {}
                const why = cls.blocked.length
                    ? `Blocked domain(s): ${cls.blocked.slice(0,6).join(', ')}`
                    : `Suspicious domain(s): ${cls.suspicious.slice(0,6).join(', ')}`;
                incStat(guildId, data, 'linkPolicy', 1);
                await issueViolation(message, data, gs, {
                    title: '🚫 Link Policy Violation',
                    color: 0xCC0000,
                    reason: why,
                    details: message.content,
                    footerLabel: 'Link Policy',
                    ttlMs: 15000,
                });
                return;
            }
        }
    }

    // ── ATTACHMENT POLICY ─────────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'attachment') && gs.attachmentPolicyEnabled && message.attachments && message.attachments.size) {
        const exts = getAttachmentExts(message);
        const block = (gs.attachmentBlockExts || []).map(x => String(x||'').toLowerCase());
        const hit = exts.find(e => block.includes(String(e||'').toLowerCase()));
        let suspiciousName = false;
        for (const a of message.attachments.values()) {
            if (isSuspiciousAttachmentName(a?.name || '')) { suspiciousName = true; break; }
        }
        if (hit || suspiciousName) {
            try { await message.delete(); } catch {}
            await issueViolation(message, data, gs, {
                title: '🚫 Attachment Blocked',
                color: 0xCC0000,
                reason: hit ? `Blocked file type: .${hit}` : 'Suspicious attachment filename pattern.',
                details: message.content || '(attachment)',
                footerLabel: 'Attachment Policy',
                ttlMs: 15000,
            });
            return;
        }
    }

    // ── INVITE POLICY ─────────────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'invite') && gs.invitePolicyEnabled && hasDiscordInvite(message.content)) {
        const allowedCh = (gs.inviteAllowedChannelIds || []).includes(message.channel.id);
        if (!allowedCh) {
            const invDomains = parseInviteDomains(message.content);
            const allow = (gs.inviteAllowlistDomains || []).map(normalizeDomain).filter(Boolean);
            const deny  = (gs.inviteDenylistDomains  || []).map(normalizeDomain).filter(Boolean);
            let blocked = true;
            if (!deny.length && !allow.length) blocked = true;
            for (const d of invDomains.map(normalizeDomain)) {
                if (!d) continue;
                if (deny.length && domainInList(d, deny)) { blocked = true; break; }
                if (allow.length && domainInList(d, allow)) { blocked = false; break; }
            }
            if (blocked) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '🚫 Invite Link Blocked',
                    color: 0xCC0000,
                    reason: 'Discord invites are not allowed in this channel.',
                    details: message.content,
                    footerLabel: 'Invite Policy',
                    ttlMs: 15000,
                });
                return;
            }
        }
    }

    // ── CAPS SPAM ─────────────────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'caps') && gs.capsSpamEnabled) {
        const m = countUppercaseMetrics(message.content);
        const minLetters = Math.max(8, Math.min(80, gs.capsMinLetters || 16));
        const maxPct = Math.max(30, Math.min(100, gs.capsMaxPercent || 70));
        const maxRun = Math.max(10, Math.min(120, gs.capsMaxRun || 28));
        const pctHit = m.percent >= maxPct;
        const runHit = (m.maxRun >= maxRun) && (m.percent >= Math.min(90, Math.max(35, maxPct * 0.6)));
        if (m.letters >= minLetters && (pctHit || runHit)) {
            try { await message.delete(); } catch {}
            await issueViolation(message, data, gs, {
                title: '⚠️ Caps Spam',
                color: 0xFF4466,
                reason: `Too much caps (letters=${m.letters}, caps=${m.upper}, caps%=${m.percent.toFixed(1)}%, run=${m.maxRun}).`,
                details: message.content,
                footerLabel: 'Caps Spam',
                ttlMs: 12000,
            });
            return;
        }
    }

    // ── EMOJI SPAM ────────────────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'emoji') && gs.emojiSpamEnabled) {
        const emojiCount = countEmojiLike(message.content);
        if (emojiCount) {
            recordEmojiSpam(message.author.id, guildId, emojiCount);
            const score = getEmojiSpamScore(message.author.id, guildId, gs.emojiWindowSec || 12);
            const max = Math.max(5, Math.min(60, gs.emojiMaxCount || 18));
            if (score.total >= max) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '⚠️ Emoji Spam',
                    color: 0xFF4466,
                    reason: `Too many emoji in ${gs.emojiWindowSec || 12}s window (${score.total} >= ${max}).`,
                    details: message.content,
                    footerLabel: 'Emoji Spam',
                    ttlMs: 12000,
                });
                return;
            }
        }
    }

    // ── ZALGO / COMBINING MARK SPAM ───────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'zalgo') && gs.zalgoEnabled) {
        const marks = countCombiningMarks(message.content);
        const max = Math.max(4, Math.min(80, gs.zalgoMaxCombining || 12));
        if (marks >= max) {
            try { await message.delete(); } catch {}
            await issueViolation(message, data, gs, {
                title: '⚠️ Zalgo / Glitch Text',
                color: 0xFF4466,
                reason: `Too many combining marks (${marks} >= ${max}).`,
                details: message.content,
                footerLabel: 'Zalgo Text',
                ttlMs: 12000,
            });
            return;
        }
    }

    // ── STRETCH / REPEAT SPAM ─────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'stretch') && gs.stretchSpamEnabled) {
        const res = detectStretchSpam(message.content, gs);
        if (res?.hit) {
            try { await message.delete(); } catch {}
            await issueViolation(message, data, gs, {
                title: '⚠️ Stretch / Repeat Spam',
                color: 0xFF4466,
                reason: res.reason,
                details: message.content,
                footerLabel: 'Stretch Spam',
                ttlMs: 12000,
            });
            return;
        }
    }

    // ── DUPLICATE MESSAGE SPAM ────────────────────────────
    if (!immune && !isCategoryImmune(message.member, guildId, data, 'dupe') && gs.dupeSpamEnabled) {
        const res = detectDupeSpam(message.author.id, guildId, message.content, gs);
        if (res?.hit) {
            try { await message.delete(); } catch {}
            incStat(guildId, data, 'spam', 1);
            await issueViolation(message, data, gs, {
                title: '⚠️ Duplicate Message Spam',
                color: 0xFF4466,
                reason: res.reason,
                details: message.content,
                footerLabel: 'Duplicate Spam',
                ttlMs: 12000,
            });
            return;
        }
    }

    // ── PREFIX COMMANDS (!...) ─────────────────────────────
    await handlePrefixCommands(message, isAdmin, isMod, data, gs);

    await ai2HandleChatMessage(message);

    // Pass the full message object so prepareText can include forwarded-message
    // snapshot text (prevents the forward-bypass) and all custom/Nitro emoji names.
    const { contentClean, contentNospace, emojiNames, hasForward } = prepareText(message.content, message);

    // ── SPAM DETECTION ────────────────────────────────────
    // NOTE: this MUST run before the trivial message guard below.
    // Short messages like "e", "w", "wd" are classic spam floods — they have
    // fewer than 4 alphanumeric chars so the guard would return early and the
    // spam tracker would never record them, making the threshold unreachable.
    if (gs.spamWarnEnabled !== false && !isCategoryImmune(message.member, guildId, data, 'spam')) {
        const spamResult = checkSpam(message.author.id, message.content, gs, guildId);
        if (spamResult.spam) {
            clearSpamHistory(message.author.id, guildId);
            await handlePolicyViolation(message, data, gs, 'spam', {
                title: '⚠️ Spam Detected',
                color: 0xFF8800,
                reason: `No spam allowed. (${spamResult.reason})`,
                footerLabel: 'Spam',
                ttlMs: 10000,
            });
            return;
        }
    }

    // ── TRIVIAL MESSAGE GUARD ─────────────────────────────────────
    // Skip scanning for messages that are purely punctuation, dots, reaction
    // characters, or have fewer than 4 meaningful alphanumeric chars.
    // e.g. ".", "..", "....", ".?", "!", "?!", "okay.", "lol.", "^^", "xd."
    // A real trade/service post always has at least one actual word.
    //
    // IMPORTANT: forwarded messages may have an empty caption (message.content = "")
    // while the actual content lives in message.messageSnapshots.  We must NOT skip
    // them here — contentNospace already includes the snapshot text (via prepareText),
    // so we check that instead of message.content alone when a forward is detected.
    {
        // For forwards: trust contentNospace (which already has snapshot text).
        // For regular messages: also gate on the raw content so tiny spam msgs are still blocked.
        const alphanumCount = hasForward
            ? (contentNospace.replace(/[^a-z0-9]/gi, '').length)
            : ((message.content.match(/[a-zA-Z0-9]/g) || []).length);
        if (alphanumCount < 4) return;
        // Also skip if the cleaned content is exclusively punctuation / whitespace
        const meaningfulChars = contentNospace.replace(/[^a-z0-9]/g, '');
        if (meaningfulChars.length < 3) return;
    }

    // ── AI DETECTION (always-classify) ────────────────────
    // Only run AI at strictness 4+ — below that, simple regex only.
    if (AI_ENABLED && gs.aiEnabled && getStrictness(gs) >= 4) {
        const aiResult = await aiDetectViolation(message, [], gs);
        const _aiThreshInline = getAiConfidenceThreshold(gs);
        if (aiResult?.violation && aiResult.confidence > _aiThreshInline && aiResult.category && aiResult.category !== 'none') {
            const cat = String(aiResult.category || '').toLowerCase();
            if (!isCategoryImmune(message.member, guildId, data, cat)) {
                incStat(guildId, data, 'aiFlag', 1);

                if (cat === 'spam' && gs.spamWarnEnabled !== false) {
                    await handlePolicyViolation(message, data, gs, 'spam', {
                        title: '⚠️ Spam Detected',
                        color: 0xFF8800,
                        reason: `AI: ${aiResult.reason || 'Spam/inappropriate content'}`,
                        footerLabel: 'Spam',
                        ttlMs: 10000,
                    });
                    return;
                }

                if (cat === 'scam' && gs.scamWarnEnabled !== false) {
                    incStat(guildId, data, 'scam', 1);
                    const action = gs.linkAction || 'warn';
                    await applyConfiguredAction(message, data, gs, {
                        action,
                        title: '🚨 Scam/Exploit Content Detected',
                        color: 0xCC0000,
                        reason: `AI: ${aiResult.reason || 'Suspicious link or scam content.'}`,
                        footerLabel: 'Scam/Exploit',
                        ttlMs: 15000,
                        timeoutMins: gs.timeoutMinutesScam || 60,
                    });
                    return;
                }

                if ((cat === 'acctrade' || cat === 'account') && gs.accTradeWarnEnabled !== false) {
                    await handlePolicyViolation(message, data, gs, 'acctrade', {
                        title: '🚫 Account Trading Detected',
                        color: 0xFF0000,
                        reason: `AI: ${aiResult.reason || 'Account trading/selling/buying is prohibited.'}`,
                        footerLabel: 'Account Trading',
                        ttlMs: 15000,
                    });
                    return;
                }

                if (cat === 'beg' && gs.begWarnEnabled !== false) {
                    await handlePolicyViolation(message, data, gs, 'beg', {
                        title: '🚫 Begging Detected',
                        color: 0xFF4500,
                        reason: `AI: ${aiResult.reason || 'No begging.'}`,
                        footerLabel: 'Begging',
                        ttlMs: 12000,
                        redirectChannelId: gs.tradeChannelId,
                    });
                    return;
                }

                // Service/trade/command redirects from AI also require setup to be complete
                const _aiServerReady = isServerSetup(gs);
                if (_aiServerReady && cat === 'service' && gs.serviceRedirectEnabled !== false && !isInCorrectServiceChannel(message.channel.id, gs)) {
                    const flagged = await checkServicesViolation(message, contentClean, contentNospace, emojiNames, data, gs);
                    if (flagged) return;
                }

                if (_aiServerReady && cat === 'trade' && gs.tradeRedirectEnabled !== false && !isInCorrectTradeChannel(message.channel.id, gs)) {
                    const flagged = await checkTradeViolation(message, contentClean, contentNospace, data, gs);
                    if (flagged) return;
                }

                if (_aiServerReady && cat === 'command' && gs.commandRedirectEnabled !== false) {
                    const hub = gs.gamesHubId || DEFAULT_GAMES_HUB_ID;
                    if (hub && message.channel.id !== hub && !GAMES_HUB_CHANNELS.has(message.channel.id)) {
                        await handlePolicyViolation(message, data, gs, 'command', {
                            title: '⚠️ Command Usage Violation',
                            color: 0xFF3344,
                            reason: `AI: ${aiResult.reason || 'Use commands only in Games Hub.'}`,
                            footerLabel: 'Command Usage',
                            ttlMs: 10000,
                            redirectChannelId: hub,
                        });
                        return;
                    }
                }
            }
        }
    }

    // ── ACCOUNT TRADING ───────────────────────────────────
    const scam = gs.scamEnabled ? detectScamByMode(gs, contentClean, message.content) : { hit: false };
    if ((gs.scamWarnEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'scam') && scam?.hit) {
        incStat(guildId, data, 'scam', 1);
        const action = gs.linkAction || 'warn';
        await applyConfiguredAction(message, data, gs, {
            action,
            title: '🚨 Scam/Exploit Content Detected',
            color: 0xCC0000,
            reason: scam.reason || 'Suspicious link or exploit/scam content.',
            footerLabel: 'Scam/Exploit',
            ttlMs: 15000,
            timeoutMins: gs.timeoutMinutesScam || 60,
        });
        return;
    }
    if ((gs.accTradeWarnEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'acctrade') && detectAccountTrading(contentClean)) {
        await checkAccountTrading(message, contentClean, data, gs);
        return;
    }

    // ── BEGGING ───────────────────────────────────────────
    if ((gs.begWarnEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'beg') && detectBegging(contentClean)) {
        await handlePolicyViolation(message, data, gs, 'beg', {
            title: '🚫 Begging Detected',
            color: 0xFF4500,
            reason: 'No begging. Make proper offers in the trades channel.',
            footerLabel: 'Begging',
            ttlMs: 12000,
            redirectChannelId: gs.tradeChannelId,
        });
        return;
    }

    // ── REDIRECT CHECKS — only run when server has been set up ────────────────
    // Scam/spam/begging/acctrade always run above; redirects only after /setup.
    const _serverReady = isServerSetup(gs);

    // ── 1v1 PvP DETECTION (no-affiliation mode) ───────────────────────────────
    // "who wanna 1v1 in bf" or split: msg1="who wanna 1v1", msg2="blox fruits"
    if (gs.noAffiliationEnabled && (_serverReady || gs.noAffiliationEnabled)) {
        const has1v1Invite  = ONE_V_ONE_INVITE_RE.test(contentClean);
        const hasBFContext  = BF_PVP_CONTEXT_RE.test(contentClean);
        const hadPrior1v1   = getPvpSplit(guildId, message.author.id);

        if (has1v1Invite && hasBFContext) {
            // Complete flag: 1v1 + BF context in same message
            clearPvpSplit(guildId, message.author.id);
            if (!isCategoryImmune(message.member, guildId, data, 'service')) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '📢 Notice — No Affiliation (PvP)',
                    color: 0x5865F2,
                    reason: `${message.guild?.name || 'This server'} is not Blox Fruits related anymore. Please use the Official Blox Fruits Discord for game requests.`,
                    details: message.content,
                    footerLabel: 'No Affiliation',
                    ttlMs: 12000,
                    redirectChannelId: gs.servicesChannelId,
                });
                return;
            }
        } else if (hadPrior1v1 && hasBFContext && !has1v1Invite) {
            // Split-message flag: prior msg had 1v1, this msg has BF context
            clearPvpSplit(guildId, message.author.id);
            if (!isCategoryImmune(message.member, guildId, data, 'service')) {
                try { await message.delete(); } catch {}
                await issueViolation(message, data, gs, {
                    title: '📢 Notice — No Affiliation (PvP)',
                    color: 0x5865F2,
                    reason: `${message.guild?.name || 'This server'} is not Blox Fruits related anymore. Please use the Official Blox Fruits Discord for game requests.`,
                    details: message.content,
                    footerLabel: 'No Affiliation',
                    ttlMs: 12000,
                    redirectChannelId: gs.servicesChannelId,
                });
                return;
            }
        } else if (has1v1Invite && !hasBFContext) {
            // Bare "who wanna 1v1" — track it, don't flag yet
            recordPvpSplit(guildId, message.author.id);
        }
    }

    // ── SERVICES / ITEMS ──────────────────────────────────
    // noAffiliationEnabled bypasses the serverReady gate so the no-affiliation
    // notice still fires even when redirects are turned off.
    if ((_serverReady || gs.noAffiliationEnabled) && (gs.serviceRedirectEnabled !== false || gs.noAffiliationEnabled) && !isCategoryImmune(message.member, guildId, data, 'service') && (gs.noAffiliationEnabled || !isInCorrectServiceChannel(message.channel.id, gs))) {
        const flagged = await checkServicesViolation(message, contentClean, contentNospace, emojiNames, data, gs);
        if (flagged) return;
    }

    // ── TRADE ─────────────────────────────────────────────
    if ((_serverReady || gs.noAffiliationEnabled) && (gs.tradeRedirectEnabled !== false || gs.noAffiliationEnabled) && !isCategoryImmune(message.member, guildId, data, 'trade') && (gs.noAffiliationEnabled || !isInCorrectTradeChannel(message.channel.id, gs))) {
        const flagged = await checkTradeViolation(message, contentClean, contentNospace, data, gs);
        if (flagged) return;
    }

    // ── RACE + TIER + INTENT ──────────────────────────────
    if (_serverReady && (gs.serviceRedirectEnabled !== false || gs.noAffiliationEnabled) && !isCategoryImmune(message.member, guildId, data, 'service') && (gs.noAffiliationEnabled || !isInCorrectServiceChannel(message.channel.id, gs))) {
        await checkRaceViolation(message, contentClean, contentNospace, data, gs);
    }

    // ── AI DETECTION (async, low priority) ───────────────
    if (AI_ENABLED && gs.aiEnabled) {
        setImmediate(async () => {
            const aiResult = await aiDetectViolation(message, [], gs);
            const aiConfThreshold = getAiConfidenceThreshold(gs);
            if (aiResult?.violation && aiResult.confidence > aiConfThreshold) {
                await sendLog(message.guild, data, new EmbedBuilder()
                    .setTitle('🤖 AI Detection Alert')
                    .setColor(0xFF00FF)
                    .addFields(
                        { name: 'User',       value: `<@${message.author.id}> (${message.author.id})`, inline: true },
                        { name: 'Category',   value: aiResult.category,                                 inline: true },
                        { name: 'Confidence', value: `${(aiResult.confidence*100).toFixed(0)}%`,        inline: true },
                        { name: 'Reason',     value: aiResult.reason,                                   inline: false },
                        { name: 'Message',    value: message.content.slice(0,500),                      inline: false },
                    ).setTimestamp());
            }
        });
    }
});

// ══════════════════════════════════════════════════════════
//  SPAM VIOLATION HANDLER
// ══════════════════════════════════════════════════════════
async function handleSpamViolation(message, reason, data, gs) {
    try { await message.delete(); } catch {}
    const res = await issueViolation(message, data, gs, {
        title: '⚠️ Spam Detected',
        color: 0xFF8800,
        reason: `No spam allowed. (${reason})`,
        details: message.content,
        footerLabel: 'Spam',
        ttlMs: 10000,
    });
    if (res?.exiled) clearSpamHistory(message.author.id, message.guild.id);
}

// ══════════════════════════════════════════════════════════
//  ACCOUNT TRADING HANDLER
// ══════════════════════════════════════════════════════════
async function checkAccountTrading(message, contentClean, data, gs) {
    try { await message.delete(); } catch { return; }
    if (gs.timeoutEnabled) {
        await tryTimeout(message.member, gs.timeoutMinutesScam || 60, 'Account trading detected');
    }
    await issueViolation(message, data, gs, {
        title: '🚫 Account Trading Detected',
        color: 0xFF0000,
        reason: 'Account trading/selling/buying is prohibited.',
        details: message.content,
        footerLabel: 'Account Trading',
        ttlMs: 15000,
    });
}

// ══════════════════════════════════════════════════════════
//  BEGGING HANDLER
// ══════════════════════════════════════════════════════════
async function checkBegging(message, contentClean, data, gs) {
    try { await message.delete(); } catch { return; }
    if (gs.timeoutEnabled) {
        await tryTimeout(message.member, gs.timeoutMinutesTrade || 5, 'Begging detected');
    }
    await issueViolation(message, data, gs, {
        title: '🚫 Begging Detected',
        color: 0xFF4500,
        reason: 'No begging. Make proper offers in the trades channel.',
        details: message.content,
        redirectChannelId: gs.tradeChannelId,
        footerLabel: 'Begging',
        ttlMs: 12000,
    });
}

// ══════════════════════════════════════════════════════════
//  SERVICES / ITEMS CHECKER
// ══════════════════════════════════════════════════════════
async function checkServicesViolation(message, contentClean, contentNospace, emojiNames, data, gs) {
    const _regexEnabled  = gs.regexEnabled !== false;
    const hasBossRegex   = _regexEnabled && bossRegex.test(contentClean);
    const hasFruitRaid   = _regexEnabled && fruitRaidRegex.test(contentClean);
    const hasSvcForRaid  = svcForRaidRegex.test(contentClean);
    const bossesFound    = scanForBosses(contentClean);
    for (const b of BOSSES) { const bc=b.replace(/[\s\-']/g,''); if(bc.length>=4&&contentNospace.includes(bc)&&!bossesFound.includes(b)) bossesFound.push(b); }
    const svcIntent      = scanForServiceIntent(contentClean, getStrictness(gs));
    const fruitsFound    = scanForFruits(contentClean);
    const swordsFound    = scanForSwords(contentClean);
    const enchantsFound  = scanForEnchants(contentClean);
    const hakiFound      = scanForHakiColors(contentClean);
    const stylesFound    = scanForFightingStyles(contentClean);
    const gunsFound      = scanForGuns(contentClean);
    const accsFound      = scanForAccessories(contentClean);
    const questsFound    = scanForQuests(contentClean);
    const seaEvFound     = scanForSeaEvents(contentClean);
    const painUpgFound   = scanForPainUpgrades(contentClean);
    const lightUpgFound  = scanForLightningUpgrades(contentClean);
    const materialsFound = scanForMaterials(contentClean);
    for (const m of MATERIALS) { const mc=m.replace(/[\s\-']/g,''); if(mc.length>=4&&contentNospace.includes(mc)&&!materialsFound.includes(m)) materialsFound.push(m); }
    const npcsFound      = scanForNpcs(contentClean);
    for (const n of NPCS) { const nc=n.replace(/[\s\-']/g,''); if(nc.length>=5&&contentNospace.includes(nc)&&!npcsFound.includes(n)) npcsFound.push(n); }

    // Explicit farm/grind/help + material or NPC — fires regardless of svcIntent
    // catches "grind gorilla", "farming shark tooth", "help [NPC]", "lf monster magnet", etc.
    const hasExplicitFarmForMatNpc =
        (materialsFound.length > 0 || npcsFound.length > 0) &&
        MATERIAL_NPC_FARM_RE.test(contentClean);

    const hasAnyItem     = swordsFound.length||enchantsFound.length||hakiFound.length||
                           stylesFound.length||gunsFound.length||accsFound.length||
                           questsFound.length||seaEvFound.length||
                           painUpgFound.length||lightUpgFound.length||
                           materialsFound.length||npcsFound.length;

    let hasFruitAndRaid = fruitsFound.length && /r+[\s\W_]*a+[\s\W_]*i+[\s\W_]*d+s*/i.test(contentClean);

    let bypassHit = false;
    if (strictnessHasBypassMode(gs, 8)) {
        for (const b of bossesFound) {
            const re = makeIntentTargetBypassRegex(gs, ['help','need','lookingfor','looking','lf','lfg','carry','hosting','host','run','running','boost'], b);
            if (re && re.test(contentClean)) { bypassHit = true; break; }
        }
        if (!bypassHit) {
            for (const b of BOSSES) {
                const re = makeIntentTargetBypassRegex(gs, ['help','need','lookingfor','looking','lf','lfg','carry','hosting','host','run','running','boost'], b);
                if (re && re.test(contentClean)) { bypassHit = true; break; }
            }
        }
    }

    // ── Instant noAffiliation flag: need/needing/hosting + any boss or sea event ──
    if (gs.noAffiliationEnabled) {
        // Check both word-boundary form (for normal text + underscore-split emoji names)
        // AND nospace form (for emoji names like :needmagma: that have no separator at all).
        // Also scan raw emoji slugs individually so a Nitro/external emoji named
        // e.g. "need_hosting_magma" gets caught even if fullClean folds it unexpectedly.
        const hasNeedHostingClean  = /\b(need|needing|hosting|wanna|want\s+to|hunt|hunting|wanna\s+do|wanna\s+join|anyone\s+wanna)\b/i.test(contentClean);
        const hasNeedHostingNospace= /need|needing|hosting|wanna|wantto|hunt|hunting/i.test(contentNospace);
        const hasNeedHostingEmoji  = emojiNames.some(n => /need|needing|hosting|wanna|hunt|hunting/i.test(n));
        const hasNeedHosting = hasNeedHostingClean || hasNeedHostingNospace || hasNeedHostingEmoji;
        if (hasNeedHosting) {
            const hasBossOrSeaEv =
                bossesFound.length > 0 ||
                seaEvFound.length > 0 ||
                materialsFound.length > 0 ||
                npcsFound.length > 0 ||
                hasBossRegex ||
                Object.keys(BOSS_ALIASES).some(alias => {
                    const a = alias.toLowerCase();
                    return a.length >= 2 && (contentClean.includes(a) || contentNospace.includes(a)
                        // Also check raw emoji names in case the boss name appears only in a slug
                        || emojiNames.some(n => n.includes(a)));
                }) ||
                Object.keys(SEA_EVENT_ALIASES).some(alias => {
                    const a = alias.toLowerCase();
                    return a.length >= 2 && (contentClean.includes(a) || contentNospace.includes(a)
                        || emojiNames.some(n => n.includes(a)));
                }) ||
                // Also catch boss/sea-event names appearing directly inside emoji slugs
                // (e.g. a Nitro emoji :magma_boss: or :harbinger_hosting:)
                BOSSES.some(b => {
                    const bn = b.replace(/[\s\-]/g, '').toLowerCase();
                    return bn.length >= 4 && emojiNames.some(n => n.includes(bn));
                }) ||
                SEA_EVENTS.some(se => {
                    const sen = se.replace(/[\s\-]/g, '').toLowerCase();
                    return sen.length >= 4 && emojiNames.some(n => n.includes(sen));
                }) ||
                MATERIALS.some(m => {
                    const mn = m.replace(/[\s\-']/g, '').toLowerCase();
                    return mn.length >= 4 && emojiNames.some(n => n.includes(mn));
                }) ||
                NPCS.some(npc => {
                    const nn = npc.replace(/[\s\-'_]/g, '').toLowerCase();
                    return nn.length >= 5 && emojiNames.some(n => n.includes(nn));
                });
            if (hasBossOrSeaEv) {
                const serverName = message.guild?.name || 'This server';
                if (gs.enforcementMode === 'monitor') {
                    await handlePolicyViolation(message, data, gs, 'service', {
                        title: '📢 Notice — No Affiliation',
                        color: 0x5865F2,
                        reason: `${serverName} is not Blox Fruits related anymore. (No-affiliation mode)`,
                        footerLabel: 'No Affiliation',
                        ttlMs: 12000,
                    });
                    return true;
                }
                try { await message.delete(); } catch { return false; }
                await issueViolation(message, data, gs, {
                    title: '📢 Notice — No Affiliation',
                    color: 0x5865F2,
                    reason: `${serverName} is not Blox Fruits related anymore. Please use the Official Blox Fruits Discord for services/trades related to Blox Fruits.`,
                    details: message.content,
                    footerLabel: 'No Affiliation',
                    ttlMs: 12000,
                });
                return true;
            }
        }
    }

    const trialsHit = detectTrialsOrTrialsRecruitment(contentClean);
    const dungeonHit = detectRaidOrDungeonRecruitment(contentClean);
    const hasTarget = hasSvcForRaid || hasBossRegex || bossesFound.length || hasFruitRaid || hasFruitAndRaid || hasAnyItem;
    const flagged = trialsHit || dungeonHit || bypassHit || hasExplicitFarmForMatNpc || (svcIntent && hasTarget);

    if (flagged) {
        if (gs.noAffiliationEnabled) {
            const serverName = message.guild?.name || 'This server';
            if (gs.enforcementMode === 'monitor') {
                await handlePolicyViolation(message, data, gs, 'service', {
                    title: '📢 Notice — No Affiliation',
                    color: 0x5865F2,
                    reason: `${serverName} is not Blox Fruits related anymore. (No-affiliation mode)` ,
                    footerLabel: 'No Affiliation',
                    ttlMs: 12000,
                });
                return true;
            }
            try { await message.delete(); } catch { return false; }
            await issueViolation(message, data, gs, {
                title: '📢 Notice — No Affiliation',
                color: 0x5865F2,
                reason: `${serverName} is not Blox Fruits related anymore. Please use the Official Blox Fruits Discord for services/trades related to Blox Fruits.`,
                details: message.content,
                footerLabel: 'No Affiliation',
                ttlMs: 12000,
            });
            return true;
        }

        // ── Smart per-category redirect ────────────────────────────────────────
        const detected = {
            leviathan:   LEVI_REDIRECT_RE.test(contentClean) || seaEvFound.some(e => /leviathan|levi|frozen/i.test(e)),
            kitsune:     KITSUNE_ISLAND_RE.test(contentClean) || seaEvFound.some(e => /kitsune/i.test(e)),
            prehistoric: PREHISTORIC_ISLAND_RE.test(contentClean) || seaEvFound.some(e => /prehistoric/i.test(e)),
            mirage:      MIRAGE_ISLAND_RE.test(contentClean) || seaEvFound.some(e => /mirage/i.test(e)),
            seaEvent:    seaEvFound.length > 0,
            raceV4:      RACE_V4_SERVICE_RE.test(contentClean),
            raid:        RAID_SERVICE_RE.test(contentClean) || bossesFound.length > 0 || hasBossRegex || hasFruitRaid || hasSvcForRaid,
        };
        const { channelId: redirectId, label: redirectLabel } = pickServiceRedirectTarget(gs, detected);

        await handlePolicyViolation(message, data, gs, 'service', {
            title: '⚠️ Service Request — Wrong Channel',
            color: 0xFF6600,
            reason: `Service/boss/raid/item/quest/trials requests go in ${redirectLabel}.`,
            footerLabel: 'Service',
            ttlMs: 10000,
            redirectChannelId: redirectId,
        });
        return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  RACE VIOLATION CHECKER
// ══════════════════════════════════════════════════════════
async function checkRaceViolation(message, contentClean, contentNospace, data, gs) {
    if (!scanForServiceIntent(contentClean, getStrictness(gs))) return;
    if (!hasTierKeyword(contentClean)) return;
    const _regexEnabled = gs.regexEnabled !== false;
    const regexHit = _regexEnabled && (raceTierRegex.test(contentClean) || raceTierRegex.test(contentNospace));
    if (!regexHit) return;
    const racesFound = scanForRaces(contentClean);
    for (const r of RACES) { const rc=r.replace(/[\s\-]/g,''); if(rc.length>=4&&contentNospace.includes(rc)&&!racesFound.includes(r)) racesFound.push(r); }
    if (!racesFound.length) return;
    await handlePolicyViolation(message, data, gs, 'service', {
        title: '⚠️ Race Service — Wrong Channel',
        color: 0x9B59B6,
        reason: 'Race reroll/trials/services go in the race/trials channel.',
        footerLabel: 'Race Service',
        ttlMs: 10000,
        redirectChannelId: primaryChannelId(gs, 'raceV4ServiceChannelIds') || gs.servicesChannelId,
    });
}

// ══════════════════════════════════════════════════════════
//  TRADE VIOLATION CHECKER
// ══════════════════════════════════════════════════════════
// Direct regex for unambiguous "perm <fruit> dm" trade solicitations.
// Short fruit names (ice, sand, dark, etc.) can get lost in generic detection
// because they appear as substrings in no-space matches or live in the whitelist.
// This fires BEFORE the generic pipeline and is intentionally broad.
const PERM_FRUIT_NAMES = [
    'ice','sand','dark','light','rubber','ghost','diamond','eagle',
    'flame','magma','smoke','spike','bomb','spring','swamp','snow',
    'door','kilo','love','quake','string','revive','rumble','gravity',
    'barrier','phoenix','buddha','blizzard','venom','control','shadow',
    'portal','leopard','spirit','dough','dragon','kitsune','mammoth',
    'trex','t-rex','sound','spider','pain','lightning','creation',
    'yeti','werewolf','rocket','gas','tiger',
];
const PERM_FRUIT_ALT = PERM_FRUIT_NAMES.map(f => f.replace(/[-]/g,'\\-')).join('|');
const PERM_TRADE_DIRECT_RE = new RegExp(
    `\\bperm(?:s|anent)?\\b[\\s\\S]{0,40}\\b(${PERM_FRUIT_ALT})\\b` +
    `|\\b(${PERM_FRUIT_ALT})\\b[\\s\\S]{0,40}\\bperm(?:s|anent)?\\b`,
    'i'
);
const DM_SIGNAL_RE = /\b(dm|dms|pm|msg|message me|who has|who got|anyone have|lf|wtt|wtb|wts|trade|trading|selling|buying|offer)\b/i;

async function checkTradeViolation(message, contentClean, contentNospace, data, gs) {
    // ── Direct perm+fruit+dm fast-path ───────────────────────────────────────
    // Catches "who has perm ice dm me", "perm sand dm offers", etc. before
    // the generic pipeline, which can miss short fruit names in whitelist.
    if (PERM_TRADE_DIRECT_RE.test(contentClean) && DM_SIGNAL_RE.test(contentClean)) {
        await handleTradeViolation(message, data, gs);
        return true;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const fruitsFound = scanForFruits(contentClean);
    for (const f of FRUITS) { const fc=f.replace(/[\s\-]/g,''); if(contentNospace.includes(fc)&&!fruitsFound.includes(f)) fruitsFound.push(f); }

    // ── Perm-context rescan ────────────────────────────────────────────────────
    // Short fruit names like "ice", "gas", "sand", "dark" are in COMMON_WORD_WHITELIST
    // and get skipped by genericScan. When "perm" (permanent gamepass) is explicitly
    // present in the message the context is unambiguous, so we rescan FRUITS directly
    // (bypassing the whitelist) to catch patterns like "who has perm ice dm me".
    if (/\bperm(s|anent)?\b/i.test(contentClean) && fruitsFound.length === 0) {
        for (const f of FRUITS) {
            const fc = f.replace(/[\s\-]/g, '');
            const fRe = new RegExp(`(?<![a-z])${f.replace(/[-]/g,'\\-')}(?![a-z])`, 'i');
            if (fRe.test(contentClean) || (fc.length >= 3 && contentNospace.includes(fc))) {
                if (!fruitsFound.includes(f)) fruitsFound.push(f);
            }
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const _strictness = getStrictness(gs);
    let hasIntent = scanForIntent(contentClean, _strictness);
    if (!hasIntent) {
        for (const kw of INTENT_PHRASE) {
            const kns = kw.replace(/\s/g,'').replace(/-/g,'');
            if (kns.length >= 5 && contentNospace.includes(kns)) { hasIntent = true; break; }
        }
    }
    let isExchange = (gs.regexEnabled !== false) && tradeRegex.test(contentClean);
    if (!isExchange && gs.regexEnabled !== false) for (const p of NOSPACE_PATTERNS) if(p.test(contentNospace)){isExchange=true;break;}

    // Scan for fruit emojis — check BOTH message.content AND any forwarded snapshot content
    // so a forwarded trade post using only fruit emojis is still caught.
    // We also check emoji names (not just the full tag string) so external/Nitro emojis
    // whose NAME contains a fruit name (e.g. :magma_fruit: from another server) are caught.
    const allEmojiSources = message.messageSnapshots?.size
        ? message.content + ' ' + extractSnapshotText(message)
        : message.content;
    const rawEmojis   = [...allEmojiSources.toLowerCase().matchAll(/<a?:[a-zA-Z0-9_]+:\d+>/g)].map(m=>m[0]);
    const fruitEmojis = rawEmojis.filter(e => FRUITS.some(f => e.includes(f.replace(/\s/g,''))));
    const totalItems  = fruitsFound.length + fruitEmojis.length;
    // Check redirect emoji in both caption and snapshot content
    const hasEmojiId  = allEmojiSources.toLowerCase().includes(gs.redirectEmojiId || DEFAULT_REDIRECT_EMOJI_ID);

    if (!hasIntent && totalItems === 0 && strictnessHasBypassMode(gs, 8)) {
        for (const f of FRUITS) {
            const re = makeIntentTargetBypassRegex(gs, ['lookingfor','looking','lf','lfg','need','want','wtt','wtb','wts'], f);
            if (re && re.test(contentClean)) { hasIntent = true; break; }
        }
    }

    const uid = message.author.id, cid = message.channel.id;
    const existing = getPartial(uid, cid);
    let splitFlagged = false;
    if (existing) {
        if ((existing.has_intent||hasIntent) && (existing.has_fruit||(totalItems>=1))) { splitFlagged=true; clearPartial(uid); }
    } else {
        if ((hasIntent||isExchange) && totalItems===0) recordPartial(uid,cid,true,false);
        else if (totalItems>=1 && !hasIntent && !isExchange) recordPartial(uid,cid,false,true);
    }
    if (hasIntent && totalItems>=1) clearPartial(uid);
    if (isExchange) clearPartial(uid);

    const flagged = isExchange || (hasIntent&&totalItems>=1) ||
                    (hasEmojiId&&hasIntent) || (hasEmojiId&&totalItems>=1) || splitFlagged;
    if (flagged) {
        await handleTradeViolation(message, data, gs);
        return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  TRADE VIOLATION PUNISHMENT
// ══════════════════════════════════════════════════════════
async function handleTradeViolation(message, data, gs) {
    if (gs.noAffiliationEnabled) {
        const serverName = message.guild?.name || 'This server';
        if (gs.enforcementMode === 'monitor') {
            await handlePolicyViolation(message, data, gs, 'trade', {
                title: '📢 Notice — No Affiliation',
                color: 0x5865F2,
                reason: `${serverName} is not Blox Fruits related anymore. (No-affiliation mode)`,
                footerLabel: 'No Affiliation',
                ttlMs: 12000,
            });
            return;
        }
        try { await message.delete(); } catch { return; }
        await issueViolation(message, data, gs, {
            title: '📢 Notice — No Affiliation',
            color: 0x5865F2,
            reason: `${serverName} is not Blox Fruits related anymore. Please use the Official Blox Fruits Discord for services/trades related to Blox Fruits.`,
            details: message.content,
            footerLabel: 'No Affiliation',
            ttlMs: 12000,
        });
        return;
    }

    await handlePolicyViolation(message, data, gs, 'trade', {
        title: '⚠️ Trade Violation',
        color: 0xFFAA00,
        reason: 'Keep trades in the trades channel.',
        footerLabel: 'Trade',
        ttlMs: 10000,
        redirectChannelId: primaryChannelId(gs, 'tradeChannelIds') || gs.tradeChannelId,
    });
}

// ══════════════════════════════════════════════════════════
//  EXILE / UNEXILE
// ══════════════════════════════════════════════════════════
function hasAppealedCurrentExile(userId, data) {
    const exile = data.exiles?.[String(userId)];
    if (!exile) return false;                      // user isn't even exiled
    const exiledAt = exile.exiledAt || 0;
    const appeals = data.appeals || {};
    for (const appeal of Object.values(appeals)) {
        // Support both `createdAt` (slash/prefix) and `timestamp` (modal) field names
        const appealTime = appeal.createdAt || appeal.timestamp || 0;
        if (
            String(appeal.userId) === String(userId) &&
            appealTime >= exiledAt
        ) return true;
    }
    return false;
}

function hasAppealedWarn(warnId, data) {
    if (!warnId) return false;
    const appeals = data.appeals || {};
    for (const appeal of Object.values(appeals)) {
        if (appeal.type === 'warn' && appeal.warnId === warnId) return true;
    }
    return false;
}

// ── Timeout appeal helper ─────────────────────────────────────────────────────
function hasAppealedTimeout(timeoutId, data) {
    if (!timeoutId) return false;
    const appeals = data.appeals || {};
    for (const appeal of Object.values(appeals)) {
        if (appeal.type === 'timeout' && appeal.timeoutId === timeoutId) return true;
    }
    return false;
}

// ── Ban appeal helper ─────────────────────────────────────────────────────────
function hasAppealedBan(banId, data) {
    if (!banId) return false;
    const appeals = data.appeals || {};
    for (const appeal of Object.values(appeals)) {
        if (appeal.type === 'ban' && appeal.banId === banId) return true;
    }
    return false;
}

// ── Long-timeout scheduler (repeats every ≤28 days until total duration ends) ─
const _activeTimeoutTimers = new Map(); // key: `${guildId}:${userId}`
const MAX_DISCORD_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // 28 days in ms

function scheduleLongTimeout(botClient, guildId, userId, data) {
    const key = `${guildId}:${userId}`;
    const existing = _activeTimeoutTimers.get(key);
    if (existing) clearTimeout(existing);

    const tInfo = (data.timeouts || {})?.[guildId]?.[userId];
    if (!tInfo) return;

    const now = Date.now();
    const remaining = tInfo.endsAt - now;
    if (remaining <= 0) {
        if (data.timeouts?.[guildId]) delete data.timeouts[guildId][userId];
        saveData(data);
        return;
    }

    // Schedule next re-timeout just before the current 28-day chunk expires (5s buffer)
    const chunk = Math.min(remaining, MAX_DISCORD_TIMEOUT_MS) - 5000;
    const fireIn = Math.max(chunk, 1000);

    const handle = setTimeout(async () => {
        _activeTimeoutTimers.delete(key);
        const freshData = loadData();
        const freshInfo = (freshData.timeouts || {})?.[guildId]?.[userId];
        if (!freshInfo) return;
        const freshRemaining = freshInfo.endsAt - Date.now();
        if (freshRemaining <= 0) {
            if (freshData.timeouts?.[guildId]) delete freshData.timeouts[guildId][userId];
            saveData(freshData);
            return;
        }
        try {
            const g = await botClient.guilds.fetch(guildId).catch(() => null);
            if (!g) return;
            const m = await g.members.fetch(userId).catch(() => null);
            if (!m) return;
            const reChunk = Math.min(freshRemaining, MAX_DISCORD_TIMEOUT_MS);
            await m.timeout(reChunk, freshInfo.reason || 'Extended timeout').catch(() => {});
            scheduleLongTimeout(botClient, guildId, userId, freshData);
        } catch {}
    }, fireIn);
    _activeTimeoutTimers.set(key, handle);
}

async function performExile(userOrMember, guild, minutes, reason, data) {
    let member = userOrMember.roles
        ? userOrMember
        : (guild.members.cache.get(userOrMember.id) || await guild.members.fetch(userOrMember.id).catch(()=>null));
    if (!member) return;

    const gs = getGuildSettings(guild.id, data);
    const oldRoleIds = member.roles.cache
        .filter(r => !r.managed && r.id !== guild.id && r.id !== gs.exiledRoleId)
        .map(r => r.id);

    // exileRemoveRole OFF → don't remove existing roles, just add exile role
    // exileRemoveRole ON  → remove existing roles; exileStripRoles controls whether they're restored
    const removeRoles = gs.exileRemoveRole !== false; // default true
    const rolesToSave = (!removeRoles || gs.exileStripRoles) ? [] : oldRoleIds;

    data.exiles[member.id] = {
    old_roles:   rolesToSave,
    remove_role: removeRoles,
    expiry:      Date.now()/1000 + minutes*60,
    exiledAt:    Date.now(),
    reason,
};
    saveData(data);

    const exRole = guild.roles.cache.get(gs.exiledRoleId);
    if (exRole) {
        try {
            if (removeRoles) {
                // Replace ALL roles with only the exile role
                await member.edit({ roles: [exRole], reason });
            } else {
                // Just add the exile role without touching the rest
                await member.roles.add(exRole, reason);
            }
        } catch {}
    }

    try {
        const exileCh = gs.exileChannelId
            ? guild.channels.cache.get(gs.exileChannelId)
            : guild.channels.cache.find(c => c && c.type === ChannelType.GuildText && c.name === 'exile-zone');
        if (exileCh) {
            await exileCh.send(`${member} has been exiled.`);
        }
    } catch {}

    // DM with appeal button
    try {
        const expiryTs = Math.floor(Date.now()/1000 + minutes*60);
        const dmEmbed = new EmbedBuilder()
            .setTitle('⛓️ You Have Been Exiled')
            .setColor(0xFF4444)
            .setDescription(`You have been exiled from **${guild.name}**.\n\n**Reason:** ${reason}\n**Duration:** ${minutes} minutes\n**Expires:** <t:${expiryTs}:R> (<t:${expiryTs}:f>)\n\nYou may submit an appeal using the button below.`)
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`open_appeal_${guild.id}_${member.id}`)
                .setLabel('📩 Submit Appeal')
                .setStyle(ButtonStyle.Primary)
        );
        await member.send({ embeds: [dmEmbed], components: [row] });
    } catch {}

    // Send exile landing message in server
    await sendLog(guild, data, new EmbedBuilder()
        .setTitle('⛓️ Member Exiled')
        .setColor(0xFF2222)
        .setThumbnail(member.user.displayAvatarURL())
        .setDescription(`**${member.user.username}** has landed in exile.`)
        .addFields(
            { name: 'User',     value: `<@${member.id}> (${member.id})`, inline: true },
            { name: 'Reason',   value: reason,                            inline: true },
            { name: 'Duration', value: `${minutes} minutes`,              inline: true },
            { name: 'Expires',  value: `<t:${Math.floor(data.exiles[member.id].expiry)}:R>`, inline: true },
        ).setTimestamp());
}

async function performUnexile(member, guild, data) {
    const gs  = getGuildSettings(guild.id, data);
    const uid = member.id;
    if (!data.exiles[uid]) return false;

    const exileRecord  = data.exiles[uid];
    const roleIds      = exileRecord.old_roles || [];
    const wasRemoved   = exileRecord.remove_role !== false; // true unless explicitly stored as false

    try {
        if (wasRemoved) {
            // Roles were stripped at exile time — restore them (or set to empty if striproles was on)
            const roles = roleIds.map(rid => guild.roles.cache.get(rid)).filter(Boolean);
            await member.edit({ roles, reason: 'Exile expired' });
        } else {
            // Roles were never removed — just remove the exile role
            const exRole = guild.roles.cache.get(gs.exiledRoleId);
            if (exRole && member.roles.cache.has(gs.exiledRoleId)) {
                await member.roles.remove(exRole, 'Exile expired').catch(() => {});
            }
        }
    } catch {
        // Fallback: at minimum try to remove the exile role
        const exRole = guild.roles.cache.get(gs.exiledRoleId);
        if (exRole && member.roles.cache.has(gs.exiledRoleId)) await member.roles.remove(exRole).catch(() => {});
    }
    return true;
}

// ══════════════════════════════════════════════════════════
//  PREFIX COMMAND HANDLER (!commands)
// ══════════════════════════════════════════════════════════
async function handlePrefixCommands(message, isAdmin, isMod, data, gs) {
    const guildPrefix = (gs?.commandPrefix) || '!';
    if (!message.content.startsWith(guildPrefix)) return;
    const args = message.content.slice(guildPrefix.length).trim().split(/\s+/);
    const cmd  = args.shift().toLowerCase();
    logCmdStats('message', '!' + cmd);
    const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
    const exileMins = Math.max(1, Math.min(1440, gs.exileDurationMins || EXILE_DURATION_MINS));

    const ai2OwnerOk = ai2State.enabled && ai2State.ownerId && String(message.author.id) === String(ai2State.ownerId);

    if (ai2State.enabled && cmd === 'pause' && ai2OwnerOk) {
        ai2State.paused = !ai2State.paused;
        await message.channel.send(`${ai2State.paused ? 'Paused' : 'Unpaused'} the bot from producing AI responses.`);
        return;
    }
    if (ai2State.enabled && cmd === 'toggledm' && ai2OwnerOk) {
        ai2State.allowDm = !ai2State.allowDm;
        await message.channel.send(`DMs are now ${ai2State.allowDm ? 'allowed' : 'disallowed'} for active channels.`);
        return;
    }
    if (ai2State.enabled && cmd === 'togglegc' && ai2OwnerOk) {
        ai2State.allowGc = !ai2State.allowGc;
        await message.channel.send(`Group chats are now ${ai2State.allowGc ? 'allowed' : 'disallowed'} for active channels.`);
        return;
    }
    if (ai2State.enabled && cmd === 'ignore' && ai2OwnerOk) {
        const tok = args[0] || '';
        const mention = tok.match(/^<@!?(\d+)>$/);
        const uid = mention ? mention[1] : (tok.match(/^\d{15,20}$/) ? tok : null);
        if (!uid) { await message.channel.send('❌ Provide a @mention or ID.'); return; }
        if (ai2State.ignoredUsers.has(String(uid))) {
            ai2State.ignoredUsers.delete(String(uid));
            await ai2DbRun('DELETE FROM ignored_users WHERE id = ?', [Number(uid)]);
            await message.channel.send(`Unignored <@${uid}>.`);
        } else {
            ai2State.ignoredUsers.add(String(uid));
            await ai2DbRun('INSERT OR IGNORE INTO ignored_users (id) VALUES (?)', [Number(uid)]);
            await message.channel.send(`Ignoring <@${uid}>.`);
        }
        return;
    }
    if (ai2State.enabled && cmd === 'toggleactive') {
        if (!ai2OwnerOk) {
            await message.channel.send(`❌ Owner only. Your ID: ${message.author.id} | Config owner_id: ${ai2State.ownerId || '(not set)'}`);
            return;
        }
        let channelId = null;
        if (!args[0]) channelId = message.channel.id;
        else {
            const m = String(args[0]).match(/^<#(\d+)>$/);
            channelId = m ? m[1] : (String(args[0]).match(/^\d{15,20}$/) ? String(args[0]) : null);
        }
        if (!channelId) { await message.channel.send('❌ Channel not found.'); return; }
        const numId = Number(channelId);
        if (ai2State.activeChannels.has(numId)) {
            ai2State.activeChannels.delete(numId);
            await ai2DbRun('DELETE FROM channels WHERE id = ?', [numId]);
            // Flush any queued messages for this channel so delayed/typing responses don't fire
            ai2State.messageQueues.delete(String(channelId));
            ai2State.messageQueues.delete(channelId);
            // Clear holdConversation state for all users in this channel so the bot
            // doesn't keep getting triggered by the inConversation flag after toggle-off
            for (const key of ai2State.activeConversations.keys()) {
                if (key.endsWith(`-${channelId}`)) ai2State.activeConversations.delete(key);
            }
            await message.channel.send('Removed this channel from the list of active channels.');
        } else {
            ai2State.activeChannels.add(numId);
            await ai2DbRun('INSERT OR IGNORE INTO channels (id) VALUES (?)', [numId]);
            await message.channel.send('Added this channel to the list of active channels.');
        }
        return;
    }
    if (ai2State.enabled && cmd === 'aimodel' && ai2OwnerOk) {
        const providerArg = (args[0] || '').toLowerCase();
        const modelArg    = (args[1] || '').toLowerCase();
        const validProviders = {
            groq:   'Groq (llama-3.3-70b-versatile)',
            openai: 'OpenAI (gpt-4o-mini)',
            claude: `Claude (${ai2State.claudeModel})`,
        };
        if (!providerArg) {
            const cur = ai2State.activeProvider || 'groq';
            await message.channel.send(
                `🤖 Current AI provider: **${validProviders[cur] || cur}** | Model: \`${ai2Model || 'none'}\`` +
                `\nUse \`!aimodel groq\`, \`!aimodel openai\`, or \`!aimodel claude\` to switch.` +
                `\nFor Claude, optionally specify model: \`!aimodel claude claude-sonnet-4-6\``
            );
            return;
        }
        if (!validProviders[providerArg]) {
            await message.channel.send(`❌ Unknown provider. Use: \`groq\` | \`openai\` | \`claude\``);
            return;
        }
        if (providerArg === 'claude' && modelArg) {
            const allowed = ['claude-haiku-4-5-20251001','claude-sonnet-4-6','claude-opus-4-6'];
            if (allowed.includes(modelArg)) {
                ai2State.claudeModel = modelArg;
            } else {
                await message.channel.send(`❌ Unknown Claude model. Valid: ${allowed.join(' | ')}`);
                return;
            }
        }
        const prev = ai2State.activeProvider || 'groq';
        ai2State.activeProvider = providerArg;
        ai2InitClient(providerArg);
        if (providerArg !== 'claude') {} else { ai2Model = ai2State.claudeModel; }
        validProviders.claude = `Claude (${ai2State.claudeModel})`;
        await message.channel.send(`✅ AI provider switched from **${validProviders[prev] || prev}** → **${validProviders[providerArg]}**\nModel: \`${ai2Model || 'none (no API key?)'}\``);
        return;
    }
    // !bloxmode [on|off] — toggle Blox Fruits-specific system prompt
    if (ai2State.enabled && cmd === 'bloxmode' && ai2OwnerOk) {
        const v = (args[0] || '').toLowerCase();
        if (!v) {
            const isBlox = ai2State.instructions === BF_KNOWLEDGE_SYSTEM_PROMPT;
            return message.channel.send(`🍎 Blox Fruits mode is currently **${isBlox ? 'ON' : 'OFF'}**. Use: \`!bloxmode on\` or \`!bloxmode off\``);
        }
        if (v === 'on') {
            ai2State.instructions = BF_KNOWLEDGE_SYSTEM_PROMPT;
            ai2SaveInstructions(BF_KNOWLEDGE_SYSTEM_PROMPT);
            return message.channel.send('✅ Blox Fruits mode **ON** — AI will now respond as a Blox Fruits expert.');
        }
        if (v === 'off') {
            ai2State.instructions = GENERAL_ASSISTANT_PROMPT;
            ai2SaveInstructions('');
            return message.channel.send('✅ Blox Fruits mode **OFF** — AI is back to general assistant mode.');
        }
        return message.channel.send('❌ Use: `!bloxmode on` or `!bloxmode off`');
    }
    if (ai2State.enabled && cmd === 'wipe' && ai2OwnerOk) {
        ai2State.messageHistory.clear();
        await message.channel.send("Wiped the bot's memory.");
        return;
    }
    if (ai2State.enabled && (cmd === 'prompt' || cmd === 'instructions') && ai2OwnerOk) {
        const prompt = args.join(' ').trim();
        if (!prompt) {
            await message.channel.send(`Current prompt:\n${ai2State.instructions ? '```' + ai2State.instructions + '```' : 'No prompt is currently set.'}`);
            return;
        }
        if (prompt.toLowerCase() === 'clear') {
            ai2State.instructions = GENERAL_ASSISTANT_PROMPT;
            ai2SaveInstructions('');
            await message.channel.send('Cleared custom prompt. Restored default general assistant prompt. (Use `!bloxmode on` to re-enable Blox Fruits mode.)');
            return;
        }
        ai2State.instructions = prompt;
        ai2SaveInstructions(prompt);
        await message.channel.send(`Updated prompt to:\n\`\`\`${prompt}\`\`\``);
        return;
    }
    if (ai2State.enabled && cmd === 'ping') {
        const latency = Math.round(client.ws.ping);
        await message.channel.send(`Pong! Latency: ${latency} ms`);
        return;
    }
    if (ai2State.enabled && cmd === 'help') {
        if (!ai2State.helpEnabled) return;
        const pfx = ai2State.prefix || '!';
        const helpText = "```\nBot Commands:\n" +
            `${pfx}pause - Pause the bot from producing AI responses\n` +
            `${pfx}analyse [user] - Analyze a user's message history\n` +
            `${pfx}wipe - Clears history of the bot\n` +
            `${pfx}ping - Shows the bot's latency\n` +
            `${pfx}toggleactive [id / channel] - Toggle a mentioned channel or the current channel\n` +
            `${pfx}bloxmode [on|off] - Toggle Blox Fruits-specific AI mode (off = general assistant)\n` +
            `${pfx}aimodel [groq|openai|claude] [model] - Switch AI provider (Groq/OpenAI/Claude). For Claude, optionally add model name.\n` +
            `${pfx}toggledm - Toggle if the bot should be active in DM's\n` +
            `${pfx}togglegc - Toggle if the bot should be active in group chats\n` +
            `${pfx}ignore [user] - Stop a user from using the bot\n` +
            `${pfx}prompt [prompt / clear] - View, set or clear the prompt for the AI\n` +
            "\nMath & Calculation:\n" +
            `!calc [expr] — Calc CLI evaluator (multi-line; type Evaluate to run)\n` +
            `/calc [expr] — Same via slash command\n` +
            `!wolf [query] — Online math/science query (multi-line supported)\n` +
            `!supercalc [expr] — superqalc_onefile engine (multi-line supported)\n` +
            `!supertower [expr] — superqalc_tower engine (multi-line supported)\n` +
            `!gaypy [code] — Python exec; mpmath 1.4.1 pre-loaded as \`mpmath\`, sympy available\n` +
            `                e.g.  mpmath.mp.dps=100; print(mpmath.sqrt(2))\n` +
            "```";
        await message.channel.send(helpText);
        return;
    }
    if (ai2State.enabled && (cmd === 'analyse' || cmd === 'analyze')) {
        if (!ai2OwnerOk) { await message.channel.send('❌ Owner only.'); return; }
        const tok = args[0] || '';
        const mention = tok.match(/^<@!?(\d+)>$/);
        const uid = mention ? mention[1] : (tok.match(/^\d{15,20}$/) ? tok : null);
        if (!uid) { await message.channel.send('❌ Provide a @mention or ID.'); return; }
        const temp = await message.channel.send(`Analysing <@${uid}>'s message history...`);
        const messages = await message.channel.messages.fetch({ limit: 100 }).catch(()=>null);
        const userMsgs = [];
        if (messages) {
            for (const m of messages.values()) {
                if (String(m.author?.id) === String(uid) && m.content) userMsgs.push(m.content);
            }
        }
        const prompt = userMsgs.slice(-200).join('');
        const instructions = `You are a PhD, LCSW, MFT, world's leading AI psychologist, known for frank and piercing insightful profiles from minimal data. Analyze from their chat log entries. Respond with a private comprehensive psychological profile. Reference specific messages where relevant. This is for entertainment with consent. Here are the chat log entries for the user: ${uid}`;
        const resp = await ai2GenerateResponse(prompt, instructions, null);
        const chunks = ai2SplitResponse(resp);
        await temp.delete().catch(()=>{});
        for (const c of chunks) await message.reply({ content: c }).catch(()=>{});
        return;
    }

    function parseOnOff(v) {
        const s = (v || '').toLowerCase();
        if (['on','true','yes','1','enable','enabled'].includes(s)) return true;
        if (['off','false','no','0','disable','disabled'].includes(s)) return false;
        return null;
    }

    async function resolveMember(token) {
        if (!token) return message.mentions.members?.first() || null;
        const mention = token.match(/^<@!?(\d+)>$/);
        const rawId   = mention ? mention[1] : (token.match(/^\d{15,20}$/) ? token : null);
        if (!rawId) return message.mentions.members?.first() || null;
        return message.guild.members.cache.get(rawId) || await message.guild.members.fetch(rawId).catch(()=>null);
    }

    async function resolveChannel(token) {
        if (!token) return message.mentions.channels?.first() || null;
        const mention = token.match(/^<#(\d+)>$/);
        const rawId = mention ? mention[1] : (token.match(/^\d{15,20}$/) ? token : null);
        if (!rawId) return message.mentions.channels?.first() || null;
        return message.guild.channels.cache.get(rawId) || await message.guild.channels.fetch(rawId).catch(()=>null);
    }

    async function resolveRole(token) {
        if (!token) return message.mentions.roles?.first() || null;
        const mention = token.match(/^<@&(\d+)>$/);
        const rawId = mention ? mention[1] : (token.match(/^\d{15,20}$/) ? token : null);
        if (!rawId) return message.mentions.roles?.first() || null;
        return message.guild.roles.cache.get(rawId) || await message.guild.roles.fetch(rawId).catch(()=>null);
    }

    // !unexile [mention | id]
    if (cmd === 'unexile' && isAdmin) {
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
        if (target.id === message.author.id && !isSuperUser(message.author.id)) return message.channel.send('❌ You cannot unexile yourself.');
        const fd = loadData();
        await performUnexile(target, message.guild, fd);
        delete fd.exiles[target.id];
        saveData(fd);
        await message.channel.send(`✅ Unexiled ${target} (${target.id}).`);
    }

    // !exile [mention | id] [duration] [reason...]
    else if (cmd === 'exile' && isAdmin) {
        if (isExileChannel(message.channel.id, message.guild, gs)) return message.channel.send('❌ Exile commands cannot be used inside the exile channel.');
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
        if (target.id === message.author.id) return message.channel.send('❌ You cannot exile yourself.');
        if (target.roles.highest.position >= message.member.roles.highest.position) return message.channel.send('❌ You cannot exile someone with equal or higher roles.');
        const durArg   = args.slice(1).find(a => /^\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)?$/.test(a.trim().toLowerCase()));
        const duration = (durArg ? parseDuration(durArg) : null) ?? EXILE_DURATION_MINS;
        const reason   = args.slice(1).filter(a => a !== durArg).join(' ') || 'Manual admin action';
        const fd = loadData();
        await performExile(target, message.guild, duration, reason, fd);
        saveData(fd);
        await message.channel.send(`🔨 Exiled ${target} (${target.id}) for **${duration}m**. Reason: ${reason}`);
    }

    else if (cmd === 'botinfo') {
        const ownerStr = gs.botOwnerId ? `<@${gs.botOwnerId}> (${gs.botOwnerId})` : 'Open Source / Community Run';
        const coderStr = `<@${BOT_CODED_BY_ID}> (${BOT_CODED_BY_ID})`;
        const embed = new EmbedBuilder()
            .setTitle('🤖 Bot Info')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Owner', value: ownerStr, inline: false },
                { name: 'Coded By', value: coderStr, inline: false },
            )
            .setTimestamp();
        await message.channel.send({ embeds: [embed] });
    }

    else if (cmd === 'uptime') {
        const upMs = Date.now() - BOT_START_TS;
        const embed = new EmbedBuilder()
            .setTitle('⏱️ Uptime')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Uptime', value: formatDuration(upMs), inline: true },
                { name: 'Started', value: `<t:${Math.floor(BOT_START_TS / 1000)}:F>`, inline: true },
                { name: 'Node', value: process.version, inline: true },
                { name: 'Memory', value: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB RSS`, inline: true },
            )
            .setTimestamp();
        const ft = footerText(gs);
        if (ft) embed.setFooter({ text: ft });
        await message.channel.send({ embeds: [embed] });
    }

    else if (cmd === 'messagecommandslist') {
        const embeds = buildCommandListEmbeds('💬 Message Commands', MESSAGE_COMMANDS_LIST, gs);
        for (const e of embeds) {
            await message.channel.send({ embeds: [e] });
        }
    }

    else if (cmd === 'slashcommandslist') {
        const embeds = buildCommandListEmbeds('✨ Slash Commands', SLASH_COMMANDS_LIST, gs);
        for (const e of embeds) {
            await message.channel.send({ embeds: [e] });
        }
    }

    else if (cmd === 'dashboard' && isAdmin) {
        await message.channel.send({ embeds: [buildDashboardEmbed(gs)], components: buildDashboardComponents() });
    }

    else if (cmd === 'policypreset' && isAdmin) {
        const preset = (args[0] || '').toLowerCase();
        if (!applyPolicyPreset(gs, preset)) return message.channel.send('❌ Use: !policypreset strict|balanced|soft|monitor');
        saveData(data);
        await message.channel.send(`✅ Policy preset applied: **${preset}**`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Policy Preset Applied', [
            `preset: **${preset}**`,
            `enforcementMode: **${gs.enforcementMode}**`,
        ]);
    }

    else if (cmd === 'case' && (isAdmin || isMod)) {
        const sub = (args[0] || '').toLowerCase();
        const cases = getGuildCases(message.guildId, data);
        if (sub === 'view') {
            const id = (args[1] || '').trim();
            const c = cases?.[id];
            if (!c) return message.channel.send('❌ Case not found.');
            const embed = new EmbedBuilder()
                .setTitle(`📁 Case #${c.id}`)
                .setColor(c.voided ? 0x777777 : 0x5865F2)
                .addFields(
                    { name: 'User', value: c.userId ? `<@${c.userId}> (${c.userId})` : 'Unknown', inline: false },
                    { name: 'Action', value: String(c.action || 'warn'), inline: true },
                    { name: 'Category', value: String(c.category || 'unknown'), inline: true },
                    { name: 'Created', value: c.createdAt ? `<t:${Math.floor(c.createdAt/1000)}:F>` : 'Unknown', inline: true },
                    { name: 'Reason', value: String(c.reason || '').slice(0, 1024) || 'None', inline: false },
                    { name: 'Content', value: String(c.content || '').slice(0, 1024) || '(none)', inline: false },
                )
                .setTimestamp();
            if (c.messageUrl) embed.addFields({ name: 'Message', value: c.messageUrl, inline: false });
            await message.channel.send({ embeds: [embed] });
            return;
        }
        if (sub === 'list') {
            const all = Object.values(cases || {}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
            const lines = all.slice(0, 20).map(c => `#${c.id} — ${c.voided ? 'VOID ' : ''}${String(c.action||'warn')} — <@${c.userId}> — ${String(c.category||'')}`);
            await message.channel.send(lines.length ? lines.join('\n') : 'No cases found.');
            return;
        }
        if (sub === 'note') {
            const id = (args[1] || '').trim();
            const text = args.slice(2).join(' ');
            if (!id || !text) return message.channel.send('❌ Use: !case note <id> <text>');
            const c = addCaseNote(message.guildId, data, id, message.author.id, text);
            if (!c) return message.channel.send('❌ Case not found.');
            await message.channel.send(`✅ Note added to case #${id}.`);
            return;
        }
        if (sub === 'void') {
            if (!isAdmin) return message.channel.send('❌ Admins only.');
            const id = (args[1] || '').trim();
            const reason = args.slice(2).join(' ');
            if (!id || !reason) return message.channel.send('❌ Use: !case void <id> <reason>');
            const c = voidCase(message.guildId, data, id, message.author.id, reason);
            if (!c) return message.channel.send('❌ Case not found.');
            await message.channel.send(`✅ Case #${id} voided.`);
            return;
        }
        return message.channel.send('❌ Use: !case view <id> | !case list | !case note <id> <text> | !case void <id> <reason>');
    }

    else if (cmd === 'appeal') {
        const sub = (args[0] || '').toLowerCase();
        if (sub !== 'submit') return message.channel.send('❌ Use: !appeal submit <text> [caseId]');
        const text = args.slice(1).join(' ').trim();
        if (!text) return message.channel.send('❌ Provide appeal text.');
        if (hasAppealedCurrentExile(message.author.id, data)) {
            return message.channel.send(
                '❌ You have already submitted an appeal for your current exile.'
            );
        }
        if (!gs.appealsChannelId) return message.channel.send('❌ Appeals channel is not configured.');
        const ch = await message.guild.channels.fetch(gs.appealsChannelId).catch(()=>null);
        if (!ch || !ch.isTextBased || !ch.isTextBased()) return message.channel.send('❌ Appeals channel is invalid.');
        const appealId = `${Date.now()}_${message.author.id}`;
        data.appeals = data.appeals || {};
        data.appeals[appealId] = { id: appealId, userId: message.author.id, text: text.slice(0, 1800), caseId: null, status: 'pending', createdAt: Date.now() };
        saveData(data);
        const embed = new EmbedBuilder()
            .setTitle('📩 Appeal — PENDING')
            .setColor(0xFFAA00)
            .addFields(
                { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: false },
                { name: 'Text', value: text.slice(0, 1024) || 'None', inline: false },
            )
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`appeal_accept_${appealId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`appeal_reject_${appealId}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
        );
        await ch.send({ embeds: [embed], components: [row] });
        await message.channel.send('✅ Appeal submitted.');
    }

    else if (cmd === 'diagnose' && isAdmin) {
        const me = message.guild.members.me || await message.guild.members.fetchMe().catch(()=>null);
        const perms = me?.permissions;
        const mm = perms?.has(PermissionFlagsBits.ManageMessages) ? '✅' : '❌';
        const mod = perms?.has(PermissionFlagsBits.ModerateMembers) ? '✅' : '❌';
        const vr = perms?.has(PermissionFlagsBits.ViewAuditLog) ? '✅' : '❌';
        const embed = new EmbedBuilder()
            .setTitle('🩺 Diagnose')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Bot Permissions', value: `ManageMessages: ${mm}\nModerateMembers: ${mod}\nViewAuditLog: ${vr}`, inline: false },
                { name: 'AI Key', value: (AI_ENABLED ? (ANTHROPIC_KEY ? '✅ Present' : '❌ Missing') : '❌ AI_DISABLED'), inline: true },
                { name: 'Mode', value: `checks=${gs.checksEnabled ? 'ON' : 'OFF'} enforcement=${gs.enforcementMode}`, inline: true },
            )
            .setTimestamp();

        const ids = [
            ['Trade Channel', gs.tradeChannelId],
            ['Services Channel', gs.servicesChannelId],
            ['Commands Channel', gs.gamesHubId || DEFAULT_GAMES_HUB_ID],
            ['Log Channel', gs.logChannelId],
            ['Exile Channel', gs.exileChannelId],
            ['Appeals Channel', gs.appealsChannelId],
        ];
        const chLines = [];
        for (const [label, id] of ids) {
            if (!id) { chLines.push(`${label}: None`); continue; }
            const exists = await message.guild.channels.fetch(id).catch(()=>null);
            chLines.push(`${label}: ${exists ? `<#${id}>` : `Missing (${id})`}`);
        }
        embed.addFields({ name: 'Channels', value: chLines.join('\n'), inline: false });

        let dataOK = '✅';
        try {
            ensureBackupDir();
            fs.accessSync(BASE_DIR, fs.constants.W_OK);
        } catch { dataOK = '❌'; }
        embed.addFields({ name: 'Storage', value: `Data file: ${DATA_FILE}\nBackups: ${BACKUP_DIR}\nWritable: ${dataOK}`, inline: false });

        const ft = footerText(gs);
        if (ft) embed.setFooter({ text: ft });
        await message.channel.send({ embeds: [embed] });
    }

    else if (cmd === 'config' && isAdmin) {
        const sub = (args[0] || '').toLowerCase();
        if (!sub || !['export','import','backup','list','restore'].includes(sub)) {
            return message.channel.send('❌ Use: !config export|import|backup|list|restore ...');
        }

        if (sub === 'export') {
            const payload = exportGuildConfig(message.guildId, data);
            const json = JSON.stringify(payload, null, 2);
            const safe = json.length > 1800 ? json.slice(0, 1800) + "\n... (truncated)" : json;
            await message.channel.send(`\`\`\`json\n${safe}\n\`\`\``);
            return;
        }

        if (sub === 'import') {
            const raw = args.slice(1).join(' ').trim();
            if (!raw) return message.channel.send('❌ Use: !config import <json>');
            let payload;
            try { payload = JSON.parse(raw); } catch { return message.channel.send('❌ Invalid JSON.'); }
            try {
                importGuildConfig(message.guildId, data, payload);
                saveData(data);
            } catch (e) {
                return message.channel.send(`❌ Import failed: ${String(e?.message || e)}`);
            }
            await message.channel.send('✅ Config imported for this server.');
            await sendConfigLog(message.guild, data, message.author.id, '⚙️ Config Imported', []);
            return;
        }

        if (sub === 'backup') {
            const p = createBackupFile(DATA_FILE);
            rotateBackups(25);
            await message.channel.send(`✅ Backup created: ${p ? path.basename(p) : 'Failed'}`);
            return;
        }

        if (sub === 'list') {
            const files = listBackupFiles().slice(0, 20);
            await message.channel.send(`✅ Backups (${files.length} shown):\n${files.join('\n') || 'None'}`);
            return;
        }

        if (sub === 'restore') {
            const file = (args[1] || '').trim();
            if (!/^skynet_data\.(\d{8}_\d{6})\.json$/.test(file)) return message.channel.send('❌ Invalid backup filename.');
            const full = path.join(BACKUP_DIR, file);
            if (!fs.existsSync(full)) return message.channel.send('❌ Backup not found.');
            try {
                const d = JSON.parse(fs.readFileSync(full, 'utf8'));
                createBackupFile(DATA_FILE);
                safeWriteJsonAtomic(DATA_FILE, Object.assign(makeDefaultData(), d));
            } catch (e) {
                return message.channel.send(`❌ Restore failed: ${String(e?.message || e)}`);
            }
            await message.channel.send(`✅ Restored from ${file}.`);
            await sendConfigLog(message.guild, data, message.author.id, '⚙️ Config Restored', [file]);
            return;
        }
    }

    else if (cmd === 'botstatus' && isAdmin) {
        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Status / Configuration')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Checks', value: gs.checksEnabled ? '✅ ON' : '❌ OFF', inline: true },
                { name: 'AI', value: gs.aiEnabled ? '✅ ON' : '❌ OFF', inline: true },
                { name: 'No-Affiliation', value: gs.noAffiliationEnabled ? '✅ ON' : '❌ OFF', inline: true },
                { name: 'Link Mode', value: String(gs.linkMode || 'strict'), inline: true },
                { name: 'Link Action', value: String(gs.linkAction || 'warn'), inline: true },
                { name: 'Auto-Timeouts', value: gs.timeoutEnabled ? '✅ ON' : '❌ OFF', inline: true },
                { name: 'Verify Gate', value: gs.verifyGateEnabled ? `✅ ON (minDays=${gs.verifyMinAccountAgeDays}, role=${gs.verifyRequiredRoleId || 'None'}, action=${gs.verifyGateAction})` : '❌ OFF', inline: false },
                { name: 'Timeout Minutes', value: `spam=${gs.timeoutMinutesSpam} scam=${gs.timeoutMinutesScam} command=${gs.timeoutMinutesCommand} trade=${gs.timeoutMinutesTrade} service=${gs.timeoutMinutesService}`, inline: false },
                { name: 'Channels', value:
                    `trade=${gs.tradeChannelId ? `<#${gs.tradeChannelId}>` : 'None'}\n` +
                    `services=${gs.servicesChannelId ? `<#${gs.servicesChannelId}>` : 'None'}\n` +
                    `commands=${(gs.gamesHubId || DEFAULT_GAMES_HUB_ID) ? `<#${gs.gamesHubId || DEFAULT_GAMES_HUB_ID}>` : 'None'}\n` +
                    `log=${gs.logChannelId ? `<#${gs.logChannelId}>` : 'None'}\n` +
                    `exile=${gs.exileChannelId ? `<#${gs.exileChannelId}>` : 'None'}`,
                    inline: false
                },
            )
            .setTimestamp();
        const ft = footerText(gs);
        if (ft) embed.setFooter({ text: ft });
        await message.channel.send({ embeds: [embed] });
    }

    else if (cmd === 'policymode' && isAdmin) {
        const mode = (args[0] || '').toLowerCase();
        if (!['enforce','monitor'].includes(mode)) return message.channel.send('❌ Use: !policymode enforce|monitor');
        const before = gs.enforcementMode;
        gs.enforcementMode = mode;
        saveData(data);
        await message.channel.send(`✅ Enforcement mode: **${before}** -> **${gs.enforcementMode}**`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Enforcement Mode Updated', [
            `enforcementMode: **${before}** -> **${gs.enforcementMode}**`,
        ]);
    }

    else if (cmd === 'policyset' && isAdmin) {
        const cat = (args[0] || '').toLowerCase();
        const action = (args[1] || '').toLowerCase();
        const mins = parseInt(args[2]) || 0;
        if (!['spam','scam','command','trade','service','beg','acctrade'].includes(cat)) return message.channel.send('❌ category must be: spam|scam|command|trade|service|beg|acctrade');
        if (!['warn','delete','timeout','exile','log'].includes(action)) return message.channel.send('❌ action must be: warn|delete|timeout|exile|log');
        gs.categoryPolicies = gs.categoryPolicies && typeof gs.categoryPolicies === 'object' ? gs.categoryPolicies : {};
        const before = gs.categoryPolicies[cat] || null;
        gs.categoryPolicies[cat] = { action, minutes: action === 'timeout' ? Math.max(1, Math.min(10080, mins || before?.minutes || 5)) : (before?.minutes || 0) };
        saveData(data);
        await message.channel.send(`✅ Policy updated for **${cat}**: action=${action}${action === 'timeout' ? ` minutes=${gs.categoryPolicies[cat].minutes}` : ''}`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Policy Updated', [
            `category: **${cat}**`,
            `action: **${before?.action || 'default'}** -> **${action}**`,
            action === 'timeout' ? `minutes: **${before?.minutes || 0}** -> **${gs.categoryPolicies[cat].minutes}**` : null,
        ]);
    }

    else if (cmd === 'policystatus' && isAdmin) {
        const cats = ['spam','scam','command','trade','service','beg','acctrade'];
        const lines = cats.map(c => {
            const p = getCategoryPolicy(gs, c);
            return `• ${c}: action=${p.action}${p.action === 'timeout' ? ` minutes=${p.minutes}` : ''}`;
        });
        const embed = new EmbedBuilder()
            .setTitle('📜 Policy Status')
            .setColor(0x5865F2)
            .setDescription(lines.join('\n'))
            .addFields({ name: 'Mode', value: `**${gs.enforcementMode}**`, inline: true })
            .setTimestamp();
        await message.channel.send({ embeds: [embed] });
    }

    else if (cmd === 'setowner' && isSuperUser(message.author.id)) {
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Provide a member mention or ID.');
        gs.botOwnerId = target.id;
        saveData(data);
        await message.channel.send(`✅ Bot owner set to ${target} (${target.id}).`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Bot Owner Updated', [
            `Owner: <@${gs.botOwnerId}> (${gs.botOwnerId})`,
        ]);
    }

    else if (cmd === 'clearowner' && isSuperUser(message.author.id)) {
        gs.botOwnerId = null;
        saveData(data);
        await message.channel.send('✅ Bot owner cleared (Open Source / Community Run).');
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Bot Owner Cleared', []);
    }

    else if (cmd === 'setfooter' && isAdmin) {
        const t = args.join(' ').trim().slice(0, 200);
        if (!t) return message.channel.send('❌ Use: !setfooter <text>');
        gs.botFooterText = t;
        saveData(data);
        await message.channel.send('✅ Footer updated.');
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Footer Updated', [
            `Footer: ${t}`,
        ]);
    }

    else if (cmd === 'clearfooter' && isAdmin) {
        gs.botFooterText = null;
        saveData(data);
        await message.channel.send('✅ Footer cleared.');
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Footer Cleared', []);
    }

    else if (cmd === 'botinfopublic' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`❌ Use: !botinfopublic on/off (currently ${gs.botInfoPublic ? 'ON' : 'OFF'})`);
        const before = gs.botInfoPublic;
        gs.botInfoPublic = v;
        saveData(data);
        await message.channel.send(`✅ /botinfo visibility is now **${gs.botInfoPublic ? 'PUBLIC' : 'EPHEMERAL'}**.`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ BotInfo Visibility', [
            `botInfoPublic: **${before ? 'ON' : 'OFF'}** -> **${gs.botInfoPublic ? 'ON' : 'OFF'}**`,
        ]);
    }

    else if (cmd === 'linkmode' && isAdmin) {
        const mode = (args[0] || '').toLowerCase();
        if (!['strict','medium','off'].includes(mode)) return message.channel.send('❌ Use: !linkmode strict|medium|off');
        const before = gs.linkMode;
        gs.linkMode = mode;
        saveData(data);
        await message.channel.send(`✅ Link mode set to **${mode}**.`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Link Mode Updated', [
            `linkMode: **${before}** -> **${gs.linkMode}**`,
        ]);
    }

    else if (cmd === 'linkaction' && isAdmin) {
        const action = (args[0] || '').toLowerCase();
        if (!['delete','warn','exile','timeout'].includes(action)) return message.channel.send('❌ Use: !linkaction delete|warn|exile|timeout [minutes]');
        const before = gs.linkAction;
        gs.linkAction = action;
        const mins = parseInt(args[1]) || 0;
        if (action === 'timeout' && mins) gs.timeoutMinutesScam = Math.max(1, Math.min(10080, mins));
        saveData(data);
        await message.channel.send(`✅ Link action set to **${action}**.`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Link Action Updated', [
            `linkAction: **${before}** -> **${gs.linkAction}**`,
            action === 'timeout' ? `timeoutMinutesScam: ${gs.timeoutMinutesScam}` : null,
        ]);
    }

    else if (cmd === 'verifygate' && isAdmin) {
        const sub = (args[0] || '').toLowerCase();
        if (['on','off','enable','disable'].includes(sub)) {
            const before = gs.verifyGateEnabled;
            gs.verifyGateEnabled = ['on','enable'].includes(sub);
            saveData(data);
            await message.channel.send(`✅ Verify gate is now **${gs.verifyGateEnabled ? 'ON' : 'OFF'}**.`);
            await sendConfigLog(message.guild, data, message.author.id, '⚙️ Verify Gate', [
                `verifyGateEnabled: **${before ? 'ON' : 'OFF'}** -> **${gs.verifyGateEnabled ? 'ON' : 'OFF'}**`,
            ]);
            return;
        }
        if (sub !== 'config') return message.channel.send('❌ Use: !verifygate on/off OR !verifygate config days <n> role <@role|id|none> action delete|warn|timeout');

        const beforeDays = gs.verifyMinAccountAgeDays;
        const beforeRole = gs.verifyRequiredRoleId;
        const beforeAction = gs.verifyGateAction;

        for (let i = 1; i < args.length; i++) {
            const k = (args[i] || '').toLowerCase();
            const v = args[i + 1];
            if (k === 'days' && v) { gs.verifyMinAccountAgeDays = Math.max(0, Math.min(365, parseInt(v) || gs.verifyMinAccountAgeDays)); i++; continue; }
            if (k === 'action' && v) { if (['delete','warn','timeout'].includes(String(v).toLowerCase())) gs.verifyGateAction = String(v).toLowerCase(); i++; continue; }
            if (k === 'role' && v) {
                if (String(v).toLowerCase() === 'none') { gs.verifyRequiredRoleId = null; i++; continue; }
                const r = await resolveRole(v);
                if (r) { gs.verifyRequiredRoleId = r.id; }
                i++; continue;
            }
            if (k === 'minutes' && v) { const m = parseInt(v) || 0; if (m) gs.timeoutMinutesCommand = Math.max(1, Math.min(10080, m)); i++; continue; }
        }
        saveData(data);
        await message.channel.send('✅ Verify gate config updated.');
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Verify Gate Config', [
            `minAccountDays: **${beforeDays}** -> **${gs.verifyMinAccountAgeDays}**`,
            `requiredRole: **${beforeRole || 'None'}** -> **${gs.verifyRequiredRoleId || 'None'}**`,
            `action: **${beforeAction}** -> **${gs.verifyGateAction}**`,
        ]);
    }

    else if (cmd === 'timeoutconfig' && isAdmin) {
        const sub = (args[0] || '').toLowerCase();
        if (['on','off','enable','disable'].includes(sub)) {
            const before = gs.timeoutEnabled;
            gs.timeoutEnabled = ['on','enable'].includes(sub);
            saveData(data);
            await message.channel.send(`✅ Auto-timeouts are now **${gs.timeoutEnabled ? 'ON' : 'OFF'}**.`);
            await sendConfigLog(message.guild, data, message.author.id, '⚙️ Auto-Timeouts', [
                `timeoutEnabled: **${before ? 'ON' : 'OFF'}** -> **${gs.timeoutEnabled ? 'ON' : 'OFF'}**`,
            ]);
            return;
        }

        if (sub !== 'set') return message.channel.send('❌ Use: !timeoutconfig on/off OR !timeoutconfig set spam <m> scam <m> command <m> trade <m> service <m>');
        for (let i = 1; i < args.length; i++) {
            const k = (args[i] || '').toLowerCase();
            const v = parseInt(args[i + 1]) || 0;
            if (!v) continue;
            if (k === 'spam') { gs.timeoutMinutesSpam = Math.max(1, Math.min(10080, v)); i++; continue; }
            if (k === 'scam') { gs.timeoutMinutesScam = Math.max(1, Math.min(10080, v)); i++; continue; }
            if (k === 'command') { gs.timeoutMinutesCommand = Math.max(1, Math.min(10080, v)); i++; continue; }
            if (k === 'trade') { gs.timeoutMinutesTrade = Math.max(1, Math.min(10080, v)); i++; continue; }
            if (k === 'service') { gs.timeoutMinutesService = Math.max(1, Math.min(10080, v)); i++; continue; }
        }
        saveData(data);
        await message.channel.send('✅ Timeout minutes updated.');
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Timeout Config', [
            `spam=${gs.timeoutMinutesSpam}m scam=${gs.timeoutMinutesScam}m command=${gs.timeoutMinutesCommand}m trade=${gs.timeoutMinutesTrade}m service=${gs.timeoutMinutesService}m`,
        ]);
    }

    // !violations [mention | id]
    else if (cmd === 'violations' && (isAdmin || isMod)) {
        const target = await resolveMember(args[0]);
        if (!target) {
            // Allow checking by raw ID even if user left the server
            const rawId = args[0]?.match(/^<@!?(\d+)>$/) ? args[0].match(/^<@!?(\d+)>$/)[1] : (args[0]?.match(/^\d{15,20}$/) ? args[0] : null);
            if (!rawId) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
            const count   = getViolationCount(data, rawId);
            const history = getViolationHistory(data, rawId);
            const histLines = history.slice(-10).map((h, i) => {
                const ts  = h.timestamp ? `<t:${Math.floor(h.timestamp/1000)}:d>` : '?';
                const cat = h.category ? `[${h.category}]` : '';
                const by  = h.by ? ` — by <@${h.by}>` : '';
                return `**${i+1}.** ${cat} ${h.reason}${by} — ${ts}`;
            });
            const embed = new EmbedBuilder()
                .setTitle('📊 Violation History (User not in server)')
                .setColor(count >= threshold ? 0xFF4444 : (count > 0 ? 0xFFAA00 : 0x00FF88))
                .setDescription(`<@${rawId}> (${rawId}) — **${count}/${threshold}** violations`)
                .addFields({ name: `Recent warnings (${history.length} total)`, value: histLines.length ? histLines.join('\n') : 'No warning history.', inline: false })
                .setTimestamp();
            return message.channel.send({ embeds: [embed] });
        }
        const count   = getViolationCount(data, target.id);
        const history = getViolationHistory(data, target.id);
        const histLines = history.slice(-10).map((h, i) => {
            const ts  = h.timestamp ? `<t:${Math.floor(h.timestamp/1000)}:d>` : '?';
            const cat = h.category ? `[${h.category}]` : '';
            const by  = h.by ? ` — by <@${h.by}>` : '';
            return `**${i+1}.** ${cat} ${h.reason}${by} — ${ts}`;
        });
        const embed = new EmbedBuilder()
            .setTitle('📊 Violation History')
            .setColor(count >= threshold ? 0xFF4444 : (count > 0 ? 0xFFAA00 : 0x00FF88))
            .setDescription(`${target} — **${count}/${threshold}** violations`)
            .addFields({ name: `Recent warnings (${history.length} total)`, value: histLines.length ? histLines.join('\n') : 'No warning history.', inline: false })
            .setTimestamp();
        await message.channel.send({ embeds: [embed] });
    }

    // !clearviolations [mention | id]
    else if (cmd === 'clearviolations' && isAdmin) {
        const target = await resolveMember(args[0]);
        if (target && target.id === message.author.id && !isSuperUser(message.author.id)) return message.channel.send('❌ You cannot clear your own violations.');
        if (!target) {
            const rawId = args[0]?.match(/^<@!?(\d+)>$/) ? args[0].match(/^<@!?(\d+)>$/)[1] : (args[0]?.match(/^\d{15,20}$/) ? args[0] : null);
            if (!rawId) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
            clearViolationEntry(data, rawId);
            saveData(data);
            return message.channel.send(`✅ Cleared violations for <@${rawId}> (${rawId}).`);
        }
        clearViolationEntry(data, target.id);
        saveData(data);
        await message.channel.send(`✅ Cleared violations for ${target}.`);
    }

    // !exilelist
    else if (cmd === 'exilelist' && (isAdmin || isMod)) {
        const now   = Date.now()/1000;
        const lines = Object.entries(data.exiles).map(([uid, info]) =>
            `• <@${uid}> (${uid}) — expires <t:${Math.floor(info.expiry)}:R>`
        );
        const embed = new EmbedBuilder()
            .setTitle('📋 Currently Exiled Members')
            .setDescription(lines.length ? lines.join('\n') : 'No members currently exiled.')
            .setColor(0xFF4400);
        await message.channel.send({ embeds: [embed] });
    }

    // !warn [mention|id] [reason...]
    else if (cmd === 'warn' && (isAdmin || isMod)) {
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
        if (target.id === message.author.id) return message.channel.send('❌ You cannot warn yourself.');
        const reason = args.slice(1).join(' ') || 'Manual warn';
        const count  = addViolationEntry(data, target.id, { reason, category: 'manual', by: message.author.id });
        const warnId = getLastWarnId(data, target.id);
        saveData(data);

        if (count >= threshold) {
            // Threshold hit — exile
            if (!isAdmin) return message.channel.send(`✅ Warned ${target}. Violations: **${count}/${threshold}** — an admin must exile them.`);
            clearViolationEntry(data, target.id);
            saveData(data);
            await performExile(target, message.guild, exileMins, `Manual warn threshold reached: ${reason}`, data);
            saveData(data);
            await message.channel.send(`⛓️ Warned ${target} and threshold reached — exiled for **${exileMins}m**. Reason: ${reason}`);
        } else {
            await message.channel.send(`✅ Warned ${target}. Violations: **${count}/${threshold}**`);
            if (warnId) {
                const appealEmbed = new EmbedBuilder()
                    .setTitle('⚠️ You received a warning')
                    .setColor(0xFFAA00)
                    .setDescription('If you believe this warning was issued unfairly, you may submit an appeal using the button below. You can only appeal this specific warning **once**.')
                    .addFields(
                        { name: 'Server',      value: message.guild.name,            inline: true },
                        { name: 'Issued by',   value: `<@${message.author.id}>`,     inline: true },
                        { name: 'Violations',  value: `${count}/${threshold}`,        inline: true },
                        { name: 'Reason',      value: reason.slice(0, 1024),         inline: false },
                    )
                    .setTimestamp();
                const appealRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`open_warn_appeal_${message.guildId}_${warnId}`)
                        .setLabel('📩 Appeal this Warning')
                        .setStyle(ButtonStyle.Primary)
                );
                target.send({ embeds: [appealEmbed], components: [appealRow] }).catch(() => {});
            }
        }
    }

    // !unwarn [mention|id]
    else if (cmd === 'unwarn' && (isAdmin || isMod)) {
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
        if (target.id === message.author.id && !isSuperUser(message.author.id)) return message.channel.send('❌ You cannot unwarn yourself.');
        const next = decrementViolationEntry(data, target.id);
        saveData(data);
        await message.channel.send(`✅ Unwarned ${target}. Violations: **${next}/${threshold}**`);
    }

    // !purge [count]  OR  !purge user [@mention|id] [count]
    else if (cmd === 'purge' && (isAdmin || isMod)) {
        if (!message.channel.isTextBased()) return;
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'user') {
            // !purge user <@mention|id> [count]
            const targetArg = args[1];
            const scanLimit = Math.max(1, Math.min(100, parseInt(args[2]) || 50));
            const mentionMatch = targetArg?.match(/^<@!?(\d+)>$/);
            const targetId = mentionMatch ? mentionMatch[1] : (targetArg?.match(/^\d{15,20}$/) ? targetArg : null);
            if (!targetId) return message.channel.send('❌ Use: `!purge user <@mention|id> [count]`');
            try {
                const fetched = await message.channel.messages.fetch({ limit: scanLimit });
                const toDelete = fetched.filter(m => m.author.id === targetId);
                if (toDelete.size === 0) {
                    const notice = await message.channel.send(`✅ No recent messages from <@${targetId}> found in the last **${scanLimit}** messages.`);
                    setTimeout(() => notice.delete().catch(() => {}), 8000);
                    return;
                }
                // Include the command message itself in the delete batch
                toDelete.set(message.id, message);
                const deleted = await message.channel.bulkDelete(toDelete, true).catch(() => null);
                const notice = await message.channel.send(`✅ Purged **${deleted ? deleted.size : 0}** messages from <@${targetId}>.`);
                setTimeout(() => notice.delete().catch(() => {}), 6000);
            } catch (e) {
                message.channel.send(`❌ Purge failed: ${e.message}`).catch(() => {});
            }
        } else {
            // !purge [count]
            const count = Math.max(1, Math.min(100, parseInt(args[0]) || 0));
            if (!count) return message.channel.send('❌ Use: `!purge <count>` or `!purge user <@mention|id> [count]`');
            try {
                // +1 to also delete the invoking command message
                const deleted = await message.channel.bulkDelete(count + 1, true).catch(() => null);
                const sent = await message.channel.send(`✅ Purged **${deleted ? Math.max(0, deleted.size - 1) : 0}** messages.`);
                setTimeout(() => sent.delete().catch(() => {}), 6000);
            } catch (e) {
                message.channel.send(`❌ Purge failed: ${e.message}`).catch(() => {});
            }
        }
    }

    // !lock [#channel|id] [reason...]
    else if (cmd === 'lock' && (isAdmin || isMod)) {
        if (!isAdmin)
            return message.channel.send('❌ `/lock` is restricted to admins only.');
        const chArg = args[0] ? await resolveChannel(args[0]) : null;
        const targetCh = chArg || message.channel;
        const reasonStart = chArg ? 1 : 0;
        const reason = args.slice(reasonStart).join(' ') || 'Channel locked';
        try {
            await targetCh.permissionOverwrites.edit(message.guild.id, { SendMessages: false }, { reason });
            await grantAdminRolesSendMessages(targetCh, message.guild, gs);
            await message.channel.send(`🔒 <#${targetCh.id}> locked. Only admins can send messages. Reason: ${reason}`);
        } catch (e) {
            await message.channel.send(`❌ Lock failed: ${e.message}`);
        }
    }

    // !unlock [#channel|id] [reason...]
    else if (cmd === 'unlock' && (isAdmin || isMod)) {
        if (!isAdmin)
            return message.channel.send('❌ `/unlock` is restricted to admins only.');
        const chArg = args[0] ? await resolveChannel(args[0]) : null;
        const targetCh = chArg || message.channel;
        const reasonStart = chArg ? 1 : 0;
        const reason = args.slice(reasonStart).join(' ') || 'Channel unlocked';
        try {
            await revokeAdminRolesSendMessages(targetCh, message.guild, gs);
            await targetCh.permissionOverwrites.edit(message.guild.id, { SendMessages: null }, { reason });
            await message.channel.send(`🔓 <#${targetCh.id}> unlocked. Reason: ${reason}`);
        } catch (e) {
            await message.channel.send(`❌ Unlock failed: ${e.message}`);
        }
    }

    // !setgameshub [channelId]
    else if (cmd === 'setgameshub' && isAdmin) {
        const ch = await resolveChannel(args[0]);
        if (!ch) return message.channel.send('❌ Provide a channel mention or channel ID.');
        gs.gamesHubId = ch.id;
        saveData(data);
        await message.channel.send(`✅ Games Hub set to ${ch}.`);
        await sendConfigLog(message.guild, data, message.author.id, '⚙️ Config Updated', [`Command channel: ${ch} (${ch.id})`]);
    }

    // !setthreshold [1-10]
    else if (cmd === 'setthreshold' && isAdmin) {
        const v = Math.max(1, Math.min(10, parseInt(args[0]) || 0));
        if (!v) return message.channel.send('❌ Use: !setthreshold 1-10');
        gs.violationThreshold = v;
        saveData(data);
        await message.channel.send(`✅ Violation threshold set to **${v}**.`);
    }

    // !setexileduration [minutes]
    else if (cmd === 'setexileduration' && isAdmin) {
        const v = Math.max(1, Math.min(1440, parseInt(args[0]) || 0));
        if (!v) return message.channel.send('❌ Use: !setexileduration 1-1440');
        gs.exileDurationMins = v;
        saveData(data);
        await message.channel.send(`✅ Default exile duration set to **${v} minutes**.`);
    }

    // !raidmode [on|off]
    else if (cmd === 'raidmode' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🛡️ Raid mode is currently **${gs.raidModeEnabled ? 'ON' : 'OFF'}**. Use: !raidmode on/off`);
        gs.raidModeEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Raid mode is now **${gs.raidModeEnabled ? 'ON' : 'OFF'}**.`);
    }

    else if (cmd === 'disablecheck' && isAdmin) {
        gs.checksEnabled = false;
        saveData(data);
        await message.channel.send('🛑 All moderation checks are now **DISABLED** for this server.');
        await sendConfigLog(message.guild, data, message.author.id, '🛑 Checks Disabled', [
            `Checks: **OFF**`,
        ]);
    }

    else if (cmd === 'enablecheck' && isAdmin) {
        gs.checksEnabled = true;
        saveData(data);
        await message.channel.send('✅ All moderation checks are now **ENABLED** for this server.');
        await sendConfigLog(message.guild, data, message.author.id, '✅ Checks Enabled', [
            `Checks: **ON**`,
        ]);
    }

    else if ((cmd === 'noaffiliation' || cmd === 'noaffliation') && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🏷️ No-affiliation mode is currently **${gs.noAffiliationEnabled ? 'ON' : 'OFF'}**. Use: !noaffiliation on/off`);
        const before = gs.noAffiliationEnabled;
        gs.noAffiliationEnabled = v;
        saveData(data);
        await message.channel.send(`✅ No-affiliation mode is now **${gs.noAffiliationEnabled ? 'ON' : 'OFF'}**.`);
        await sendConfigLog(message.guild, data, message.author.id, '🏷️ No-Affiliation Mode', [
            `No-affiliation: **${before ? 'ON' : 'OFF'}** -> **${gs.noAffiliationEnabled ? 'ON' : 'OFF'}**`,
        ]);
    }

    // !aienable / !aidisable
    else if (cmd === 'aienable' && isAdmin) {
        gs.aiEnabled = true;
        saveData(data);
        await message.channel.send('✅ AI detection is now **ENABLED** for this server.');
        await sendConfigLog(message.guild, data, message.author.id, '🤖 AI Enabled', [
            `AI detection: **ON**`,
        ]);
    }
    else if (cmd === 'aidisable' && isAdmin) {
        gs.aiEnabled = false;
        saveData(data);
        await message.channel.send('⚠️ AI detection is now **DISABLED** for this server.');
        await sendConfigLog(message.guild, data, message.author.id, '🤖 AI Disabled', [
            `AI detection: **OFF**`,
        ]);
    }

    else if (cmd.endsWith('immunity') && isAdmin) {
        const category = cmd.replace(/immunity$/i, '');
        const kind = (args[0] || '').toLowerCase();
        const action = (args[1] || '').toLowerCase();
        const c = getCategoryImmunity(message.guildId, data, category);

        if (kind === 'role') {
            if (action === 'list') {
                const list = c.roles.map(rid => message.guild.roles.cache.get(rid) ? `<@&${rid}>` : `Unknown (${rid})`).slice(0, 60);
                await message.channel.send(`✅ **${category}** role immunity list (${c.roles.length}):\n${list.join('\n') || 'None'}`);
                return;
            }
            const role = await resolveRole(args[2]);
            if (!role) { await message.channel.send('❌ Provide a role mention or role ID.'); return; }
            if (action === 'add') {
                if (!c.roles.includes(role.id)) c.roles.push(role.id);
                saveData(data);
                await message.channel.send(`✅ Added role immunity for **${category}**: ${role}`);
                await sendConfigLog(message.guild, data, message.author.id, '🛡️ Immunity Updated', [
                    `Category: **${category}**`,
                    `Role add: ${role} (${role.id})`,
                ]);
                return;
            }
            if (action === 'remove') {
                c.roles = c.roles.filter(x => x !== role.id);
                saveData(data);
                await message.channel.send(`✅ Removed role immunity for **${category}**: ${role}`);
                await sendConfigLog(message.guild, data, message.author.id, '🛡️ Immunity Updated', [
                    `Category: **${category}**`,
                    `Role remove: ${role} (${role.id})`,
                ]);
                return;
            }
            await message.channel.send('❌ Use: !<category>immunity role add/remove/list [@role]');
            return;
        }

        if (kind === 'member') {
            if (action === 'list') {
                const list = c.members.map(uid => `<@${uid}> (${uid})`).slice(0, 60);
                await message.channel.send(`✅ **${category}** member immunity list (${c.members.length}):\n${list.join('\n') || 'None'}`);
                return;
            }
            const member = await resolveMember(args[2]);
            if (!member) { await message.channel.send('❌ Provide a member mention or Discord ID.'); return; }
            if (action === 'add') {
                if (!c.members.includes(member.id)) c.members.push(member.id);
                saveData(data);
                await message.channel.send(`✅ Added member immunity for **${category}**: ${member}`);
                await sendConfigLog(message.guild, data, message.author.id, '🛡️ Immunity Updated', [
                    `Category: **${category}**`,
                    `Member add: <@${member.id}> (${member.id})`,
                ]);
                return;
            }
            if (action === 'remove') {
                c.members = c.members.filter(x => x !== member.id);
                saveData(data);
                await message.channel.send(`✅ Removed member immunity for **${category}**: ${member}`);
                await sendConfigLog(message.guild, data, message.author.id, '🛡️ Immunity Updated', [
                    `Category: **${category}**`,
                    `Member remove: <@${member.id}> (${member.id})`,
                ]);
                return;
            }
            await message.channel.send('❌ Use: !<category>immunity member add/remove/list [@member|id]');
            return;
        }

        await message.channel.send('❌ Use: !<category>immunity role|member add/remove/list ...');
    }

    // !raidstatus
    else if (cmd === 'raidstatus' && (isAdmin || isMod)) {
        const e = joinSpikeTracker.get(message.guildId);
        const w = getJoinSpikeWindow(e, gs.raidJoinWindowSec || 25);
        const locked = isRaidLocked(message.guildId);
        const lockInfo = locked ? `LOCKED until <t:${Math.floor((e.lockedUntil||0)/1000)}:R>` : 'Not locked';
        await message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🛡️ Raid Mode Status')
            .setColor(gs.raidModeEnabled ? 0xFFAA00 : 0x00FF88)
            .addFields(
                { name: 'Raid Mode', value: gs.raidModeEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                { name: 'Auto Raid', value: gs.raidAutoEnabled ? '✅ ON' : '❌ OFF', inline: true },
                { name: 'Join Window', value: `${gs.raidJoinWindowSec || 25}s`, inline: true },
                { name: 'Joins In Window', value: String(w), inline: true },
                { name: 'Threshold', value: String(gs.raidJoinThreshold || 7), inline: true },
                { name: 'Lockdown', value: `${gs.raidLockdownMins || 8}m`, inline: true },
                { name: 'State', value: lockInfo, inline: false },
            ).setTimestamp()] });
    }

    // !linkpolicy [on|off]
    else if (cmd === 'linkpolicy' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🔗 Link policy is currently **${gs.linkPolicyEnabled ? 'ON' : 'OFF'}**. Use: !linkpolicy on/off`);
        gs.linkPolicyEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Link policy is now **${gs.linkPolicyEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !commandredirect [on|off]
    else if ((cmd === 'commandredirect' || cmd === 'togglecommandredirect') && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🧭 Command redirect is currently **${gs.commandRedirectEnabled ? 'ON' : 'OFF'}**. Use: !commandredirect on/off`);
        gs.commandRedirectEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Command redirect is now **${gs.commandRedirectEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !serviceredirect [on|off]
    else if ((cmd === 'serviceredirect' || cmd === 'servicesredirect' || cmd === 'toggleserviceredirect') && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`⚔️ Service redirect is currently **${gs.serviceRedirectEnabled ? 'ON' : 'OFF'}**. Use: !serviceredirect on/off`);
        gs.serviceRedirectEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Service redirect is now **${gs.serviceRedirectEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !traderedirect [on|off]
    else if ((cmd === 'traderedirect' || cmd === 'toggletraderedirect') && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🔄 Trade redirect is currently **${gs.tradeRedirectEnabled ? 'ON' : 'OFF'}**. Use: !traderedirect on/off`);
        gs.tradeRedirectEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Trade redirect is now **${gs.tradeRedirectEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !spamwarn / !spamredirect [on|off]
    else if ((cmd === 'spamwarn' || cmd === 'spamredirect' || cmd === 'togglespamredirect') && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`⚠️ Spam warnings are currently **${gs.spamWarnEnabled ? 'ON' : 'OFF'}**. Use: !spamwarn on/off`);
        gs.spamWarnEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Spam warnings are now **${gs.spamWarnEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !begwarn [on|off]
    else if (cmd === 'begwarn' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🚫 Begging warnings are currently **${gs.begWarnEnabled ? 'ON' : 'OFF'}**. Use: !begwarn on/off`);
        gs.begWarnEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Begging warnings are now **${gs.begWarnEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !scamwarn [on|off]
    else if (cmd === 'scamwarn' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🚨 Scam warnings are currently **${gs.scamWarnEnabled ? 'ON' : 'OFF'}**. Use: !scamwarn on/off`);
        gs.scamWarnEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Scam warnings are now **${gs.scamWarnEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !acctradewarn [on|off]
    else if (cmd === 'acctradewarn' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🚫 Account trading warnings are currently **${gs.accTradeWarnEnabled ? 'ON' : 'OFF'}**. Use: !acctradewarn on/off`);
        gs.accTradeWarnEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Account trading warnings are now **${gs.accTradeWarnEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !allowdomain [domain]
    else if (cmd === 'allowdomain' && isAdmin) {
        const dom = parseDomainArg(args[0]);
        if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return message.channel.send('❌ Use: !allowdomain example.com');
        gs.linkAllowlistedDomains = Array.isArray(gs.linkAllowlistedDomains) ? gs.linkAllowlistedDomains : [];
        if (!gs.linkAllowlistedDomains.includes(dom)) gs.linkAllowlistedDomains.push(dom);
        saveData(data);
        await message.channel.send(`✅ Allowlisted: **${dom}**`);
    }

    // !denydomain [domain]
    else if (cmd === 'denydomain' && isAdmin) {
        const dom = parseDomainArg(args[0]);
        if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return message.channel.send('❌ Use: !denydomain example.com');
        gs.linkDenylistedDomains = Array.isArray(gs.linkDenylistedDomains) ? gs.linkDenylistedDomains : [];
        if (!gs.linkDenylistedDomains.includes(dom)) gs.linkDenylistedDomains.push(dom);
        saveData(data);
        await message.channel.send(`✅ Denylisted: **${dom}**`);
    }

    // !listdomains
    else if (cmd === 'listdomains' && (isAdmin || isMod)) {
        const allow = (gs.linkAllowlistedDomains || []).slice(0, 60);
        const deny  = (gs.linkDenylistedDomains || []).slice(0, 60);
        await message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🔗 Link Policy Domains')
            .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
            .addFields(
                { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                { name: 'Allowlist (first 60)', value: allow.length ? allow.join('\n').slice(0, 1024) : 'None', inline: false },
                { name: 'Denylist (first 60)', value: deny.length ? deny.join('\n').slice(0, 1024) : 'None', inline: false },
            ).setTimestamp()] });
    }

    // !mentionlimit [limit] [windowSec] [unique]
    else if (cmd === 'mentionlimit' && isAdmin) {
        const limit = Math.max(1, Math.min(30, parseInt(args[0]) || 0));
        const windowSec = Math.max(3, Math.min(60, parseInt(args[1]) || gs.mentionSpamWindowSec || 12));
        const unique = Math.max(1, Math.min(30, parseInt(args[2]) || gs.mentionSpamUniqueLimit || 5));
        if (!limit) return message.channel.send('❌ Use: !mentionlimit <limit 1-30> [windowSec 3-60] [unique 1-30]');
        gs.mentionSpamLimit = limit;
        gs.mentionSpamWindowSec = windowSec;
        gs.mentionSpamUniqueLimit = unique;
        saveData(data);
        await message.channel.send(`✅ Mention spam limits updated: total=${limit}, unique=${unique}, window=${windowSec}s`);
    }

    // !togglescanedits [on|off]
    else if (cmd === 'togglescanedits' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`✏️ Scan edits is currently **${gs.scanEditsEnabled ? 'ON' : 'OFF'}**. Use: !togglescanedits on/off`);
        gs.scanEditsEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Scan edits is now **${gs.scanEditsEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !automodstats
    else if (cmd === 'automodstats' && (isAdmin || isMod)) {
        const st = getGuildStats(message.guildId, data);
        const c = st.counters || {};
        const last = st.lastUpdated ? `<t:${Math.floor(st.lastUpdated/1000)}:R>` : 'Unknown';
        await message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('📈 SKYNET — Automod Stats')
            .setColor(0x00FF88)
            .addFields(
                { name: 'Last Updated', value: last, inline: true },
                { name: 'Command Usage', value: String(c.commandUsage || 0), inline: true },
                { name: 'Command Abuse', value: String(c.commandAbuse || 0), inline: true },
                { name: 'Spam', value: String(c.spam || 0), inline: true },
                { name: 'Account Trading', value: String(c.accountTrading || 0), inline: true },
                { name: 'Begging', value: String(c.begging || 0), inline: true },
                { name: 'Trade', value: String(c.trade || 0), inline: true },
                { name: 'Service', value: String(c.service || 0), inline: true },
                { name: 'Race', value: String(c.race || 0), inline: true },
                { name: 'Scam/Exploit', value: String(c.scam || 0), inline: true },
                { name: 'Link Policy', value: String(c.linkPolicy || 0), inline: true },
                { name: 'Mention Spam', value: String(c.mentionSpam || 0), inline: true },
                { name: 'Raid Lockdown', value: String(c.raidLockdown || 0), inline: true },
                { name: 'AI Flags', value: String(c.aiFlag || 0), inline: true },
            ).setTimestamp()] });
    }

    // !dupeconfig [on/off] [windowSec] [threshold] [minLen]
    else if (cmd === 'dupeconfig' && isAdmin) {
        const onoff = parseOnOff(args[0]);
        if (onoff !== null) gs.dupeSpamEnabled = onoff;
        if (args[1]) gs.dupeWindowSec  = Math.max(5,  Math.min(120, parseInt(args[1]) || gs.dupeWindowSec  || 20));
        if (args[2]) gs.dupeThreshold  = Math.max(2,  Math.min(20,  parseInt(args[2]) || gs.dupeThreshold  || 4));
        if (args[3]) gs.dupeMinLen     = Math.max(5,  Math.min(200, parseInt(args[3]) || gs.dupeMinLen     || 10));
        saveData(data);
        await message.channel.send(`✅ Dupe config: enabled=${gs.dupeSpamEnabled} window=${gs.dupeWindowSec}s threshold=${gs.dupeThreshold} minLen=${gs.dupeMinLen}`);
    }

    // !raidconfig [window <sec>] [threshold <n>] [lockdown <mins>] [lockchannels on/off] [blocklinks on/off] [newacctdays <n>]
    else if (cmd === 'raidconfig' && isAdmin) {
        if (!args.length) {
            return message.channel.send(
                `📋 Raid config: window=${gs.raidJoinWindowSec||25}s threshold=${gs.raidJoinThreshold||7} lockdown=${gs.raidLockdownMins||8}m lockChannels=${gs.raidLockChannels} blockLinks=${gs.raidLinkBlockAll} newAcctDays=${gs.raidNewAccountDays||7}\n` +
                `Use: !raidconfig window <s> threshold <n> lockdown <m> lockchannels on/off blocklinks on/off newacctdays <d>`
            );
        }
        for (let i = 0; i < args.length; i++) {
            const k = (args[i] || '').toLowerCase();
            const v = args[i + 1];
            if (k === 'window'      && v) { gs.raidJoinWindowSec   = Math.max(5,  Math.min(120, parseInt(v) || gs.raidJoinWindowSec  || 25)); i++; continue; }
            if (k === 'threshold'   && v) { gs.raidJoinThreshold   = Math.max(2,  Math.min(50,  parseInt(v) || gs.raidJoinThreshold  || 7));  i++; continue; }
            if (k === 'lockdown'    && v) { gs.raidLockdownMins    = Math.max(1,  Math.min(60,  parseInt(v) || gs.raidLockdownMins   || 8));  i++; continue; }
            if (k === 'newacctdays' && v) { gs.raidNewAccountDays  = Math.max(0,  Math.min(90,  parseInt(v) || gs.raidNewAccountDays || 7));  i++; continue; }
            if (k === 'lockchannels'&& v) { const p = parseOnOff(v); if (p !== null) gs.raidLockChannels  = p; i++; continue; }
            if (k === 'blocklinks'  && v) { const p = parseOnOff(v); if (p !== null) gs.raidLinkBlockAll  = p; i++; continue; }
        }
        saveData(data);
        await message.channel.send(`✅ Raid config updated. window=${gs.raidJoinWindowSec}s threshold=${gs.raidJoinThreshold} lockdown=${gs.raidLockdownMins}m lockChannels=${gs.raidLockChannels} blockLinks=${gs.raidLinkBlockAll} newAcctDays=${gs.raidNewAccountDays}`);
    }

    // !unlockdown [unlockchannels on/off]
    else if (cmd === 'unlockdown' && isAdmin) {
        const unlockStr = (args[0] || '').toLowerCase();
        const unlockChannels = ['on','true','yes','1','unlock','unlockchannels'].includes(unlockStr);
        const e = joinSpikeTracker.get(message.guildId);
        if (e) { e.lockedUntil = 0; joinSpikeTracker.set(message.guildId, e); }
        if (unlockChannels) await unlockGuildTextChannels(message.guild, gs);
        await message.channel.send(`✅ Raid lockdown disabled.${unlockChannels ? ' Channels unlocked.' : ''}`);
    }

    // !linkstatus
    else if (cmd === 'linkstatus' && (isAdmin || isMod)) {
        const allow = (gs.linkAllowlistedDomains || []).length;
        const deny  = (gs.linkDenylistedDomains || []).length;
        await message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🔗 Link Policy Status')
            .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
            .addFields(
                { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                { name: 'Allowlist Size', value: String(allow), inline: true },
                { name: 'Denylist Size', value: String(deny), inline: true },
                { name: 'Raid Block Links', value: gs.raidLinkBlockAll ? '✅ ON' : '❌ OFF', inline: true },
                { name: 'New Account Days', value: String(gs.raidNewAccountDays || 0), inline: true },
            ).setTimestamp()] });
    }

    // !domainremove [allow|deny] [domain]
    else if (cmd === 'domainremove' && isAdmin) {
        const list = (args[0] || '').toLowerCase();
        const dom = parseDomainArg(args[1]);
        if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return message.channel.send('❌ Use: !domainremove allow|deny example.com');
        if (list !== 'allow' && list !== 'deny') return message.channel.send('❌ First arg must be allow or deny.');
        if (list === 'allow') gs.linkAllowlistedDomains = (gs.linkAllowlistedDomains || []).filter(x => normalizeDomain(x) !== dom);
        if (list === 'deny')  gs.linkDenylistedDomains  = (gs.linkDenylistedDomains  || []).filter(x => normalizeDomain(x) !== dom);
        saveData(data);
        await message.channel.send(`✅ Removed **${dom}** from **${list}** list.`);
    }

    // !capsconfig [on/off] [percent] [minLetters] [maxRun]
    else if (cmd === 'capsconfig' && isAdmin) {
        const onoff = parseOnOff(args[0]);
        if (onoff !== null) gs.capsSpamEnabled = onoff;
        if (args[1]) gs.capsMaxPercent  = Math.max(30, Math.min(100, parseInt(args[1]) || gs.capsMaxPercent  || 70));
        if (args[2]) gs.capsMinLetters  = Math.max(8,  Math.min(80,  parseInt(args[2]) || gs.capsMinLetters  || 16));
        if (args[3]) gs.capsMaxRun      = Math.max(10, Math.min(120, parseInt(args[3]) || gs.capsMaxRun      || 28));
        saveData(data);
        await message.channel.send(`✅ Caps config: enabled=${gs.capsSpamEnabled} percent=${gs.capsMaxPercent} minLetters=${gs.capsMinLetters} maxRun=${gs.capsMaxRun}`);
    }

    // !emojiconfig [on/off] [max] [windowSec]
    else if (cmd === 'emojiconfig' && isAdmin) {
        const onoff = parseOnOff(args[0]);
        if (onoff !== null) gs.emojiSpamEnabled = onoff;
        if (args[1]) gs.emojiMaxCount  = Math.max(5,  Math.min(60, parseInt(args[1]) || gs.emojiMaxCount  || 18));
        if (args[2]) gs.emojiWindowSec = Math.max(3,  Math.min(60, parseInt(args[2]) || gs.emojiWindowSec || 12));
        saveData(data);
        await message.channel.send(`✅ Emoji config: enabled=${gs.emojiSpamEnabled} max=${gs.emojiMaxCount} window=${gs.emojiWindowSec}s`);
    }

    // !zalgoconfig [on/off] [maxMarks]
    else if (cmd === 'zalgoconfig' && isAdmin) {
        const onoff = parseOnOff(args[0]);
        if (onoff !== null) gs.zalgoEnabled = onoff;
        if (args[1]) gs.zalgoMaxCombining = Math.max(4, Math.min(80, parseInt(args[1]) || gs.zalgoMaxCombining || 12));
        saveData(data);
        await message.channel.send(`✅ Zalgo config: enabled=${gs.zalgoEnabled} maxMarks=${gs.zalgoMaxCombining}`);
    }

    // !invitepolicy [on/off]
    else if (cmd === 'invitepolicy' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🔗 Invite policy is currently **${gs.invitePolicyEnabled ? 'ON' : 'OFF'}**. Use: !invitepolicy on/off`);
        gs.invitePolicyEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Invite policy is now **${gs.invitePolicyEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !invitechannel [add|remove|list] [#channel]
    else if (cmd === 'invitechannel' && isAdmin) {
        const mode = (args[0] || '').toLowerCase();
        gs.inviteAllowedChannelIds = Array.isArray(gs.inviteAllowedChannelIds) ? gs.inviteAllowedChannelIds : [];
        if (mode === 'list') {
            const list = gs.inviteAllowedChannelIds.slice(0, 40).map(id => `<#${id}>`).join('\n');
            await message.channel.send(`✅ Allowed invite channels (${gs.inviteAllowedChannelIds.length}):\n${list || 'None'}`);
            return;
        }
        const ch = await resolveChannel(args[1]);
        if (!ch) return message.channel.send('❌ Provide a channel mention or channel ID. Example: !invitechannel add #invites');
        if (mode === 'add') {
            if (!gs.inviteAllowedChannelIds.includes(ch.id)) gs.inviteAllowedChannelIds.push(ch.id);
            saveData(data);
            await message.channel.send(`✅ Added allowed invite channel: <#${ch.id}>`);
            return;
        }
        if (mode === 'remove') {
            gs.inviteAllowedChannelIds = gs.inviteAllowedChannelIds.filter(x => x !== ch.id);
            saveData(data);
            await message.channel.send(`✅ Removed allowed invite channel: <#${ch.id}>`);
            return;
        }
        await message.channel.send('❌ Use: !invitechannel add/remove/list');
    }

    // !attachmentpolicy [on/off]
    else if (cmd === 'attachmentpolicy' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`📎 Attachment policy is currently **${gs.attachmentPolicyEnabled ? 'ON' : 'OFF'}**. Use: !attachmentpolicy on/off`);
        gs.attachmentPolicyEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Attachment policy is now **${gs.attachmentPolicyEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !attachmentext [add|remove|list] [ext]
    else if (cmd === 'attachmentext' && isAdmin) {
        const mode = (args[0] || '').toLowerCase();
        const ext = String(args[1] || '').toLowerCase().replace(/^\./,'').trim();
        gs.attachmentBlockExts = Array.isArray(gs.attachmentBlockExts) ? gs.attachmentBlockExts : [];
        if (mode === 'list') {
            const list = gs.attachmentBlockExts.slice(0, 120).map(x => '.'+String(x)).join(', ');
            await message.channel.send(`✅ Blocked extensions (${gs.attachmentBlockExts.length}):\n${list || 'None'}`);
            return;
        }
        if (!ext || !/^[a-z0-9]{1,8}$/.test(ext)) return message.channel.send('❌ Use: !attachmentext add/remove/list [ext]');
        if (mode === 'add') {
            if (!gs.attachmentBlockExts.includes(ext)) gs.attachmentBlockExts.push(ext);
            saveData(data);
            await message.channel.send(`✅ Added blocked ext: .${ext}`);
            return;
        }
        if (mode === 'remove') {
            gs.attachmentBlockExts = gs.attachmentBlockExts.filter(x => String(x).toLowerCase() !== ext);
            saveData(data);
            await message.channel.send(`✅ Removed blocked ext: .${ext}`);
            return;
        }
        await message.channel.send('❌ Use: !attachmentext add/remove/list');
    }

    // !stretchconfig [on/off] [maxCharRun] [maxPunctRun] [maxWordRepeat]
    else if (cmd === 'stretchconfig' && isAdmin) {
        const onoff = parseOnOff(args[0]);
        if (onoff !== null) gs.stretchSpamEnabled = onoff;
        if (args[1]) gs.stretchMaxCharRun    = Math.max(6,  Math.min(40, parseInt(args[1]) || gs.stretchMaxCharRun    || 12));
        if (args[2]) gs.stretchMaxPunctRun   = Math.max(6,  Math.min(40, parseInt(args[2]) || gs.stretchMaxPunctRun   || 10));
        if (args[3]) gs.stretchMaxWordRepeat = Math.max(3,  Math.min(20, parseInt(args[3]) || gs.stretchMaxWordRepeat  || 5));
        saveData(data);
        await message.channel.send(`✅ Stretch config: enabled=${gs.stretchSpamEnabled} maxCharRun=${gs.stretchMaxCharRun} maxPunctRun=${gs.stretchMaxPunctRun} maxWordRepeat=${gs.stretchMaxWordRepeat}`);
    }

    // !channelconfig [add|remove|list] [category] [#channel]
    // categories: trade, raid, race, seaevents, mirage, prehistoric, kitsune, leviathan
    else if ((cmd === 'channelconfig' || cmd === 'channelconf') && isAdmin) {
        const mode = (args[0] || '').toLowerCase();
        const cat  = (args[1] || '').toLowerCase();
        if (mode === 'list' || (!mode && !cat)) {
            const lines = Object.entries(CHANNEL_CATEGORIES).map(([c, meta]) => {
                const ids = getChannelIds(gs, meta.key);
                return `${meta.label} (\`${c}\`): ${ids.length ? ids.map(id=>`<#${id}>`).join(', ') : 'None'}`;
            });
            return message.channel.send(`📋 **Channel Config Pools:**\n${lines.join('\n')}`);
        }
        const meta = CHANNEL_CATEGORIES[cat];
        if (!meta) return message.channel.send(`❌ Unknown category \`${cat}\`. Valid: ${Object.keys(CHANNEL_CATEGORIES).join(', ')}\nUsage: !channelconfig add|remove|list [category] [#channel]`);
        const ch = await resolveChannel(args[2] || args[1]);
        if (!ch) return message.channel.send('❌ Provide a channel mention or ID. Example: !channelconfig add trade #fast-trading');
        gs[meta.key] = Array.isArray(gs[meta.key]) ? gs[meta.key] : [];
        if (mode === 'add') {
            if (!gs[meta.key].includes(ch.id)) { gs[meta.key].push(ch.id); saveData(data); }
            await message.channel.send(`✅ Added <#${ch.id}> to **${meta.label}** pool. Pool: ${formatChannelIds(gs[meta.key])}`);
            return;
        }
        if (mode === 'remove') {
            gs[meta.key] = gs[meta.key].filter(id => id !== ch.id); saveData(data);
            await message.channel.send(`✅ Removed <#${ch.id}> from **${meta.label}** pool. Pool: ${formatChannelIds(gs[meta.key])}`);
            return;
        }
        await message.channel.send('❌ Use: !channelconfig add|remove|list [category] [#channel]');
    }

    // !togglescam [on|off]
    else if (cmd === 'togglescam' && isAdmin) {
        const v = parseOnOff(args[0]);
        if (v === null) return message.channel.send(`🚨 Scam detection is currently **${gs.scamEnabled ? 'ON' : 'OFF'}**. Use: !togglescam on/off`);
        gs.scamEnabled = v;
        saveData(data);
        await message.channel.send(`✅ Scam detection is now **${gs.scamEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !immunestatus
    else if (cmd === 'immunestatus' && (isAdmin || isMod)) {
        const imm = getImmunitySettings(message.guildId, data);
        const roleNames   = imm.whitelistedRoles.map(rid => { const r = message.guild.roles.cache.get(rid); return r ? `<@&${rid}>` : `Unknown (${rid})`; });
        const memberNames = imm.whitelistedMembers.map(uid => `<@${uid}>`);
        await message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🛡️ Immunity Settings')
            .setColor(imm.enabled ? 0x00FF88 : 0xFF4444)
            .addFields(
                { name: 'Immunity Status',     value: imm.enabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                { name: 'Whitelisted Roles',   value: roleNames.length   ? roleNames.join('\n')   : 'None', inline: false },
                { name: 'Whitelisted Members', value: memberNames.length ? memberNames.join('\n') : 'None', inline: false },
            )] });
    }

    // !testscan [text...]
    else if (cmd === 'testscan' && (isAdmin || isMod)) {
        const text = args.join(' ');
        if (!text) return;
        const cleaned = fullClean(text);
        const ns      = cleaned.replace(/[\s_]/g,'');
        const fruits  = scanForFruits(cleaned);
        for (const f of FRUITS) { const fc=f.replace(/[\s\-]/g,''); if(ns.includes(fc)&&!fruits.includes(f)) fruits.push(f); }
        const bosses  = scanForBosses(cleaned);
        const swords  = scanForSwords(cleaned);
        const painUpg = scanForPainUpgrades(cleaned);
        const lightUpg= scanForLightningUpgrades(cleaned);
        const materials = scanForMaterials(cleaned);
        const npcs      = scanForNpcs(cleaned);
        const intent  = scanForIntent(cleaned);
        const svcInt  = scanForServiceIntent(cleaned);
        const tier    = hasTierKeyword(cleaned);
        const accTrd  = detectAccountTrading(cleaned);
        const beg     = detectBegging(cleaned);
        let exchange  = tradeRegex.test(cleaned);
        if (!exchange) for (const p of NOSPACE_PATTERNS) if(p.test(ns)){exchange=true;break;}

        const embed = new EmbedBuilder()
            .setTitle('🔬 SKYNET V7 — Scan Test')
            .setColor(0x00FF88)
            .addFields(
                { name: 'Cleaned',         value: `\`${cleaned.slice(0,200)}\``, inline: false },
                { name: 'Fruits',          value: fruits.join(', ')    || 'None', inline: false },
                { name: 'Bosses',          value: bosses.join(', ')    || 'None', inline: false },
                { name: 'Swords',          value: swords.join(', ')    || 'None', inline: false },
                { name: 'Pain Upgrades',   value: painUpg.join(', ')   || 'None', inline: false },
                { name: 'Lightning Upgr.', value: lightUpg.join(', ')  || 'None', inline: false },
                { name: 'Materials',       value: materials.join(', ')  || 'None', inline: false },
                { name: 'NPCs',            value: npcs.join(', ')       || 'None', inline: false },
                { name: 'Trade Intent',    value: intent   ? '✅' : '❌', inline: true },
                { name: 'Service Intent',  value: svcInt   ? '✅' : '❌', inline: true },
                { name: 'Tier Keyword',    value: tier     ? '✅' : '❌', inline: true },
                { name: 'Direct Exchange', value: exchange ? '✅' : '❌', inline: true },
                { name: 'Account Trading', value: accTrd   ? '🚨 YES' : '✅ CLEAN', inline: true },
                { name: 'Begging',         value: beg      ? '🚨 YES' : '✅ CLEAN', inline: true },
            );
        await message.channel.send({ embeds: [embed] });
    }

}

// ══════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════
ai2InitDb();
ai2LoadDbState().catch(()=>{});
client.login(TOKEN);
