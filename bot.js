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

const {
    Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits,
    REST, Routes, SlashCommandBuilder, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, Collection,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════
//  CONFIGURATION — overridden by /setup
// ══════════════════════════════════════════════════════════
const TOKEN     = process.env.DISCORD_TOKEN || '';
if (!TOKEN) throw new Error("Missing DISCORD_TOKEN in .env");
const CLIENT_ID = '1494250614123659294';

// Fallback channel / role IDs (overridden per-guild via /setup)
const DEFAULT_TARGET_CHANNEL_ID   = '1417395956357267516';
const DEFAULT_SERVICES_CHANNEL_ID = '1417396221362049085';
const DEFAULT_GAMES_HUB_ID        = '1416126451589316679';
const DEFAULT_EXILED_ROLE_ID      = '1423350765711261797';
const DEFAULT_REDIRECT_EMOJI_ID   = '1125321969932451841';

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
if (AI_ENABLED && !ANTHROPIC_KEY) {
    throw new Error("AI is enabled but ANTHROPIC_API_KEY is missing");
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
const BASE_DIR  = path.dirname(path.resolve(process.argv[1]));
const DATA_FILE = path.join(BASE_DIR, 'skynet_data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return makeDefaultData();
    try {
        const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return Object.assign(makeDefaultData(), d);
    } catch { return makeDefaultData(); }
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
    "in return","in exchange","in exchange for","exchange for","swap for","trade for","for ",
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

function extractDomains(text) {
    const domains = [];
    const raw = (text.match(/https?:\/\/[^\s)\]]+/gi) || []);
    for (const u of raw) {
        const m = u.match(/^https?:\/\/([^\/\s?#:]+)(?::\d+)?/i);
        if (m && m[1]) domains.push(m[1].toLowerCase());
    }
    const bare = (text.match(/(?<![a-z0-9])[a-z0-9][a-z0-9\-]{0,60}\.[a-z]{2,}(?![a-z0-9])/gi) || []);
    for (const b of bare) domains.push(b.toLowerCase());
    return [...new Set(domains)];
}

function detectScamOrExploit(cleanText, rawText) {
    const t = cleanText;
    const ns = t.replace(/[\s_]/g,'');

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
                if (vc.length >= 2 && ns.includes(vc) && Math.abs(ns.index(c) - ns.index(vc)) <= 120) return true;
            }
            for (const h of TRIALS_RECRUITMENT_HEADS) {
                const hc = h.toLowerCase().replace(/[\s_]/g,'');
                if (hc.length >= 4 && ns.includes(hc) && Math.abs(ns.index(c) - ns.index(hc)) <= 160) return true;
            }
            for (const n of TRIALS_NUMBER_WORDS) {
                const nc = n.toLowerCase().replace(/[\s_]/g,'');
                if (nc.length >= 1 && ns.includes(nc) && Math.abs(ns.index(c) - ns.index(nc)) <= 160) {
                    for (const pw of TRIALS_PEOPLE_WORDS) {
                        const pc = pw.toLowerCase().replace(/[\s_]/g,'');
                        if (pc.length >= 2 && ns.includes(pc) && Math.abs(ns.index(pc) - ns.index(nc)) <= 60) return true;
                    }
                    return true;
                }
            }
            for (const ctx of TRIALS_CONTEXT_WORDS) {
                const xc = ctx.toLowerCase().replace(/[\s_]/g,'');
                if (xc.length >= 2 && ns.includes(xc) && Math.abs(ns.index(c) - ns.index(xc)) <= 120) return true;
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
function makeDefaultData() {
    return {
        violations: {}, exiles: {}, immunity: {},
        guildSettings: {}, appeals: {}, spamTracker: {},
        logMessages: [],
        guildStats: {},
    };
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
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch(e) {
        console.error('saveData error:', e);
    }
}

// Per-guild settings helpers
function getGuildSettings(guildId, data) {
    if (!data.guildSettings[guildId]) {
        data.guildSettings[guildId] = {
            tradeChannelId:    DEFAULT_TARGET_CHANNEL_ID,
            servicesChannelId: DEFAULT_SERVICES_CHANNEL_ID,
            gamesHubId:        DEFAULT_GAMES_HUB_ID,
            exiledRoleId:      DEFAULT_EXILED_ROLE_ID,
            logChannelId:      null,
            appealsChannelId:  null,
            redirectEmojiId:   DEFAULT_REDIRECT_EMOJI_ID,
            scamEnabled:       true,
            commandRedirectEnabled: true,
            serviceRedirectEnabled: true,
            tradeRedirectEnabled:   true,
            spamWarnEnabled:        true,
            begWarnEnabled:         true,
            scamWarnEnabled:        true,
            accTradeWarnEnabled:    true,
            aiEnabled: false,
            checksEnabled: true,
            noAffiliationEnabled: false,
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

            capsSpamEnabled: true,
            capsMaxPercent: 70,
            capsMinLetters: 16,
            capsMaxRun: 28,

            emojiSpamEnabled: true,
            emojiMaxCount: 18,
            emojiWindowSec: 12,

            zalgoEnabled: true,
            zalgoMaxCombining: 12,

            stretchSpamEnabled: true,
            stretchMaxCharRun: 12,
            stretchMaxPunctRun: 10,
            stretchMaxWordRepeat: 5,

            dupeSpamEnabled: true,
            dupeWindowSec: 20,
            dupeThreshold: 4,
            dupeMinLen: 10,

            invitePolicyEnabled: true,
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

            attachmentPolicyEnabled: true,
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
            linkPolicyEnabled: true,
            linkAllowlistedDomains: [
                'discord.com','discord.gg','discordapp.com','support.discord.com',
                'roblox.com','www.roblox.com','auth.roblox.com','web.roblox.com',
                'youtube.com','www.youtube.com','youtu.be','twitch.tv','www.twitch.tv',
                'twitter.com','x.com','reddit.com','www.reddit.com',
                'github.com','raw.githubusercontent.com','gist.github.com',
                'pastebin.com','rentry.co',
                'tenor.com','giphy.com',
            ],
            linkDenylistedDomains: [],
            scanEditsEnabled: true,
        };
    }
    const gs = data.guildSettings[guildId];
    if (gs.commandRedirectEnabled === undefined) gs.commandRedirectEnabled = true;
    if (gs.serviceRedirectEnabled === undefined) gs.serviceRedirectEnabled = true;
    if (gs.tradeRedirectEnabled === undefined) gs.tradeRedirectEnabled = true;
    if (gs.spamWarnEnabled === undefined) gs.spamWarnEnabled = true;
    if (gs.begWarnEnabled === undefined) gs.begWarnEnabled = true;
    if (gs.scamWarnEnabled === undefined) gs.scamWarnEnabled = true; 
    if (gs.accTradeWarnEnabled === undefined) gs.accTradeWarnEnabled = true;
    if (gs.aiEnabled === undefined) gs.aiEnabled = false;
    if (gs.checksEnabled === undefined) gs.checksEnabled = true;
    if (gs.noAffiliationEnabled === undefined) gs.noAffiliationEnabled = false;
    return gs;
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

function getImmunitySettings(guildId, data) {
    data.immunity = data.immunity || {};
    if (!data.immunity[guildId]) {
        data.immunity[guildId] = {
            enabled: false,
            whitelistedRoles: [],
        };
    }
    data.immunity[guildId].whitelistedRoles = Array.isArray(data.immunity[guildId].whitelistedRoles)
        ? data.immunity[guildId].whitelistedRoles
        : [];
    if (typeof data.immunity[guildId].enabled !== 'boolean') data.immunity[guildId].enabled = false;
    return data.immunity[guildId];
}

function isMemberImmune(member, guildId, data) {
    const s = getImmunitySettings(guildId, data);
    if (!s.enabled) return false;
    if (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) return true;
    for (const rid of s.whitelistedRoles) {
        if (member.roles.cache.has(rid)) return true;
    }
    return false;
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
        const immune = message.member ? isMemberImmune(message.member, message.guild.id, data) : false;
        if (immune) return;

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

        const { contentClean } = prepareText(message.content);
        const scam = gs.scamEnabled ? detectScamOrExploit(contentClean, message.content) : { hit: false };
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
    '—':'-','–':'-','−':'-','‑':'-','‒':'-','﹘':'-','﹣':'-','－':'-','·':'.','•':'.','∙':'.','⋅':'.','•':'.','。':'.','｡':'.',
    '“':'"','”':'"','„':'"','‟':'"','′':'\'','＇':'\'','‘':'\'','’':'\'','‚':'\'','‛':'\'',
    '（':'(','）':')','［':'[','］':']','｛':'{','｝':'}','〈':'<','〉':'>','《':'<','》':'>',
    '：':':','；':';','，':',','、':',','！':'!','？':'?','％':'%','＃':'#','＆':'&','＠':'@','＊':'*','＋':'+','＝':'=','／':'/','＼':'\\','｜':'|',
    '\u2060':'','\u180e':'','\u200e':'','\u200f':'','\u202a':'','\u202b':'','\u202c':'','\u202d':'','\u202e':'',
    '\u2061':'','\u2062':'','\u2063':'','\u2064':'','\u034f':'',
};
const LEET_MAP = {
    '4':'a','3':'e','1':'i','0':'o','@':'a','!':'i',
    '5':'s','7':'t','8':'b','9':'g','6':'g','$':'s',
    '|':'i','+':'t','(':'c',')':'o','<':'c','>':'o',
    '#':'h','^':'a','~':'n','?':'q',
};

const LEET_MAP_EXTRA = {
    '€':'e','£':'l','¥':'y','¢':'c','©':'c','®':'r','™':'tm','×':'x','÷':'/','°':'o',
    '§':'s','¶':'p','¤':'o','∞':'oo','✓':'v','✔':'v','✗':'x','✕':'x',
    '¡':'i','¿':'?','¬':'-','¦':'|',
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
    "it","its","i","im","in","is","if","id","he","his","her","hers","him",
    "we","us","our","ours","they","them","their","you","your","yours",
    "a","an","the","to","of","on","at","as","or","so","up","do","go",
    "be","by","my","and","but","nor","yet","for","not","no","via","per","vs",
    "am","are","was","were","had","has","have","did","does","will","can",
    "may","might","shall","get","got","let","put","set","sit","hit","bit",
    "say","said","see","saw","try","use","run","ran","eat","ate","ask","pay",
    "ago","add","aim","who","what","when","where","why","how","me","own",
    "off","out","ive","ud","ull","ill","wont","cant","dont","isnt","arent",
    "wasnt","werent","hadnt","hasnt","havent","didnt","doesnt","shouldnt",
    "wouldnt","couldnt","mightnt","mustnt","im","ive","were","youre","theyre",
    "weve","theyve","youve","shell","hell","well","theyll","youll","that",
    "this","those","these","than","then","such","each","both","all","few",
    "more","most","other","some","any","only","same","also","just","into",
    "over","from","with","about","after","before","between","through","during",
    "without","against","around","because","since","until","while","although",
    "though","even","here","there","now","once","soon","again","still",
    "already","often","always","never","ever","maybe","perhaps","very","quite",
    "rather","almost","enough","either","neither","many","much","less","least",
    "little","long","short","large","small","big","old","new","good","bad",
    "best","worst","right","left","next","last","first","second","third",
    "ice","age","ace","act","aid","air","all","any","apt","arc","arm","art",
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
    "yew","zip","zoo","able","also","area","back","ball","band","bank","base",
    "bath","been","best","beta","bill","bird","blow","blue","body","book",
    "boot","born","both","call","calm","came","card","care","case","cash",
    "cast","chat","chip","city","clam","clap","clay","clip","club","coal",
    "coat","code","coin","cold","come","cook","cool","cope","copy","cord",
    "core","corn","cost","cozy","crew","crop","cure","data","date","dawn",
    "dead","deal","dean","dear","debt","deck","deed","deep","deer","demo",
    "deny","desk","dial","dice","diet","dirt","disk","dive","door","dose",
    "dove","down","draw","drip","drop","drum","duck","dude","duel","dumb",
    "dump","dusk","dust","duty","earn","ease","east","edge","emit","epic",
    "even","ever","evil","exam","face","fact","fail","fair","fake","fall",
    "fame","fast","fate","feel","feet","fell","felt","fern","file","fill",
    "film","find","fine","fire","firm","fish","fist","flag","flat","flew",
    "flip","flow","foam","fold","folk","fond","food","fool","foot","ford",
    "fore","fork","form","fort","foul","four","free","frog","fuel","full",
    "fume","fund","fuse","fuss","gain","game","gave","gear","gift","girl",
    "give","glad","glow","glue","goal","gold","golf","good","gown","grab",
    "grid","grin","grip","grow","gulf","gust","guys","hack","half","hall",
    "hand","hang","hard","harm","hate","have","head","heal","heap","hear",
    "heat","held","hell","help","hide","high","hill","hire","hold","hole",
    "home","hood","hook","hope","horn","host","hour","huge","hull","hung",
    "hunt","hurt","idea","idle","into","iron","isle","item","join","joke",
    "jump","just","keen","keep","kick","kill","kind","king","knew","know",
    "lack","laid","lake","land","lane","last","late","lead","leaf","leak",
    "lean","leap","left","lend","less","lick","life","lift","like","lime",
    "line","link","lion","list","live","load","loan","lock","loft","lone",
    "look","loom","loop","lord","lore","lose","loss","lost","loud","lout",
    "lure","lush","made","mail","main","make","male","mall","mane","many",
    "mark","mars","mash","mass","mast","mate","math","maze","mean","meet",
    "melt","memo","menu","mere","mess","mind","mine","mint","miss","mode",
    "mold","mole","moon","move","much","muse","must","mute","myth","nail",
    "name","navy","near","neat","neck","news","next","nice","nine","node",
    "none","noon","norm","nose","note","noun","nude","null","oath","obey",
    "once","only","open","oral","orca","over","pace","pack","page","paid",
    "pair","pale","pane","park","part","pass","past","path","peak","peel",
    "peer","pick","pile","pink","pipe","plan","play","plot","plow","plug",
    "plus","pole","poll","pond","pool","pore","port","pose","post","pour",
    "pray","prey","prop","pull","pump","pure","push","quiz","race","rack",
    "rage","rain","rank","rare","rate","read","real","reap","rear","rely",
    "rent","rest","rich","ride","rife","ring","riot","rise","risk","road",
    "roam","roar","robe","rock","rode","role","roll","roof","room","root",
    "rope","rose","rout","rule","rush","rust","safe","sage","sail","sake",
    "sale","sang","sank","save","scan","scar","seal","seat","seed","seek",
    "seem","seen","self","sell","send","sent","shed","ship","shoe","shop",
    "shot","show","shut","sick","side","sigh","silk","sill","sing","sink",
    "site","size","skip","slab","slam","slap","sled","slew","slim","slip",
    "slot","slow","slug","slum","snap","snow","soak","sock","soft","soil",
    "sole","some","song","soon","sore","soul","soup","sour","span","spec",
    "spit","spot","spur","stab","star","stay","step","stem","stew","stop",
    "stub","such","suit","sung","sunk","sure","swan","swam","swim","sync",
    "tail","tale","talk","tall","tame","task","taut","team","tear","tell",
    "tend","tent","term","test","text","than","that","then","this","thou",
    "thus","tide","tied","tile","till","time","tire","told","toll","tomb",
    "tone","tore","torn","toss","tour","town","trap","tray","tree","trek",
    "trim","trip","true","tube","tune","turf","turn","twin","type","ugly",
    "undo","unit","upon","used","user","vain","vale","vary","vast","veil",
    "vein","verb","very","vest","view","vine","visa","void","volt","vote",
    "wade","wait","wake","walk","wall","want","ward","warm","warn","wary",
    "wave","weak","weld","went","west","whim","wide","wife","wiki","wild",
    "wind","wine","wing","wire","wise","wish","with","wolf","wood","wool",
    "word","wore","work","worm","worn","wrap","writ","yard","yarn","year",
    "yell","zero","zone","swap","loot","lore","hero","gear","slot","buff",
    "nerf","stat","dmg","dps","aoe","rng","exp","xp","lvl","gg","gl","hf",
    "wp","ez","nt","brb","afk","op","pve","pvp","grind","farm","carry",
    "boost","loot","drop","spawn","cooldown","cd","hp","mp","sp","lol",
    "lmao","omg","wtf","smh","tbh","ngl","imo","fr","nah","yea","yeah",
    "yep","yup","nope","ok","okay","bro","bruh","fam","dude","man",
    "robux","roblox","blox","sea","island","ship","boat","reset","rebirth",
    "mastery","bounty","honor","first","second","third","noob","newbie",
    "pro","main","discord","server","chat","link","invite","world","map",
    "location","area","zone","region","teleport","tp","warp","beli","chest",
    "player","member","staff","owner","ping","lag","fps","ms","latency",
    "kick","ban","mute","warn","timeout","role","perm","sorry","mb","oops",
    "please","pls","plz","thanks","thx","ty","np","yw","welcome","sure",
    "now","soon","later","today","tomorrow","morning","evening","night",
    "north","south","east","west","forward","backward","front","bottom",
    "sec","min","hr","hour","day","week","month","year","seconds","minutes",
    "v1","v2","v3","v4","v5","p1","p2","p3","1x","2x","3x","5x","10x",
    "1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th",
    "about","above","after","again","along","among","another","anyone",
    "anything","around","away","before","behind","below","beside","between",
    "beyond","cause","change","check","choose","clear","close","could","cross",
    "cycle","daily","delay","does","done","early","else","empty","enter",
    "equal","every","exist","extra","feels","field","fixed","focus","found",
    "fresh","front","fully","given","going","great","green","group","guess",
    "guide","hands","happy","heard","hence","hours","house","human","inbox",
    "inside","issue","items","keeps","known","large","later","leads","learn",
    "leave","light","liked","limit","links","lives","local","lower","lucky",
    "lunch","might","money","month","moved","named","needs","never","night",
    "noted","often","order","ought","pages","party","place","plain","plans",
    "plays","point","power","price","prior","quite","reach","ready","refer",
    "seems","sends","shown","since","sleep","small","solve","speak","spend",
    "split","stand","start","state","stays","still","stops","story","stuff",
    "style","super","takes","tasks","tests","thing","think","those","three",
    "throw","times","total","touch","track","tried","truck","trust","truth",
    "twice","under","unity","until","using","usual","valid","value","video",
    "voice","walks","watch","where","while","whole","whose","words","works",
    "worse","worth","would","write","wrote","years","young","yours","ahead",
    "alone","apart","apply","argue","aside","being","below","blood","boats",
    "bonus","bound","break","bring","broke","build","built","burns","bytes",
    "calls","chain","claim","class","clean","coins","color","comes","count",
    "cover","crash","crazy","dance","death","delta","depth","drive","enjoy",
    "error","event","exact","final","finds","frame","gains","games","gives",
    "glass","grand","grant","greet","guard","helps","holds","holes","honor",
    "keeps","kills","leads","least","lobby","magic","match","means","media",
    "meets","merge","metal","minor","modes","named","nodes","noise","notes",
    "occur","pools","press","print","proof","queue","races","range","rates",
    "reads","realm","reset","rings","roles","rooms","round","route","saves",
    "score","scene","sense","serve","setup","share","shift","ships","sides",
    "sizes","skill","smart","solve","sorts","sound","space","specs","speed",
    "stone","store","stuck","suits","table","teams","texts","thick","tiles",
    "title","token","tools","towns","trace","train","trees","typed","types",
    "union","units","usage","walls","wants","water","waves","zones",
]);

// ══════════════════════════════════════════════════════════
//  FRUITS
// ══════════════════════════════════════════════════════════
const FRUITS = [
    "rocket","spin","blade","spring","bomb","smoke","spike","flame",
    "ice","sand","dark","eagle","diamond","light","rubber","ghost",
    "magma","quake","buddha","buda","love","creation","spider","sound",
    "phoenix","portal","rumble","lightning","pain","blizzard","gravity",
    "mammoth","trex","t-rex","dough","shadow","venom","gas","spirit",
    "tiger","yeti","kitsune","control","dragon","leopard",
    "2x money","2x mastery","2x boss drops","dark blade","yoru",
    "fast boats","fruit notifier","werewolf",
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
    "gods chalice","god's chalice","godschalice",
    "fist of darkness","fistofdarkness",
    "greybeard","grey beard",
    "darkbeard","dark beard",
    "order",
    "cake prince","cakeprince",
    "dough king","doughking",
    "tyrant of the skies","tyrant skies","tyrantskies",
    "leviathan","leviathn","leviatan","levithan",
    "sea beast","seabeast","seabst",
    "unbound werewolf","unboundwerewolf","werewlf","wwolf",
    "gorilla king","gorillaking",
    "bobby",
    "the saw","thesaw",
    "yeti",
    "mob leader","mobleader",
    "vice admiral","viceadmiral",
    "saber expert","saberexpert",
    "warden",
    "chief warden","chiefwarden",
    "swan",
    "magma admiral","magmaadmiral",
    "fishman lord","fishmanlord",
    "wysper",
    "thunder god","thundergod",
    "cyborg",
    "ice admiral","iceadmiral",
    "diamond",
    "jeremy",
    "fajita",
    "don swan","donswan",
    "smoke admiral","smokeadmiral",
    "awakened ice admiral","awakenediceadmiral",
    "tide keeper","tidekeeper",
    "stone",
    "island empress","islandempres",
    "kilo admiral","kiloadmiral",
    "captain elephant","captainelephant",
    "beautiful pirate","beautifulpirate",
    "longma",
    "cake queen","cakequeen",
    "soul reaper","soulreaper",
    "indra",
    "katakuri",
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
};

// ══════════════════════════════════════════════════════════
//  SEA EVENTS
// ══════════════════════════════════════════════════════════
const SEA_EVENTS = [
    "sea beast","seabeast","ship raid","shipraid",
    "rumbling waters","pirate raid","pirateraid",
    "factory raid","factoryraid","ghost ship","ghostship",
    "terrorshark","terror shark","piranhas","piranha",
    "fishman commando","fishman scout",
    "electric recluse","leviathan",
    "rough sea","roughsea","mirage island","mirageisland",
    "frozen outpost","frozenoutpost",
    "haunted shipwreck","hauntedshipwreck",
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
    "fo":"frozen outpost","frozoutpost":"frozen outpost","frznoutpost":"frozen outpost",
    "hw":"haunted shipwreck","hauntshipwreck":"haunted shipwreck","hauntedship":"haunted shipwreck",
    "hauntshp":"haunted shipwreck",
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
    "seeking ",
    "want ",
    "wanting ",
    "wanna ",
    "wana ",
    "need ",
    "need: ",
    "offering ",
    "offer ",
    "offers ",
    "my offer ",
    "my offers ",
    "giving ",
    "i give ",
    "i'll give ",
    "i will give ",
    "i can give ",
    "you give ",
    "u give ",
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
    "exchange ",
    "exchanging ",
    "for ",
    "for: ",
    "for trade ",
    "for trading ",
    "for offers ",
    "for offer ",
    "in exchange ",
    "in exchange for ",
    "in return ",
    "in return for ",
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
    "i offer ",
    "i can offer ",
    "i have ",
    "i got ",
    "i have for trade ",
    "i got for trade ",
    "anyone have ",
    "any1 have ",
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
    "have ",
    "i have ",
    "i got ",
    "i have: ",
    "i got: ",
    "have: ",
    "got: ",
    "h ",
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
    "for: ",
    "my: ",
    "your: ",
    "them: ",
    "these: ",
    "those: ",
];
const SERVICE_INTENT_EXACT = [
    "service","services","svc","svcs","carry","carries","carried",
    "boost","boosting","raid","raids","dungeon","dungeons","help","helping",
    "run","runs","clear","clearing","farm","farming","lf","lfg","lfs",
    "need","wanna","wana","anyone","join","team","partner","looking",
    "searching","hiring","enchant","enchanting",
];
const SERVICE_INTENT_PHRASE = [
    "looking for","looking 4","need help","need someone",
    "need a carry","need carry","lf carry","lf service","lf raid",
    "anyone help","anyone carry","anyone run",
    "want to run","want to do","wanna run","wanna do",
    "can anyone","who can","help me","help with",
    "services for","service for","carry for","boost for",
    "raid for","farm for","pay for","hiring for",
    "how to get","how do i get","where to get","where do i find",
    "how to unlock","how do i unlock","where to find","quest for",
    "which enchant","best enchant","what enchant",
    "which sword","best sword","sword for",
    "which gun","best gun","gun for",
    "which style","best style","style for",
    "haki color","change haki","best haki",
    "sea event","farm for","grind for",
];

const SERVICE_INTENT_PHRASE_EXTRA = [
    "help with v4 trials",
    "help with v3 trials",
    "help with v2 trials",
    "help with trials",
    "help with trial",
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
    "account for paypal","acc for paypal","account for cash","acc for cash",
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
const scanForPainUpgrades   = t => genericScan(t, PAIN_UPGRADES,    PAIN_UPGRADE_ALIASES);
const scanForLightningUpgrades = t => genericScan(t, LIGHTNING_UPGRADES, LIGHTNING_UPGRADE_ALIASES);

function scanForServiceIntent(cleanText) {
    const ns = cleanText.replace(/\s/g, '');
    for (const phrase of SERVICE_INTENT_PHRASE) {
        if (ns.includes(phrase.replace(/\s/g,'')) || cleanText.includes(phrase)) return true;
    }
    for (const phrase of SERVICE_INTENT_PHRASE_EXTRA) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 6 && (ns.includes(p) || cleanText.includes(phrase))) return true;
    }

    for (const phrase of SERVICE_INTENT_PHRASE_EXTRA2) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 6 && (ns.includes(p) || cleanText.includes(phrase))) return true;
    }
    const { single } = tokenize(cleanText);
    for (const tok of single) {
        if (tok.length < 2) continue;
        for (const kw of SERVICE_INTENT_EXACT) {
            const kwc = kw.replace(/\s/g,'');
            if (kwc.length <= 4) { if (tok === kwc) return true; continue; }
            if (tok === kwc) return true;
            if (Math.abs(tok.length - kwc.length) > Math.max(2,Math.floor(kwc.length/3))) continue;
            if (fuzzyRatio(tok, kwc) >= 0.82) return true;
        }
    }
    return false;
}
function scanForIntent(cleanText) {
    const ns = cleanText.replace(/\s/g,'');
    for (const phrase of INTENT_PHRASE) {
        if (ns.includes(phrase.replace(/\s/g,'')) || cleanText.includes(phrase)) return true;
    }
    for (const phrase of INTENT_PHRASE_EXTRA) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 2 && (ns.includes(p) || cleanText.includes(phrase.trim()))) return true;
    }

    for (const phrase of INTENT_PHRASE_EXTRA2) {
        const p = phrase.replace(/\s/g,'');
        if (p.length >= 3 && (ns.includes(p) || cleanText.includes(phrase.trim()))) return true;
    }
    const { single } = tokenize(cleanText);
    for (const tok of single) {
        if (tok.length < 2) continue;
        for (const kw of INTENT_EXACT) {
            const kwc = kw.replace(/\s/g,'');
            if (kwc.length <= 4) { if (tok === kwc) return true; continue; }
            if (tok === kwc) return true;
            if (Math.abs(tok.length - kwc.length) > Math.max(2,Math.floor(kwc.length/3))) continue;
            if (fuzzyRatio(tok, kwc) >= 0.82) return true;
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
for (const ki of ["lf","wtt","wtb","wts","lookingfor","lfr","lf4"])
    for (const fr of FRUITS) NOSPACE_PATTERNS.push(makeNospacePattern(ki, fr));

// ══════════════════════════════════════════════════════════
//  VIOLATION SYSTEM (UNIFIED WARNING COUNTER)
// ══════════════════════════════════════════════════════════
async function issueViolation(message, data, gs, opts) {
    const uid = message.author.id;
    const threshold = Math.max(1, Math.min(10, gs?.violationThreshold || VIOLATION_THRESHOLD));
    const exileMins = Math.max(1, Math.min(1440, gs?.exileDurationMins || EXILE_DURATION_MINS));
    data.violations[uid] = (data.violations[uid] || 0) + 1;
    const count = data.violations[uid];
    saveData(data);

    const title = opts?.title || '⚠️ Violation';
    const color = opts?.color ?? 0xFFAA00;
    const reason = opts?.reason || 'Rule violation';
    const details = opts?.details || message.content.slice(0, 500);
    const redirectChannelId = opts?.redirectChannelId || null;
    const footerLabel = opts?.footerLabel || 'Violation';

    await sendLog(message.guild, data, new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .addFields(
            { name: 'User', value: `<@${uid}> (${uid})`, inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Violations', value: `${count}/${threshold}`, inline: true },
            { name: 'Reason', value: String(reason).slice(0, 1024), inline: false },
            { name: 'Content', value: String(details).slice(0, 1024), inline: false },
        ).setTimestamp());

    if (count >= threshold) {
        data.violations[uid] = 0;
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
        .setFooter({ text: `${footerLabel} ${count}/${threshold}` });
    const sent = await message.channel.send({ embeds: [embed] });
    setTimeout(() => sent.delete().catch(()=>{}), opts?.ttlMs || 10000);
    return { exiled: false, count };
}

// ══════════════════════════════════════════════════════════
//  SPAM DETECTION
// ══════════════════════════════════════════════════════════
// spamTracker: userId -> { msgs: [{content, timestamp}], violations: number }
const spamTracker = new Map();

function recordSpamMsg(userId, content) {
    const now = Date.now();
    if (!spamTracker.has(userId)) spamTracker.set(userId, { msgs: [], violations: 0 });
    const s = spamTracker.get(userId);
    s.msgs.push({ content, timestamp: now });
    s.msgs = s.msgs.filter(m => now - m.timestamp < SPAM_WINDOW_MS);
    return s;
}

function checkSpam(userId, content) {
    const s = recordSpamMsg(userId, content);
    if (s.msgs.length >= SPAM_MSG_LIMIT) return { spam: true, reason: 'message flood' };
    const dupes = s.msgs.filter(m => m.content === content).length;
    if (dupes >= SPAM_DUPE_LIMIT) return { spam: true, reason: 'duplicate messages' };
    const emojiCount = (content.match(/(<a?:[a-zA-Z0-9_]+:\d+>|[\u{1F300}-\u{1FFFF}])/gu) || []).length;
    if (emojiCount >= SPAM_EMOJI_LIMIT) return { spam: true, reason: 'emoji spam' };
    const capsRatio = content.replace(/\s/g,'').length > 5
        ? (content.replace(/[^A-Z]/g,'').length / content.replace(/[^a-zA-Z]/g,'').length)
        : 0;
    if (capsRatio > 0.85 && content.length > 20) return { spam: true, reason: 'all caps spam' };
    const linkCount = (content.match(/https?:\/\/\S+/g) || []).length;
    if (linkCount >= 4) return { spam: true, reason: 'link spam' };
    return { spam: false };
}

function clearSpamHistory(userId) { spamTracker.delete(userId); }

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
function classifyLinkDomains(domains, gs) {
    const allow = (gs?.linkAllowlistedDomains || []).map(normalizeDomain);
    const deny  = (gs?.linkDenylistedDomains || []).map(normalizeDomain);
    const out = { blocked: [], allowed: [], suspicious: [] };
    for (const dom of domains || []) {
        const d = normalizeDomain(dom);
        if (!d) continue;
        if (domainInList(d, deny)) { out.blocked.push(d); continue; }
        if (SCAM_DOMAIN_BLACKLIST.has(d)) { out.blocked.push(d); continue; }
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
    const maxPunc = Math.max(6, Math.min(40, gs.stretchMaxPunctRun || 10));
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

async function unlockGuildTextChannels(guild, gs) {
    const reason = 'SKYNET V7: Raid lockdown manual unlock';
    for (const [, ch] of guild.channels.cache) {
        if (ch.type !== ChannelType.GuildText) continue;
        if (gs.logChannelId && ch.id === gs.logChannelId) continue;
        if (gs.appealsChannelId && ch.id === gs.appealsChannelId) continue;
        try {
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
        const systemPrompt = `You are a moderation AI for a Blox Fruits Discord server.
Analyze the user's message and determine if it violates any of these rules:
1. Trading in wrong channel (should be in #trades)
2. Begging for fruits or items
3. Account trading/selling
4. Service/boss/raid requests (should be in #services)
5. Spam/inappropriate content

6. Using bot commands in the wrong channels (command usage / command-like)
7. Scam/exploit links or scammy content

Respond ONLY with valid JSON: {"violation": true/false, "category": "trade|beg|account|acctrade|service|spam|command|scam|none", "confidence": 0.0-1.0, "reason": "short reason"}
Only flag if confidence > 0.85. Be conservative — do NOT flag normal conversation.`;
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
        const data = await res.json();
        const text = data.content?.[0]?.text || '{}';
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
function prepareText(raw) {
    let textOnly = raw.replace(/<a?:[a-zA-Z0-9_]+:\d+>/g,' __EMOJI__ ').replace(/<@!?\d+>/g,' ');
    const emojiNames = [...raw.toLowerCase().matchAll(/<a?:([a-zA-Z0-9_]+):\d+>/g)].map(m=>m[1]);
    const contentClean   = fullClean(textOnly + ' ' + emojiNames.join(' '));
    const contentNospace = contentClean.replace(/[\s_]/g,'');
    return { contentClean, contentNospace };
}

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS DEFINITION
// ══════════════════════════════════════════════════════════
const slashCommands = [
    // Setup wizard
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Open the setup wizard to configure SKYNET for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    // Change setup (alias)
    new SlashCommandBuilder()
        .setName('changesetup')
        .setDescription('Reopen the setup wizard to change your configuration')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

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
            .addChannelOption(o => o.setName('channel').setDescription('Appeals channel').setRequired(true))),

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

    // Immunity
    new SlashCommandBuilder()
        .setName('enableimmunity')
        .setDescription('Enable staff/mod immunity from all moderation actions')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('disableimmunity')
        .setDescription('Disable staff/mod immunity (they will be scanned like regular members)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('addimmunity')
        .setDescription('Add a role to the immunity whitelist')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addRoleOption(o => o.setName('role').setDescription('Role to whitelist').setRequired(true)),
    new SlashCommandBuilder()
        .setName('removeimmunity')
        .setDescription('Remove a role from the immunity whitelist')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)),
    new SlashCommandBuilder()
        .setName('immunestatus')
        .setDescription('Show current immunity settings')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('aienable')
        .setDescription('Enable AI (Claude) detection for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('aidisable')
        .setDescription('Disable AI (Claude) detection for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('disablecheck')
        .setDescription('Disable ALL moderation checks for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('enablecheck')
        .setDescription('Enable ALL moderation checks for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
        .setName('noaffiliation')
        .setDescription('Replace trade/service redirects with a no-affiliation notice')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable no-affiliation mode'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable no-affiliation mode')),
    new SlashCommandBuilder()
        .setName('noaffliation')
        .setDescription('Replace trade/service redirects with a no-affiliation notice')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(s => s.setName('enable').setDescription('Enable no-affiliation mode'))
        .addSubcommand(s => s.setName('disable').setDescription('Disable no-affiliation mode')),

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
        .addIntegerOption(o => o.setName('duration').setDescription('Duration in minutes (default 45)').setRequired(false))
        .addStringOption(o => o.setName('reason').setDescription('Reason for exile').setRequired(false)),
    new SlashCommandBuilder()
        .setName('unexile')
        .setDescription('Unexile a member by user or ID')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('user').setDescription('User mention or Discord ID').setRequired(true)),

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

    // Status
    new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Show current bot configuration and status')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

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
        .addIntegerOption(o => o.setName('count').setDescription('How many messages (1-100)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock the current channel (deny SendMessages for @everyone)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock the current channel (allow SendMessages for @everyone)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
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
        .setName('togglescam')
        .setDescription('Toggle scam/exploit detection for this server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)),

    new SlashCommandBuilder()
        .setName('commandredirect')
        .setDescription('Enable/disable command redirect enforcement (Games Hub)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('serviceredirect')
        .setDescription('Enable/disable services redirect enforcement (wrong channel)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('traderedirect')
        .setDescription('Enable/disable trade redirect enforcement (wrong channel)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('spamwarn')
        .setDescription('Enable/disable spam warnings/enforcement')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('begwarn')
        .setDescription('Enable/disable begging warnings/enforcement')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('scamwarn')
        .setDescription('Enable/disable scam warnings/enforcement')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('acctradewarn')
        .setDescription('Enable/disable account trading warnings/enforcement')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(false)),

    new SlashCommandBuilder()
        .setName('raidmode')
        .setDescription('Enable/disable raid mode (stricter, auto-lockdown on join spikes)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)),

    new SlashCommandBuilder()
        .setName('raidstatus')
        .setDescription('Show raid-mode status and current join spike window')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    new SlashCommandBuilder()
        .setName('linkpolicy')
        .setDescription('Enable/disable link policy (allowlist/denylist)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable/disable').setRequired(true)),

    new SlashCommandBuilder()
        .setName('allowdomain')
        .setDescription('Allowlist a domain for link policy')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('domain').setDescription('Domain (example.com)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('denydomain')
        .setDescription('Denylist a domain for link policy')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('domain').setDescription('Domain (example.com)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('listdomains')
        .setDescription('List link allowlist/denylist domains')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

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
        .setName('raidconfig')
        .setDescription('Configure raid protection thresholds')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addIntegerOption(o => o.setName('window').setDescription('Join window seconds (5-120)').setRequired(false))
        .addIntegerOption(o => o.setName('threshold').setDescription('Joins in window to trigger (2-50)').setRequired(false))
        .addIntegerOption(o => o.setName('lockdown').setDescription('Lockdown minutes (1-60)').setRequired(false))
        .addBooleanOption(o => o.setName('lockchannels').setDescription('Lock channels on trigger').setRequired(false))
        .addBooleanOption(o => o.setName('blocklinks').setDescription('Block all links during lockdown').setRequired(false))
        .addIntegerOption(o => o.setName('newacctdays').setDescription('Treat accounts younger than X days as risky (0-90)').setRequired(false))
        .addChannelOption(o => o.setName('notify').setDescription('Notify channel for raid alerts').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlockdown')
        .setDescription('Disable raid lockdown and optionally unlock channels')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addBooleanOption(o => o.setName('unlockchannels').setDescription('Unlock channels (@everyone SendMessages)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('linkstatus')
        .setDescription('Show link policy status and summarize recent domains')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    new SlashCommandBuilder()
        .setName('domainremove')
        .setDescription('Remove a domain from allowlist or denylist')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addStringOption(o => o.setName('list').setDescription('allow|deny').setRequired(true))
        .addStringOption(o => o.setName('domain').setDescription('Domain (example.com)').setRequired(true)),

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

].map(c => c.toJSON());

// ══════════════════════════════════════════════════════════
//  READY
// ══════════════════════════════════════════════════════════
client.once('ready', async () => {
    console.log(`🚨 SKYNET V7 ONLINE: ${client.user.tag}`);
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: slashCommands });
        console.log('✅ Slash commands registered');
    } catch(e) { console.error('❌ Slash command registration failed:', e); }

    // Auto-unexile loop
    setInterval(async () => {
        const data = loadData();
        const now  = Date.now()/1000;
        const done = [];
        for (const [uid, info] of Object.entries(data.exiles)) {
            if (now >= info.expiry) {
                for (const guild of client.guilds.cache.values()) {
                    let member = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(()=>null);
                    if (member) {
                        const fd = loadData();
                        if (await performUnexile(member, guild, fd)) {
                            done.push(uid);
                            await sendLog(guild, fd, new EmbedBuilder()
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
        if (done.length) {
            const fd = loadData();
            for (const uid of done) delete fd.exiles[uid];
            saveData(fd);
        }
    }, 30000);
});

// ══════════════════════════════════════════════════════════
//  INTERACTION HANDLER (slash commands + buttons + modals)
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;
    const data = loadData();
    const guildId = interaction.guildId;
    const gs   = getGuildSettings(guildId, data);
    const imm  = getImmunitySettings(guildId, data);

    // ── MODALS ────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
        // Setup modal
        if (interaction.customId === 'setup_modal') {
            gs.tradeChannelId    = interaction.fields.getTextInputValue('trade_channel_id').trim();
            gs.servicesChannelId = interaction.fields.getTextInputValue('services_channel_id').trim();
            gs.exiledRoleId      = interaction.fields.getTextInputValue('exile_role_id').trim();
            const logId          = interaction.fields.getTextInputValue('log_channel_id').trim();
            const appId          = interaction.fields.getTextInputValue('appeals_channel_id').trim();
            if (logId) gs.logChannelId = logId;
            if (appId) gs.appealsChannelId = appId;
            saveData(data);
            const embed = new EmbedBuilder()
                .setTitle('✅ SKYNET V7 — Setup Complete')
                .setColor(0x00FF88)
                .addFields(
                    { name: '🔄 Trade Channel',    value: `<#${gs.tradeChannelId}>`,    inline: true },
                    { name: '⚔️ Services Channel', value: `<#${gs.servicesChannelId}>`, inline: true },
                    { name: '⛓️ Exile Role',       value: `<@&${gs.exiledRoleId}>`,     inline: true },
                    { name: '📋 Log Channel',      value: gs.logChannelId ? `<#${gs.logChannelId}>` : 'Not set', inline: true },
                    { name: '📩 Appeals Channel',  value: gs.appealsChannelId ? `<#${gs.appealsChannelId}>` : 'Not set', inline: true },
                )
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Appeal modal
        if (interaction.customId.startsWith('appeal_modal_')) {
            const exiledUserId = interaction.customId.replace('appeal_modal_', '');
            const reason       = interaction.fields.getTextInputValue('appeal_reason');
            const appealId     = `appeal_${Date.now()}_${exiledUserId}`;
            data.appeals[appealId] = { userId: exiledUserId, reason, timestamp: Date.now(), status: 'pending', handledBy: null };
            saveData(data);

            const appealsChId = gs.appealsChannelId || gs.logChannelId;
            if (!appealsChId) {
                await interaction.reply({ content: '❌ No appeals channel configured. Contact an admin.', ephemeral: true });
                return;
            }
            try {
                const appealsChannel = await interaction.guild.channels.fetch(appealsChId).catch(()=>null);
                if (!appealsChannel) { await interaction.reply({ content: '❌ Appeals channel not found.', ephemeral: true }); return; }

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
                await interaction.reply({ content: '✅ Your appeal has been submitted! Admins will review it shortly.', ephemeral: true });
            } catch(e) {
                await interaction.reply({ content: '❌ Failed to submit appeal.', ephemeral: true });
            }
            return;
        }
    }

    // ── BUTTONS ────────────────────────────────────────────
    if (interaction.isButton()) {
        const cid = interaction.customId;

        // Appeal button (opens modal)
        if (cid.startsWith('open_appeal_')) {
            const exiledUserId = cid.replace('open_appeal_', '');
            const modal = new ModalBuilder()
                .setCustomId(`appeal_modal_${exiledUserId}`)
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
            await interaction.showModal(modal);
            return;
        }

        // Accept appeal
        if (cid.startsWith('appeal_accept_')) {
            const appealId = cid.replace('appeal_accept_', '');
            const appeal   = data.appeals[appealId];
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', ephemeral: true }); return; }
            if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot accept your own appeal.', ephemeral: true }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', ephemeral: true }); return; }

            appeal.status    = 'accepted';
            appeal.handledBy = interaction.user.id;
            saveData(data);

            const member = await interaction.guild.members.fetch(appeal.userId).catch(()=>null);
            if (member) {
                const fd = loadData();
                await performUnexile(member, interaction.guild, fd);
                delete fd.exiles[appeal.userId];
                saveData(fd);
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
            if (!appeal) { await interaction.reply({ content: '❌ Appeal not found.', ephemeral: true }); return; }
            if (appeal.userId === interaction.user.id) { await interaction.reply({ content: '❌ You cannot reject your own appeal.', ephemeral: true }); return; }
            if (appeal.status !== 'pending') { await interaction.reply({ content: '⚠️ This appeal has already been handled.', ephemeral: true }); return; }

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

    // ── SLASH COMMANDS ─────────────────────────────────────
    if (!interaction.isChatInputCommand()) return;
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isMod   = interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages);

    async function handleCategoryImmunity(category) {
        if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
        const c = getCategoryImmunity(guildId, data, category);

        const group = interaction.options.getSubcommandGroup(false);
        if (group) {
            const sub = interaction.options.getSubcommand();

            if (group === 'role') {
                if (sub === 'list') {
                    const list = c.roles.map(rid => interaction.guild.roles.cache.get(rid) ? `<@&${rid}>` : `Unknown (${rid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** role immunity list (${c.roles.length}):\n${list.join('\n') || 'None'}`, ephemeral: true });
                    return;
                }
                const role = interaction.options.getRole('role');
                if (!role) { await interaction.reply({ content: '❌ Provide a role.', ephemeral: true }); return; }
                if (sub === 'add') {
                    if (!c.roles.includes(role.id)) c.roles.push(role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added role immunity for **${category}**: ${role}`, ephemeral: true });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Role add: ${role} (${role.id})`,
                    ]);
                    return;
                }
                if (sub === 'remove') {
                    c.roles = c.roles.filter(x => x !== role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed role immunity for **${category}**: ${role}`, ephemeral: true });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Role remove: ${role} (${role.id})`,
                    ]);
                    return;
                }
                await interaction.reply({ content: '❌ Invalid subcommand.', ephemeral: true });
                return;
            }

            if (group === 'member') {
                if (sub === 'list') {
                    const list = c.members.map(uid => `<@${uid}> (${uid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** member immunity list (${c.members.length}):\n${list.join('\n') || 'None'}`, ephemeral: true });
                    return;
                }
                const member = interaction.options.getUser('member');
                if (!member) { await interaction.reply({ content: '❌ Provide a member.', ephemeral: true }); return; }
                if (sub === 'add') {
                    if (!c.members.includes(member.id)) c.members.push(member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added member immunity for **${category}**: <@${member.id}>`, ephemeral: true });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Member add: <@${member.id}> (${member.id})`,
                    ]);
                    return;
                }
                if (sub === 'remove') {
                    c.members = c.members.filter(x => x !== member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed member immunity for **${category}**: <@${member.id}>`, ephemeral: true });
                    await sendConfigLog(interaction.guild, data, interaction.user.id, '🛡️ Immunity Updated', [
                        `Category: **${category}**`,
                        `Member remove: <@${member.id}> (${member.id})`,
                    ]);
                    return;
                }
                await interaction.reply({ content: '❌ Invalid subcommand.', ephemeral: true });
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
                    await interaction.reply({ content: `✅ **${category}** role immunity list (${c.roles.length}):\n${list.join('\n') || 'None'}`, ephemeral: true });
                    return;
                }
                if (!role) { await interaction.reply({ content: '❌ Provide a role.', ephemeral: true }); return; }
                if (legacyMode === 'add') {
                    if (!c.roles.includes(role.id)) c.roles.push(role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added role immunity for **${category}**: ${role}`, ephemeral: true });
                    return;
                }
                if (legacyMode === 'remove') {
                    c.roles = c.roles.filter(x => x !== role.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed role immunity for **${category}**: ${role}`, ephemeral: true });
                    return;
                }
            }
            if (legacySub === 'member') {
                const member = interaction.options.getUser('member');
                if (legacyMode === 'list') {
                    const list = c.members.map(uid => `<@${uid}> (${uid})`).slice(0, 60);
                    await interaction.reply({ content: `✅ **${category}** member immunity list (${c.members.length}):\n${list.join('\n') || 'None'}`, ephemeral: true });
                    return;
                }
                if (!member) { await interaction.reply({ content: '❌ Provide a member.', ephemeral: true }); return; }
                if (legacyMode === 'add') {
                    if (!c.members.includes(member.id)) c.members.push(member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Added member immunity for **${category}**: <@${member.id}>`, ephemeral: true });
                    return;
                }
                if (legacyMode === 'remove') {
                    c.members = c.members.filter(x => x !== member.id);
                    saveData(data);
                    await interaction.reply({ content: `✅ Removed member immunity for **${category}**: <@${member.id}>`, ephemeral: true });
                    return;
                }
            }
        }

        await interaction.reply({ content: '❌ Invalid immunity command usage.', ephemeral: true });
    }

    switch (interaction.commandName) {

        // ── /setup & /changesetup ─────────────────────────
        case 'setup':
        case 'changesetup': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const modal = new ModalBuilder()
                .setCustomId('setup_modal')
                .setTitle('🔧 SKYNET V7 Setup');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('trade_channel_id').setLabel('Trade Channel ID')
                        .setStyle(TextInputStyle.Short).setRequired(true)
                        .setValue(gs.tradeChannelId || '').setPlaceholder('Paste the channel ID for #trades')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('services_channel_id').setLabel('Services Channel ID')
                        .setStyle(TextInputStyle.Short).setRequired(true)
                        .setValue(gs.servicesChannelId || '').setPlaceholder('Paste the channel ID for #services')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('exile_role_id').setLabel('Exile Role ID')
                        .setStyle(TextInputStyle.Short).setRequired(true)
                        .setValue(gs.exiledRoleId || '').setPlaceholder('Paste the exile role ID')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('log_channel_id').setLabel('Log Channel ID (optional)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(gs.logChannelId || '').setPlaceholder('Paste the log channel ID')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('appeals_channel_id').setLabel('Appeals Channel ID (optional)')
                        .setStyle(TextInputStyle.Short).setRequired(false)
                        .setValue(gs.appealsChannelId || '').setPlaceholder('Paste the appeals channel ID')
                ),
            );
            await interaction.showModal(modal);
            break;
        }

        // ── /set subcommands ──────────────────────────────
        case 'set': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
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
                await interaction.reply({ content: '❌ Provide a channel or a valid channel ID.', ephemeral: true });
                return;
            }

            if (sub === 'tradechannel')    { gs.tradeChannelId    = resolvedCh.id; }
            if (sub === 'serviceschannel') { gs.servicesChannelId = resolvedCh.id; }
            if (sub === 'logchannel')      { gs.logChannelId      = interaction.options.getChannel('channel').id; }
            if (sub === 'exilerole')       { gs.exiledRoleId      = interaction.options.getRole('role').id; }
            if (sub === 'appealschannel')  { gs.appealsChannelId  = interaction.options.getChannel('channel').id; }
            if (sub === 'commandchannel')  { gs.gamesHubId        = resolvedCh.id; }
            saveData(data);
            await interaction.reply({ content: `✅ **${sub}** updated successfully.`, ephemeral: true });
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
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const sub = interaction.options.getSubcommand();
            const beforeTrade = gs.tradeChannelId;
            const beforeServices = gs.servicesChannelId;
            const beforeCommand = gs.gamesHubId;
            if (sub === 'tradechannel')    gs.tradeChannelId    = DEFAULT_TARGET_CHANNEL_ID;
            if (sub === 'serviceschannel') gs.servicesChannelId = DEFAULT_SERVICES_CHANNEL_ID;
            if (sub === 'commandchannel')  gs.gamesHubId        = DEFAULT_GAMES_HUB_ID;
            saveData(data);
            await interaction.reply({ content: `✅ **${sub}** cleared (reverted to default).`, ephemeral: true });
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
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            if (interaction.options.getSubcommand() === 'create') {
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
                    await interaction.reply({ content: `✅ Exile channel created: <#${ch.id}>`, ephemeral: true });
                } catch(e) {
                    await interaction.reply({ content: `❌ Failed to create exile channel: ${e.message}`, ephemeral: true });
                }
            }
            break;
        }

        // ── /exilerole create ─────────────────────────────
        case 'exilerole': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            if (interaction.options.getSubcommand() === 'create') {
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
                    await interaction.reply({ content: `✅ Exile role created: <@&${role.id}>\nIt has been denied from all text channels.`, ephemeral: true });
                } catch(e) {
                    await interaction.reply({ content: `❌ Failed to create exile role: ${e.message}`, ephemeral: true });
                }
            }
            break;
        }

        // ── Immunity ──────────────────────────────────────
        case 'enableimmunity':  { if(!isAdmin){await interaction.reply({content:'❌ Admins only.',ephemeral:true});return;} imm.enabled=true; saveData(data); await interaction.reply({ content: '✅ **Staff immunity ENABLED.** Admins/mods are now immune from scanning.', ephemeral: true }); break; }
        case 'disableimmunity': { if(!isAdmin){await interaction.reply({content:'❌ Admins only.',ephemeral:true});return;} imm.enabled=false; saveData(data); await interaction.reply({ content: '⚠️ **Staff immunity DISABLED.** Everyone is scanned, including staff.', ephemeral: true }); break; }
        case 'addimmunity': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const role = interaction.options.getRole('role');
            if (!imm.whitelistedRoles.includes(role.id)) { imm.whitelistedRoles.push(role.id); saveData(data); }
            await interaction.reply({ content: `✅ Role **${role.name}** added to immunity whitelist.`, ephemeral: true });
            break;
        }
        case 'removeimmunity': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const role = interaction.options.getRole('role');
            imm.whitelistedRoles = imm.whitelistedRoles.filter(id => id !== role.id);
            saveData(data);
            await interaction.reply({ content: `✅ Role **${role.name}** removed from immunity whitelist.`, ephemeral: true });
            break;
        }
        case 'immunestatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const roleNames = imm.whitelistedRoles.map(rid => { const r = interaction.guild.roles.cache.get(rid); return r ? `<@&${rid}>` : `Unknown (${rid})`; });
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🛡️ Immunity Settings')
                .setColor(imm.enabled ? 0x00FF88 : 0xFF4444)
                .addFields(
                    { name: 'Immunity Status', value: imm.enabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                    { name: 'Whitelisted Roles', value: roleNames.length ? roleNames.join('\n') : 'None', inline: false },
                )], ephemeral: true });
            break;
        }

        case 'aienable': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            gs.aiEnabled = true;
            saveData(data);
            await interaction.reply({ content: '✅ AI detection is now **ENABLED** for this server.', ephemeral: true });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🤖 AI Enabled', [
                `AI detection: **ON**`,
            ]);
            break;
        }

        case 'aidisable': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            gs.aiEnabled = false;
            saveData(data);
            await interaction.reply({ content: '⚠️ AI detection is now **DISABLED** for this server.', ephemeral: true });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🤖 AI Disabled', [
                `AI detection: **OFF**`,
            ]);
            break;
        }

        case 'disablecheck': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            gs.checksEnabled = false;
            saveData(data);
            await interaction.reply({ content: '🛑 All moderation checks are now **DISABLED** for this server.', ephemeral: true });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🛑 Checks Disabled', [
                `Checks: **OFF**`,
            ]);
            break;
        }

        case 'enablecheck': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            gs.checksEnabled = true;
            saveData(data);
            await interaction.reply({ content: '✅ All moderation checks are now **ENABLED** for this server.', ephemeral: true });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '✅ Checks Enabled', [
                `Checks: **ON**`,
            ]);
            break;
        }

        case 'noaffiliation':
        case 'noaffliation': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const sub = interaction.options.getSubcommand();
            const before = gs.noAffiliationEnabled;
            gs.noAffiliationEnabled = (sub === 'enable');
            saveData(data);
            await interaction.reply({ content: `✅ No-affiliation mode is now **${gs.noAffiliationEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            await sendConfigLog(interaction.guild, data, interaction.user.id, '🏷️ No-Affiliation Mode', [
                `No-affiliation: **${before ? 'ON' : 'OFF'}** -> **${gs.noAffiliationEnabled ? 'ON' : 'OFF'}**`,
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

        // ── /exile ────────────────────────────────────────
        case 'exile': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const targetUser = interaction.options.getUser('user');
            const duration   = interaction.options.getInteger('duration') || EXILE_DURATION_MINS;
            const reason     = interaction.options.getString('reason') || 'Admin action';
            const target     = await interaction.guild.members.fetch(targetUser.id).catch(()=>null);
            if (!target) { await interaction.reply({ content: '❌ Member not found.', ephemeral: true }); return; }
            if (target.id === interaction.user.id) { await interaction.reply({ content: '❌ You cannot exile yourself.', ephemeral: true }); return; }
            if (target.roles.highest.position >= interaction.member.roles.highest.position) { await interaction.reply({ content: '❌ You cannot exile someone with equal or higher roles.', ephemeral: true }); return; }
            await performExile(target, interaction.guild, duration, reason, data);
            saveData(data);
            await interaction.reply({ content: `🔨 Exiled **${target.user.tag}** for **${duration}m**. Reason: ${reason}`, ephemeral: false });
            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('⛓️ Manual Exile')
                .setColor(0xFF6600)
                .addFields(
                    { name: 'User',   value: `<@${target.id}> (${target.id})`, inline: true },
                    { name: 'By',     value: `<@${interaction.user.id}>`,       inline: true },
                    { name: 'Reason', value: reason,                            inline: false },
                    { name: 'Duration', value: `${duration} minutes`,           inline: true },
                ).setTimestamp());
            break;
        }

        // ── /unexile ──────────────────────────────────────
        case 'unexile': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const input  = interaction.options.getString('user');
            const userId = (input.match(/<@!?(\d+)>/) || input.match(/^(\d{15,20})$/) || [])[1] || input;
            const fd     = loadData();
            let member   = interaction.guild.members.cache.get(userId) || await interaction.guild.members.fetch(userId).catch(()=>null);
            if (!member) { await interaction.reply({ content: '❌ Member not found.', ephemeral: true }); return; }
            await performUnexile(member, interaction.guild, fd);
            delete fd.exiles[userId];
            saveData(fd);
            await interaction.reply({ content: `✅ Unexiled **${member.user.tag}**.`, ephemeral: false });
            await sendLog(interaction.guild, fd, new EmbedBuilder()
                .setTitle('🔓 Manual Unexile')
                .setColor(0x00FF88)
                .addFields(
                    { name: 'User', value: `<@${userId}>`, inline: true },
                    { name: 'By',   value: `<@${interaction.user.id}>`, inline: true },
                ).setTimestamp());
            break;
        }

        // ── /violations ───────────────────────────────────
        case 'violations': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const user  = interaction.options.getUser('user');
            const count = data.violations[user.id] || 0;
            const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('📊 Violation Count')
                .setColor(count >= threshold ? 0xFF4444 : 0xFFAA00)
                .setDescription(`<@${user.id}> has **${count}/${threshold}** violations.`)
                .setThumbnail(user.displayAvatarURL())], ephemeral: true });
            break;
        }

        // ── /clearviolations ──────────────────────────────
        case 'clearviolations': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const user = interaction.options.getUser('user');
            data.violations[user.id] = 0;
            saveData(data);
            await interaction.reply({ content: `✅ Cleared violations for <@${user.id}>.`, ephemeral: true });
            break;
        }

        // ── /exilelist ────────────────────────────────────
        case 'exilelist': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const now   = Date.now()/1000;
            const lines = Object.entries(data.exiles).map(([uid, info]) =>
                `• <@${uid}> — expires <t:${Math.floor(info.expiry)}:R>`
            );
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('📋 Currently Exiled')
                .setColor(0xFF4400)
                .setDescription(lines.length ? lines.join('\n') : 'Nobody is currently exiled.')], ephemeral: true });
            break;
        }

        // ── /botstatus ────────────────────────────────────
        case 'botstatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const totalExiled     = Object.keys(data.exiles).length;
            const totalViolations = Object.values(data.violations).reduce((a,b)=>a+b,0);
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🤖 SKYNET V7 — Status')
                .setColor(0x5865F2)
                .addFields(
                    { name: '🧠 Checks',          value: gs.checksEnabled ? '✅ ON' : '🛑 OFF',       inline: true },
                    { name: '📡 Trade Channel',    value: `<#${gs.tradeChannelId}>`,              inline: true },
                    { name: '⚔️ Services Channel', value: `<#${gs.servicesChannelId}>`,           inline: true },
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
                .setTimestamp()], ephemeral: true });
            break;
        }

        case 'warn': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'Manual warn';
            const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
            const exileMins = Math.max(1, Math.min(1440, gs.exileDurationMins || EXILE_DURATION_MINS));
            data.violations[user.id] = (data.violations[user.id] || 0) + 1;
            const count = data.violations[user.id];
            saveData(data);
            await sendLog(interaction.guild, data, new EmbedBuilder()
                .setTitle('⚠️ Manual Warn')
                .setColor(0xFFAA00)
                .addFields(
                    { name: 'User', value: `<@${user.id}> (${user.id})`, inline: true },
                    { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Violations', value: `${count}/${threshold}`, inline: true },
                    { name: 'Reason', value: reason.slice(0, 1024), inline: false },
                ).setTimestamp());
            await interaction.reply({ content: `✅ Warned <@${user.id}>. Violations: **${count}/${threshold}**`, ephemeral: false });
            if (count >= threshold) {
                data.violations[user.id] = 0;
                saveData(data);
                const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
                if (member) await performExile(member, interaction.guild, exileMins, `Manual warn threshold reached: ${reason}`, data);
                saveData(data);
            }
            break;
        }

        case 'unwarn': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'Manual unwarn';
            const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
            const cur = data.violations[user.id] || 0;
            const next = Math.max(0, cur - 1);
            data.violations[user.id] = next;
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
            await interaction.reply({ content: `✅ Unwarned <@${user.id}>. Violations: **${next}/${threshold}**`, ephemeral: false });
            break;
        }

        case 'purge': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const count = Math.max(1, Math.min(100, interaction.options.getInteger('count')));
            if (!interaction.channel || !interaction.channel.isTextBased()) { await interaction.reply({ content: '❌ Invalid channel.', ephemeral: true }); return; }
            try {
                const deleted = await interaction.channel.bulkDelete(count, true).catch(()=>null);
                await interaction.reply({ content: `✅ Purged ${deleted ? deleted.size : 0} messages.`, ephemeral: true });
            } catch(e) {
                await interaction.reply({ content: `❌ Purge failed: ${e.message}`, ephemeral: true });
            }
            break;
        }

        case 'lock': {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageChannels) && !isAdmin) { await interaction.reply({ content: '❌ Missing permission: Manage Channels.', ephemeral: true }); return; }
            const reason = interaction.options.getString('reason') || 'Channel locked';
            const ch = interaction.channel;
            try {
                await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false }, { reason });
                await interaction.reply({ content: `🔒 Locked <#${ch.id}>.`, ephemeral: false });
            } catch(e) {
                await interaction.reply({ content: `❌ Lock failed: ${e.message}`, ephemeral: true });
            }
            break;
        }

        case 'unlock': {
            if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageChannels) && !isAdmin) { await interaction.reply({ content: '❌ Missing permission: Manage Channels.', ephemeral: true }); return; }
            const reason = interaction.options.getString('reason') || 'Channel unlocked';
            const ch = interaction.channel;
            try {
                await ch.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null }, { reason });
                await interaction.reply({ content: `🔓 Unlocked <#${ch.id}>.`, ephemeral: false });
            } catch(e) {
                await interaction.reply({ content: `❌ Unlock failed: ${e.message}`, ephemeral: true });
            }
            break;
        }

        case 'setgameshub': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const ch = interaction.options.getChannel('channel');
            gs.gamesHubId = ch.id;
            saveData(data);
            await interaction.reply({ content: `✅ Games Hub set to <#${ch.id}>.`, ephemeral: true });
            break;
        }

        case 'setthreshold': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const v = Math.max(1, Math.min(10, interaction.options.getInteger('count')));
            gs.violationThreshold = v;
            saveData(data);
            await interaction.reply({ content: `✅ Violation threshold set to **${v}**.`, ephemeral: true });
            break;
        }

        case 'setexileduration': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const mins = Math.max(1, Math.min(1440, interaction.options.getInteger('minutes')));
            gs.exileDurationMins = mins;
            saveData(data);
            await interaction.reply({ content: `✅ Default exile duration set to **${mins} minutes**.`, ephemeral: true });
            break;
        }

        case 'togglescam': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.scamEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Scam/Exploit detection is now **${gs.scamEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'commandredirect': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🧭 Command redirect is currently **${gs.commandRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.commandRedirectEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Command redirect is now **${gs.commandRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'serviceredirect': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `⚔️ Service redirect is currently **${gs.serviceRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.serviceRedirectEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Service redirect is now **${gs.serviceRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'traderedirect': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🔄 Trade redirect is currently **${gs.tradeRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.tradeRedirectEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Trade redirect is now **${gs.tradeRedirectEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'spamwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `⚠️ Spam warnings are currently **${gs.spamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.spamWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Spam warnings are now **${gs.spamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'begwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🚫 Begging warnings are currently **${gs.begWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.begWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Begging warnings are now **${gs.begWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'scamwarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🚨 Scam warnings are currently **${gs.scamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.scamWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Scam warnings are now **${gs.scamWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'acctradewarn': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            if (enabled === null) {
                await interaction.reply({ content: `🚫 Account trading warnings are currently **${gs.accTradeWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
                break;
            }
            gs.accTradeWarnEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Account trading warnings are now **${gs.accTradeWarnEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'raidmode': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.raidModeEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Raid mode is now **${gs.raidModeEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'raidstatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
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
                ).setTimestamp()], ephemeral: true });
            break;
        }

        case 'linkpolicy': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.linkPolicyEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Link policy is now **${gs.linkPolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'allowdomain': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const dom = normalizeDomain(interaction.options.getString('domain'));
            if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', ephemeral: true }); return; }
            gs.linkAllowlistedDomains = Array.isArray(gs.linkAllowlistedDomains) ? gs.linkAllowlistedDomains : [];
            if (!gs.linkAllowlistedDomains.includes(dom)) gs.linkAllowlistedDomains.push(dom);
            saveData(data);
            await interaction.reply({ content: `✅ Allowlisted: **${dom}**`, ephemeral: true });
            break;
        }

        case 'denydomain': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const dom = normalizeDomain(interaction.options.getString('domain'));
            if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', ephemeral: true }); return; }
            gs.linkDenylistedDomains = Array.isArray(gs.linkDenylistedDomains) ? gs.linkDenylistedDomains : [];
            if (!gs.linkDenylistedDomains.includes(dom)) gs.linkDenylistedDomains.push(dom);
            saveData(data);
            await interaction.reply({ content: `✅ Denylisted: **${dom}**`, ephemeral: true });
            break;
        }

        case 'listdomains': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
            const allow = (gs.linkAllowlistedDomains || []).slice(0, 60);
            const deny  = (gs.linkDenylistedDomains || []).slice(0, 60);
            await interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle('🔗 Link Policy Domains')
                .setColor(gs.linkPolicyEnabled ? 0x00FF88 : 0xFF4444)
                .addFields(
                    { name: 'Policy', value: gs.linkPolicyEnabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                    { name: 'Allowlist (first 60)', value: allow.length ? allow.join('\n').slice(0, 1024) : 'None', inline: false },
                    { name: 'Denylist (first 60)',  value: deny.length  ? deny.join('\n').slice(0, 1024)  : 'None', inline: false },
                ).setTimestamp()], ephemeral: true });
            break;
        }

        case 'mentionlimit': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const limit = Math.max(1, Math.min(30, interaction.options.getInteger('limit')));
            const windowSec = Math.max(3, Math.min(60, interaction.options.getInteger('window') || gs.mentionSpamWindowSec || 12));
            const unique = Math.max(1, Math.min(30, interaction.options.getInteger('unique') || gs.mentionSpamUniqueLimit || 5));
            gs.mentionSpamLimit = limit;
            gs.mentionSpamWindowSec = windowSec;
            gs.mentionSpamUniqueLimit = unique;
            saveData(data);
            await interaction.reply({ content: `✅ Mention spam limits updated: total=${limit}, unique=${unique}, window=${windowSec}s`, ephemeral: true });
            break;
        }

        case 'togglescanedits': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.scanEditsEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Scan edits is now **${gs.scanEditsEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'automodstats': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
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
                ).setTimestamp()], ephemeral: true });
            break;
        }

        case 'raidconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
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
            await interaction.reply({ content: `✅ Raid config updated. window=${gs.raidJoinWindowSec}s threshold=${gs.raidJoinThreshold} lockdown=${gs.raidLockdownMins}m lockChannels=${gs.raidLockChannels} blockLinks=${gs.raidLinkBlockAll} newAcctDays=${gs.raidNewAccountDays}`, ephemeral: true });
            break;
        }

        case 'unlockdown': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const unlockChannels = interaction.options.getBoolean('unlockchannels');
            const e = joinSpikeTracker.get(guildId);
            if (e) { e.lockedUntil = 0; joinSpikeTracker.set(guildId, e); }
            if (unlockChannels) await unlockGuildTextChannels(interaction.guild, gs);
            await interaction.reply({ content: `✅ Raid lockdown disabled.${unlockChannels ? ' Channels unlocked.' : ''}`, ephemeral: true });
            break;
        }

        case 'linkstatus': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
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
                ).setTimestamp()], ephemeral: true });
            break;
        }

        case 'domainremove': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const list = (interaction.options.getString('list') || '').toLowerCase();
            const dom = normalizeDomain(interaction.options.getString('domain'));
            if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) { await interaction.reply({ content: '❌ Invalid domain.', ephemeral: true }); return; }
            if (list !== 'allow' && list !== 'deny') { await interaction.reply({ content: '❌ list must be allow or deny.', ephemeral: true }); return; }
            if (list === 'allow') {
                gs.linkAllowlistedDomains = (gs.linkAllowlistedDomains || []).filter(x => normalizeDomain(x) !== dom);
            }
            if (list === 'deny') {
                gs.linkDenylistedDomains = (gs.linkDenylistedDomains || []).filter(x => normalizeDomain(x) !== dom);
            }
            saveData(data);
            await interaction.reply({ content: `✅ Removed **${dom}** from **${list}** list.`, ephemeral: true });
            break;
        }

        case 'capsconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const percent = interaction.options.getInteger('percent');
            const minletters = interaction.options.getInteger('minletters');
            const maxrun = interaction.options.getInteger('maxrun');
            if (enabled !== null) gs.capsSpamEnabled = !!enabled;
            if (percent !== null) gs.capsMaxPercent = Math.max(30, Math.min(100, percent));
            if (minletters !== null) gs.capsMinLetters = Math.max(8, Math.min(80, minletters));
            if (maxrun !== null) gs.capsMaxRun = Math.max(10, Math.min(120, maxrun));
            saveData(data);
            await interaction.reply({ content: `✅ Caps config: enabled=${gs.capsSpamEnabled} percent=${gs.capsMaxPercent} minLetters=${gs.capsMinLetters} maxRun=${gs.capsMaxRun}`, ephemeral: true });
            break;
        }

        case 'emojiconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const max = interaction.options.getInteger('max');
            const windowSec = interaction.options.getInteger('window');
            if (enabled !== null) gs.emojiSpamEnabled = !!enabled;
            if (max !== null) gs.emojiMaxCount = Math.max(5, Math.min(60, max));
            if (windowSec !== null) gs.emojiWindowSec = Math.max(3, Math.min(60, windowSec));
            saveData(data);
            await interaction.reply({ content: `✅ Emoji config: enabled=${gs.emojiSpamEnabled} max=${gs.emojiMaxCount} window=${gs.emojiWindowSec}s`, ephemeral: true });
            break;
        }

        case 'zalgoconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const maxmarks = interaction.options.getInteger('maxmarks');
            if (enabled !== null) gs.zalgoEnabled = !!enabled;
            if (maxmarks !== null) gs.zalgoMaxCombining = Math.max(4, Math.min(80, maxmarks));
            saveData(data);
            await interaction.reply({ content: `✅ Zalgo config: enabled=${gs.zalgoEnabled} maxMarks=${gs.zalgoMaxCombining}`, ephemeral: true });
            break;
        }

        case 'invitepolicy': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.invitePolicyEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Invite policy is now **${gs.invitePolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'invitechannel': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const mode = (interaction.options.getString('mode') || '').toLowerCase();
            const ch = interaction.options.getChannel('channel');
            gs.inviteAllowedChannelIds = Array.isArray(gs.inviteAllowedChannelIds) ? gs.inviteAllowedChannelIds : [];
            if (mode === 'list') {
                const names = [];
                for (const id of gs.inviteAllowedChannelIds.slice(0, 40)) {
                    const c = await interaction.guild.channels.fetch(id).catch(()=>null);
                    names.push(c ? `<#${id}>` : id);
                }
                await interaction.reply({ content: `✅ Allowed invite channels (${gs.inviteAllowedChannelIds.length}):\n${names.join('\n') || 'None'}`, ephemeral: true });
                break;
            }
            if (!ch) { await interaction.reply({ content: '❌ Provide a channel.', ephemeral: true }); return; }
            if (mode === 'add') {
                if (!gs.inviteAllowedChannelIds.includes(ch.id)) gs.inviteAllowedChannelIds.push(ch.id);
                saveData(data);
                await interaction.reply({ content: `✅ Added allowed invite channel: <#${ch.id}>`, ephemeral: true });
                break;
            }
            if (mode === 'remove') {
                gs.inviteAllowedChannelIds = gs.inviteAllowedChannelIds.filter(x => x !== ch.id);
                saveData(data);
                await interaction.reply({ content: `✅ Removed allowed invite channel: <#${ch.id}>`, ephemeral: true });
                break;
            }
            await interaction.reply({ content: '❌ mode must be add/remove/list.', ephemeral: true });
            break;
        }

        case 'attachmentpolicy': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            gs.attachmentPolicyEnabled = !!enabled;
            saveData(data);
            await interaction.reply({ content: `✅ Attachment policy is now **${gs.attachmentPolicyEnabled ? 'ENABLED' : 'DISABLED'}**.`, ephemeral: true });
            break;
        }

        case 'attachmentext': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const mode = (interaction.options.getString('mode') || '').toLowerCase();
            const extRaw = (interaction.options.getString('ext') || '').toLowerCase().replace(/^\./,'').trim();
            gs.attachmentBlockExts = Array.isArray(gs.attachmentBlockExts) ? gs.attachmentBlockExts : [];
            if (mode === 'list') {
                const list = gs.attachmentBlockExts.slice(0, 120).map(x => '.'+String(x));
                await interaction.reply({ content: `✅ Blocked extensions (${gs.attachmentBlockExts.length}):\n${list.join(', ') || 'None'}`, ephemeral: true });
                break;
            }
            if (!extRaw || !/^[a-z0-9]{1,8}$/.test(extRaw)) { await interaction.reply({ content: '❌ Invalid ext. Example: exe', ephemeral: true }); return; }
            if (mode === 'add') {
                if (!gs.attachmentBlockExts.includes(extRaw)) gs.attachmentBlockExts.push(extRaw);
                saveData(data);
                await interaction.reply({ content: `✅ Added blocked ext: .${extRaw}`, ephemeral: true });
                break;
            }
            if (mode === 'remove') {
                gs.attachmentBlockExts = gs.attachmentBlockExts.filter(x => String(x).toLowerCase() !== extRaw);
                saveData(data);
                await interaction.reply({ content: `✅ Removed blocked ext: .${extRaw}`, ephemeral: true });
                break;
            }
            await interaction.reply({ content: '❌ mode must be add/remove/list.', ephemeral: true });
            break;
        }

        case 'stretchconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const maxChar = interaction.options.getInteger('maxcharrun');
            const maxPunc = interaction.options.getInteger('maxpunctrun');
            const maxWord = interaction.options.getInteger('maxwordrepeat');
            if (enabled !== null) gs.stretchSpamEnabled = !!enabled;
            if (maxChar !== null) gs.stretchMaxCharRun = Math.max(6, Math.min(40, maxChar));
            if (maxPunc !== null) gs.stretchMaxPunctRun = Math.max(6, Math.min(40, maxPunc));
            if (maxWord !== null) gs.stretchMaxWordRepeat = Math.max(3, Math.min(20, maxWord));
            saveData(data);
            await interaction.reply({ content: `✅ Stretch config: enabled=${gs.stretchSpamEnabled} maxCharRun=${gs.stretchMaxCharRun} maxPunctRun=${gs.stretchMaxPunctRun} maxWordRepeat=${gs.stretchMaxWordRepeat}`, ephemeral: true });
            break;
        }

        case 'dupeconfig': {
            if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
            const enabled = interaction.options.getBoolean('enabled');
            const windowSec = interaction.options.getInteger('window');
            const threshold = interaction.options.getInteger('threshold');
            const minlen = interaction.options.getInteger('minlen');
            if (enabled !== null) gs.dupeSpamEnabled = !!enabled;
            if (windowSec !== null) gs.dupeWindowSec = Math.max(5, Math.min(120, windowSec));
            if (threshold !== null) gs.dupeThreshold = Math.max(2, Math.min(20, threshold));
            if (minlen !== null) gs.dupeMinLen = Math.max(5, Math.min(200, minlen));
            saveData(data);
            await interaction.reply({ content: `✅ Dupe config: enabled=${gs.dupeSpamEnabled} window=${gs.dupeWindowSec}s threshold=${gs.dupeThreshold} minLen=${gs.dupeMinLen}`, ephemeral: true });
            break;
        }

        // ── /testscan ─────────────────────────────────────
        case 'testscan': {
            if (!isMod && !isAdmin) { await interaction.reply({ content: '❌ Mods only.', ephemeral: true }); return; }
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

                )], ephemeral: true });
            break;
        }
    }
});

// ══════════════════════════════════════════════════════════
//  MESSAGE HANDLER
// ══════════════════════════════════════════════════════════
const CMD_PREFIX_RE = /^[^a-zA-Z0-9\s@]/;
function isMessageCommand(msg) {
    const c = msg.content;
    if (!c) return false;
    const t = c.trimStart();
    if (msg.type === 20) return true;
    if (t.startsWith('@') || t.startsWith('<@')) return false;
    if (/^:[a-zA-Z0-9_]{2,32}:/.test(t)) return false;
    if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{6,20}>/.test(t)) return false;
    if (/^\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(t)) return false;
    if (/^\p{Regional_Indicator}{2}/u.test(t)) return false;
    if (/^[#*0-9]\uFE0F?\u20E3/u.test(t)) return false;
    if (/^[?!]\s*$/.test(c)) return false;
    if (/^[?!]\s+[a-zA-Z]/.test(c)) return false;
    if (CMD_PREFIX_RE.test(c)) return true;
    return false;
}

const COMMAND_LIKE_PREFIXES = [
    '/', '!', '.', '?', ';', ':', '-', '_', '~', '`', '#', '$', '%', '^', '&', '*', '+', '=', '|', '\\',
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
    if (/^:[a-zA-Z0-9_]{2,32}:/.test(r)) return false;
    const t = cleaned || fullClean(r);
    const ns = t.replace(/[\s_]/g,'');

    for (const p of COMMAND_LIKE_PREFIXES) {
        if (r.toLowerCase().startsWith(p)) return true;
    }

    if (/^\s*\/[a-z0-9]{2,32}/i.test(r)) return true;
    if (/^\s*[!.?]\s*[a-z]{2,32}/i.test(r)) return true;
    if (/^\s*<@!?\d+>\s*[!.?/]/i.test(r)) return true;

    for (const ev of COMMAND_EVASION_PATTERNS) {
        const ec = ev.replace(/[\s_]/g,'').toLowerCase();
        if (ec.length >= 6 && ns.includes(ec)) return true;
    }

    for (const n of COMMON_SLASH_COMMAND_NAMES) {
        const nc = n.toLowerCase().replace(/[\s_]/g,'');
        if (nc.length >= 3 && (ns.includes('/'+nc) || ns.includes('／'+nc))) return true;
    }

    for (const w of COMMON_COMMAND_WORDS) {
        const wc = w.toLowerCase().replace(/[\s_]/g,'');
        if (wc.length >= 4 && ns.includes(wc) && (r.includes('/') || r.includes('!') || r.includes('.'))) return true;
    }

    if (/\b(?:type|use|run)\b[\s\W_]{0,8}(?:\!|\/|\.)[a-z0-9]{2,20}/i.test(r)) return true;
    if (/\b(?:prefix|cmd|command|commands)\b/i.test(r) && (r.includes('!') || r.includes('/'))) return true;
    if (/\b(?:bot|autobot|moderation|mod bot)\b/i.test(r) && /\b(?:cmd|command|commands|prefix)\b/i.test(r)) return true;

    return false;
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const data  = loadData();
    const guildId = message.guild.id;
    const gs    = getGuildSettings(guildId, data);
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isMod   = message.member?.permissions.has(PermissionFlagsBits.ManageMessages);
    const isStaff = isAdmin || isMod;
    const immune  = message.member ? isMemberImmune(message.member, guildId, data) : false;
    const immCfg  = getImmunitySettings(guildId, data);

    if (gs.checksEnabled === false) return;

    // ── RAID LOCKDOWN (message-time enforcement) ───────────
    if (gs.raidModeEnabled && isRaidLocked(guildId) && !immune && !isCategoryImmune(message.member, guildId, data, 'raid')) {
        if (message.channel && message.channel.isTextBased && message.channel.isTextBased()) {
            const allow = GAMES_HUB_CHANNELS.has(message.channel.id) || message.channel.id === (gs.logChannelId || '') || message.channel.id === (gs.appealsChannelId || '');
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

    // ── COMMAND LOCKDOWN ──────────────────────────────────
    if ((gs.commandRedirectEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'command') && isMessageCommand(message)) {
        const staffCommandImmune = isStaff && immCfg.enabled;
        if (!staffCommandImmune && !GAMES_HUB_CHANNELS.has(message.channel.id)) {
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

    if ((gs.commandRedirectEnabled !== false) && !immune && !isCategoryImmune(message.member, guildId, data, 'command') && !GAMES_HUB_CHANNELS.has(message.channel.id)) {
        const { contentClean: cmdClean } = prepareText(message.content);
        if (looksLikeCommandButNotCaught(message.content, cmdClean)) {
            const staffCommandImmune = isStaff && immCfg.enabled;
            if (!staffCommandImmune) {
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
        if (m.letters >= minLetters && (m.percent >= maxPct || m.maxRun >= maxRun)) {
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

    // ── IMMUNE SKIP ───────────────────────────────────────
    if (immune) return;

    const { contentClean, contentNospace } = prepareText(message.content);

    // ── AI DETECTION (always-classify) ────────────────────
    if (AI_ENABLED && gs.aiEnabled) {
        const aiResult = await aiDetectViolation(message, [], gs);
        if (aiResult?.violation && aiResult.confidence > 0.85 && aiResult.category && aiResult.category !== 'none') {
            const cat = String(aiResult.category || '').toLowerCase();
            if (!isCategoryImmune(message.member, guildId, data, cat)) {
                incStat(guildId, data, 'aiFlag', 1);

                if (cat === 'spam' && gs.spamWarnEnabled !== false) {
                    await handleSpamViolation(message, `AI: ${aiResult.reason || 'Spam/inappropriate content'}`, data, gs);
                    return;
                }

                if (cat === 'scam' && gs.scamWarnEnabled !== false) {
                    try { await message.delete(); } catch {}
                    incStat(guildId, data, 'scam', 1);
                    await issueViolation(message, data, gs, {
                        title: '🚨 Scam/Exploit Content Detected',
                        color: 0xCC0000,
                        reason: `AI: ${aiResult.reason || 'Suspicious link or scam content.'}`,
                        details: message.content,
                        footerLabel: 'Scam/Exploit',
                        ttlMs: 15000,
                    });
                    return;
                }

                if ((cat === 'acctrade' || cat === 'account') && gs.accTradeWarnEnabled !== false) {
                    await checkAccountTrading(message, contentClean, data, gs);
                    return;
                }

                if (cat === 'beg' && gs.begWarnEnabled !== false) {
                    await checkBegging(message, contentClean, data, gs);
                    return;
                }

                if (cat === 'service' && gs.serviceRedirectEnabled !== false && message.channel.id !== gs.servicesChannelId) {
                    const flagged = await checkServicesViolation(message, contentClean, contentNospace, data, gs);
                    if (flagged) return;
                }

                if (cat === 'trade' && gs.tradeRedirectEnabled !== false && message.channel.id !== gs.tradeChannelId) {
                    const flagged = await checkTradeViolation(message, contentClean, contentNospace, data, gs);
                    if (flagged) return;
                }

                if (cat === 'command' && gs.commandRedirectEnabled !== false) {
                    const hub = gs.gamesHubId || DEFAULT_GAMES_HUB_ID;
                    if (hub && message.channel.id !== hub && !GAMES_HUB_CHANNELS.has(message.channel.id)) {
                        try { await message.delete(); } catch {}
                        await issueViolation(message, data, gs, {
                            title: '⚠️ Command Usage Violation',
                            color: 0xFF3344,
                            reason: `AI: ${aiResult.reason || 'Use commands only in Games Hub.'}`,
                            details: message.content,
                            redirectChannelId: hub,
                            footerLabel: 'Command Usage',
                            ttlMs: 10000,
                        });
                        return;
                    }
                }
            }
        }
    }

    // ── SPAM DETECTION ────────────────────────────────────
    if (gs.spamWarnEnabled !== false && !isCategoryImmune(message.member, guildId, data, 'spam')) {
        const spamResult = checkSpam(message.author.id, message.content);
        if (spamResult.spam) {
            await handleSpamViolation(message, spamResult.reason, data, gs);
            return;
        }
    }

    // ── ACCOUNT TRADING ───────────────────────────────────
    const scam = gs.scamEnabled ? detectScamOrExploit(contentClean, message.content) : { hit: false };
    if ((gs.scamWarnEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'scam') && scam?.hit) {
        try { await message.delete(); } catch {}
        incStat(guildId, data, 'scam', 1);
        await issueViolation(message, data, gs, {
            title: '🚨 Scam/Exploit Content Detected',
            color: 0xCC0000,
            reason: scam.reason || 'Suspicious link or exploit/scam content.',
            details: message.content,
            footerLabel: 'Scam/Exploit',
            ttlMs: 15000,
        });
        return;
    }
    if ((gs.accTradeWarnEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'acctrade') && detectAccountTrading(contentClean)) {
        await checkAccountTrading(message, contentClean, data, gs);
        return;
    }

    // ── BEGGING ───────────────────────────────────────────
    if ((gs.begWarnEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'beg') && detectBegging(contentClean)) {
        await checkBegging(message, contentClean, data, gs);
        return;
    }

    // ── SERVICES / ITEMS ──────────────────────────────────
    if ((gs.serviceRedirectEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'service') && message.channel.id !== gs.servicesChannelId) {
        const flagged = await checkServicesViolation(message, contentClean, contentNospace, data, gs);
        if (flagged) return;
    }

    // ── TRADE ─────────────────────────────────────────────
    if ((gs.tradeRedirectEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'trade') && message.channel.id !== gs.tradeChannelId) {
        const flagged = await checkTradeViolation(message, contentClean, contentNospace, data, gs);
        if (flagged) return;
    }

    // ── RACE + TIER + INTENT ──────────────────────────────
    if ((gs.serviceRedirectEnabled !== false) && !isCategoryImmune(message.member, guildId, data, 'service') && message.channel.id !== gs.tradeChannelId) {
        await checkRaceViolation(message, contentClean, contentNospace, data, gs);
    }

    // ── AI DETECTION (async, low priority) ───────────────
    if (AI_ENABLED && gs.aiEnabled) {
        setImmediate(async () => {
            const aiResult = await aiDetectViolation(message, [], gs);
            if (aiResult?.violation && aiResult.confidence > 0.9) {
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
    if (res?.exiled) clearSpamHistory(message.author.id);
}

// ══════════════════════════════════════════════════════════
//  ACCOUNT TRADING HANDLER
// ══════════════════════════════════════════════════════════
async function checkAccountTrading(message, contentClean, data, gs) {
    try { await message.delete(); } catch { return; }
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
async function checkServicesViolation(message, contentClean, contentNospace, data, gs) {
    const hasBossRegex   = bossRegex.test(contentClean);
    const hasFruitRaid   = fruitRaidRegex.test(contentClean);
    const hasSvcForRaid  = svcForRaidRegex.test(contentClean);
    const bossesFound    = scanForBosses(contentClean);
    for (const b of BOSSES) { const bc=b.replace(/[\s\-']/g,''); if(bc.length>=4&&contentNospace.includes(bc)&&!bossesFound.includes(b)) bossesFound.push(b); }
    const svcIntent      = scanForServiceIntent(contentClean);
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
    const hasAnyItem     = swordsFound.length||enchantsFound.length||hakiFound.length||
                           stylesFound.length||gunsFound.length||accsFound.length||
                           questsFound.length||seaEvFound.length||
                           painUpgFound.length||lightUpgFound.length;

    let hasFruitAndRaid = fruitsFound.length && /r+[\s\W_]*a+[\s\W_]*i+[\s\W_]*d+s*/i.test(contentClean);

    let flagged = false;
    if (hasSvcForRaid)                                            flagged = true;
    else if (bossesFound.length && svcIntent)                     flagged = true;
    else if ((hasBossRegex||bossesFound.length) && svcIntent)    flagged = true;
    else if (hasFruitRaid || hasFruitAndRaid)                     flagged = true;
    else if (hasAnyItem && svcIntent)                             flagged = true;
    else if (detectTrialsOrTrialsRecruitment(contentClean))        flagged = true;

    if (flagged) {
        try { await message.delete(); } catch { return false; }
        if (gs.noAffiliationEnabled) {
            const serverName = message.guild?.name || 'This server';
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
        await issueViolation(message, data, gs, {
            title: '⚠️ Service Request — Wrong Channel',
            color: 0xFF6600,
            reason: 'Service/boss/raid/item/quest/trials requests go in the services channel.',
            details: message.content,
            redirectChannelId: gs.servicesChannelId,
            footerLabel: 'Service',
            ttlMs: 10000,
        });
        return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  RACE VIOLATION CHECKER
// ══════════════════════════════════════════════════════════
async function checkRaceViolation(message, contentClean, contentNospace, data, gs) {
    if (!scanForServiceIntent(contentClean)) return;
    if (!hasTierKeyword(contentClean)) return;
    const regexHit = raceTierRegex.test(contentClean) || raceTierRegex.test(contentNospace);
    if (!regexHit) return;
    const racesFound = scanForRaces(contentClean);
    for (const r of RACES) { const rc=r.replace(/[\s\-]/g,''); if(rc.length>=4&&contentNospace.includes(rc)&&!racesFound.includes(r)) racesFound.push(r); }
    if (!racesFound.length) return;
    try { await message.delete(); } catch { return; }
    await issueViolation(message, data, gs, {
        title: '⚠️ Race Service — Wrong Channel',
        color: 0x9B59B6,
        reason: 'Race reroll/trials/services go in the services channel.',
        details: message.content,
        redirectChannelId: gs.servicesChannelId,
        footerLabel: 'Race Service',
        ttlMs: 10000,
    });
}

// ══════════════════════════════════════════════════════════
//  TRADE VIOLATION CHECKER
// ══════════════════════════════════════════════════════════
async function checkTradeViolation(message, contentClean, contentNospace, data, gs) {
    const fruitsFound = scanForFruits(contentClean);
    for (const f of FRUITS) { const fc=f.replace(/[\s\-]/g,''); if(contentNospace.includes(fc)&&!fruitsFound.includes(f)) fruitsFound.push(f); }
    let hasIntent = scanForIntent(contentClean);
    if (!hasIntent) {
        for (const kw of INTENT_PHRASE) {
            const kns = kw.replace(/\s/g,'').replace(/-/g,'');
            if (kns.length >= 5 && contentNospace.includes(kns)) { hasIntent = true; break; }
        }
    }
    let isExchange = tradeRegex.test(contentClean);
    if (!isExchange) for (const p of NOSPACE_PATTERNS) if(p.test(contentNospace)){isExchange=true;break;}

    const rawEmojis   = [...message.content.toLowerCase().matchAll(/<a?:[a-zA-Z0-9_]+:\d+>/g)].map(m=>m[0]);
    const fruitEmojis = rawEmojis.filter(e => FRUITS.some(f => e.includes(f.replace(/\s/g,''))));
    const totalItems  = fruitsFound.length + fruitEmojis.length;
    const hasEmojiId  = message.content.toLowerCase().includes(gs.redirectEmojiId || DEFAULT_REDIRECT_EMOJI_ID);

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
    try { await message.delete(); } catch { return; }
    if (gs.noAffiliationEnabled) {
        const serverName = message.guild?.name || 'This server';
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
    await issueViolation(message, data, gs, {
        title: '⚠️ Trade Violation',
        color: 0xFFAA00,
        reason: 'Keep trades in the trades channel.',
        details: message.content,
        redirectChannelId: gs.tradeChannelId,
        footerLabel: 'Trade',
        ttlMs: 10000,
    });
}

// ══════════════════════════════════════════════════════════
//  EXILE / UNEXILE
// ══════════════════════════════════════════════════════════
async function performExile(userOrMember, guild, minutes, reason, data) {
    let member = userOrMember.roles
        ? userOrMember
        : (guild.members.cache.get(userOrMember.id) || await guild.members.fetch(userOrMember.id).catch(()=>null));
    if (!member) return;

    const gs = getGuildSettings(guild.id, data);
    const oldRoleIds = member.roles.cache
        .filter(r => !r.managed && r.id !== guild.id && r.id !== gs.exiledRoleId)
        .map(r => r.id);

    data.exiles[member.id] = {
        old_roles: oldRoleIds,
        expiry:    Date.now()/1000 + minutes*60,
        reason,
    };
    saveData(data);

    const exRole = guild.roles.cache.get(gs.exiledRoleId);
    if (exRole) {
        try { await member.edit({ roles: [exRole], reason }); } catch {}
    }

    try {
        const exileCh = guild.channels.cache.find(c => c && c.type === ChannelType.GuildText && c.name === 'exile-zone');
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
                .setCustomId(`open_appeal_${member.id}`)
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
        .setDescription(`**${member.user.tag}** has landed in exile.`)
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
    const roleIds = data.exiles[uid].old_roles || [];
    const roles   = roleIds.map(rid => guild.roles.cache.get(rid)).filter(Boolean);
    try {
        await member.edit({ roles, reason: 'Exile expired' });
    } catch {
        const exRole = guild.roles.cache.get(gs.exiledRoleId);
        if (exRole && member.roles.cache.has(gs.exiledRoleId)) await member.roles.remove(exRole).catch(()=>{});
    }
    return true;
}

// ══════════════════════════════════════════════════════════
//  PREFIX COMMAND HANDLER (!commands)
// ══════════════════════════════════════════════════════════
async function handlePrefixCommands(message, isAdmin, isMod, data, gs) {
    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/\s+/);
    const cmd  = args.shift().toLowerCase();
    const threshold = Math.max(1, Math.min(10, gs.violationThreshold || VIOLATION_THRESHOLD));
    const exileMins = Math.max(1, Math.min(1440, gs.exileDurationMins || EXILE_DURATION_MINS));

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
        const fd = loadData();
        await performUnexile(target, message.guild, fd);
        delete fd.exiles[target.id];
        saveData(fd);
        await message.channel.send(`✅ Unexiled ${target} (${target.id}).`);
    }

    // !exile [mention | id] [duration] [reason...]
    else if (cmd === 'exile' && isAdmin) {
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
        if (target.id === message.author.id) return message.channel.send('❌ You cannot exile yourself.');
        if (target.roles.highest.position >= message.member.roles.highest.position) return message.channel.send('❌ You cannot exile someone with equal or higher roles.');
        const durArg = args.find((a, i) => i > 0 && /^\d+$/.test(a));
        const duration = parseInt(durArg) || EXILE_DURATION_MINS;
        const reason   = args.filter((a, i) => i > 0 && a !== durArg).join(' ') || 'Manual admin action';
        const fd = loadData();
        await performExile(target, message.guild, duration, reason, fd);
        saveData(fd);
        await message.channel.send(`🔨 Exiled ${target} (${target.id}) for **${duration}m**. Reason: ${reason}`);
    }

    // !violations [mention | id]
    else if (cmd === 'violations' && (isAdmin || isMod)) {
        const target = await resolveMember(args[0]);
        if (!target) return;
        const count = data.violations[target.id] || 0;
        await message.channel.send(`📊 ${target} has **${count}/${threshold}** violations.`);
    }

    // !clearviolations [mention | id]
    else if (cmd === 'clearviolations' && isAdmin) {
        const target = await resolveMember(args[0]);
        if (!target) return;
        data.violations[target.id] = 0;
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
        const reason = args.slice(1).join(' ') || 'Manual warn';
        data.violations[target.id] = (data.violations[target.id] || 0) + 1;
        const count = data.violations[target.id];
        saveData(data);
        await message.channel.send(`✅ Warned ${target}. Violations: **${count}/${threshold}**`);
        if (count >= threshold && isAdmin) {
            data.violations[target.id] = 0;
            saveData(data);
            const fd = loadData();
            await performExile(target, message.guild, exileMins, `Manual warn threshold reached: ${reason}`, fd);
            saveData(fd);
        }
    }

    // !unwarn [mention|id]
    else if (cmd === 'unwarn' && (isAdmin || isMod)) {
        const target = await resolveMember(args[0]);
        if (!target) return message.channel.send('❌ Member not found. Provide a @mention or Discord ID.');
        const cur = data.violations[target.id] || 0;
        data.violations[target.id] = Math.max(0, cur - 1);
        saveData(data);
        await message.channel.send(`✅ Unwarned ${target}. Violations: **${data.violations[target.id]}/${threshold}**`);
    }

    // !purge [1-100]
    else if (cmd === 'purge' && (isAdmin || isMod)) {
        const count = Math.max(1, Math.min(100, parseInt(args[0]) || 0));
        if (!count) return;
        try {
            const deleted = await message.channel.bulkDelete(count, true).catch(()=>null);
            const sent = await message.channel.send(`✅ Purged ${deleted ? deleted.size : 0} messages.`);
            setTimeout(() => sent.delete().catch(()=>{}), 6000);
        } catch {}
    }

    // !lock [reason...]
    else if (cmd === 'lock' && (isAdmin || isMod)) {
        const reason = args.join(' ') || 'Channel locked';
        try {
            await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false }, { reason });
            await message.channel.send('🔒 Channel locked.');
        } catch {}
    }

    // !unlock [reason...]
    else if (cmd === 'unlock' && (isAdmin || isMod)) {
        const reason = args.join(' ') || 'Channel unlocked';
        try {
            await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null }, { reason });
            await message.channel.send('🔓 Channel unlocked.');
        } catch {}
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
        const v = (args[0] || '').toLowerCase();
        if (!v) return message.channel.send(`🛡️ Raid mode is currently **${gs.raidModeEnabled ? 'ON' : 'OFF'}**.`);
        if (['on','true','yes','1','enable','enabled'].includes(v)) gs.raidModeEnabled = true;
        else if (['off','false','no','0','disable','disabled'].includes(v)) gs.raidModeEnabled = false;
        else return message.channel.send('❌ Use: !raidmode on/off');
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
        const v = (args[0] || '').toLowerCase();
        if (!v) return message.channel.send(`🔗 Link policy is currently **${gs.linkPolicyEnabled ? 'ON' : 'OFF'}**.`);
        if (['on','true','yes','1','enable','enabled'].includes(v)) gs.linkPolicyEnabled = true;
        else if (['off','false','no','0','disable','disabled'].includes(v)) gs.linkPolicyEnabled = false;
        else return message.channel.send('❌ Use: !linkpolicy on/off');
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
        const dom = normalizeDomain(args[0]);
        if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return message.channel.send('❌ Use: !allowdomain example.com');
        gs.linkAllowlistedDomains = Array.isArray(gs.linkAllowlistedDomains) ? gs.linkAllowlistedDomains : [];
        if (!gs.linkAllowlistedDomains.includes(dom)) gs.linkAllowlistedDomains.push(dom);
        saveData(data);
        await message.channel.send(`✅ Allowlisted: **${dom}**`);
    }

    // !denydomain [domain]
    else if (cmd === 'denydomain' && isAdmin) {
        const dom = normalizeDomain(args[0]);
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
        const v = (args[0] || '').toLowerCase();
        if (!v) return message.channel.send(`✏️ Scan edits is currently **${gs.scanEditsEnabled ? 'ON' : 'OFF'}**.`);
        if (['on','true','yes','1','enable','enabled'].includes(v)) gs.scanEditsEnabled = true;
        else if (['off','false','no','0','disable','disabled'].includes(v)) gs.scanEditsEnabled = false;
        else return message.channel.send('❌ Use: !togglescanedits on/off');
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
        const onoff = (args[0] || '').toLowerCase();
        if (onoff) {
            if (['on','true','yes','1','enable','enabled'].includes(onoff)) gs.dupeSpamEnabled = true;
            else if (['off','false','no','0','disable','disabled'].includes(onoff)) gs.dupeSpamEnabled = false;
        }
        if (args[1]) gs.dupeWindowSec = Math.max(5, Math.min(120, parseInt(args[1]) || gs.dupeWindowSec || 20));
        if (args[2]) gs.dupeThreshold = Math.max(2, Math.min(20, parseInt(args[2]) || gs.dupeThreshold || 4));
        if (args[3]) gs.dupeMinLen = Math.max(5, Math.min(200, parseInt(args[3]) || gs.dupeMinLen || 10));
        saveData(data);
        await message.channel.send(`✅ Dupe config: enabled=${gs.dupeSpamEnabled} window=${gs.dupeWindowSec}s threshold=${gs.dupeThreshold} minLen=${gs.dupeMinLen}`);
    }

    // !raidconfig [windowSec] [threshold] [lockdownMins] [lockchannels on/off] [blocklinks on/off] [newacctdays]
    else if (cmd === 'raidconfig' && isAdmin) {
        const windowSec = args[0] ? Math.max(5, Math.min(120, parseInt(args[0]) || gs.raidJoinWindowSec || 25)) : null;
        const threshold = args[1] ? Math.max(2, Math.min(50, parseInt(args[1]) || gs.raidJoinThreshold || 7)) : null;
        const lockdown  = args[2] ? Math.max(1, Math.min(60, parseInt(args[2]) || gs.raidLockdownMins || 8)) : null;
        const lockChStr = (args[3] || '').toLowerCase();
        const blockStr  = (args[4] || '').toLowerCase();
        const newAcct   = args[5] ? Math.max(0, Math.min(90, parseInt(args[5]) || gs.raidNewAccountDays || 7)) : null;

        if (windowSec !== null) gs.raidJoinWindowSec = windowSec;
        if (threshold !== null) gs.raidJoinThreshold = threshold;
        if (lockdown !== null) gs.raidLockdownMins = lockdown;
        if (lockChStr) {
            if (['on','true','yes','1','enable','enabled'].includes(lockChStr)) gs.raidLockChannels = true;
            else if (['off','false','no','0','disable','disabled'].includes(lockChStr)) gs.raidLockChannels = false;
        }
        if (blockStr) {
            if (['on','true','yes','1','enable','enabled'].includes(blockStr)) gs.raidLinkBlockAll = true;
            else if (['off','false','no','0','disable','disabled'].includes(blockStr)) gs.raidLinkBlockAll = false;
        }
        if (newAcct !== null) gs.raidNewAccountDays = newAcct;
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
        const dom = normalizeDomain(args[1]);
        if (!dom || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dom)) return message.channel.send('❌ Use: !domainremove allow|deny example.com');
        if (list !== 'allow' && list !== 'deny') return message.channel.send('❌ First arg must be allow or deny.');
        if (list === 'allow') gs.linkAllowlistedDomains = (gs.linkAllowlistedDomains || []).filter(x => normalizeDomain(x) !== dom);
        if (list === 'deny')  gs.linkDenylistedDomains  = (gs.linkDenylistedDomains  || []).filter(x => normalizeDomain(x) !== dom);
        saveData(data);
        await message.channel.send(`✅ Removed **${dom}** from **${list}** list.`);
    }

    // !capsconfig [on/off] [percent] [minLetters] [maxRun]
    else if (cmd === 'capsconfig' && isAdmin) {
        const onoff = (args[0] || '').toLowerCase();
        if (onoff) {
            if (['on','true','yes','1','enable','enabled'].includes(onoff)) gs.capsSpamEnabled = true;
            else if (['off','false','no','0','disable','disabled'].includes(onoff)) gs.capsSpamEnabled = false;
        }
        if (args[1]) gs.capsMaxPercent = Math.max(30, Math.min(100, parseInt(args[1]) || gs.capsMaxPercent || 70));
        if (args[2]) gs.capsMinLetters = Math.max(8, Math.min(80, parseInt(args[2]) || gs.capsMinLetters || 16));
        if (args[3]) gs.capsMaxRun = Math.max(10, Math.min(120, parseInt(args[3]) || gs.capsMaxRun || 28));
        saveData(data);
        await message.channel.send(`✅ Caps config: enabled=${gs.capsSpamEnabled} percent=${gs.capsMaxPercent} minLetters=${gs.capsMinLetters} maxRun=${gs.capsMaxRun}`);
    }

    // !emojiconfig [on/off] [max] [windowSec]
    else if (cmd === 'emojiconfig' && isAdmin) {
        const onoff = (args[0] || '').toLowerCase();
        if (onoff) {
            if (['on','true','yes','1','enable','enabled'].includes(onoff)) gs.emojiSpamEnabled = true;
            else if (['off','false','no','0','disable','disabled'].includes(onoff)) gs.emojiSpamEnabled = false;
        }
        if (args[1]) gs.emojiMaxCount = Math.max(5, Math.min(60, parseInt(args[1]) || gs.emojiMaxCount || 18));
        if (args[2]) gs.emojiWindowSec = Math.max(3, Math.min(60, parseInt(args[2]) || gs.emojiWindowSec || 12));
        saveData(data);
        await message.channel.send(`✅ Emoji config: enabled=${gs.emojiSpamEnabled} max=${gs.emojiMaxCount} window=${gs.emojiWindowSec}s`);
    }

    // !zalgoconfig [on/off] [maxMarks]
    else if (cmd === 'zalgoconfig' && isAdmin) {
        const onoff = (args[0] || '').toLowerCase();
        if (onoff) {
            if (['on','true','yes','1','enable','enabled'].includes(onoff)) gs.zalgoEnabled = true;
            else if (['off','false','no','0','disable','disabled'].includes(onoff)) gs.zalgoEnabled = false;
        }
        if (args[1]) gs.zalgoMaxCombining = Math.max(4, Math.min(80, parseInt(args[1]) || gs.zalgoMaxCombining || 12));
        saveData(data);
        await message.channel.send(`✅ Zalgo config: enabled=${gs.zalgoEnabled} maxMarks=${gs.zalgoMaxCombining}`);
    }

    // !invitepolicy [on/off]
    else if (cmd === 'invitepolicy' && isAdmin) {
        const v = (args[0] || '').toLowerCase();
        if (!v) return message.channel.send(`🔗 Invite policy is currently **${gs.invitePolicyEnabled ? 'ON' : 'OFF'}**.`);
        if (['on','true','yes','1','enable','enabled'].includes(v)) gs.invitePolicyEnabled = true;
        else if (['off','false','no','0','disable','disabled'].includes(v)) gs.invitePolicyEnabled = false;
        else return message.channel.send('❌ Use: !invitepolicy on/off');
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
        const v = (args[0] || '').toLowerCase();
        if (!v) return message.channel.send(`📎 Attachment policy is currently **${gs.attachmentPolicyEnabled ? 'ON' : 'OFF'}**.`);
        if (['on','true','yes','1','enable','enabled'].includes(v)) gs.attachmentPolicyEnabled = true;
        else if (['off','false','no','0','disable','disabled'].includes(v)) gs.attachmentPolicyEnabled = false;
        else return message.channel.send('❌ Use: !attachmentpolicy on/off');
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
        const onoff = (args[0] || '').toLowerCase();
        if (onoff) {
            if (['on','true','yes','1','enable','enabled'].includes(onoff)) gs.stretchSpamEnabled = true;
            else if (['off','false','no','0','disable','disabled'].includes(onoff)) gs.stretchSpamEnabled = false;
        }
        if (args[1]) gs.stretchMaxCharRun = Math.max(6, Math.min(40, parseInt(args[1]) || gs.stretchMaxCharRun || 12));
        if (args[2]) gs.stretchMaxPunctRun = Math.max(6, Math.min(40, parseInt(args[2]) || gs.stretchMaxPunctRun || 10));
        if (args[3]) gs.stretchMaxWordRepeat = Math.max(3, Math.min(20, parseInt(args[3]) || gs.stretchMaxWordRepeat || 5));
        saveData(data);
        await message.channel.send(`✅ Stretch config: enabled=${gs.stretchSpamEnabled} maxCharRun=${gs.stretchMaxCharRun} maxPunctRun=${gs.stretchMaxPunctRun} maxWordRepeat=${gs.stretchMaxWordRepeat}`);
    }

    // !togglescam [on|off]
    else if (cmd === 'togglescam' && isAdmin) {
        const v = (args[0] || '').toLowerCase();
        if (!v) return message.channel.send(`🚨 Scam detection is currently **${gs.scamEnabled ? 'ON' : 'OFF'}**.`);
        if (['on','true','yes','1','enable','enabled'].includes(v)) gs.scamEnabled = true;
        else if (['off','false','no','0','disable','disabled'].includes(v)) gs.scamEnabled = false;
        else return message.channel.send('❌ Use: !togglescam on/off');
        saveData(data);
        await message.channel.send(`✅ Scam detection is now **${gs.scamEnabled ? 'ON' : 'OFF'}**.`);
    }

    // !immunestatus
    else if (cmd === 'immunestatus' && (isAdmin || isMod)) {
        const imm = getImmunitySettings(message.guildId, data);
        const roleNames = imm.whitelistedRoles.map(rid => { const r = message.guild.roles.cache.get(rid); return r ? `<@&${rid}>` : `Unknown (${rid})`; });
        await message.channel.send({ embeds: [new EmbedBuilder()
            .setTitle('🛡️ Immunity Settings')
            .setColor(imm.enabled ? 0x00FF88 : 0xFF4444)
            .addFields(
                { name: 'Immunity Status',   value: imm.enabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                { name: 'Whitelisted Roles', value: roleNames.length ? roleNames.join('\n') : 'None', inline: false },
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
client.login(TOKEN);
