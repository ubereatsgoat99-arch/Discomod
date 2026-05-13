// ╔══════════════════════════════════════════════════════════════════════╗
// ║  SKYNET V7 — MATH COMMANDS MODULE                                    ║
// ║  Backends: arb · cln · fricas · ginac · gmp · linbox · mpfr ·        ║
// ║            mpmath · numpy · pari · sage · scipy                       ║
// ║  Features: multiline input (modal) · multiline output chunking ·      ║
// ║            RAM-aware chunked computation (auto-parts on OOM)          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

// ─── HOW TO INTEGRATE INTO DISCOMOD.js ──────────────────────────────────────
//
//  1. At the top of DISCOMOD.js, add:
//       const mathMod = require('./math_commands');
//
//  2. Inside the big `slashCommands` array (before the `.map(c => c.toJSON())`),
//     add at the end:
//       ...mathMod.mathSlashCommandBuilders,
//
//     This adds ONE /math command (with subcommands run/all/status/ramset)
//     instead of 15 separate commands, staying under Discord's 100-command limit.
//     Users invoke it as:  /math run <backend> [expression]
//                          /math all [expression]
//                          /math status
//                          /math ramset <mb>
//
//  3. At the VERY TOP of the interactionCreate handler (before any other checks):
//       if (await mathMod.handleMathInteraction(interaction)) return;
//
//  4. Inside the messageCreate handler, before other command parsing:
//       if (await mathMod.handleMathMessage(message)) return;
//
// ─────────────────────────────────────────────────────────────────────────────

const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    PermissionsBitField,
} = require('discord.js');
const { spawn } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ══════════════════════════════════════════════════════════
//  CONFIG  (override via .env)
// ══════════════════════════════════════════════════════════
const MATH_RAM_LIMIT_MB  = parseInt(process.env.MATH_RAM_LIMIT_MB  || '512');
const MATH_TIMEOUT_S     = parseInt(process.env.MATH_TIMEOUT_S     || '110');
const MATH_CHUNK_SIZE    = 1800;   // characters per Discord message chunk
const MATH_MAX_PARTS     = 20;    // safety cap on auto-parts
const MATH_SESSION_TTL   = 5 * 60 * 1000;  // modal session lifetime (5 min)

// ══════════════════════════════════════════════════════════
//  PYTHON MATH WORKER  (embedded, spawned once)
// ══════════════════════════════════════════════════════════
const MATH_WORKER_PY = String.raw`
import sys, json, gc, os, traceback, threading, time, ctypes, io, shutil, resource, subprocess, tempfile
sys.set_int_max_str_digits(0)

MAX_RAM_MB  = float(os.environ.get('MATH_RAM_LIMIT_MB', '512'))
TIMEOUT_S   = float(os.environ.get('MATH_TIMEOUT_S',    '110'))

# ── Availability table ───────────────────────────────────
AVAIL = {}

def _try(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False

AVAIL['mpmath']  = _try('mpmath')
AVAIL['numpy']   = _try('numpy')
AVAIL['scipy']   = _try('scipy')
AVAIL['sympy']   = _try('sympy')
AVAIL['gmp']     = _try('gmpy2')
AVAIL['mpfr']    = _try('gmpy2')
AVAIL['ginac']   = _try('symengine')
AVAIL['linbox']  = _try('linbox')
AVAIL['cln']     = _try('cln')
AVAIL['pari']    = _try('cypari2')
AVAIL['arb']     = _try('flint')
AVAIL['sage']    = shutil.which('sage')    is not None
AVAIL['fricas']  = shutil.which('fricas')  is not None

# ── RAM helpers ──────────────────────────────────────────
def _rss_mb():
    try:
        with open('/proc/self/status') as f:
            for line in f:
                if line.startswith('VmRSS:'):
                    return int(line.split()[1]) / 1024.0
    except Exception:
        pass
    try:
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except Exception:
        return 0.0

def _gc():
    gc.collect(); gc.collect(); gc.collect()

class _MemInterrupt(Exception):
    pass
class _TimeoutInterrupt(Exception):
    pass

def _kill_thread(tid, exc_cls):
    try:
        ctypes.pythonapi.PyThreadState_SetAsyncExc(
            ctypes.c_ulong(tid), ctypes.py_object(exc_cls))
    except Exception:
        pass

# ── Monitored exec ───────────────────────────────────────
def monitored_exec(code, globs, locs, ram_mb, timeout_s):
    """
    Run code in a daemon thread.
    Monitor RAM + time in main thread.
    Returns: (output_str, partial_flag, error_str)
    """
    out_buf  = io.StringIO()
    err_ref  = [None]
    done_ev  = threading.Event()
    tid_ref  = [None]
    partial  = [False]

    # Override print so it flushes to our buffer
    def _print(*args, **kwargs):
        sep = kwargs.get('sep', ' ')
        end = kwargs.get('end', '\n')
        out_buf.write(sep.join(str(a) for a in args) + end)

    globs_merged = dict(globs)
    globs_merged['print'] = _print
    locs['print'] = _print

    def _target():
        tid_ref[0] = threading.get_ident()
        try:
            exec(compile(code, '<math>', 'exec'), globs_merged, locs)
        except (_MemInterrupt, _TimeoutInterrupt, MemoryError) as e:
            partial[0] = True
            err_ref[0] = str(e)
        except SystemExit:
            err_ref[0] = "SystemExit called"
        except Exception:
            err_ref[0] = traceback.format_exc()
        finally:
            done_ev.set()

    t = threading.Thread(target=_target, daemon=True)
    t.start()

    # Wait for TID
    for _ in range(40):
        if tid_ref[0]: break
        time.sleep(0.01)

    start = time.time()
    while not done_ev.is_set():
        elapsed = time.time() - start
        ram = _rss_mb()
        if ram > ram_mb:
            partial[0] = True
            err_ref[0] = f"RAM limit {ram_mb:.0f} MB exceeded (current {ram:.0f} MB)"
            _kill_thread(tid_ref[0], _MemInterrupt)
            break
        if elapsed > timeout_s:
            partial[0] = True
            err_ref[0] = f"Timeout after {timeout_s:.0f}s"
            _kill_thread(tid_ref[0], _TimeoutInterrupt)
            break
        time.sleep(0.25)

    done_ev.wait(timeout=4)

    output = out_buf.getvalue()

    # If no print() output but locs has 'result', show that
    if not output.strip() and 'result' in locs:
        output = str(locs['result'])

    return output, partial[0], err_ref[0]

# ── Backend: subprocess runner (for sage / fricas) ───────
def _run_subprocess_backend(cmd_args, input_code, timeout_s):
    try:
        r = subprocess.run(
            cmd_args, input=input_code,
            capture_output=True, text=True,
            timeout=timeout_s
        )
        out = (r.stdout or '') + (r.stderr or '')
        return out.strip() or '(No output)', False, None
    except subprocess.TimeoutExpired:
        return '', True, f'Timeout after {timeout_s:.0f}s'
    except FileNotFoundError as e:
        return '', False, f'Not found: {e}'
    except Exception:
        return '', False, traceback.format_exc()

# ── Base exec helper ─────────────────────────────────────
def _base_exec(code, globs, ram_mb, timeout_s):
    locs = {}
    return monitored_exec(code, globs, locs, ram_mb, timeout_s)

# ── BACKENDS ─────────────────────────────────────────────

def _run_mpmath(code, ram_mb, timeout_s):
    if not AVAIL['mpmath']:
        return '', False, 'mpmath is not installed  |  pip install mpmath'
    import mpmath
    globs = {'mpmath': mpmath, 'mp': mpmath.mp}
    globs.update({k: getattr(mpmath, k) for k in dir(mpmath) if not k.startswith('_')})
    return _base_exec(code, globs, ram_mb, timeout_s)

def _run_numpy(code, ram_mb, timeout_s):
    if not AVAIL['numpy']:
        return '', False, 'numpy is not installed  |  pip install numpy'
    import numpy as np
    globs = {'np': np, 'numpy': np}
    globs.update({k: getattr(np, k) for k in dir(np) if not k.startswith('_')})
    return _base_exec(code, globs, ram_mb, timeout_s)

def _run_scipy(code, ram_mb, timeout_s):
    if not AVAIL['scipy']:
        return '', False, 'scipy is not installed  |  pip install scipy'
    import scipy, numpy as np
    import importlib
    globs = {'scipy': scipy, 'np': np, 'numpy': np}
    for sub in ['optimize','integrate','linalg','signal','stats','fft','special','sparse','interpolate']:
        try: globs[sub] = importlib.import_module(f'scipy.{sub}')
        except Exception: pass
    return _base_exec(code, globs, ram_mb, timeout_s)

def _run_pari(code, ram_mb, timeout_s):
    if not AVAIL['pari']:
        return '', False, 'cypari2 not installed  |  pip install cypari2'
    try:
        from cypari2 import Pari
        pari = Pari()
        result = pari.eval(code)
        return str(result), False, None
    except Exception:
        return '', False, traceback.format_exc()

def _run_gmp(code, ram_mb, timeout_s):
    if not AVAIL['gmp']:
        return '', False, 'gmpy2 not installed  |  pip install gmpy2'
    import gmpy2
    globs = {
        'gmpy2': gmpy2,
        'mpz':   gmpy2.mpz,
        'mpq':   gmpy2.mpq,
        'mpfr':  gmpy2.mpfr,
        'mpc':   gmpy2.mpc,
    }
    return _base_exec(code, globs, ram_mb, timeout_s)

def _run_mpfr(code, ram_mb, timeout_s):
    if AVAIL['gmp']:
        import gmpy2
        globs = {
            'gmpy2': gmpy2,
            'mpfr':  gmpy2.mpfr,
            'mpz':   gmpy2.mpz,
            'mpq':   gmpy2.mpq,
            'mpc':   gmpy2.mpc,
            'set_context': gmpy2.set_context,
            'get_context': gmpy2.get_context,
            'context':     gmpy2.context,
        }
        return _base_exec(code, globs, ram_mb, timeout_s)
    if AVAIL['mpmath']:
        # mpmath uses libmpfr internally — usable as fallback
        out, p, err = _run_mpmath(code, ram_mb, timeout_s)
        note = '\n[mpfr: gmpy2 not found, using mpmath (also backed by libmpfr)]'
        return (out or '') + note, p, err
    return '', False, 'mpfr requires gmpy2  |  pip install gmpy2'

def _run_arb(code, ram_mb, timeout_s):
    if AVAIL['arb']:
        import flint
        globs = {'flint': flint}
        # expose arb, acb, fmpz, fmpq, fmpz_mat, etc.
        for attr in dir(flint):
            if not attr.startswith('_'):
                globs[attr] = getattr(flint, attr)
        globs['arb'] = getattr(flint, 'arb', None) or flint
        return _base_exec(code, globs, ram_mb, timeout_s)
    # Fallback: mpmath approximates ball arithmetic
    if AVAIL['mpmath']:
        out, p, err = _run_mpmath(code, ram_mb, timeout_s)
        note = '\n[arb: python-flint not found, using mpmath as ball-arithmetic fallback  |  pip install python-flint]'
        return (out or '') + note, p, err
    return '', False, 'arb requires python-flint  |  pip install python-flint'

def _run_fricas(code, ram_mb, timeout_s):
    if not AVAIL['fricas']:
        return '', False, 'FriCAS not installed  |  apt install fricas  (or brew install fricas)'
    # Write to a temp file and run fricas in batch mode
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.input', delete=False) as f:
            f.write(code + '\n)quit\n')
            fname = f.name
        out, p, err = _run_subprocess_backend(
            ['fricas', '-nosman', '-nox'],
            f')read {fname}\n)quit\n',
            timeout_s
        )
        try: os.unlink(fname)
        except: pass
        return out, p, err
    except Exception:
        return '', False, traceback.format_exc()

def _run_ginac(code, ram_mb, timeout_s):
    if AVAIL['ginac']:
        import symengine
        globs = {'symengine': symengine, 'ginac': symengine}
        globs.update({k: getattr(symengine, k) for k in dir(symengine) if not k.startswith('_')})
        return _base_exec(code, globs, ram_mb, timeout_s)
    # Fallback: SymPy (same CAS concepts)
    if AVAIL['sympy']:
        import sympy
        globs = {'sympy': sympy, 'ginac': sympy}
        globs.update({k: getattr(sympy, k) for k in dir(sympy) if not k.startswith('_')})
        out, p, err = _base_exec(code, globs, ram_mb, timeout_s)
        note = '\n[ginac: symengine not found, using SymPy as CAS fallback  |  pip install symengine]'
        return (out or '') + note, p, err
    return '', False, 'GiNaC requires symengine  |  pip install symengine'

def _run_linbox(code, ram_mb, timeout_s):
    if AVAIL['linbox']:
        import linbox
        globs = {'linbox': linbox}
        return _base_exec(code, globs, ram_mb, timeout_s)
    # Fallback: numpy linalg
    if AVAIL['numpy']:
        import numpy as np
        globs = {'np': np, 'numpy': np, 'linbox': np.linalg}
        globs.update({k: getattr(np.linalg, k) for k in dir(np.linalg) if not k.startswith('_')})
        out, p, err = _base_exec(code, globs, ram_mb, timeout_s)
        note = '\n[linbox: python-linbox not found, using numpy.linalg as fallback]'
        return (out or '') + note, p, err
    return '', False, 'LinBox requires linbox  |  pip install linbox'

def _run_cln(code, ram_mb, timeout_s):
    if AVAIL['cln']:
        import cln
        globs = {'cln': cln}
        globs.update({k: getattr(cln, k) for k in dir(cln) if not k.startswith('_')})
        return _base_exec(code, globs, ram_mb, timeout_s)
    # Fallback: mpmath (similar arbitrary-precision)
    if AVAIL['mpmath']:
        out, p, err = _run_mpmath(code, ram_mb, timeout_s)
        note = '\n[cln: python-cln not found, using mpmath as fallback  |  pip install cln]'
        return (out or '') + note, p, err
    return '', False, 'CLN requires python-cln  |  pip install cln'

def _run_sage(code, ram_mb, timeout_s):
    if not AVAIL['sage']:
        return '', False, 'SageMath not installed  |  https://sagemath.org  or  conda install -c conda-forge sage'
    out, p, err = _run_subprocess_backend(['sage', '--nodotsage', '-c', code], None, timeout_s)
    return out, p, err

# ── Dispatch table ───────────────────────────────────────
BACKENDS = {
    'mpmath':  _run_mpmath,
    'numpy':   _run_numpy,
    'scipy':   _run_scipy,
    'pari':    _run_pari,
    'gmp':     _run_gmp,
    'mpfr':    _run_mpfr,
    'arb':     _run_arb,
    'fricas':  _run_fricas,
    'ginac':   _run_ginac,
    'linbox':  _run_linbox,
    'cln':     _run_cln,
    'sage':    _run_sage,
}

# ── RPC loop ─────────────────────────────────────────────
def _reply(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req    = json.loads(line)
        rid    = req.get('id')
        method = req.get('method')
        params = req.get('params') or {}

        # ── ping ─────────────────────────────────────────
        if method == 'math_ping':
            _reply({'id': rid, 'ok': True, 'result': AVAIL})
            continue

        # ── eval ─────────────────────────────────────────
        if method == 'math_eval':
            backend   = str(params.get('backend', 'mpmath')).lower()
            code      = str(params.get('code', ''))
            ram_mb    = float(params.get('ram_mb',  MAX_RAM_MB))
            timeout_s = float(params.get('timeout', TIMEOUT_S))

            fn = BACKENDS.get(backend)
            if fn is None:
                _reply({'id': rid, 'ok': False,
                        'error': f'Unknown backend: {backend}. Valid: {list(BACKENDS)}'})
                continue

            _gc()
            try:
                output, is_partial, err = fn(code, ram_mb, timeout_s)
            except Exception:
                output, is_partial, err = '', False, traceback.format_exc()
            _gc()

            _reply({'id': rid, 'ok': True, 'result': {
                'output':    output or '',
                'partial':   is_partial,
                'error':     err or None,
                'backend':   backend,
                'ram_limit': ram_mb,
            }})
            continue

        _reply({'id': rid, 'ok': False, 'error': f'Unknown method: {method}'})

    except Exception:
        try:
            _reply({'id': None, 'ok': False, 'error': traceback.format_exc()})
        except Exception:
            pass
`;

// ══════════════════════════════════════════════════════════
//  MathWorker class
// ══════════════════════════════════════════════════════════
class MathWorker {
    constructor() {
        this.proc    = null;
        this.pending = new Map();
        this.nextId  = 1;
        this.buf     = '';
    }

    start() {
        if (this.proc) return;
        const venvPy = process.env.PYTHON_BIN
            || (process.env.HOME ? path.join(process.env.HOME, 'venvs', 'advikmathlib_env', 'bin', 'python') : null);
        const pythonExe = (venvPy && fs.existsSync(venvPy)) ? venvPy : 'python3';
        this.proc = spawn(pythonExe, ['-u', '-c', MATH_WORKER_PY], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                MATH_RAM_LIMIT_MB: String(MATH_RAM_LIMIT_MB),
                MATH_TIMEOUT_S:    String(MATH_TIMEOUT_S),
            },
        });
        this.proc.stdout.on('data', d => this._onData(d));
        this.proc.stderr.on('data', () => {});
        this.proc.on('exit', () => {
            this.proc = null;
            for (const [, p] of this.pending) {
                try { p.reject(new Error('MathWorker exited')); } catch {}
            }
            this.pending.clear();
        });
    }

    _onData(d) {
        this.buf += d.toString('utf8');
        let idx;
        while ((idx = this.buf.indexOf('\n')) !== -1) {
            const line = this.buf.slice(0, idx).trim();
            this.buf   = this.buf.slice(idx + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            const p = this.pending.get(msg.id);
            if (!p) continue;
            this.pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.result);
            else        p.reject(new Error(String(msg.error || 'MathWorker error')));
        }
    }

    request(method, params) {
        this.start();
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                this.proc.stdin.write(JSON.stringify({ id, method, params: params || {} }) + '\n');
            } catch (e) {
                this.pending.delete(id);
                reject(e);
            }
        });
    }

    /** Restart the worker process (purges RAM for next computation). */
    restart() {
        if (this.proc) {
            try { this.proc.kill(); } catch {}
            this.proc = null;
        }
        this.pending.clear();
        this.buf = '';
        this.start();
    }

    /** Send a ping and return the availability map. */
    async ping() {
        try { return await this.request('math_ping', {}); }
        catch { return {}; }
    }

    /**
     * Evaluate `code` with a given backend.
     * Automatically retries with a fresh worker process if RAM was exceeded,
     * for up to MATH_MAX_PARTS parts, collecting all partial outputs.
     *
     * @returns {{ parts: string[], totalParts: number, errors: string[] }}
     */
    async evalChunked(backend, code, ramMb, timeoutS) {
        const parts  = [];
        const errors = [];
        let   partN  = 0;

        for (let attempt = 0; attempt < MATH_MAX_PARTS; attempt++) {
            let res;
            try {
                res = await this.request('math_eval', {
                    backend, code,
                    ram_mb:  ramMb  || MATH_RAM_LIMIT_MB,
                    timeout: timeoutS || MATH_TIMEOUT_S,
                });
            } catch (e) {
                errors.push(String(e.message || e));
                break;
            }

            const output  = String(res.output  || '').trim();
            const isPartial = !!res.partial;
            const errMsg    = res.error ? String(res.error) : null;

            if (output) {
                partN++;
                parts.push(output);
            }
            if (errMsg) errors.push(errMsg);

            if (!isPartial) break;

            // ── RAM was exceeded: restart the worker to free memory,
            //    then loop again so the user code can continue printing
            //    (only useful if the code does incremental printing).
            this.restart();
            // Brief pause so the OS can reclaim memory
            await new Promise(r => setTimeout(r, 600));
        }

        return { parts, totalParts: partN, errors };
    }
}

const mathWorker = new MathWorker();
mathWorker.start();

// ══════════════════════════════════════════════════════════
//  PENDING MODAL SESSIONS
//  When a user triggers a math slash command without an inline
//  expression, we show them a modal.  We need to remember which
//  backend they chose until the modal is submitted.
// ══════════════════════════════════════════════════════════
const _mathModalSessions = new Map();  // sessionId → { backend, userId, timestamp }

// Per-user multiline accumulation for /math run  (same pattern as /wolf, /gaypy etc.)
const _mathRunSessions = new Map();  // userId → { backend, lines: string[] }

function _saveModalSession(sessionId, backend, userId) {
    _mathModalSessions.set(sessionId, { backend, userId, timestamp: Date.now() });
    // GC old sessions
    const cutoff = Date.now() - MATH_SESSION_TTL;
    for (const [k, v] of _mathModalSessions) {
        if (v.timestamp < cutoff) _mathModalSessions.delete(k);
    }
}

function _popModalSession(sessionId) {
    const s = _mathModalSessions.get(sessionId);
    if (s) _mathModalSessions.delete(sessionId);
    return s || null;
}

// ══════════════════════════════════════════════════════════
//  OUTPUT FORMATTING
// ══════════════════════════════════════════════════════════

/**
 * Split a long string into Discord-safe code-block chunks.
 * Each chunk fits within 2000 characters (the Discord message limit).
 */
function _chunkOutput(text) {
    const wrap  = '```\n';
    const close = '\n```';
    const maxInner = MATH_CHUNK_SIZE - wrap.length - close.length;
    const s = String(text || '(No output)');
    const chunks = [];
    for (let i = 0; i < s.length; i += maxInner) {
        chunks.push(wrap + s.slice(i, i + maxInner) + close);
    }
    return chunks.length ? chunks : [wrap + '(No output)' + close];
}

/**
 * Send all output chunks to a Discord channel or interaction.
 * Supports very long outputs by splitting across multiple messages.
 */
async function _sendResults({ interaction, channel, backend, resolvedBackend, parts, errors, isPartial, ramMb }) {
    const EMOJI = {
        mpmath: '🔢', numpy: '📐', scipy: '🔬', pari: '🔣',
        gmp: '🔏', mpfr: '🎯', arb: '⚽', fricas: '🌀',
        ginac: '✨', linbox: '🗂️', cln: '🔠', sage: '🌿',
    };
    const emojiKey = resolvedBackend || backend;
    const emoji = EMOJI[emojiKey] || '🧮';

    const totalParts = parts.length;
    const allText    = parts.join('\n\n--- Part Break ---\n\n');
    const chunks     = _chunkOutput(allText || '(No output)');

    // ── Build header embed ──────────────────────────────
    const headerEmbed = new EmbedBuilder()
        .setTitle(`${emoji} Math Result — ${backend.toUpperCase()}`)
        .setColor(isPartial ? 0xFF8800 : 0x00CC66)
        .addFields(
            { name: 'Backend', value: backend,            inline: true },
            { name: 'Parts',   value: String(totalParts), inline: true },
            { name: 'Chunks',  value: String(chunks.length), inline: true },
        )
        .setTimestamp();

    if (isPartial) {
        headerEmbed.addFields({
            name: '⚠️ Computation Truncated',
            value: `RAM limit **${ramMb} MB** was reached. Output shown is partial.\n`
                 + `To work around this:\n`
                 + `• Use \`print()\` at each step so partial results are captured.\n`
                 + `• Reduce problem size and re-run.\n`
                 + `• Increase \`MATH_RAM_LIMIT_MB\` in your \`.env\`.`,
        });
    }

    if (errors.length) {
        headerEmbed.addFields({
            name: '🔴 Errors',
            value: errors.map(e => e.slice(0, 500)).join('\n').slice(0, 1024),
        });
    }

    // ── Send ─────────────────────────────────────────────
    const send = async (payload) => {
        if (interaction) {
            if (!interaction.deferred && !interaction.replied) {
                try { await interaction.deferReply(); } catch {}
            }
            try {
                if (payload.embeds) await interaction.editReply(payload);
                else                await interaction.followUp(payload);
            } catch {
                try { await interaction.followUp(payload); } catch {}
            }
        } else if (channel) {
            await channel.send(payload).catch(() => {});
        }
    };

    await send({ embeds: [headerEmbed] });
    for (const chunk of chunks) {
        await send({ content: chunk });
    }
}

// ══════════════════════════════════════════════════════════
//  MODAL BUILDER  (multiline input)
// ══════════════════════════════════════════════════════════
function _buildMathModal(backend, sessionId) {
    const HINTS = {
        mpmath:  'mp.dps = 50\nresult = mpmath.pi\nprint(result)',
        numpy:   'import numpy as np\nA = np.array([[1,2],[3,4]])\nprint(np.linalg.det(A))',
        scipy:   'from scipy.integrate import quad\nresult, err = quad(lambda x: x**2, 0, 1)\nprint(result)',
        pari:    'factor(2^64 - 1)',
        gmp:     'result = mpz(2)**1000\nprint(result)',
        mpfr:    'ctx = get_context()\nctx.precision = 200\nresult = mpfr(1) / mpfr(3)\nprint(result)',
        arb:     'x = arb("3.14159")\nprint(x.sin())',
        fricas:  'integrate(x^2, x)',
        ginac:   'x = Symbol("x")\nresult = expand((x+1)**10)\nprint(result)',
        linbox:  'import numpy as np\nA = np.array([[2,1],[5,3]])\nresult = np.linalg.det(A)\nprint(result)',
        cln:     'result = mpmath.pi\nprint(result)',
        sage:    'print(factor(2^128 - 1))',
    };
    const placeholder = HINTS[backend] || 'Enter your code here...';

    const modal = new ModalBuilder()
        .setCustomId(`math_modal_${sessionId}`)
        .setTitle(`🧮 ${backend.toUpperCase()} Math Input`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('math_code')
                .setLabel(`${backend.toUpperCase()} code (multiline supported)`)
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(1)
                .setMaxLength(4000)
                .setRequired(true)
                .setPlaceholder(placeholder)
        )
    );
    return modal;
}

// ══════════════════════════════════════════════════════════
//  CORE EVAL PIPELINE  (used by slash + message commands)
// ══════════════════════════════════════════════════════════

/** Lightweight reply helper that works whether or not the interaction is deferred. */
async function safeReplyMath(interaction, content) {
    if (!interaction) return;
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, ephemeral: false });
        }
    } catch {
        try { await interaction.followUp({ content }); } catch {}
    }
}

async function runMathEval({ interaction, channel, backend, code, userId }) {
    // Show "computing…" indicator
    if (interaction) {
        if (!interaction.deferred && !interaction.replied) {
            try { await interaction.deferReply(); } catch {}
        }
        try {
            await interaction.editReply({
                content: `⏳ **${backend.toUpperCase()}** — computing… (RAM limit: ${MATH_RAM_LIMIT_MB} MB)`,
            });
        } catch {}
    } else if (channel) {
        channel.sendTyping().catch(() => {});
    }

    // Resolve friendly display name → real Python backend name
    const resolvedBackend = BACKEND_ALIAS[backend] || backend;

    const { parts, totalParts, errors } = await mathWorker.evalChunked(
        resolvedBackend, code, MATH_RAM_LIMIT_MB, MATH_TIMEOUT_S
    );

    const isPartial = errors.some(e => /RAM limit|timeout|exceeded/i.test(e));

    await _sendResults({
        interaction, channel,
        backend,         // display name for the embed title
        resolvedBackend, // actual backend for the emoji lookup
        parts, errors, isPartial,
        ramMb: MATH_RAM_LIMIT_MB,
    });
}

// ══════════════════════════════════════════════════════════
//  SLASH COMMAND BUILDERS
//  Each backend gets its own top-level slash command.
//  All share the same shape:
//    /math<backend> [expression:string]  [multiline:boolean]
//  Omitting expression (or setting multiline true) opens a modal.
// ══════════════════════════════════════════════════════════

const BACKENDS_META = [
    { name: 'precision', desc: 'Perform high-precision interval arithmetic' }, // was arb
    { name: 'algebra',   desc: 'Symbolic algebraic manipulations' },          // was cln
    { name: 'symbolic',  desc: 'Advanced symbolic math and calculus' },       // was fricas
    { name: 'geometry',  desc: 'Interactive geometry computations' },         // was ginac
    { name: 'integers',  desc: 'High-speed integer arithmetic' },              // was gmp
    { name: 'matrices',  desc: 'Linear algebra and matrix math' },            // was linbox
    { name: 'floats',    desc: 'Multi-precision floating-point math' },       // was mpfr
    { name: 'analysis',  desc: 'Numerical analysis and functions' },          // was mpmath
    { name: 'arrays',    desc: 'Fast array and vector processing' },          // was numpy
    { name: 'theory',    desc: 'Number theory and modular math' },            // was pari
    { name: 'advanced',  desc: 'General-purpose advanced math suite' },       // was sage
    { name: 'scientific',desc: 'Scientific and engineering tools' },          // was scipy
];

// ── Maps the user-facing display names → the actual Python backend keys ──────
// Without this, sending 'symbolic' to the Python worker causes
// "Unknown backend: symbolic. Valid: ['mpmath', ...]"
const BACKEND_ALIAS = {
    precision: 'arb',
    algebra:   'cln',
    symbolic:  'fricas',
    geometry:  'ginac',
    integers:  'gmp',
    matrices:  'linbox',
    floats:    'mpfr',
    analysis:  'mpmath',
    arrays:    'numpy',
    theory:    'pari',
    advanced:  'sage',
    scientific: 'scipy',
};

/**
 * Single /math command with subcommands:
 *   /math run <backend> [expression]  — run code on a specific backend
 *   /math all [expression]            — run on every available backend
 *   /math status                      — show which backends are installed
 *   /math ramset <mb>                 — change RAM limit (Manage Messages required)
 *
 * This counts as ONE slash command instead of 15, staying well under Discord's 100-command limit.
 */
const mathSlashCommandBuilders = [
    new SlashCommandBuilder()
        .setName('math')
        .setDescription('🧮 Math computation — run code across multiple backends')

        // ── /math run ──────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('run')
               .setDescription('Run code on a specific math backend')
               .addStringOption(o =>
                   o.setName('backend')
                    .setDescription('Which math backend to use')
                    .setRequired(true)
                    .addChoices(
                        ...BACKENDS_META.map(({ name, desc }) => ({
                            name: `${name} — ${desc}`.slice(0, 100),
                            value: name,
                        }))
                    )
               )
               .addStringOption(o =>
                   o.setName('expression')
                    .setDescription('Inline code/expression (leave blank to open multiline modal)')
                    .setRequired(false)
               )
        )

        // ── /math all ──────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('all')
               .setDescription('🧮 Run the same code on ALL available backends and compare results')
               .addStringOption(o =>
                   o.setName('expression')
                    .setDescription('Inline code (leave blank to open multiline modal)')
                    .setRequired(false)
               )
        )

        // ── /math status ───────────────────────────────
        .addSubcommand(sub =>
            sub.setName('status')
               .setDescription('📊 Show which math backends are installed and available')
        )

        // ── /math ramset ───────────────────────────────
        .addSubcommand(sub =>
            sub.setName('ramset')
               .setDescription('⚙️ Set the RAM limit (MB) for math computations (requires Manage Messages)')
               .addIntegerOption(o =>
                   o.setName('mb')
                    .setDescription('RAM limit in MB (64 – 32768)')
                    .setRequired(true)
               )
        ),
];

// ══════════════════════════════════════════════════════════
//  INTERACTION HANDLER
//  Call this at the very top of your interactionCreate handler.
//  Returns true if the interaction was handled (so you can return early).
// ══════════════════════════════════════════════════════════
async function handleMathInteraction(interaction) {
    // ── Slash commands ─────────────────────────────────
    if (interaction.isChatInputCommand()) {
        const cmd = String(interaction.commandName || '');
        if (cmd !== 'math') return false;  // not ours

        const sub = interaction.options.getSubcommand(false);

        // /math status
        if (sub === 'status') {
            await interaction.deferReply().catch(() => {});
            const avail = await mathWorker.ping();
            const lines = BACKENDS_META.map(({ name, emoji }) => {
                const ok = avail[name];
                return `${ok ? '✅' : '❌'} **${name}** ${emoji || ''}`;
            });
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('📊 Math Backend Status')
                    .setColor(0x5865F2)
                    .setDescription(lines.join('\n'))
                    .addFields({
                        name: '💡 Install missing backends',
                        value: '`pip install mpmath numpy scipy gmpy2 symengine cypari2 python-flint`\n'
                             + 'For Sage: https://sagemath.org\nFor FriCAS: `apt install fricas`',
                    })
                    .setTimestamp()],
            }).catch(() => {});
            return true;
        }

        // /math ramset  (permission checked here since subcommands can't have their own perms)
        if (sub === 'ramset') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
                await interaction.reply({ content: '❌ You need the **Manage Messages** permission to use this.', ephemeral: true });
                return true;
            }
            const mb = interaction.options.getInteger('mb');
            if (mb < 64 || mb > 32768) {
                await interaction.reply({ content: '❌ RAM limit must be between 64 and 32768 MB.', ephemeral: true });
                return true;
            }
            process.env.MATH_RAM_LIMIT_MB = String(mb);
            mathWorker.restart();
            await interaction.reply({ content: `✅ Math RAM limit set to **${mb} MB**. Worker restarted.`, ephemeral: true });
            return true;
        }

        // /math all
        if (sub === 'all') {
            const expr = interaction.options.getString('expression') || '';
            if (!expr) {
                const sid = `mathall_${interaction.id}`;
                _saveModalSession(sid, '__all__', interaction.user.id);
                try {
                    await interaction.showModal(_buildMathModal('all backends', sid));
                } catch {
                    await interaction.reply({ content: '❌ Failed to open modal.', ephemeral: true }).catch(() => {});
                }
                return true;
            }
            await interaction.deferReply().catch(() => {});
            const avail = await mathWorker.ping();
            for (const { name } of BACKENDS_META) {
                if (!avail[name]) continue;
                await runMathEval({
                    interaction: null,
                    channel: interaction.channel,
                    backend: name,
                    code: expr,
                    userId: interaction.user.id,
                });
            }
            try { await interaction.editReply({ content: '✅ All backends finished.' }); } catch {}
            return true;
        }

        // /math run
        if (sub === 'run') {
            const backend = interaction.options.getString('backend');
            const expr    = interaction.options.getString('expression') || '';
            const uid     = interaction.user.id;

            // Check for an active accumulation session for this user
            const st = _mathRunSessions.get(uid) || { backend, lines: [] };

            // "Evaluate" → flush accumulated lines and run
            if (expr.toLowerCase() === 'evaluate' && st.lines.length) {
                _mathRunSessions.delete(uid);
                const combined = st.lines.join('');
                await runMathEval({
                    interaction,
                    channel: interaction.channel,
                    backend: st.backend,
                    code: combined,
                    userId: uid,
                });
                return true;
            }

            // No expression at all and no session → open modal as fallback
            if (!expr && !st.lines.length) {
                const sid = `math_${backend}_${interaction.id}`;
                _saveModalSession(sid, backend, uid);
                try {
                    await interaction.showModal(_buildMathModal(backend, sid));
                } catch {
                    await interaction.reply({ content: '❌ Failed to open modal.', ephemeral: true }).catch(() => {});
                }
                return true;
            }

            // Accumulate this line into the session
            if (expr) {
                st.backend = backend;  // always update backend in case they switch
                st.lines.push(expr);
                _mathRunSessions.set(uid, st);
            }

            await safeReplyMath(interaction,
                `🧮 **${(st.backend || backend).toUpperCase()}** — line ${st.lines.length} saved. `
                + `Send more or type \`Evaluate\` to run.`
            );
            return true;
        }

        return false;  // unknown subcommand
    }

    // ── Modal submissions ──────────────────────────────
    if (interaction.isModalSubmit()) {
        const cid = String(interaction.customId || '');
        if (!cid.startsWith('math_modal_')) return false;

        const sessionId = cid.slice('math_modal_'.length);
        const session   = _popModalSession(sessionId);
        if (!session) {
            await interaction.reply({ content: '❌ Math session expired. Please run the command again.', ephemeral: true }).catch(() => {});
            return true;
        }
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ This modal belongs to a different user.', ephemeral: true }).catch(() => {});
            return true;
        }

        const code    = interaction.fields.getTextInputValue('math_code') || '';
        const backend = session.backend;

        if (backend === '__all__') {
            await interaction.deferReply().catch(() => {});
            const avail = await mathWorker.ping();
            for (const { name } of BACKENDS_META) {
                if (!avail[name]) continue;
                await runMathEval({
                    interaction: null,
                    channel: interaction.channel,
                    backend: name,
                    code,
                    userId: interaction.user.id,
                });
            }
            try { await interaction.editReply({ content: '✅ All backends finished.' }); } catch {}
            return true;
        }

        await runMathEval({
            interaction,
            channel: interaction.channel,
            backend,
            code,
            userId: interaction.user.id,
        });
        return true;
    }

    return false;
}

// ══════════════════════════════════════════════════════════
//  MESSAGE COMMAND HANDLER  (!math<backend> ...)
//  Usage examples:
//    !mathmpmath mp.dps = 50; print(mpmath.pi)
//    !mathnumpy  (no args → shows usage)
//    !mathnumpy
//    (then paste code on next lines — multi-line via Discord code blocks)
//
//  Also supports ``` code blocks:
//    !mathscipy
//    ```python
//    from scipy.integrate import quad
//    result, _ = quad(lambda x: x**2, 0, 1)
//    print(result)
//    ```
// ══════════════════════════════════════════════════════════
async function handleMathMessage(message) {
    if (message.author?.bot) return false;
    const content = String(message.content || '').trim();
    if (!content.startsWith('!math')) return false;

    // Extract command and rest
    const spaceIdx = content.indexOf(' ');
    const cmd = spaceIdx === -1 ? content.slice(1) : content.slice(1, spaceIdx);
    const rest = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim();

    const cmdLow = cmd.toLowerCase();

    // !mathstatus
    if (cmdLow === 'mathstatus') {
        const avail = await mathWorker.ping();
        const lines = BACKENDS_META.map(({ name, emoji }) => {
            const ok = avail[name];
            return `${ok ? '✅' : '❌'} ${name} ${emoji}`;
        });
        await message.channel.send({
            embeds: [new EmbedBuilder()
                .setTitle('📊 Math Backend Status')
                .setColor(0x5865F2)
                .setDescription(lines.join('\n'))
                .setTimestamp()],
        }).catch(() => {});
        return true;
    }

    // !mathramset <mb>
    if (cmdLow === 'mathramset') {
        const isAdmin = message.member?.permissions?.has?.(PermissionsBitField.Flags.ManageMessages);
        if (!isAdmin) {
            await message.channel.send('❌ Admins only.').catch(() => {});
            return true;
        }
        const mb = parseInt(rest);
        if (!mb || mb < 64 || mb > 32768) {
            await message.channel.send('❌ Usage: `!mathramset <64-32768>`').catch(() => {});
            return true;
        }
        process.env.MATH_RAM_LIMIT_MB = String(mb);
        mathWorker.restart();
        await message.channel.send(`✅ Math RAM limit set to **${mb} MB**.`).catch(() => {});
        return true;
    }

    // !mathall
    if (cmdLow === 'mathall') {
        let code = _extractCode(rest);
        if (!code) {
            await message.channel.send('❌ Usage: `!mathall <code>`\nOr wrap code in ` ```...``` `').catch(() => {});
            return true;
        }
        const avail = await mathWorker.ping();
        await message.channel.send('⏳ Running on all available backends…').catch(() => {});
        for (const { name } of BACKENDS_META) {
            if (!avail[name]) continue;
            await runMathEval({
                interaction: null,
                channel: message.channel,
                backend: name,
                code,
                userId: message.author.id,
            });
        }
        return true;
    }

    // !math<backend>
    const backendMatch = BACKENDS_META.find(b => cmdLow === `math${b.name}`);
    if (!backendMatch) return false;

    const backend = backendMatch.name;
    const code    = _extractCode(rest);

    if (!code) {
        await message.channel.send(
            `❌ Usage: \`!math${backend} <expression>\`\n`
            + `Or wrap multi-line code in a code block:\n`
            + `\`\`\`\n!math${backend}\n\`\`\`python\nprint("hello")\n\`\`\`\n\`\`\``
        ).catch(() => {});
        return true;
    }

    await runMathEval({
        interaction: null,
        channel: message.channel,
        backend,
        code,
        userId: message.author.id,
    });
    return true;
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════

/**
 * Extract code from a string that may contain a fenced code block.
 * Supports:
 *   - ```python\n...\n```
 *   - ```\n...\n```
 *   - plain text
 */
function _extractCode(text) {
    if (!text) return '';
    // Check for fenced code block
    const fenceMatch = text.match(/```(?:\w+)?\n?([\s\S]+?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    return text.trim();
}

// ══════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
    mathSlashCommandBuilders,
    handleMathInteraction,
    handleMathMessage,
    mathWorker,       // exposed so main bot can call mathWorker.ping() etc.
    runMathEval,      // exposed for custom usage
};
