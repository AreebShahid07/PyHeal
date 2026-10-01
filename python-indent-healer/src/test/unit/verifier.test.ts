import * as assert from 'assert';
import {
    interpreterCandidates,
    discoverPython,
    setPythonRunnerForTests,
    buildCandidates,
    healIndentationVerified,
    PythonRunner,
    ParseCheck,
    VerifyOptions,
} from '../../verifier';
import { renderPlanned } from '../../structure';
import { healIndentationLegacy } from '../../healer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const okCheck: ParseCheck = { ok: true };

/** Runner that reports ok for every input. */
const alwaysOk: PythonRunner = async () => okCheck;

/** Runner that reports failure for every input. */
const alwaysFail: PythonRunner = async () => ({ ok: false, reason: 'syntax error at line 1' });

/** Runner keyed by input: map from exact code text to its check result. */
function runnerFor(results: Map<string, ParseCheck>): PythonRunner {
    return async (code: string) => results.get(code) ?? okCheck;
}

const SAMPLE = 'def f():\nif x:\nreturn 1\nreturn 2';

suite('Verifier (Pass 4) — candidates', () => {

    test('buildCandidates orders: v2+resolver, v2-no-resolver, legacy', () => {
        const c = buildCandidates(SAMPLE);
        assert.strictEqual(c.length, 3);
        assert.strictEqual(c[0], renderPlanned(SAMPLE));
        assert.strictEqual(c[1], renderPlanned(SAMPLE, { useResolver: false }));
        assert.strictEqual(c[2], healIndentationLegacy(SAMPLE));
    });

    test('interpreterCandidates are platform-appropriate', () => {
        const c = interpreterCandidates();
        assert.ok(c.length >= 2);
        if (process.platform === 'win32') {
            assert.ok(c.includes('python') && c.includes('py'));
        } else {
            assert.ok(c.includes('python3'));
        }
    });

});

suite('Verifier (Pass 4) — verified healing with DI runners', () => {

    teardown(() => setPythonRunnerForTests(undefined));

    test('no Python (null runner) → default v2 output, graceful stats', async () => {
        const { text, stats } = await healIndentationVerified(SAMPLE, { runner: null });
        assert.strictEqual(text, renderPlanned(SAMPLE));
        assert.strictEqual(stats.pythonAvailable, false);
        assert.strictEqual(stats.verified, false);
        assert.strictEqual(stats.attempts, 0);
    });

    test('default candidate parses → returned unchanged, verified', async () => {
        const results = new Map<string, ParseCheck>();
        results.set(renderPlanned(SAMPLE), okCheck);
        const { text, stats } = await healIndentationVerified(SAMPLE, { runner: runnerFor(results) });
        assert.strictEqual(text, renderPlanned(SAMPLE));
        assert.strictEqual(stats.verified, true);
        assert.strictEqual(stats.attempts, 1);
        assert.strictEqual(stats.usedCandidate, undefined);
    });

    test('default fails, no-resolver parses → retry uses candidate 1', async () => {
        // R1-active snippet: candidates 0 and 1 genuinely differ here
        // (R1 needs the trailing dedented def to fire).
        const src = 'def can_craft(self, inv):\nfor item, count in inv.items():\nif inv.count(item) < count:\nreturn False\nreturn True\ndef other():\nreturn 0';
        const results = new Map<string, ParseCheck>();
        results.set(renderPlanned(src), { ok: false, reason: 'syntax error at line 4' });
        results.set(renderPlanned(src, { useResolver: false }), okCheck);
        const { text, stats } = await healIndentationVerified(src, { runner: runnerFor(results) });
        assert.strictEqual(text, renderPlanned(src, { useResolver: false }));
        assert.strictEqual(stats.verified, true);
        assert.strictEqual(stats.attempts, 2);
        assert.strictEqual(stats.usedCandidate, 1);
    });

    test('all candidates fail → default v2 output returned, not verified', async () => {
        const { text, stats } = await healIndentationVerified(SAMPLE, { runner: alwaysFail });
        assert.strictEqual(text, renderPlanned(SAMPLE));
        assert.strictEqual(stats.verified, false);
        assert.strictEqual(stats.attempts, 3);
        assert.strictEqual(stats.pythonAvailable, true);
    });

    test('runner throwing → heals degrade to default output (never throws)', async () => {
        const boom: PythonRunner = async () => { throw new Error('boom'); };
        const { text, stats } = await healIndentationVerified(SAMPLE, { runner: boom });
        assert.strictEqual(text, renderPlanned(SAMPLE));
        assert.strictEqual(stats.verified, false);
        assert.strictEqual(stats.attempts, 1);
    });

    test('timeout-check runner: hung parse treated as failure, retry proceeds', async () => {
        let calls = 0;
        const slowThenOk: PythonRunner = async () => {
            calls++;
            if (calls === 1) { return { ok: false, reason: 'timeout' }; }
            return okCheck;
        };
        const { text, stats } = await healIndentationVerified(SAMPLE, { runner: slowThenOk });
        assert.strictEqual(text, renderPlanned(SAMPLE, { useResolver: false }));
        assert.strictEqual(stats.usedCandidate, 1);
    });

    test('cached discovery respects test override', async () => {
        setPythonRunnerForTests(alwaysOk);
        const r = await discoverPython();
        assert.ok(r);
        setPythonRunnerForTests(null);
        const r2 = await discoverPython();
        assert.strictEqual(r2, null);
    });

});

suite('Verifier (Pass 4) — real Python integration', () => {

    // Real interpreter if present; skipped gracefully when absent.
    let realRunner: PythonRunner | null | undefined;
    suiteSetup(async () => {
        realRunner = await discoverPython(3000);
    });

    test('real Python (if installed) verifies healing of ambiguous flat input', async function () {
        if (!realRunner) { this.skip(); }
        // The known ambiguity: value-return after a loop guard. Default v2
        // resolves it to the loop sibling — must parse.
        const src = 'def can_craft(self, inv):\nfor item, count in inv.items():\nif inv.count(item) < count:\nreturn False\nreturn True';
        const { text, stats } = await healIndentationVerified(src, { runner: realRunner! });
        assert.strictEqual(stats.verified, true, 'expected real Python to verify the default candidate');
        assert.ok(text.startsWith('def can_craft(self, inv):'));
    });

    test('real Python (if installed) accepts v2 output of the 499-line fixture', async function () {
        if (!realRunner) { this.skip(); }
        const { stats } = await healIndentationVerified('x = 1\ny = 2\n', { runner: realRunner! });
        assert.strictEqual(stats.verified, true);
    });

});
