/**
 * Python AST verifier — Pass 4 of the v2 healing pipeline (M4).
 *
 * Optional verification: when a Python interpreter is available, healed
 * output is checked with `python -c "import ast; ast.parse(...)"`. On
 * failure, alternative candidate plans (most-likely-first) are retried;
 * if all fail — or no Python exists — the default pipeline result is
 * returned unchanged. Verification must NEVER block or corrupt healing:
 * every failure mode degrades to the Pass 1–3 output.
 *
 * Design notes
 *  - Interpreter discovery is cached once per process (spawning `python
 *    --version` on every paste would be wasteful).
 *  - The parsed source is piped via STDIN (no temp files, no quoting
 *    hazards, unicode-safe).
 *  - Discovery runs with a hard timeout; a hung interpreter (antivirus,
 *    Windows Store stub) is treated as "unavailable".
 *  - Fully dependency-injectable for unit tests: the runPython function
 *    can be replaced, so no test ever requires a real interpreter.
 */

import { spawn } from 'child_process';
import { renderPlanned } from './structure';
import { healIndentationLegacy } from './healer';

/** Result of a single parse attempt. */
export interface ParseCheck {
    ok: boolean;
    /** Human-readable reason when ok is false ('unavailable', 'timeout', 'syntax error at line N', ...). */
    reason?: string;
    /** Line number reported by Python, when applicable. */
    line?: number;
}

export interface VerifyStats {
    verified: boolean;
    pythonAvailable: boolean;
    attempts: number;
    /** Which candidate was finally used (index into candidates) — undefined when the default won. */
    usedCandidate?: number;
}

export type PythonRunner = (
    code: string,
    timeoutMs: number
) => Promise<ParseCheck>;

const DISCOVERY_TIMEOUT_MS = 2000;
const PARSE_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Interpreter discovery
// ---------------------------------------------------------------------------

let cachedRunner: PythonRunner | null | undefined; // undefined = not probed yet

/** Candidate interpreter commands, most common first (cross-platform). */
export function interpreterCandidates(): string[] {
    if (process.platform === 'win32') {
        return ['python', 'py', 'python3'];
    }
    return ['python3', 'python'];
}

/**
 * Build a PythonRunner around a specific interpreter command. Returns null
 * if the command cannot parse (missing, Store stub, hung).
 */
function buildRunner(cmd: string, timeoutMs: number): Promise<PythonRunner | null> {
    return new Promise(resolve => {
        let settled = false;
        const done = (r: PythonRunner | null) => {
            if (settled) { return; }
            settled = true;
            resolve(r);
        };

        try {
            const proc = spawn(cmd, ['-c', 'import ast'], { stdio: 'ignore' });
            const timer = setTimeout(() => {
                proc.kill();
                done(null);
            }, timeoutMs);

            proc.on('error', () => { clearTimeout(timer); done(null); });
            proc.on('close', code => {
                clearTimeout(timer);
                done(code === 0 ? makeRunnerFor(cmd) : null);
            });
        } catch {
            done(null);
        }
    });
}

function makeRunnerFor(cmd: string): PythonRunner {
    return (code: string, timeoutMs: number) => runAstCheck(cmd, code, timeoutMs);
}

/**
 * Run `python -c "import ast, sys; ..."` with source piped to STDIN.
 * Exit 0 = parses; exit 1 = SyntaxError (message on stderr).
 */
function runAstCheck(cmd: string, code: string, timeoutMs: number): Promise<ParseCheck> {
    return new Promise(resolve => {
        let settled = false;
        const finish = (r: ParseCheck) => {
            if (settled) { return; }
            settled = true;
            resolve(r);
        };

        try {
            const proc = spawn(cmd, ['-c', PY_CHECK_SNIPPET], {
                stdio: ['pipe', 'ignore', 'pipe'],
            });
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d.toString(); });

            const timer = setTimeout(() => {
                proc.kill();
                finish({ ok: false, reason: 'timeout' });
            }, timeoutMs);

            proc.on('error', err => {
                clearTimeout(timer);
                finish({ ok: false, reason: `spawn failed: ${err.message}` });
            });

            proc.on('close', exitCode => {
                clearTimeout(timer);
                if (exitCode === 0) {
                    finish({ ok: true });
                    return;
                }
                const m = /line\s+(\d+)/.exec(stderr);
                finish({
                    ok: false,
                    reason: m ? `syntax error at line ${m[1]}` : (stderr.trim().split('\n').pop() || 'syntax error'),
                    line: m ? parseInt(m[1], 10) : undefined,
                });
            });

            proc.stdin?.write(code);
            proc.stdin?.end();
        } catch (err) {
            finish({ ok: false, reason: `spawn failed: ${err}` });
        }
    });
}

const PY_CHECK_SNIPPET = 'import ast, sys; ast.parse(sys.stdin.read())';

/**
 * Discover a working Python interpreter (cached). Returns a runner, or null
 * when no interpreter is usable. Safe to call repeatedly.
 */
export async function discoverPython(timeoutMs = DISCOVERY_TIMEOUT_MS): Promise<PythonRunner | null> {
    if (cachedRunner !== undefined) { return cachedRunner; }
    for (const cmd of interpreterCandidates()) {
        const runner = await buildRunner(cmd, timeoutMs);
        if (runner) {
            cachedRunner = runner;
            return runner;
        }
    }
    cachedRunner = null;
    return null;
}

/** Test hook: force discovery state (null = unavailable, undefined = re-probe). */
export function setPythonRunnerForTests(runner: PythonRunner | null | undefined): void {
    cachedRunner = runner;
}

// ---------------------------------------------------------------------------
// Verification + retry
// ---------------------------------------------------------------------------

export interface VerifyOptions {
    /** Provide a runner directly (tests); skips discovery. */
    runner?: PythonRunner | null;
    /** Force verification off (used when no Python is found). */
    enabled?: boolean;
}

/**
 * Generate healing candidates for `source`, most-likely-first:
 *   0: full v2 pipeline (structure + resolver)
 *   1: v2 structure without the ambiguity resolver
 *   2: legacy v1 engine
 */
export function buildCandidates(source: string): string[] {
    return [
        renderPlanned(source),
        renderPlanned(source, { useResolver: false }),
        healIndentationLegacy(source),
    ];
}

/**
 * Verify the default healed output; if it fails to parse and Python is
 * available, try the remaining candidates in order. Returns the first
 * candidate that parses, or the default candidate when none parse / Python
 * is unavailable. Never throws.
 */
export async function healIndentationVerified(
    source: string,
    opts: VerifyOptions = {}
): Promise<{ text: string; stats: VerifyStats }> {
    const candidates = buildCandidates(source);
    const stats: VerifyStats = { verified: false, pythonAvailable: false, attempts: 0 };

    let runner: PythonRunner | null | undefined = opts.runner;
    if (runner === undefined) {
        try { runner = await discoverPython(); } catch { runner = null; }
    }
    if (!runner) {
        return { text: candidates[0], stats };
    }
    stats.pythonAvailable = true;

    for (let i = 0; i < candidates.length; i++) {
        stats.attempts++;
        try {
            const check = await runner(candidates[i], PARSE_TIMEOUT_MS);
            if (check.ok) {
                stats.verified = true;
                if (i > 0) { stats.usedCandidate = i; }
                return { text: candidates[i], stats };
            }
        } catch {
            break; // verifier failure must never block healing
        }
    }

    return { text: candidates[0], stats };
}
