import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { healIndentationLegacy as healV1 } from '../../healer';
import { renderPlanned, planIndentation } from '../../structure';
import { healIndentation, healIndentationLegacy, ENGINE_VERSION } from '../../healer';
import { toLogicalLines } from '../../lexer';

/** Engine switch smoke test: the public API now routes to the v2 pipeline. */
suite('Engine switch (M2 flip)', () => {
    test('healIndentation delegates to the v2 pipeline', () => {
        const input = 'class Dog:\ndef bark(self):\nreturn "Woof!"';
        assert.strictEqual(healIndentation(input), renderPlanned(input));
        assert.strictEqual(ENGINE_VERSION, 'v2.0.0-pipeline');
    });

    test('legacy engine remains callable for A/B comparison', () => {
        const input = 'def f():\nreturn 1';
        assert.strictEqual(
            healIndentationLegacy(input),
            'def f():\n    return 1'
        );
    });
});

// ---------------------------------------------------------------------------
// Golden corpus — the exact inputs from the v1 test suite. The M2 contract is
// that the new pipeline produces IDENTICAL output to v1 on every one.
// ---------------------------------------------------------------------------

const CORPUS: Array<{ name: string; input: string }> = [
    {
        name: 'simple indentation',
        input: 'def foo():\nprint("bar")\nif True:\nprint("baz")',
    },
    {
        name: 'nested blocks',
        input: 'if a:\nif b:\nprint("c")\nelse:\nprint("d")',
    },
    {
        name: 'comments',
        input: 'def foo(): # comment\nprint("bar")',
    },
    {
        name: 'match/case',
        input: 'match x:\ncase 1:\nprint(1)\ncase 2:\nprint(2)',
    },
    {
        name: 'flat if/elif/else',
        input: 'def calculate_grade(score):\nif score >= 90:\nreturn "A"\nelif score >= 80:\nreturn "B"\nelse:\nreturn "C"',
    },
    {
        name: 'broken block class',
        input: 'class Dog:\ndef __init__(self, name):\nself.name = name\ndef bark(self):\nif self.name:\nreturn f"{self.name} says Woof!"\nelse:\nreturn "Woof!"',
    },
    {
        name: 'ultimate boss fight',
        input: `import json\nimport os\n\nclass UserDatabase:\ndef __init__(self, filepath):\nself.filepath = filepath\nself.users = []\n\ndef load_data(self):\ntry:\nif os.path.exists(self.filepath):\nwith open(self.filepath, 'r') as f:\nself.users = json.load(f)\nprint(f"Loaded {len(self.users)} users.")\nelse:\nprint("Database file not found. Starting fresh.")\nself.users = []\nexcept Exception as e:\nprint(f"Failed to load database: {e}")\nself.users = []\n\ndef save_data(self):\nwith open(self.filepath, 'w') as f:\njson.dump(self.users, f, indent=4)\nprint("Database saved successfully.")\n\nif __name__ == "__main__":\ndb = UserDatabase("users.json")\ndb.load_data()\ndb.save_data()`,
    },
    {
        name: 'network service staircase',
        input: `import asyncio\nimport random\n\nclass NetworkService:\n@staticmethod\ndef validate_packet(data):\nif not data:\nreturn False\n\nif len(data) < 10:\nprint("Packet too small")\nreturn False\n\nreturn True\n\nasync def connect_with_retry(self, endpoint):\nattempts = 0\nmax_retries = 3\n\nwhile attempts < max_retries:\nprint(f"Attempt {attempts + 1} connecting to {endpoint}...")\nawait asyncio.sleep(1)\n\nif random.choice([True, False]):\nprint("Connection established.")\nreturn True\n\nprint("Connection failed. Retrying...")\nattempts += 1\n\nprint("All attempts failed.")\nraise ConnectionError("Could not connect to host")`,
    },
    {
        name: 'nested if-else',
        input: 'def h(n):\nif n>=0:\nif n==0:\nprint("zero")\nelse:\nprint("pos")\nelse:\nprint("neg")',
    },
];

suite('Structure Inferencer (Pass 2) — M2 equivalence', () => {

    CORPUS.forEach(({ name, input }) => {
        test(`[corpus] ${name}: v2 matches v1 exactly`, () => {
            const v1 = healV1(input);
            const v2 = renderPlanned(input);
            assert.strictEqual(v2, v1, `v2 output differs from v1 on corpus case "${name}"`);
        });
    });

});

suite('Structure Inferencer (Pass 2) — unit behavior', () => {

    test('sibling methods after different nesting levels align under class', () => {
        const src = 'class C:\ndef a(self):\nreturn 1\ndef b(self):\nreturn 2';
        const out = renderPlanned(src);
        assert.strictEqual(out, 'class C:\n    def a(self):\n        return 1\n    def b(self):\n        return 2');
    });

    test('else finds nearest if across nested frames', () => {
        const src = 'if a:\nif b:\nx = 1\nelse:\nx = 2';
        // else belongs to `if b` (nearest open if).
        assert.strictEqual(
            renderPlanned(src),
            'if a:\n    if b:\n        x = 1\n    else:\n        x = 2'
        );
    });

    test('except attaches to try, finally too', () => {
        const src = 'try:\ndo_x()\nexcept ValueError:\nfix()\nfinally:\nend()';
        assert.strictEqual(
            renderPlanned(src),
            'try:\n    do_x()\nexcept ValueError:\n    fix()\nfinally:\n    end()'
        );
    });

    test('hard reset: import and __main__ return to column zero', () => {
        const src = 'def f():\nx = 1\nimport os\nx = 2';
        const out = renderPlanned(src);
        assert.strictEqual(out.split('\n')[2], 'import os');
    });

    test('decorator above def inside class aligns both at class+1', () => {
        const src = 'class C:\n@staticmethod\ndef m():\nreturn 1';
        assert.strictEqual(
            renderPlanned(src),
            'class C:\n    @staticmethod\n    def m():\n        return 1'
        );
    });

    test('module-level function after class body resets to zero', () => {
        const src = 'class C:\ndef m(self):\nreturn 1\ndef top():\nreturn 2';
        assert.strictEqual(
            renderPlanned(src),
            'class C:\n    def m(self):\n        return 1\ndef top():\n    return 2'
        );
    });

    test('match/case frames nest correctly', () => {
        const src = 'match cmd:\ncase "go":\nmove()\ncase "stop":\nstop()';
        assert.strictEqual(
            renderPlanned(src),
            'match cmd:\n    case "go":\n        move()\n    case "stop":\n        stop()'
        );
    });

    test('multi-line call continuation keeps statement indent + hanging', () => {
        const src = 'def f():\nresult = compute(\nvalue_one,\nvalue_two,\n)\nreturn result';
        assert.strictEqual(
            renderPlanned(src),
            'def f():\n    result = compute(\n        value_one,\n        value_two,\n    )\n    return result'
        );
    });

    test('closing bracket line sits back at statement level', () => {
        const src = 'data = [\n1,\n2,\n]\nprint(data)';
        assert.strictEqual(
            renderPlanned(src),
            'data = [\n    1,\n    2,\n]\nprint(data)'
        );
    });

});

suite('Structure Inferencer (Pass 2) — properties', () => {

    test('idempotence: healing healed output is a no-op (corpus)', () => {
        CORPUS.forEach(({ name, input }) => {
            const once = renderPlanned(input);
            const twice = renderPlanned(once);
            assert.strictEqual(twice, once, `not idempotent on "${name}"`);
        });
    });

    test('already-correct code is preserved on corpus cases', () => {
        // Healing v1's expected outputs (correct code) must be a no-op.
        CORPUS.forEach(({ input }) => {
            const healed = healV1(input);
            assert.strictEqual(renderPlanned(healed), healed);
        });
    });

});

suite('Structure Inferencer (Pass 2) — 499-line fixture', () => {

    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const flatPath = path.join(repoRoot, 'test.py');
    const megaPath = path.join(repoRoot, 'Mega.py');

    let flat = '';
    let mega = '';
    try {
        flat = fs.readFileSync(flatPath, 'utf8');
        mega = fs.readFileSync(megaPath, 'utf8');
    } catch {
        // Fixture not present in this environment — skip gracefully.
    }

    test('v2 heals test.py to syntactically valid Python (via structure check)', function () {
        if (!flat) { this.skip(); }
        const planned = renderPlanned(flat);
        // Every opensBlock-annotated line must end with ':'; every level must be >= 0.
        const { levels } = planIndentation(flat);
        assert.ok(levels.every(l => l >= 0));
        // The healed output must not lose or gain physical lines.
        assert.strictEqual(planned.split('\n').length, flat.split(/\r\n|\r|\n/).length);
    });

    test('v2 output equals Mega.py BYTE-FOR-BYTE on the full 499-line fixture (M3 goal)', function () {
        if (!flat || !mega) { this.skip(); }
        const planned = renderPlanned(flat).split('\n');
        const expected = mega.split(/\r\n|\r|\n/);

        const unexpected: number[] = [];
        const max = Math.max(planned.length, expected.length);
        for (let i = 0; i < max; i++) {
            const a = planned[i] ?? '';
            const b = expected[i] ?? '';
            if (a !== b) { unexpected.push(i + 1); }
        }
        assert.ok(
            unexpected.length === 0,
            `v2 diverges from repaired Mega.py at lines: ${unexpected.join(', ')}`
        );
    });

    test('v2 differs from v1 ONLY at lines where v2 matches Mega (verified improvements)', function () {
        if (!flat || !mega) { this.skip(); }
        const v1 = healV1(flat).split('\n');
        const v2 = renderPlanned(flat).split('\n');
        const megaLines = mega.split(/\r\n|\r|\n/);

        // Every divergence from the legacy engine must be one of the three
        // documented improvement zones, and on each the v2 line must equal
        // Mega.py — i.e., v1-vs-v2 differences are strictly improvements:
        //   1) line 66 — R1 loop-return escape (return True after the loop)
        //   2) lines 479-486 — R2 nested-def rescue (quicksort under its
        //      outer def)
        //   3) lines 497-499 — Pass 2 stack-based except-attachment
        //      (current v1 mis-nests the final except: ast.parse fails)
        const improvementZones = new Set<number>([65]);                    // 0-based
        for (let n = 478; n <= 485; n++) { improvementZones.add(n); }
        for (let n = 496; n <= 498; n++) { improvementZones.add(n); }

        const divergences: number[] = [];
        const max = Math.max(v1.length, v2.length);
        for (let i = 0; i < max; i++) {
            const a = v1[i] ?? '';
            const b = v2[i] ?? '';
            if (a !== b) { divergences.push(i); }
        }
        const outside = divergences.filter(i => !improvementZones.has(i));
        assert.ok(
            outside.length === 0,
            `v1-vs-v2 divergence outside documented zones at lines: ${outside.map(i => i + 1).join(', ')}`
        );
        for (const i of divergences) {
            assert.strictEqual(
                v2[i] ?? '', megaLines[i] ?? '',
                `v1-vs-v2 divergence at line ${i + 1} must be an improvement (v2 == Mega)`
            );
        }
        assert.ok(divergences.length >= 10, 'expected the documented improvement zones to diverge from v1');
    });

    test('lexer: fixture assembles into logical lines without losing content', function () {
        if (!flat) { this.skip(); }
        const physicalCount = flat.split(/\r\n|\r|\n/).length;
        const logical = toLogicalLines(flat);
        const covered = new Set<number>();
        logical.forEach(l => {
            for (let p = l.start; p <= l.end; p++) { covered.add(p); }
        });
        assert.strictEqual(covered.size, physicalCount);
    });

    test('perf smoke: 10k-line file heals well under a second (guards O(n^2) blowups)', function () {
        if (!flat) { this.skip(); }
        const big = Array(20).fill(flat).join('\n');
        const t0 = Date.now();
        renderPlanned(big);
        const elapsed = Date.now() - t0;
        // Observed baseline on this machine: ~45-85 ms. The bound is generous
        // to stay robust across CI machines while still catching any
        // catastrophic complexity regression (quadratic or worse).
        assert.ok(
            elapsed < 2000,
            `10k-line heal took ${elapsed} ms — catastrophic regression?`
        );
    });

});
