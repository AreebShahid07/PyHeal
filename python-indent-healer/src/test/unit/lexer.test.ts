import * as assert from 'assert';
import {
    assembleLogicalLines,
    splitPhysicalLines,
    normalizeWhitespace,
    toLogicalLines,
} from '../../lexer';

suite('Logical-Line Assembler (Pass 1)', () => {

    test('splits simple statements into one logical line each', () => {
        const lines = toLogicalLines([
            'x = 1',
            'y = 2',
            'print(x + y)',
        ].join('\n'));
        assert.strictEqual(lines.length, 3);
        assert.ok(lines.every(l => l.kind === 'code'));
        assert.ok(lines.every(l => l.cont === 'none'));
        assert.ok(lines.every(l => !l.opensBlock));
    });

    test('multi-line string content never registers as block opener', () => {
        const lines = toLogicalLines([
            'x = "if True:"',
            'print("hello:")',
            "y = 'nested: dict'",
        ].join('\n'));
        assert.strictEqual(lines.length, 3);
        assert.ok(lines.every(l => !l.opensBlock), 'colons inside strings must not open blocks');
    });

    test('trailing comments with colons do not open blocks', () => {
        const lines = toLogicalLines([
            'x = 1  # note: this is not a block',
            'y = 2',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.ok(lines.every(l => !l.opensBlock));
    });

    test('whole-line comments are classified as comments', () => {
        const lines = toLogicalLines([
            '# a comment',
            'x = 1',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].kind, 'comment');
        assert.strictEqual(lines[1].kind, 'code');
    });

    test('blank lines are preserved as blank entries', () => {
        const lines = toLogicalLines([
            'x = 1',
            '',
            'y = 2',
        ].join('\n'));
        assert.strictEqual(lines.length, 3);
        assert.strictEqual(lines[0].kind, 'code');
        assert.strictEqual(lines[1].kind, 'blank');
        assert.strictEqual(lines[2].kind, 'code');
    });

    test('block openers are detected: def, if, for, match, case', () => {
        const lines = toLogicalLines([
            'def foo():',
            'if x:',
            'for i in y:',
            'match x:',
            'case 1:',
            'z = 1',
        ].join('\n'));
        assert.deepStrictEqual(
            lines.slice(0, 5).map(l => l.opensBlock),
            [true, true, true, true, true]
        );
        assert.strictEqual(lines[5].opensBlock, false);
    });

    test('merges multi-line bracket continuation into one logical line', () => {
        const lines = toLogicalLines([
            'x = foo(',
            '    1,',
            '    2,',
            ')',
            'y = 3',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].cont, 'brackets');
        assert.strictEqual(lines[0].start, 0);
        assert.strictEqual(lines[0].end, 3);
        assert.strictEqual(lines[0].openBrackets, 0);
        assert.strictEqual(lines[0].opensBlock, false);
        assert.strictEqual(lines[1].text, 'y = 3');
    });

    test('merges nested brackets spanning several physical lines', () => {
        const lines = toLogicalLines([
            'data = [',
            '    {"a": 1},',
            '    {',
            '        "b": [2, 3],',
            '    },',
            ']',
        ].join('\n'));
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0].cont, 'brackets');
        assert.strictEqual(lines[0].openBrackets, 0);
        // The dict literal colons must not mark the whole line as a block opener.
        assert.strictEqual(lines[0].opensBlock, false);
    });

    test('absorbs blank lines inside bracket continuations', () => {
        const lines = toLogicalLines([
            'x = foo(',
            '',
            '    1,',
            ')',
            'y = 2',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].start, 0);
        assert.strictEqual(lines[0].end, 3);
        assert.strictEqual(lines[1].text, 'y = 2');
    });

    test('merges backslash line continuations', () => {
        const lines = toLogicalLines([
            'total = 1 + \\',
            '    2 + \\',
            '    3',
            'x = 4',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].cont, 'backslash');
        assert.strictEqual(lines[0].start, 0);
        assert.strictEqual(lines[0].end, 2);
        assert.strictEqual(lines[1].text, 'x = 4');
    });

    test('triple-quoted string spanning lines becomes one logical line', () => {
        const lines = toLogicalLines([
            's = """',
            'if True:',
            'print("looks like code:")',
            '"""',
            'x = 1',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].cont, 'string');
        assert.strictEqual(lines[0].start, 0);
        assert.strictEqual(lines[0].end, 3);
        // The fake "if True:" inside the string must not open a block.
        assert.strictEqual(lines[0].opensBlock, false);
        assert.strictEqual(lines[1].text, 'x = 1');
    });

    test('inline triple-quoted string (open and close on one line)', () => {
        const lines = toLogicalLines([
            's = """abc"""',
            'x = 1',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].cont, 'none');
        assert.strictEqual(lines[0].kind, 'code');
    });

    test('docstring with a colon-only line is not a block opener', () => {
        const lines = toLogicalLines([
            'def f():',
            '    """Section:',
            '    more text:',
            '    """',
            '    return 1',
        ].join('\n'));
        assert.strictEqual(lines.length, 3);              // def | docstring | return
        assert.strictEqual(lines[0].opensBlock, true);    // def f():
        assert.strictEqual(lines[1].opensBlock, false);   // the docstring
        assert.strictEqual(lines[1].cont, 'string');
        assert.strictEqual(lines[2].text, '    return 1');
    });

    test('escaped quote inside single-quoted string does not break scanning', () => {
        const lines = toLogicalLines([
            "s = 'it\\'s: fine'",
            'x = 1',
        ].join('\n'));
        assert.strictEqual(lines.length, 2);
        assert.ok(lines.every(l => !l.opensBlock));
    });

    test('handles CRLF line endings', () => {
        const lines = toLogicalLines('x = 1\r\ny = 2\r\n');
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[1].text, 'y = 2');
    });

    test('handles lone CR line endings', () => {
        const lines = toLogicalLines('x = 1\ry = 2\r');
        assert.strictEqual(lines.length, 2);
    });

    test('strips a leading BOM', () => {
        const lines = toLogicalLines('\uFEFFx = 1');
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(lines[0].text, 'x = 1');
    });

    test('normalizeWhitespace converts NBSP and exotic spaces', () => {
        assert.strictEqual(normalizeWhitespace('a\u00A0b\u3000c'), 'a b c');
    });

    test('NBSP-padded lines assemble without crashing', () => {
        const lines = toLogicalLines('x\u00A0=\u00A01\ny = 2');
        assert.strictEqual(lines.length, 2);
    });

    test('splitPhysicalLines handles empty input', () => {
        assert.deepStrictEqual(splitPhysicalLines(''), ['']);
    });

    test('unterminated single-quote on a line does not swallow the rest of the file', () => {
        const lines = toLogicalLines([
            "s = 'oops",
            'x = 1',
            'y = 2',
        ].join('\n'));
        // Invalid Python, but the assembler must stay sane and keep later lines.
        assert.strictEqual(lines.length, 3);
        assert.strictEqual(lines[1].text, 'x = 1');
    });

});
