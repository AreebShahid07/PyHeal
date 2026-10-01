import * as assert from 'assert';
import { renderPlanned } from '../../structure';

suite('Ambiguity Resolver (Pass 3) — R1 loop-return escape', () => {

    test('value-return after single-statement guard becomes loop sibling', () => {
        const input = [
            'def check(items):',
            'for it in items:',
            'if it.broken:',
            'return False',
            'return True',
            'def other():',
            'return 0',
        ].join('\n');
        const expected = [
            'def check(items):',
            '    for it in items:',
            '        if it.broken:',
            '            return False',
            '    return True',
            'def other():',
            '    return 0',
        ].join('\n');
        assert.strictEqual(renderPlanned(input), expected);
    });

    test('negative: R1 abstains after `continue` — terminal-drop keeps the return in the loop body', () => {
        const input = [
            'def scan(rows):',
            'for r in rows:',
            'record(r)',
            'if r.bad:',
            'continue',
            'return True',
        ].join('\n');
        // R1's evidence chain requires a return/raise sibling before the
        // value-return; `continue` fails that, so R1 must NOT fire. Pass 2's
        // documented terminal-drop then places the return at loop-body level
        // (v1-consistent, and the conservative reading of ambiguous flat input).
        const expected = [
            'def scan(rows):',
            '    for r in rows:',
            '        record(r)',
            '        if r.bad:',
            '            continue',
            '        return True',
        ].join('\n');
        assert.strictEqual(renderPlanned(input), expected);
    });

    test('negative: loop-body return without a deeper return/raise sibling stays put', () => {
        const input = [
            'def f(xs):',
            'for x in xs:',
            'return x',
        ].join('\n');
        const expected = [
            'def f(xs):',
            '    for x in xs:',
            '        return x',
        ].join('\n');
        assert.strictEqual(renderPlanned(input), expected);
    });

});

suite('Ambiguity Resolver (Pass 3) — R2 nested-def rescue', () => {

    test('helper def with use-site call+outer-local nests under its outer def', () => {
        const input = [
            'def outer():',
            'data = make_data()',
            'def helper(arr):',
            'if len(arr) <= 1:',
            'return arr',
            'return helper(arr[1:]) + [arr[0]]',
            'result = helper(data)',
            'return result',
        ].join('\n');
        const expected = [
            'def outer():',
            '    data = make_data()',
            '    def helper(arr):',
            '        if len(arr) <= 1:',
            '            return arr',
            '        return helper(arr[1:]) + [arr[0]]',
            '    result = helper(data)',
            '    return result',
        ].join('\n');
        assert.strictEqual(renderPlanned(input), expected);
    });

    test('negative: independent module-level helpers are NOT nested', () => {
        const input = [
            'def make_data():',
            'return [1, 2]',
            'def helper(arr):',
            'return arr',
            'result = helper(make_data())',
            'print(result)',
        ].join('\n');
        const expected = [
            'def make_data():',
            '    return [1, 2]',
            'def helper(arr):',
            '    return arr',
            'result = helper(make_data())',
            'print(result)',
        ].join('\n');
        // No outer-local assignment inside def1's body -> evidence fails.
        assert.strictEqual(renderPlanned(input), expected);
    });

});

suite('Ambiguity Resolver (Pass 3) — safety properties', () => {

    const cases: Array<[string, string]> = [
        ['R1 positive', 'def check(items):\nfor it in items:\nif it.broken:\nreturn False\nreturn True\ndef other():\nreturn 0'],
        ['R2 positive', 'def outer():\ndata = make_data()\ndef helper(arr):\nif len(arr) <= 1:\nreturn arr\nreturn helper(arr[1:]) + [arr[0]]\nresult = helper(data)\nreturn result'],
        ['plain code', 'def f():\nx = 1\nreturn x'],
    ];

    test('idempotence: healing healed output is a no-op on resolver-active paths', () => {
        cases.forEach(([name, src]) => {
            const once = renderPlanned(src);
            const twice = renderPlanned(once);
            assert.strictEqual(twice, once, `not idempotent on ${name}`);
        });
    });

    test('resolver rules are conservative: plain code passes through unchanged', () => {
        assert.strictEqual(
            renderPlanned('def f():\nx = 1\nreturn x'),
            'def f():\n    x = 1\n    return x'
        );
    });

});
