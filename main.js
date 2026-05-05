// ============================================================
// main.js — converted from main.py (discord.py → discord.js v14)
//
// Python → JS mappings used throughout:
//   asyncio.Lock        → Mutex class (see below)
//   collections.deque   → Array (used with .push() / .shift())
//   time.time()         → Date.now() / 1000
//   datetime.now()      → new Date()
//   re module           → native RegExp
//   colorama            → chalk
//   requests            → node-fetch (built-in fetch in Node 18+)
//   dotenv              → dotenv
//   discord.py Bot      → discord.js Client + discord.js/voice Commands
//
// Required npm packages:
//   npm install discord.js @discordjs/rest dotenv chalk js-yaml node-fetch
//
// Util modules should be converted from their Python counterparts:
//   utils/helpers.js        (helpers.py)
//   utils/db.js             (db.py)
//   utils/errorNotifications.js  (error_notifications.py)
//   utils/ai.js             (ai.py)
//   utils/splitResponse.js  (split_response.py)
//   utils/setup.js          (setup.py)
// ============================================================

import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Collection,
} from "discord.js";
import { readdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import chalk from "chalk";
import fetch from "node-fetch";

import {
  clearConsole,
  resourcePath,
  getEnvPath,
  loadInstructions,
  loadConfig,
} from "./utils/helpers.js";
import { initDb, getChannels, getIgnoredUsers } from "./utils/db.js";
import { webhookLog } from "./utils/errorNotifications.js";
import { initAi, generateResponse, generateResponseImage } from "./utils/ai.js";
import { splitResponse } from "./utils/splitResponse.js";

// ─── Mutex (asyncio.Lock equivalent) ────────────────────────────────────────
// Python's asyncio.Lock prevents concurrent execution of a critical section.
// This Mutex does the same by chaining Promises so only one caller runs at a
// time. Usage: await mutex.acquire(); ... mutex.release();
// Or: await mutex.runExclusive(async () => { ... });
class Mutex {
  constructor() {
    this._locked = false;
    this._queue = [];
  }

  locked() {
    return this._locked;
  }

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

// ─── asyncio.sleep equivalent ────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── time.time() equivalent (seconds, like Python) ──────────────────────────
const timeNow = () => Date.now() / 1000;

// ─── datetime.now().strftime('[%H:%M:%S]') equivalent ───────────────────────
function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
}

// ─── Config check ────────────────────────────────────────────────────────────
function checkConfig() {
  const envPath = resourcePath("config/.env");
  const configPath = resourcePath("config/config.yaml");
  if (!existsSync(envPath) || !existsSync(configPath)) {
    console.log("Config files are not setup! Running setup...");
    const { createConfig } = await import("./utils/setup.js");
    createConfig();
  }
}

// ─── Update check ────────────────────────────────────────────────────────────
async function checkForUpdate() {
  // Update this URL if you host your own fork/releases
  const url =
    "https://api.github.com/repos/Najmul190/Discord-AI-Selfbot/releases/latest";
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return data.tag_name;
    }
  } catch {
    // ignore network errors
  }
  return null;
}

// ─── Terminal helpers (shutil.get_terminal_size / colorama) ─────────────────
function getTerminalWidth() {
  return process.stdout.columns || 80;
}

function createBorder(char = "═") {
  return char.repeat(getTerminalWidth() - 2);
}

function printHeader() {
  const width = getTerminalWidth();
  const border = createBorder();
  const title = "AI Discord Bot";
  const padding = " ".repeat(Math.floor((width - title.length - 2) / 2));

  console.log(chalk.cyan(`╔${border}╗`));
  console.log(chalk.cyan(`║${padding}${chalk.bold(title)}${padding}║`));
  console.log(chalk.cyan(`╚${border}╝`));
}

function printSeparator() {
  console.log(chalk.cyan(createBorder("─")));
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
// Top-level await equivalent of the module-level Python code
checkConfig();
const config = loadConfig();

const envPath = getEnvPath();
dotenvConfig({ path: envPath, override: true });

initDb();
initAi();

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = config.bot.prefix;
const OWNER_ID = config.bot.owner_id;
// Python: config["bot"]["trigger"].lower().split(",")
const TRIGGER = config.bot.trigger
  .toLowerCase()
  .split(",")
  .map((t) => t.trim());
const DISABLE_MENTIONS = config.bot.disable_mentions;

const CONVERSATION_TIMEOUT = 150.0; // seconds
const SPAM_MESSAGE_THRESHOLD = 5;
const SPAM_TIME_WINDOW = 10.0;     // seconds
const COOLDOWN_DURATION = 60.0;    // seconds
const MAX_HISTORY = 15;

// ─── Client (commands.Bot equivalent) ────────────────────────────────────────
// discord.py: commands.Bot(command_prefix=PREFIX, help_command=None, intents=discord.Intents.all())
// discord.js uses a Client + a commands Collection; prefix commands are handled
// manually in the messageCreate event (or via @discordjs/builders).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Bot state (bot.xxx attributes in Python)
client.ownerId = BigInt(OWNER_ID);
client.activeChannels = new Set(getChannels().map(BigInt));
client.ignoreUsers = getIgnoredUsers().map(BigInt);
client.messageHistory = {};          // { key: [{role, content}] }
client.paused = false;
client.allowDm = config.bot.allow_dm;
client.allowGc = config.bot.allow_gc;
client.helpCommandEnabled = config.bot.help_command_enabled;
client.realisticTyping = config.bot.realistic_typing;
client.antiAgeBan = config.bot.anti_age_ban;
client.batchMessages = config.bot.batch_messages;
client.batchWaitTime = parseFloat(config.bot.batch_wait_time);
client.holdConversation = config.bot.hold_conversation;
client.userMessageCounts = {};       // { userId: [timestamp, ...] }
client.userCooldowns = {};           // { userId: cooldownEndTime }
client.instructions = loadInstructions();
client.messageQueues = {};           // { channelId: [...messages] }  — deque → Array
client.processingLocks = {};         // { channelId: Mutex }
client.userMessageBatches = {};      // { batchKey: { messages, lastTime, imageUrl } }
client.activeConversations = {};     // { convKey: timestamp }
client.commands = new Collection();  // prefix command handlers

// ─── ready event (on_ready) ───────────────────────────────────────────────────
client.once("ready", async () => {
  // Validate owner_id
  if (client.ownerId === 123456789012345678n) {
    console.log(
      chalk.red("Error: Please set a valid owner_id in config.yaml")
    );
    process.exit(1);
  }

  if (client.ownerId === client.user.id) {
    console.log(
      chalk.red(
        "Error: owner_id in config.yaml cannot be the same as the bot's user ID"
      )
    );
    process.exit(1);
  }

  // bot.bot_id equivalent
  client.botId = client.user.id;

  clearConsole();
  printHeader();

  console.log(
    `AI Bot successfully logged in as ${chalk.cyan(
      `${client.user.username} (${client.botId})`
    )}.\n`
  );

  if (updateAvailable) {
    console.log(
      chalk.red(
        `A new version is available! Please update to ${latestVersion} at:\nhttps://github.com/Najmul190/Discord-AI-Selfbot/releases/latest\n`
      )
    );
  }

  if (client.activeChannels.size > 0) {
    console.log("Active in the following channels:");
    for (const channelId of client.activeChannels) {
      const channel = client.channels.cache.get(String(channelId));
      if (channel) {
        try {
          console.log(`- #${channel.name} in ${channel.guild.name}`);
        } catch {
          // ignore channels without guilds (DMs, etc.)
        }
      }
    }
  } else {
    console.log(
      `Bot is currently not active in any channel, use ${PREFIX}toggleactive command to activate it in a channel.`
    );
  }

  console.log(
    `\n${chalk.gray(
      "Join the Discord server for support and news on updates: https://discord.gg/yUWmzQBV4P"
    )}`
  );

  printSeparator();
});

// ─── Load command modules (load_extensions / setup_hook equivalent) ───────────
// Python loads cogs from a ./cogs directory. In JS we load command files from
// ./commands and register them in client.commands.
async function loadExtensions() {
  const cogsDir = resolve(".", "commands");

  if (!existsSync(cogsDir)) {
    console.log(
      `Warning: Commands directory not found at ${cogsDir}. Skipping command loading.`
    );
    return;
  }

  clearConsole();

  const files = readdirSync(cogsDir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const commandName = file.replace(".js", "");
    try {
      console.log(`Loading command module: ${commandName}`);
      const mod = await import(join(cogsDir, file));
      // Each command file should export: { name, execute }
      // For cogs with multiple commands, export an array: { commands: [...] }
      if (mod.commands) {
        for (const cmd of mod.commands) {
          client.commands.set(cmd.name, cmd);
        }
      } else if (mod.default?.name) {
        client.commands.set(mod.default.name, mod.default);
      }
    } catch (e) {
      console.log(`Error loading command module ${commandName}: ${e}`);
    }
  }
}

// ─── should_ignore_message ───────────────────────────────────────────────────
function shouldIgnoreMessage(message) {
  // Python: message.author.id in bot.ignore_users or message.author.bot
  return (
    client.ignoreUsers.includes(message.author.id) ||
    message.author.bot
  );
}

// ─── is_trigger_message ──────────────────────────────────────────────────────
function isTriggerMessage(message) {
  // mentioned = bot.user.mentioned_in(message) and not @everyone / @here
  const mentioned =
    message.mentions.has(client.user) &&
    !message.content.includes("@everyone") &&
    !message.content.includes("@here");

  // replied_to = message.reference resolved to bot's own message
  const repliedTo =
    message.reference &&
    message.reference.messageId &&
    (() => {
      const resolved = message.channel.messages?.cache?.get(
        message.reference.messageId
      );
      return resolved && resolved.author.id === client.botId;
    })();

  // is_dm = DM channel and allow_dm
  const isDm =
    message.channel.type === ChannelType.DM && client.allowDm;

  // is_group_dm = GroupDM channel and allow_gc
  const isGroupDm =
    message.channel.type === ChannelType.GroupDM && client.allowGc;

  const convKey = `${message.author.id}-${message.channel.id}`;
  const inConversation =
    convKey in client.activeConversations &&
    timeNow() - client.activeConversations[convKey] < CONVERSATION_TIMEOUT &&
    client.holdConversation;

  // content_has_trigger: any(re.search(r'\b{keyword}\b', content.lower()))
  const lowerContent = message.content.toLowerCase();
  const contentHasTrigger = TRIGGER.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lowerContent);
  });

  const triggered =
    contentHasTrigger ||
    mentioned ||
    repliedTo ||
    isDm ||
    isGroupDm ||
    inConversation;

  if (triggered) {
    client.activeConversations[convKey] = timeNow();
  }

  return triggered;
}

// ─── update_message_history ───────────────────────────────────────────────────
function updateMessageHistory(authorId, messageContent) {
  if (!(authorId in client.messageHistory)) {
    client.messageHistory[authorId] = [];
  }
  client.messageHistory[authorId].push(messageContent);
  // keep only the last MAX_HISTORY entries (Python: [-MAX_HISTORY:])
  client.messageHistory[authorId] = client.messageHistory[authorId].slice(
    -MAX_HISTORY
  );
}

// ─── generate_response_and_reply ─────────────────────────────────────────────
async function generateResponseAndReply(message, prompt, history, imageUrl = null) {
  let response;

  if (!client.realisticTyping) {
    // async with message.channel.typing():
    await message.channel.sendTyping();
    if (imageUrl) {
      response = await generateResponseImage(
        prompt, client.instructions, imageUrl, history
      );
    } else {
      response = await generateResponse(prompt, client.instructions, history);
    }
  } else {
    if (imageUrl) {
      response = await generateResponseImage(
        prompt, client.instructions, imageUrl, history
      );
    } else {
      response = await generateResponse(prompt, client.instructions, history);
    }
  }

  let chunks = splitResponse(response);

  if (chunks.length > 3) {
    chunks = chunks.slice(0, 3);
    console.log(`${timestamp()} Response too long, truncating.`);
  }

  for (const rawChunk of chunks) {
    let chunk = rawChunk;

    // DISABLE_MENTIONS: replace @ with @\u200b
    if (DISABLE_MENTIONS) {
      chunk = chunk.replace(/@/g, "@\u200b");
    }

    // anti_age_ban: zero out small numbers
    if (client.antiAgeBan) {
      chunk = chunk.replace(
        /(?<!\d)([0-9]|1[0-2])(?!\d)|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
        "\u200b"
      );
    }

    console.log(`${timestamp()} ${message.author.username}: ${prompt}`);
    console.log(`${timestamp()} Responding to ${message.author.username}: ${chunk}`);
    printSeparator();

    try {
      if (client.realisticTyping) {
        // await asyncio.sleep(random.randint(10, 30))
        await sleep((Math.floor(Math.random() * 21) + 10) * 1000);

        await message.channel.sendTyping();

        // characters_per_second = random.uniform(5.0, 6.0)
        const charsPerSecond = 5.0 + Math.random() * 1.0;
        await sleep(Math.floor((chunk.length / charsPerSecond) * 1000));
      }

      try {
        let sentMessage;

        if (message.channel.type === ChannelType.DM) {
          // isinstance(message.channel, discord.DMChannel)
          sentMessage = await message.channel.send(chunk);
        } else {
          sentMessage = await message.reply({
            content: chunk,
            allowedMentions: {
              repliedUser: config.bot.reply_ping ? true : false,
            },
          });
        }

        const convKey = `${message.author.id}-${message.channel.id}`;
        client.activeConversations[convKey] = timeNow();

        // After the last chunk: wait for follow-up messages (hold_conversation)
        if (chunk === chunks[chunks.length - 1]) {
          const channelId = message.channel.id;
          const batchStartTime = timeNow();

          if (client.holdConversation) {
            // Python: while time.time() - batch_start_time <= bot.batch_wait_time
            while (timeNow() - batchStartTime <= client.batchWaitTime) {
              const remaining =
                client.batchWaitTime - (timeNow() - batchStartTime);
              if (remaining <= 0) break;

              try {
                // bot.wait_for("message", timeout=..., check=check)
                const followUp = await waitForMessage(
                  message.author.id,
                  message.channel.id,
                  remaining * 1000
                );

                if (!followUp) break; // timeout

                if (followUp.content.startsWith(PREFIX)) {
                  // process as command
                  await handleCommand(followUp);
                  continue;
                }

                if (!(channelId in client.messageQueues)) {
                  client.messageQueues[channelId] = [];
                  client.processingLocks[channelId] = new Mutex();
                }

                client.messageQueues[channelId].push(followUp);
              } catch {
                break;
              }
            }
          }

          if (
            client.messageQueues[channelId]?.length > 0 &&
            !client.processingLocks[channelId]?.locked()
          ) {
            processMessageQueue(channelId); // fire-and-forget (asyncio.create_task)
          }
        }
      } catch (innerErr) {
        // swallow inner send errors; outer catch handles logging
        throw innerErr;
      }
    } catch (e) {
      if (e?.code === 50013 /* Missing Permissions */ || e?.message?.includes("Missing Permissions")) {
        console.log(
          `${timestamp()} Missing permissions to send message, bot may be muted.`
        );
        printSeparator();
        await webhookLog(message, e);
      } else if (e?.httpStatus || e?.code) {
        console.log(
          `${timestamp()} Error replying to message, original message may have been deleted.`
        );
        printSeparator();
        await webhookLog(message, e);
      } else {
        console.log(`${timestamp()} Error: ${e}`);
        printSeparator();
        await webhookLog(message, e);
      }
    }
  }

  return response;
}

// ─── waitForMessage helper (bot.wait_for equivalent) ─────────────────────────
// Returns the next matching message within timeoutMs, or null on timeout.
function waitForMessage(authorId, channelId, timeoutMs) {
  return new Promise((resolve) => {
    const handler = (msg) => {
      if (
        msg.author.id === authorId &&
        msg.channel.id === channelId &&
        !msg.content.startsWith(PREFIX)
      ) {
        clearTimeout(timer);
        client.off("messageCreate", handler);
        resolve(msg);
      }
    };

    const timer = setTimeout(() => {
      client.off("messageCreate", handler);
      resolve(null);
    }, timeoutMs);

    client.on("messageCreate", handler);
  });
}

// ─── handleCommand (bot.process_commands equivalent) ─────────────────────────
async function handleCommand(message) {
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const command = client.commands.get(commandName);

  if (!command) return;

  try {
    await command.execute(message, args, client, config);
  } catch (e) {
    console.log(`Error executing command ${commandName}: ${e}`);
  }
}

// ─── on_message event ─────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  // if should_ignore_message(message) and not message.author.id == bot.owner_id
  if (shouldIgnoreMessage(message) && message.author.id !== String(client.ownerId)) {
    return;
  }

  if (message.content.startsWith(PREFIX)) {
    await handleCommand(message);
    return;
  }

  const channelId = message.channel.id;
  const userId = message.author.id;
  const currentTime = timeNow();

  const batchKey = `${userId}-${channelId}`;
  const isFollowup = batchKey in client.userMessageBatches;
  const isTrigger = isTriggerMessage(message);

  if ((isTrigger || (isFollowup && client.holdConversation)) && !client.paused) {
    // Cooldown check
    if (userId in client.userCooldowns) {
      const cooldownEnd = client.userCooldowns[userId];
      if (currentTime < cooldownEnd) {
        const remaining = Math.floor(cooldownEnd - currentTime);
        console.log(
          `${timestamp()} User ${message.author.username} is on cooldown for ${remaining}s`
        );
        return;
      } else {
        delete client.userCooldowns[userId];
      }
    }

    // Spam detection
    if (!(userId in client.userMessageCounts)) {
      client.userMessageCounts[userId] = [];
    }

    // filter out timestamps outside the spam window
    client.userMessageCounts[userId] = client.userMessageCounts[userId].filter(
      (ts) => currentTime - ts < SPAM_TIME_WINDOW
    );

    client.userMessageCounts[userId].push(currentTime);

    if (client.userMessageCounts[userId].length > SPAM_MESSAGE_THRESHOLD) {
      client.userCooldowns[userId] = currentTime + COOLDOWN_DURATION;
      console.log(
        `${timestamp()} User ${message.author.username} has been put on ${COOLDOWN_DURATION}s cooldown for spam`
      );
      client.userMessageCounts[userId] = [];
      return;
    }

    if (!(channelId in client.messageQueues)) {
      client.messageQueues[channelId] = [];            // deque() → Array
      client.processingLocks[channelId] = new Mutex(); // Lock() → Mutex
    }

    client.messageQueues[channelId].push(message);

    if (!client.processingLocks[channelId].locked()) {
      processMessageQueue(channelId); // asyncio.create_task → fire-and-forget
    }
  }
});

// ─── process_message_queue ────────────────────────────────────────────────────
async function processMessageQueue(channelId) {
  // async with bot.processing_locks[channel_id]:
  await client.processingLocks[channelId].runExclusive(async () => {
    // while bot.message_queues[channel_id]:
    while (client.messageQueues[channelId]?.length > 0) {
      // message = bot.message_queues[channel_id].popleft()
      const message = client.messageQueues[channelId].shift();
      const batchKey = `${message.author.id}-${channelId}`;
      const currentTime = timeNow();

      let combinedContent;
      let messageToReplyTo;
      let imageUrl;

      if (client.batchMessages) {
        if (!(batchKey in client.userMessageBatches)) {
          const firstImageUrl =
            message.attachments.size > 0
              ? message.attachments.first().url
              : null;

          client.userMessageBatches[batchKey] = {
            messages: [],
            lastTime: currentTime,
            imageUrl: firstImageUrl,
          };
          client.userMessageBatches[batchKey].messages.push(message);

          // await asyncio.sleep(bot.batch_wait_time)
          await sleep(client.batchWaitTime * 1000);

          // Drain queue messages from the same user
          while (client.messageQueues[channelId]?.length > 0) {
            const nextMessage = client.messageQueues[channelId][0];
            if (
              nextMessage.author.id === message.author.id &&
              !nextMessage.content.startsWith(PREFIX)
            ) {
              client.messageQueues[channelId].shift();

              const alreadySeen = client.userMessageBatches[batchKey].messages.some(
                (m) => m.content === nextMessage.content
              );
              if (!alreadySeen) {
                client.userMessageBatches[batchKey].messages.push(nextMessage);
              }

              if (
                !client.userMessageBatches[batchKey].imageUrl &&
                nextMessage.attachments.size > 0
              ) {
                client.userMessageBatches[batchKey].imageUrl =
                  nextMessage.attachments.first().url;
              }
            } else {
              break;
            }
          }

          // Deduplicate messages by content (Python: seen = set())
          const seen = new Set();
          const uniqueMessages = [];
          for (const msg of client.userMessageBatches[batchKey].messages) {
            if (!seen.has(msg.content)) {
              seen.add(msg.content);
              uniqueMessages.push(msg);
            }
          }

          combinedContent = uniqueMessages.map((m) => m.content).join("\n");
          messageToReplyTo = uniqueMessages[uniqueMessages.length - 1];
          imageUrl = client.userMessageBatches[batchKey].imageUrl;

          delete client.userMessageBatches[batchKey];
        }
      } else {
        combinedContent = message.content;
        messageToReplyTo = message;
        imageUrl =
          message.attachments.size > 0
            ? message.attachments.first().url
            : null;
      }

      // Replace mention snowflakes with display names
      // Python: for mention in message_to_reply_to.mentions: combined_content.replace(...)
      for (const [, user] of messageToReplyTo.mentions.users) {
        combinedContent = combinedContent.replace(
          new RegExp(`<@!?${user.id}>`, "g"),
          `@${user.displayName ?? user.username}`
        );
      }

      const key = `${messageToReplyTo.author.id}-${messageToReplyTo.channel.id}`;
      if (!(key in client.messageHistory)) {
        client.messageHistory[key] = [];
      }

      client.messageHistory[key].push({ role: "user", content: combinedContent });
      const history = client.messageHistory[key];

      const isActiveChannel = client.activeChannels.has(
        BigInt(messageToReplyTo.channel.id)
      );
      const isDmAllowed =
        messageToReplyTo.channel.type === ChannelType.DM && client.allowDm;

      if (isActiveChannel || isDmAllowed) {
        const response = await generateResponseAndReply(
          messageToReplyTo, combinedContent, history, imageUrl
        );
        client.messageHistory[key].push({
          role: "assistant",
          content: response,
        });
      }
    }
  });
}

// ─── Startup sequence ─────────────────────────────────────────────────────────
const currentVersion = "v2.0.1";
let latestVersion = null;
let updateAvailable = false;

// Wrap startup in an async IIFE (top-level await equivalent)
(async () => {
  latestVersion = await checkForUpdate();
  updateAvailable = latestVersion && latestVersion !== currentVersion;

  if (updateAvailable) {
    console.log(
      chalk.red(
        `A new version is available! Please update to ${latestVersion} at:\nhttps://github.com/Najmul190/Discord-AI-Selfbot/releases/latest`
      )
    );
    await sleep(5000); // time.sleep(5)
  }

  // setup_hook equivalent — load command modules before connecting
  await loadExtensions();

  // bot.run(TOKEN) equivalent
  await client.login(TOKEN);
})();
