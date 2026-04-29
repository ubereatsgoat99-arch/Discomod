const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════
const TOKEN = 'token';

const TARGET_CHANNEL_ID    = '1417395956357267516';  // ✅ trade goes here
const SERVICES_CHANNEL_ID  = '1417396221362049085';  // ✅ services/raids/bosses go here
const GAMES_HUB_CHANNEL_ID = '1416126451589316679';  // ✅ commands go here

const EXILED_ROLE_ID       = '1423350765711261797';
const REDIRECT_EMOJI_ID    = '1125321969932451841';
const VIOLATION_THRESHOLD  = 3;
const EXILE_DURATION_MINS  = 45;

const SPLIT_MESSAGE_TTL    = 90;    // seconds
const FUZZY_THRESHOLD      = 0.72;
const SHORT_FRUIT_MIN_LEN  = 5;

// ── Games Hub whitelisted channels (commands allowed here) ──────────────────
const GAMES_HUB_CHANNELS = new Set([
    '1416126451589316679', '1416378429795991653', '1416448183080583228',
    '1416834855810895973', '1416835306874867713', '1416860441073811477',
    '1416863662085505065', '1416867540017348758', '1416868781405245460',
    '1417084523325296704', '1417123448190275635',
]);

// ── Channels where services/boss/raid scanning is SKIPPED ───────────────────
const SERVICES_EXEMPT_CHANNELS = new Set([SERVICES_CHANNEL_ID]);

// ══════════════════════════════════════════════════════════
//  FRUITS / TRADE DICTIONARY
// ══════════════════════════════════════════════════════════
const FRUITS = [
    "rocket", "spin", "blade", "spring", "bomb", "smoke", "spike", "flame",
    "ice", "sand", "dark", "eagle", "diamond", "light", "rubber", "ghost",
    "magma", "quake", "buddha", "buda", "love", "creation", "spider", "sound",
    "phoenix", "portal", "rumble", "lightning", "pain", "blizzard", "gravity",
    "mammoth", "trex", "t-rex", "dough", "shadow", "venom", "gas", "spirit",
    "tiger", "yeti", "kitsune", "kit", "control", "dragon", "drag", "lg", "leo", "leopard",
    "2x money", "2x mastery", "2x boss drops", "dark blade", "yoru", "fast boats", "fruit notifier",
    "werewolf",
];

const FRUIT_ALIASES = {
    "rmble": "rumble", "rmbl": "rumble", "ruble": "rumble", "rumbl": "rumble",
    "drg": "dragon", "drgn": "dragon", "drago": "dragon", "draggon": "dragon",
    "phx": "phoenix", "phnx": "phoenix", "phonix": "phoenix", "phenix": "phoenix",
    "lghtn": "lightning", "lightnin": "lightning", "litning": "lightning", "ltning": "lightning",
    "lghtning": "lightning", "lnghtning": "lightning",
    "blzrd": "blizzard", "blizzrd": "blizzard", "blzd": "blizzard",
    "spdr": "spider", "spidur": "spider",
    "mmth": "mammoth", "mamoth": "mammoth", "mamoto": "mammoth",
    "budha": "buddha", "buda": "buddha", "budda": "buddha",
    "ghst": "ghost", "gost": "ghost",
    "shdw": "shadow", "shadw": "shadow", "shado": "shadow", "shadoe": "shadow",
    "dmnd": "diamond", "diamnd": "diamond", "dimond": "diamond", "daimnd": "diamond",
    "grv": "gravity", "gravty": "gravity", "graviti": "gravity",
    "ctrl": "control", "contrl": "control", "contrll": "control",
    "phntm": "phantom",
    "quak": "quake", "qake": "quake",
    "lght": "light", "ligt": "light", "ight": "light",
    "flme": "flame", "flam": "flame",
    "blad": "blade", "balde": "blade",
    "sprng": "spring", "sprin": "spring", "spng": "spring",
    "snke": "snake",
    "rubbr": "rubber", "rubr": "rubber", "ruber": "rubber",
    "cration": "creation", "cretion": "creation", "creaton": "creation",
    "ventom": "venom", "venm": "venom", "vnm": "venom",
    "tgr": "tiger", "tigr": "tiger", "tigar": "tiger",
    "kitsun": "kitsune", "kitune": "kitsune", "kitsn": "kitsune",
    "ytes": "yeti", "yti": "yeti", "yeit": "yeti",
    "drkblade": "dark blade", "drk blade": "dark blade", "drkblde": "dark blade",
    "frst": "frost",
    "mg": "magma", "mgma": "magma", "magm": "magma", "magmma": "magma",
    "leoprd": "leopard", "leapord": "leopard", "leoprad": "leopard",
};

// ══════════════════════════════════════════════════════════
//  BOSSES — for the services/help redirect
// ══════════════════════════════════════════════════════════
const BOSSES = [
    "gods chalice", "god's chalice", "godschalice",
    "fist of darkness", "fistofdarkness",
    "greybeard", "grey beard",
    "darkbeard", "dark beard",
    "order",
    "cake prince", "cakeprince",
    "dough king", "doughking",
    "tyrant of the skies", "tyrant skies", "tyrantskies",
    "leviathan",
    "sea beast", "seabeast",
    "unbound werewolf", "unboundwerewolf", "werewolf",
    "leviathn", "leviatan", "levithan",
    "greybrd", "greybd", "graybrd",
    "darkbrd", "darkbd",
    "seabst",
    "doughkng", "dghking",
    "cakeprnce", "cakeprinc",
    "werewlf", "wwolf",
    "tyrantskys", "tyranskies",
    "fistdrk", "fistofdark",
    "godchalice",
];

const BOSS_ALIASES = {
    "gc":   "gods chalice",
    "fod":  "fist of darkness",
    "gb":   "greybeard",
    "db":   "darkbeard",
    "cp":   "cake prince",
    "dk":   "dough king",
    "tots": "tyrant of the skies",
    "levi": "leviathan",
    "sb":   "sea beast",
    "uw":   "unbound werewolf",
    "ww":   "unbound werewolf",
};

// ── Service / help intent keywords ──────────────────────────────────────────
const SERVICE_INTENT_EXACT = [
    "service", "services", "svc", "svcs",
    "carry", "carries", "carried",
    "boost", "boosting",
    "raid", "raids",
    "dungeon", "dungeons",
    "help", "helping",
    "run", "runs",
    "clear", "clearing",
    "farm", "farming",
    "lf", "lfg", "lfs",
    "need",
    "wanna", "wana",
    "anyone",
    "join",
    "team",
    "partner",
    "looking",
    "searching",
    "hiring",
];

const SERVICE_INTENT_PHRASE = [
    "looking for", "looking 4",
    "need help", "need someone",
    "need a carry", "need carry",
    "lf carry", "lf service", "lf raid",
    "anyone help", "anyone carry", "anyone run",
    "want to run", "want to do", "wanna run", "wanna do",
    "can anyone", "who can",
    "help me", "help with",
    "services for",
    "service for",
    "carry for",
    "boost for",
    "raid for",
    "farm for",
    "pay for",
    "hiring for",
];

// ══════════════════════════════════════════════════════════
//  COMMON WORD WHITELIST
// ══════════════════════════════════════════════════════════
const COMMON_WORD_WHITELIST = new Set([
    "it","its","i","im","in","is","if","id",
    "he","his","her","hers","him",
    "we","us","our","ours",
    "they","them","their",
    "you","your","yours",
    "a","an","the",
    "to","of","on","at","as","or","so",
    "up","do","go","be","by","my",
    "and","but","nor","yet","for",
    "not","no","via","per","vs",
    "am","are","was","were","had","has","have",
    "did","does","will","can","may","might","shall",
    "get","got","let","put","set","sit","hit","bit",
    "say","said","see","saw","try","use","run","ran",
    "eat","ate","ask","pay","ago","add","aim",
    "who","what","when","where","why","how",
    "ice","age","ace","act","aid","air","all",
    "any","apt","arc","arm","art","ash","awe",
    "bad","bag","ban","bar","bat","bay","bed",
    "big","bit","bot","bow","box","boy","bud",
    "bug","bus","cab","cap","car","cat","cop",
    "cup","cut","day","den","dig","dim","dip",
    "dog","dot","dug","duo","ear","egg","ego",
    "end","era","eve","eye","fad","fan","far",
    "fat","fax","fee","few","fig","fit","fix",
    "fly","fog","fun","gap","gel","gem","god",
    "guy","gym","hat","hay","hey","hip",
    "hop","hot","hub","hue","hug","hum",
    "ink","inn","ion","jar","jaw","joy","key",
    "kid","kin","lab","lag","law","lay","led",
    "leg","lid","lip","log","lot","low","map",
    "mar","mat","max","mob","mod","mom","mop",
    "mud","mug","nap","net","nod","nun","nut",
    "oak","odd","oil","old","one","opt","orb",
    "ore","owl","own","pad","pan","pat","paw",
    "peg","pen","pet","pie","pig","pin","pit",
    "pod","pop","pot","pun","pup","rat","raw",
    "ray","red","ref","rep","rib","rid","rig",
    "rip","rob","rod","row","rub","rug","rum",
    "sad","sap","sat","saw","sew","shy","sin",
    "sip","sir","six","ski","sky","sly","sob",
    "son","sow","spa","spy","sub","sum",
    "sun","sup","tab","tan","tap","tar","tax",
    "tea","ten","tip","toe","ton","too","top",
    "tow","toy","tub","tug","two","urn","van",
    "vat","vow","wag","war","wax","web",
    "wed","wet","win","wit","woe","wok","won",
    "woo","yak","yam","yap","yaw","yes","yet",
    "yew","zip","zoo",
    "able","also","area","back","ball","band","bank",
    "base","bath","been","best","beta","bill","bird",
    "blow","blue","body","book","boot","born","both",
    "brad","call","calm","came","card","care","case",
    "cash","cast","chat","chip","city","clam","clap",
    "clay","clip","club","coal","coat","code","coin",
    "cold","come","cook","cool","cope","copy","cord",
    "core","corn","cost","cozy","crew","crop","cure",
    "data","date","dawn","dead","deal","dean","dear",
    "debt","deck","deed","deep","deer","demo","deny",
    "desk","dial","dice","diet","dirt","disk","dive",
    "door","dose","dove","down","draw","drew","drip",
    "drop","drum","duck","dude","duel","dumb","dump",
    "dusk","dust","duty","each","earn","ease","east",
    "edge","else","emit","epic","even","ever","evil",
    "exam","face","fact","fail","fair","fake","fall",
    "fame","fast","fate","feel","feet","fell","felt",
    "fern","file","fill","film","find","fine","fire",
    "firm","fish","fist","flag","flat","flew","flip",
    "flow","foam","fold","folk","fond","food","fool",
    "foot","ford","fore","fork","form","fort","foul",
    "four","free","from","frog","fuel","full","fume",
    "fund","fuse","fuss","gain","game","gave","gear",
    "gift","girl","give","glad","glow","glue","goal",
    "gold","golf","good","gown","grab","grid","grin",
    "grip","grow","gulf","gust","guys","hack","half",
    "hall","hand","hang","hard","harm","hate","have",
    "head","heal","heap","hear","heat","held","hell",
    "help","here","hide","high","hill","hire","hold",
    "hole","home","hood","hook","hope","horn","host",
    "hour","huge","hull","hung","hunt","hurt","idea",
    "idle","into","iron","isle","item","join","joke",
    "jump","just","keen","keep","kick","kill","kind",
    "king","knew","know","lack","laid","lake","land",
    "lane","last","late","lead","leaf","leak","lean",
    "leap","left","lend","less","lick","life","lift",
    "like","lime","line","link","lion","list","live",
    "load","loan","lock","loft","lone","long","look",
    "loom","loop","lord","lore","lorn","lose","loss",
    "lost","loud","lout","lure","lush","made","mail",
    "main","make","male","mall","mane","many","mark",
    "mars","mash","mass","mast","mate","math","maze",
    "mean","meet","melt","memo","menu","mere","mess",
    "mind","mine","mint","miss","mode","mold","mole",
    "moon","more","most","move","much","muse","must",
    "mute","myth","nail","name","navy","near","neat",
    "neck","news","next","nice","nine","node",
    "none","noon","norm","nose","note","noun","nude",
    "null","oath","obey","once","only","open","oral",
    "orca","over","pace","pack","page","paid","pair",
    "pale","pane","park","part","pass","past","path",
    "peak","peel","peer","pick","pile","pink","pipe",
    "plan","play","plot","plow","plug","plus","pole",
    "poll","pond","pool","pore","port","pose","post",
    "pour","pray","prey","prop","pull","pump","pure",
    "push","quiz","race","rack","rage","rain","rank",
    "rare","rate","read","real","reap","rear","rely",
    "rent","rest","rich","ride","rife","ring","riot",
    "rise","risk","road","roam","roar","robe","rock",
    "rode","role","roll","roof","room","root","rope",
    "rose","rout","rule","rush","rust","safe","sage",
    "sail","sake","sale","same","sang","sank",
    "save","scan","scar","seal","seat","seed","seek",
    "seem","seen","self","sell","send","sent","shed",
    "ship","shoe","shop","shot","show","shut","sick",
    "side","sigh","silk","sill","sing","sink","site",
    "size","skip","slab","slam","slap","sled","slew",
    "slim","slip","slot","slow","slug","slum","snap",
    "snow","soak","sock","soft","soil","sole","some",
    "song","soon","sore","soul","soup","sour","span",
    "spec","sped","spew","spit","spot","spun",
    "spur","stab","star","stay","step","stem","stew",
    "stop","stub","such","suit","sung","sunk","sure",
    "swan","swap","swam","swim","sync","tail","tale",
    "talk","tall","tame","task","taut","team","tear",
    "tell","tend","tent","term","test","text","than",
    "that","then","this","thou","thus","tide",
    "tied","tile","till","time","tire","told","toll",
    "tomb","tone","tore","torn","toss","tour","town",
    "trap","tray","tree","trek","trim","trip","true",
    "tube","tune","turf","turn","twin","type","ugly",
    "undo","unit","upon","used","user","vain","vale",
    "vary","vast","veil","vein","verb","very","vest",
    "view","vine","visa","void","volt","vote","wade",
    "wait","wake","walk","wall","want","ward","warm",
    "warn","wary","wave","weak","weld","well","went",
    "were","west","when","whim","wide","wife","wiki",
    "wild","will","wilt","wind","wine","wing","wire",
    "wise","wish","with","wolf","wood","wool","word",
    "wore","work","worm","worn","wrap","writ","yard",
    "yarn","year","yell","your","zero","zone",
]);

// ══════════════════════════════════════════════════════════
//  TRADE INTENT KEYWORDS
// ══════════════════════════════════════════════════════════
const INTENT_EXACT = [
    "lf","wtt","wtb","wts","w2t","lf4","lfor","lfr","lf4r",
    "trade","trading","swap","swapping","buying","selling",
    "offer","offers","tradng","tradig","swapin","swaping",
    "xchnge","xchange","exchng",
];

const INTENT_PHRASE = [
    "looking for","l00king for","lookingfor",
    "searching for","in exchange for",
    "wanna trade","want to trade","wantotrade","want trade","want2trade",
    "anyone trading","does anyone have","does any1 have",
    "exchang",
];

const INTENT_KEYWORDS = [...INTENT_EXACT, ...INTENT_PHRASE];

// ══════════════════════════════════════════════════════════
//  UNICODE / HOMOGLYPH / LEET NORMALIZATION
// ══════════════════════════════════════════════════════════
const HOMOGLYPHS = {
    'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x',
    'ı':'i','ĺ':'l','ļ':'l','ľ':'l','ł':'l',
    'ß':'ss','ø':'o','đ':'d','ð':'d','þ':'th',
    '\u200b':'','\u200c':'','\u200d':'','\ufeff':'','\u00ad':'',
};

const LEET_MAP = {
    '4':'a','3':'e','1':'i','0':'o','@':'a','!':'i',
    '5':'s','7':'t','8':'b','9':'g','6':'g','$':'s',
    '|':'i','+':'t','(':'c',')':'o','<':'c','>':'o',
    '#':'h','^':'a','~':'n','?':'q',
};

function normalizeUnicode(text) {
    text = text.normalize('NFKD');
    text = text.replace(/[\u0300-\u036f]/g, '');
    for (const [src, dst] of Object.entries(HOMOGLYPHS)) {
        text = text.split(src).join(dst);
    }
    return text;
}

function cleanLeetspeak(text) {
    for (const [k, v] of Object.entries(LEET_MAP)) {
        text = text.split(k).join(v);
    }
    return text;
}

function collapseRepeats(text) {
    return text.replace(/(.)\1{2,}/g, '$1$1');
}

function fullClean(text) {
    text = normalizeUnicode(text.toLowerCase());
    text = cleanLeetspeak(text);
    text = collapseRepeats(text);
    return text;
}

// ══════════════════════════════════════════════════════════
//  FUZZY HELPERS
// ══════════════════════════════════════════════════════════
function fuzzyRatio(a, b) {
    if (a.length === 0 && b.length === 0) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    return (2 * dp[m][n]) / (m + n);
}

function tokenIsFruit(token, threshold = FUZZY_THRESHOLD) {
    if (COMMON_WORD_WHITELIST.has(token)) return null;
    if (token.length < 3) return null;
    if (FRUIT_ALIASES[token]) return FRUIT_ALIASES[token];
    for (const fruit of FRUITS) {
        const fc = fruit.replace(/[\s\-]/g, '');
        if (fc.length < SHORT_FRUIT_MIN_LEN) {
            if (token === fc) return fruit;
            continue;
        }
        if (token === fc) return fruit;
        if (token.includes(fc) && token.length <= fc.length + 2) return fruit;
        if (fc.includes(token) && token.length >= fc.length - 2 && token.length >= 4) return fruit;
        if (Math.abs(token.length - fc.length) > Math.max(3, Math.floor(fc.length / 3))) continue;
        if (fuzzyRatio(token, fc) >= threshold) return fruit;
    }
    return null;
}

function tokenIsBoss(token, threshold = FUZZY_THRESHOLD) {
    if (COMMON_WORD_WHITELIST.has(token)) return null;
    if (token.length < 2) return null;
    if (BOSS_ALIASES[token]) return BOSS_ALIASES[token];
    for (const boss of BOSSES) {
        const bc = boss.replace(/[\s\-']/g, '');
        if (bc.length < SHORT_FRUIT_MIN_LEN) {
            if (token === bc) return boss;
            continue;
        }
        if (token === bc) return boss;
        if (token.includes(bc) && token.length <= bc.length + 2) return boss;
        if (bc.includes(token) && token.length >= bc.length - 2 && token.length >= 4) return boss;
        if (Math.abs(token.length - bc.length) > Math.max(3, Math.floor(bc.length / 3))) continue;
        if (fuzzyRatio(token, bc) >= threshold) return boss;
    }
    return null;
}

function tokenIsIntent(token, threshold = 0.82) {
    if (token.length < 2) return false;
    for (const kw of INTENT_EXACT) {
        if (kw.includes(' ')) continue;
        const kwClean = kw.replace(/\s/g, '');
        if (kwClean.length <= 4) {
            if (token === kwClean) return true;
            continue;
        }
        if (token === kwClean) return true;
        if (Math.abs(token.length - kwClean.length) > Math.max(2, Math.floor(kwClean.length / 3))) continue;
        if (fuzzyRatio(token, kwClean) >= threshold) return true;
    }
    return false;
}

function tokenIsServiceIntent(token, threshold = 0.82) {
    if (token.length < 2) return false;
    for (const kw of SERVICE_INTENT_EXACT) {
        const kwClean = kw.replace(/\s/g, '');
        if (kwClean.length <= 4) {
            if (token === kwClean) return true;
            continue;
        }
        if (token === kwClean) return true;
        if (Math.abs(token.length - kwClean.length) > Math.max(2, Math.floor(kwClean.length / 3))) continue;
        if (fuzzyRatio(token, kwClean) >= threshold) return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  REGEX SCANNING ENGINE
// ══════════════════════════════════════════════════════════
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeAggroPattern(word, isFruit = false) {
    const cleanWord = word.replace(/[\s\-']/g, '');
    const core = cleanWord.split('').map(c => `${escapeRegex(c)}+`).join('[\\s\\W_]*');
    if (isFruit) {
        return `(?<![a-z])${core}(?:[\\s\\W]*s+)?(?![a-z])`;
    } else {
        return `(?<![a-z])${core}(?![a-z])`;
    }
}

// Trade regex (fruit for fruit)
const aggroFruits  = FRUITS.map(f => makeAggroPattern(f, true));
const fruitP       = `(?:${aggroFruits.join('|')})`;
const aggroFor     = makeAggroPattern("for", false);
const tradeRegex   = new RegExp(`(${fruitP}[\\s\\S]*?${aggroFor}[\\s\\S]*?${fruitP})`, 'i');

// Boss / services regex (boss name in message)
const aggroBosses  = BOSSES.map(b => makeAggroPattern(b, true));
const bossP        = `(?:${aggroBosses.join('|')})`;
const bossRegex    = new RegExp(`(${bossP})`, 'i');

// "raid" combined with a fruit name e.g. "dough raid", "rumble raid"
const raidWordP       = makeAggroPattern("raid", false);
const fruitRaidRegex  = new RegExp(`(${fruitP}[\\s\\W]{0,6}${raidWordP}|${raidWordP}[\\s\\W]{0,6}${fruitP})`, 'i');

// "service" / "services" combined with intent
const serviceWordP = `(?:s+[\\s\\W_]*e+[\\s\\W_]*r+[\\s\\W_]*v+[\\s\\W_]*i+[\\s\\W_]*c+[\\s\\W_]*e+s*)`;
// "services for raids/dungeons"
const svcForRaidRegex = new RegExp(
    `(?<![a-z])${serviceWordP}[\\s\\W_]{0,6}(?:for[\\s\\W_]{0,6})?(?:r+[\\s\\W_]*a+[\\s\\W_]*i+[\\s\\W_]*d+s*|d+[\\s\\W_]*u+[\\s\\W_]*n+[\\s\\W_]*g+[\\s\\W_]*e+[\\s\\W_]*o+[\\s\\W_]*n+s*)(?![a-z])`,
    'i'
);

// No-space patterns (lookingforrumble etc.)
function makeNospacePattern(keyword, target) {
    const kw = keyword.replace(/[\s\-]/g, '');
    const fr = target.replace(/[\s\-']/g, '');
    const kwPat = kw.split('').map(c => `${escapeRegex(c)}+`).join('[\\s_]*');
    const frPat = fr.split('').map(c => `${escapeRegex(c)}+`).join('[\\s_]*');
    return new RegExp(`(?<![a-z])${kwPat}[\\s\\W_]{0,3}${frPat}(?![a-z])`, 'i');
}

const NOSPACE_PATTERNS = [];
const SHORT_INTENTS = ["lf","wtt","wtb","wts","lookingfor","lfr","lf4"];
for (const _intent of SHORT_INTENTS) {
    for (const _fruit of FRUITS) {
        NOSPACE_PATTERNS.push(makeNospacePattern(_intent, _fruit));
    }
}

// ══════════════════════════════════════════════════════════
//  TOKENIZATION
// ══════════════════════════════════════════════════════════
function tokenize(text) {
    const words = text.match(/[a-z0-9']+/g) || [];
    const singleTokens = new Set(words);
    const compoundTokens = new Set();
    for (let i = 0; i < words.length - 1; i++) {
        compoundTokens.add(words[i] + words[i + 1]);
    }
    for (let i = 0; i < words.length - 2; i++) {
        compoundTokens.add(words[i] + words[i + 1] + words[i + 2]);
    }
    return { singleTokens, compoundTokens };
}

function scanForFruits(cleanText) {
    const { singleTokens, compoundTokens } = tokenize(cleanText);
    const found = [];
    for (const tok of singleTokens) {
        if (tok.length < 3) continue;
        const match = tokenIsFruit(tok);
        if (match && !found.includes(match)) found.push(match);
    }
    for (const tok of compoundTokens) {
        if (tok.length < 4) continue;
        if (FRUIT_ALIASES[tok] && !found.includes(FRUIT_ALIASES[tok])) {
            found.push(FRUIT_ALIASES[tok]);
            continue;
        }
        for (const fruit of FRUITS) {
            const fc = fruit.replace(/[\s\-]/g, '');
            if (fc === tok && !found.includes(fruit)) { found.push(fruit); break; }
            if (fc.length >= SHORT_FRUIT_MIN_LEN) {
                if (tok.includes(fc) && tok.length <= fc.length + 2 && !found.includes(fruit)) { found.push(fruit); break; }
                if (fc.includes(tok) && tok.length >= fc.length - 2 && tok.length >= 4 && !found.includes(fruit)) { found.push(fruit); break; }
            }
        }
    }
    return found;
}

function scanForBosses(cleanText) {
    const { singleTokens, compoundTokens } = tokenize(cleanText);
    const found = [];
    for (const tok of singleTokens) {
        if (tok.length < 2) continue;
        const match = tokenIsBoss(tok);
        if (match && !found.includes(match)) found.push(match);
    }
    for (const tok of compoundTokens) {
        if (tok.length < 3) continue;
        if (BOSS_ALIASES[tok] && !found.includes(BOSS_ALIASES[tok])) {
            found.push(BOSS_ALIASES[tok]);
            continue;
        }
        for (const boss of BOSSES) {
            const bc = boss.replace(/[\s\-']/g, '');
            if (bc === tok && !found.includes(boss)) { found.push(boss); break; }
            if (bc.length >= SHORT_FRUIT_MIN_LEN) {
                if (tok.includes(bc) && tok.length <= bc.length + 2 && !found.includes(boss)) { found.push(boss); break; }
                if (bc.includes(tok) && tok.length >= bc.length - 2 && tok.length >= 4 && !found.includes(boss)) { found.push(boss); break; }
            }
        }
    }
    return found;
}

function scanForIntent(cleanText) {
    const textNospace = cleanText.replace(/\s/g, '');
    for (const phrase of INTENT_PHRASE) {
        const phraseNs = phrase.replace(/\s/g, '');
        if (textNospace.includes(phraseNs) || cleanText.includes(phrase)) return true;
    }
    const { singleTokens } = tokenize(cleanText);
    for (const tok of singleTokens) {
        if (tok.length < 2) continue;
        if (tokenIsIntent(tok)) return true;
    }
    return false;
}

function scanForServiceIntent(cleanText) {
    const textNospace = cleanText.replace(/\s/g, '');
    for (const phrase of SERVICE_INTENT_PHRASE) {
        const phraseNs = phrase.replace(/\s/g, '');
        if (textNospace.includes(phraseNs) || cleanText.includes(phrase)) return true;
    }
    const { singleTokens } = tokenize(cleanText);
    for (const tok of singleTokens) {
        if (tok.length < 2) continue;
        if (tokenIsServiceIntent(tok)) return true;
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  DATA PERSISTENCE
// ══════════════════════════════════════════════════════════
const BASE_DIR  = path.dirname(path.resolve(process.argv[1]));
const DATA_FILE = path.join(BASE_DIR, 'trade_guard_data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return { violations: {}, exiles: {}, partial_signals: {} };
    }
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (!data.partial_signals) data.partial_signals = {};
        return data;
    } catch {
        return { violations: {}, exiles: {}, partial_signals: {} };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
    } catch {}
}

// ══════════════════════════════════════════════════════════
//  SPLIT-MESSAGE TRACKING
// ══════════════════════════════════════════════════════════
const _partial = new Map();

function recordPartial(userId, channelId, hasIntent, hasFruit) {
    const now = Date.now() / 1000;
    const existing = _partial.get(userId) || {};
    _partial.set(userId, {
        has_intent:  (existing.has_intent  || false) || hasIntent,
        has_fruit:   (existing.has_fruit   || false) || hasFruit,
        timestamp:   now,
        channel_id:  channelId,
    });
}

function getPartial(userId, channelId) {
    const entry = _partial.get(userId);
    if (!entry) return null;
    if (entry.channel_id !== channelId) return null;
    if (Date.now() / 1000 - entry.timestamp > SPLIT_MESSAGE_TTL) {
        _partial.delete(userId);
        return null;
    }
    return entry;
}

function clearPartial(userId) {
    _partial.delete(userId);
}

function cleanupPartials() {
    const now = Date.now() / 1000;
    for (const [uid, v] of _partial.entries()) {
        if (now - v.timestamp > SPLIT_MESSAGE_TTL) _partial.delete(uid);
    }
}

// ══════════════════════════════════════════════════════════
//  BOT SETUP
// ══════════════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

client.once('ready', () => {
    console.log(`🚨 SKYNET V5 ONLINE: ${client.user.tag}`);

    // Exile check — every 60s
    setInterval(async () => {
        const data = loadData();
        const now  = Date.now() / 1000;
        const toRemove = [];
        for (const [uid, info] of Object.entries(data.exiles)) {
            if (now >= info.expiry) {
                for (const guild of client.guilds.cache.values()) {
                    let member = guild.members.cache.get(uid);
                    if (!member) member = await guild.members.fetch(uid).catch(() => null);
                    if (member) {
                        const freshData = loadData();
                        const success = await performUnexile(member, guild, freshData);
                        if (success) { toRemove.push(uid); break; }
                    }
                }
            }
        }
        if (toRemove.length > 0) {
            const freshData = loadData();
            for (const uid of toRemove) delete freshData.exiles[uid];
            saveData(freshData);
        }
    }, 60 * 1000);

    // Partial cleanup — every 2 min
    setInterval(() => cleanupPartials(), 2 * 60 * 1000);
});

// ══════════════════════════════════════════════════════════
//  HELPERS — is this message a command?
//  Any non-alphanumeric, non-space first character is treated as a command prefix.
//  Also catches: g.m, g. prefix (Giveaway Boat), slash commands.
// ══════════════════════════════════════════════════════════
const CMD_PREFIX_RE = /^[^a-zA-Z0-9\s@]/;  // starts with a symbol (but NOT @)

function isMessageCommand(message) {
    const content = message.content;
    if (!content) return false;

    // Slash command (interaction)
    if (message.type === 20) return true;  // APPLICATION_COMMAND

    // @ mentions — NEVER treat as a command, people need to be able to ping
    if (content.startsWith('@') || content.startsWith('<@')) return false;

    // g.m or any g. prefix (Giveaway Boat)
    if (/^g\./i.test(content)) return true;

    // Standalone ? or ! (just the symbol, nothing after, or only whitespace)
    // e.g. "?", "!", "?  " — don't flag these
    if (/^[?!]\s*$/.test(content)) return false;

    // ? or ! followed by a space then letters — e.g. "? what", "! hello"
    // This is normal chat punctuation, not a command
    if (/^[?!]\s+[a-zA-Z]/.test(content)) return false;

    // Any other symbol as first character (!, /, -, ., $, ?, ~, etc.)
    if (CMD_PREFIX_RE.test(content)) return true;

    return false;
}

// ══════════════════════════════════════════════════════════
//  MAIN ON_MESSAGE
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isStaff = (
        message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member?.permissions.has(PermissionFlagsBits.ManageMessages)
    );

    // ────────────────────────────────────────────────────────
    // BLOCK A — COMMAND LOCKDOWN
    // Any message that looks like a command (any symbol prefix, g.m, slash)
    // gets deleted + redirected to Games Hub UNLESS:
    //   • the author is staff (admin / manage_messages), OR
    //   • the channel is already in GAMES_HUB_CHANNELS
    // ────────────────────────────────────────────────────────
    if (isMessageCommand(message)) {
        if (!isStaff && !GAMES_HUB_CHANNELS.has(message.channel.id)) {
            try { await message.delete(); } catch {}
            const sent = await message.channel.send(
                `❌ ${message.author}, use commands in <#${GAMES_HUB_CHANNEL_ID}> under **Games Hub**.`
            );
            setTimeout(() => sent.delete().catch(() => {}), 10000);
            return;  // stop here — don't scan for trades / services
        }
    }

    // Handle admin commands
    await handleCommands(message);

    // ────────────────────────────────────────────────────────
    // BLOCK B — SERVICES / BOSS / RAID SCAN
    // Applies to EVERYONE including staff.
    // Skip if the message is already in the services channel.
    // ────────────────────────────────────────────────────────
    if (!SERVICES_EXEMPT_CHANNELS.has(message.channel.id)) {
        await checkServicesViolation(message);
    }

    // ────────────────────────────────────────────────────────
    // BLOCK C — TRADE SCAN
    // Skip the designated trade channel itself.
    // Applies to everyone including staff.
    // ────────────────────────────────────────────────────────
    if (message.channel.id !== TARGET_CHANNEL_ID) {
        await checkTradeViolation(message);
    }
});

// ══════════════════════════════════════════════════════════
//  SERVICES / BOSS CHECKER
// ══════════════════════════════════════════════════════════
async function checkServicesViolation(message) {
    const raw = message.content;

    let textOnly    = raw.replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, ' __EMOJI__ ');
    textOnly        = textOnly.replace(/<@!?\d+>/g, ' ');
    const emojiNames = [...raw.toLowerCase().matchAll(/<a?:([a-zA-Z0-9_]+):\d+>/g)].map(m => m[1]);
    const emojiText  = emojiNames.join(' ');

    const contentClean   = fullClean(textOnly + ' ' + emojiText);
    const contentNospace = contentClean.replace(/[\s_]/g, '');

    // 1. Direct regex hits
    const hasBossRegex   = bossRegex.test(contentClean);
    const hasFruitRaid   = fruitRaidRegex.test(contentClean);
    const hasSvcForRaid  = svcForRaidRegex.test(contentClean);

    // 2. Fuzzy / token scan
    const bossesFound = scanForBosses(contentClean);
    // Also check no-space for boss names
    for (const b of BOSSES) {
        const bc = b.replace(/[\s\-']/g, '');
        if (bc.length >= 4 && contentNospace.includes(bc) && !bossesFound.includes(b)) {
            bossesFound.push(b);
        }
    }

    const hasServiceIntent = scanForServiceIntent(contentClean);
    const fruitsInMsg      = scanForFruits(contentClean);

    // 3. "fruit + raid" via tokens
    let hasFruitAndRaid = false;
    if (fruitsInMsg.length > 0) {
        const raidPattern = /r+[\s\W_]*a+[\s\W_]*i+[\s\W_]*d+s*/i;
        if (raidPattern.test(contentClean)) hasFruitAndRaid = true;
    }

    // ── TRIGGER LOGIC ───────────────────────────────────────
    // SA: "services for raids" / "services for dungeons" explicit phrase
    let flaggedService = false;
    if (hasSvcForRaid) {
        flaggedService = true;
    }
    // SB: Boss name found with service/help intent
    else if (bossesFound.length > 0 && hasServiceIntent) {
        flaggedService = true;
    }
    // SC: Boss name found standalone (asking about boss = services channel)
    else if (hasBossRegex || bossesFound.length > 0) {
        // Only flag if there's SOME indication they want help (not just mentioning boss name casually)
        if (hasServiceIntent) flaggedService = true;
    }
    // SD: Fruit + raid combination
    else if (hasFruitRaid || hasFruitAndRaid) {
        flaggedService = true;
    }

    if (flaggedService) {
        try { await message.delete(); } catch { return; }
        const embed = new EmbedBuilder()
            .setDescription(
                `⚠️ ${message.author}, ` +
                `service/boss/raid requests go in <#${SERVICES_CHANNEL_ID}>!`
            )
            .setColor(0xFF6600);
        const sent = await message.channel.send({ embeds: [embed] });
        setTimeout(() => sent.delete().catch(() => {}), 10000);
    }
}

// ══════════════════════════════════════════════════════════
//  TRADE CHECKER  (original logic, fully preserved)
// ══════════════════════════════════════════════════════════
async function checkTradeViolation(message) {
    const raw = message.content;

    let textOnly    = raw.replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, ' __EMOJI__ ');
    textOnly        = textOnly.replace(/<@!?\d+>/g, ' ');
    const emojiNames = [...raw.toLowerCase().matchAll(/<a?:([a-zA-Z0-9_]+):\d+>/g)].map(m => m[1]);
    const emojiText  = emojiNames.join(' ');

    const contentClean   = fullClean(textOnly + ' ' + emojiText);
    const contentNospace = contentClean.replace(/[\s_]/g, '');

    // Fruit scan
    const fruitsFound = scanForFruits(contentClean);
    for (const f of FRUITS) {
        const fc = f.replace(/[\s\-]/g, '');
        if (contentNospace.includes(fc) && !fruitsFound.includes(f)) fruitsFound.push(f);
    }

    // Intent scan
    let hasIntent = scanForIntent(contentClean);
    if (!hasIntent) {
        for (const kw of INTENT_PHRASE) {
            const kwNs = kw.replace(/\s/g, '').replace(/-/g, '');
            if (kwNs.length >= 5 && contentNospace.includes(kwNs)) { hasIntent = true; break; }
        }
    }

    // Regex exchange
    let isDirectExchange = tradeRegex.test(contentClean);
    if (!isDirectExchange) {
        for (const pat of NOSPACE_PATTERNS) {
            if (pat.test(contentNospace)) { isDirectExchange = true; break; }
        }
    }

    // Redirect emoji
    const hasTargetEmoji = raw.toLowerCase().includes(REDIRECT_EMOJI_ID);

    // Fruit emoji count
    const rawEmojis   = [...raw.toLowerCase().matchAll(/<a?:[a-zA-Z0-9_]+:\d+>/g)].map(m => m[0]);
    const fruitEmojis = rawEmojis.filter(e => FRUITS.some(f => e.includes(f.replace(/\s/g, ''))));
    const totalItems  = fruitsFound.length + fruitEmojis.length;

    // Split-message logic
    const uid = message.author.id;
    const cid = message.channel.id;
    const existing    = getPartial(uid, cid);
    let splitFlagged  = false;

    if (existing) {
        const combinedIntent = existing.has_intent || hasIntent;
        const combinedFruit  = existing.has_fruit  || (totalItems >= 1);
        if (combinedIntent && combinedFruit) {
            splitFlagged = true;
            clearPartial(uid);
        }
    } else {
        if ((hasIntent || isDirectExchange) && totalItems === 0) {
            recordPartial(uid, cid, true, false);
        } else if (totalItems >= 1 && !hasIntent && !isDirectExchange) {
            recordPartial(uid, cid, false, true);
        }
    }

    if (hasIntent && totalItems >= 1) clearPartial(uid);
    if (isDirectExchange) clearPartial(uid);

    // Trigger logic
    let flagged = false;
    if (isDirectExchange)                        flagged = true;
    else if (hasIntent && totalItems >= 1)       flagged = true;
    else if (hasTargetEmoji && hasIntent)        flagged = true;
    else if (hasTargetEmoji && totalItems >= 1)  flagged = true;
    else if (splitFlagged)                       flagged = true;

    if (flagged) await handleTradeViolation(message);
}

// ══════════════════════════════════════════════════════════
//  PUNISHMENT
// ══════════════════════════════════════════════════════════
async function handleTradeViolation(message) {
    try { await message.delete(); } catch { return; }

    const data = loadData();
    const uid  = message.author.id;
    data.violations[uid] = (data.violations[uid] || 0) + 1;
    const count = data.violations[uid];
    saveData(data);

    if (count >= VIOLATION_THRESHOLD) {
        await performExile(message.author, message.guild, EXILE_DURATION_MINS, 'Automated Rule Enforcement');
        const freshData = loadData();
        freshData.violations[uid] = 0;
        saveData(freshData);
    } else {
        const embed = new EmbedBuilder()
            .setDescription(`⚠️ ${message.author} keep trades in <#${TARGET_CHANNEL_ID}>!`)
            .setColor(0xFFFFFF)
            .setFooter({ text: `Violation ${count}/${VIOLATION_THRESHOLD}` });
        const sent = await message.channel.send({ embeds: [embed] });
        setTimeout(() => sent.delete().catch(() => {}), 10000);
    }
}

async function performExile(userOrMember, guild, minutes, reason) {
    const data = loadData();
    let member = userOrMember.roles
        ? userOrMember
        : (guild.members.cache.get(userOrMember.id) || await guild.members.fetch(userOrMember.id).catch(() => null));
    if (!member) return;

    const oldRoleIds = member.roles.cache
        .filter(r => !r.managed && r.id !== guild.id && r.id !== EXILED_ROLE_ID)
        .map(r => r.id);

    data.exiles[member.id] = {
        old_roles: oldRoleIds,
        expiry:    Date.now() / 1000 + minutes * 60,
    };
    saveData(data);

    const exRole = guild.roles.cache.get(EXILED_ROLE_ID);
    if (exRole) {
        try {
            await member.edit({ roles: [exRole], reason });
            await member.send(
                `❌ You've been exiled from **${guild.name}** for ${minutes}m ` +
                `for trading in the wrong channel.`
            ).catch(() => {});
        } catch {}
    }
}

async function performUnexile(member, guild, data) {
    const uid = member.id;
    if (data.exiles[uid]) {
        const roleIds = data.exiles[uid].old_roles;
        const roles   = roleIds.map(rid => guild.roles.cache.get(rid)).filter(Boolean);
        try {
            await member.edit({ roles, reason: 'Exile End' });
            return true;
        } catch {
            const exRole = guild.roles.cache.get(EXILED_ROLE_ID);
            if (exRole && member.roles.cache.has(EXILED_ROLE_ID)) {
                await member.roles.remove(exRole).catch(() => {});
            }
            return true;
        }
    }
    return false;
}

// ══════════════════════════════════════════════════════════
//  ADMIN COMMANDS
// ══════════════════════════════════════════════════════════
async function handleCommands(message) {
    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/\s+/);
    const cmd  = args.shift().toLowerCase();

    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);

    // !unexile @member
    if (cmd === 'unexile' && isAdmin) {
        const mentioned = message.mentions.members?.first();
        if (!mentioned) return;
        const data = loadData();
        const uid  = mentioned.id;
        await performUnexile(mentioned, message.guild, data);
        if (data.exiles[uid]) { delete data.exiles[uid]; saveData(data); }
        await message.channel.send(`✅ Restored ${mentioned}.`);
    }

    // !exile @member [duration]
    else if (cmd === 'exile' && isAdmin) {
        const mentioned = message.mentions.members?.first();
        if (!mentioned) return;
        const duration = parseInt(args[1]) || 45;
        await performExile(mentioned, message.guild, duration, 'Manual Admin Action');
        await message.channel.send(`🔨 Exiled ${mentioned} for ${duration}m.`);
    }

    // !violations @member
    else if (cmd === 'violations' && isAdmin) {
        const mentioned = message.mentions.members?.first();
        if (!mentioned) return;
        const data  = loadData();
        const count = data.violations[mentioned.id] || 0;
        await message.channel.send(`📊 ${mentioned} has **${count}/${VIOLATION_THRESHOLD}** violations.`);
    }

    // !clearviolations @member
    else if (cmd === 'clearviolations' && isAdmin) {
        const mentioned = message.mentions.members?.first();
        if (!mentioned) return;
        const data = loadData();
        data.violations[mentioned.id] = 0;
        saveData(data);
        await message.channel.send(`✅ Cleared violations for ${mentioned}.`);
    }

    // !testscan <text>   — Test the full scanner pipeline on any string. Admin only.
    else if (cmd === 'testscan' && isAdmin) {
        const text = args.join(' ');
        if (!text) return;

        const cleaned  = fullClean(text);
        const nospace  = cleaned.replace(/[\s_]/g, '');

        const fruits = scanForFruits(cleaned);
        for (const f of FRUITS) {
            const fc = f.replace(/[\s\-]/g, '');
            if (nospace.includes(fc) && !fruits.includes(f)) fruits.push(f);
        }

        const bosses = scanForBosses(cleaned);
        for (const b of BOSSES) {
            const bc = b.replace(/[\s\-']/g, '');
            if (bc.length >= 4 && nospace.includes(bc) && !bosses.includes(b)) bosses.push(b);
        }

        let intent = scanForIntent(cleaned);
        if (!intent) {
            for (const kw of INTENT_PHRASE) {
                const kwNs = kw.replace(/\s/g, '').replace(/-/g, '');
                if (kwNs.length >= 5 && nospace.includes(kwNs)) { intent = true; break; }
            }
        }

        const svcIntent = scanForServiceIntent(cleaned);

        let exchange = tradeRegex.test(cleaned);
        if (!exchange) {
            for (const pat of NOSPACE_PATTERNS) {
                if (pat.test(nospace)) { exchange = true; break; }
            }
        }

        const bossHit   = bossRegex.test(cleaned);
        const fruitRaid = fruitRaidRegex.test(cleaned);
        const svcRaid   = svcForRaidRegex.test(cleaned);

        const total     = fruits.length;
        const tradeFlag = exchange || (intent && total >= 1);
        const svcFlag   = svcRaid || (bosses.length > 0 && svcIntent) || bossHit || fruitRaid;

        const embed = new EmbedBuilder()
            .setTitle('🔬 Scanner Test')
            .setColor(0x00FF88)
            .addFields(
                { name: 'Cleaned Input',          value: `\`${cleaned.slice(0, 200)}\``,              inline: false },
                { name: 'Fruits Found',            value: fruits.length  ? fruits.join(', ')  : 'None', inline: false },
                { name: 'Bosses Found',            value: bosses.length  ? bosses.join(', ')  : 'None', inline: false },
                { name: 'Trade Intent',            value: intent     ? '✅ YES' : '❌ NO',             inline: true  },
                { name: 'Service Intent',          value: svcIntent  ? '✅ YES' : '❌ NO',             inline: true  },
                { name: 'Direct Exchange',         value: exchange   ? '✅ YES' : '❌ NO',             inline: true  },
                { name: 'Boss Regex Hit',          value: bossHit    ? '✅ YES' : '❌ NO',             inline: true  },
                { name: 'Fruit+Raid',              value: fruitRaid  ? '✅ YES' : '❌ NO',             inline: true  },
                { name: 'Svc-for-Raid',            value: svcRaid    ? '✅ YES' : '❌ NO',             inline: true  },
                { name: 'Would Flag (Trade)?',     value: tradeFlag  ? '🚨 YES' : '✅ CLEAN',         inline: true  },
                { name: 'Would Flag (Service)?',   value: svcFlag    ? '🚨 YES' : '✅ CLEAN',         inline: true  },
            );
        await message.channel.send({ embeds: [embed] });
    }
}

client.login(TOKEN);
