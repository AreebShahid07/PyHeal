/**
 * Block-stack structure inferencer — Pass 2 of the v2 healing pipeline.
 *
 * Consumes the logical lines produced by the lexer (Pass 1) and produces an
 * IndentPlan: the target indent level for every physical line.
 *
 * Design: instead of v1's mutable streaming level plus per-keyword regex
 * look-backs, structure is tracked in an explicit stack of BlockFrames.
 * Every decision falls out of stack operations:
 *
 *  - openers push a frame {type, indent}
 *  - else/elif/except/finally/case resolve their host by walking the stack
 *    for the nearest frame of a compatible family, then replace it
 *  - a universal sync rule pops frames whose indent >= the placed line's
 *    indent, which handles sibling defs, dedented regular statements, and
 *    post-return escapes without special cases
 *  - return/raise/break/continue/pass adjust the *base level* used by the
 *    next regular statement (v1's "Return Escape" and terminal drop)
 *
 * M2 contract: behaviorally equivalent to v1's healIndentation on the
 * golden corpus (enforced by tests), while being analyzable and extensible
 * for M3's ambiguity resolver.
 */

import { toLogicalLines, splitPhysicalLines, normalizeWhitespace, LogicalLine } from './lexer';
import { PlanLine, applyRule1LoopReturnEscape, applyRule2NestedDefRescue } from './resolver';

export const INDENT_SIZE = 4;

type BlockType =
    | 'def' | 'class'
    | 'if' | 'elif' | 'else'
    | 'for' | 'while'
    | 'try' | 'except' | 'finally'
    | 'with' | 'match' | 'case';

interface BlockFrame {
    type: BlockType;
    /** Indent level (in steps) of the line that opened this block. */
    indent: number;
}

/** Per-physical-line target indent levels (in 4-space steps). */
export interface IndentPlan {
    levels: number[];
}

/** Classification of a logical line's first physical line. */
type Keyword =
    | 'hardreset'      // import / from / if __name__ == "__main__"
    | 'class' | 'def' | 'decorator'
    | 'else' | 'elif' | 'except' | 'finally' | 'case'
    | 'if' | 'for' | 'while' | 'try' | 'with' | 'match'
    | 'return' | 'raise' | 'break' | 'continue' | 'pass'
    | 'section'        // v1's section-header heuristic: print("\n--- ...
    | 'regular';

const CLOSER_HOSTS: Record<string, BlockType[]> = {
    else: ['if', 'elif', 'for', 'while'],
    elif: ['if', 'elif', 'for', 'while'],
    except: ['try', 'except'],
    finally: ['try', 'except'],
    case: ['match'],
};

const OPENER_TYPES = new Set<BlockType>([
    'if', 'for', 'while', 'try', 'with', 'match',
    'elif', 'else', 'except', 'finally', 'case', 'def', 'class',
]);

export function classifyLine(firstPhysicalTrimmed: string): Keyword {
    const t = firstPhysicalTrimmed;
    if (/^(import|from)\b/.test(t)) { return 'hardreset'; }
    if (t.startsWith('if __name__') && t.includes('"__main__"')) { return 'hardreset'; }
    if (/^print\s*\(\s*["']\\n---/.test(t)) { return 'section'; }
    if (t.startsWith('@')) { return 'decorator'; }
    if (/^async\s+def\b/.test(t) || /^def\s/.test(t)) { return 'def'; }
    if (/^async\s+(for|with)\b/.test(t)) {
        return t.match(/^async\s+(for|with)\b/)![1] as Keyword;
    }
    if (/^class\b/.test(t)) { return 'class'; }
    if (/^else\b/.test(t)) { return 'else'; }
    if (/^elif\b/.test(t)) { return 'elif'; }
    if (/^except\b/.test(t)) { return 'except'; }
    if (/^finally\b/.test(t)) { return 'finally'; }
    if (/^case\b/.test(t)) { return 'case'; }
    if (/^if\b/.test(t)) { return 'if'; }
    if (/^for\b/.test(t)) { return 'for'; }
    if (/^while\b/.test(t)) { return 'while'; }
    if (/^try\b/.test(t)) { return 'try'; }
    if (/^with\b/.test(t)) { return 'with'; }
    if (/^match\b/.test(t)) { return 'match'; }
    if (/^return\b/.test(t)) { return 'return'; }
    if (/^raise\b/.test(t)) { return 'raise'; }
    if (/^break\b/.test(t)) { return 'break'; }
    if (/^continue\b/.test(t)) { return 'continue'; }
    if (/^pass\b/.test(t)) { return 'pass'; }
    return 'regular';
}

/**
 * v1-exact per-line rendering rules for continuation lines:
 *  - a line STARTING with a closer renders one level lower (Rule E)
 *  - a line ENDING with an opener char (optionally + comment) raises the
 *    level for the NEXT physical line (Rule 2)
 * These mirror v1's regexes on trimmed lines (not string-aware), keeping
 * byte-equivalence with the legacy engine on multi-line constructs.
 */
const ENDS_WITH_OPENER = /[:\{\[\(]\s*(#.*)?$/;
const STARTS_WITH_CLOSER = /^[\]\}\)]/;

/** Cumulative open-bracket depth BEFORE each physical line of a group. */
export function bracketDepthProfile(physicalLines: string[]): number[] {
    const out: number[] = [];
    let depth = 0;
    let inString: { quote: string; triple: boolean } | null = null;
    for (const raw of physicalLines) {
        out.push(depth);
        const res = scanLineDepth(normalizeWhitespace(raw).trim(), inString);
        inString = res.inString;
        depth = Math.max(0, depth + res.delta);
    }
    return out;
}

// Minimal scanner re-used for depth profiling (mirrors lexer.scanLine logic).
function scanLineDepth(
    line: string,
    inString: { quote: string; triple: boolean } | null
): { delta: number; inString: { quote: string; triple: boolean } | null } {
    let delta = 0;
    let i = 0;
    let str = inString;

    if (str) {
        const { quote, triple } = str;
        if (triple) {
            const end = line.indexOf(quote, i);
            if (end === -1) { return { delta, inString: str }; }
            i = end + quote.length;
            str = null;
        } else {
            str = null;
        }
    }

    while (i < line.length) {
        const ch = line[i];
        if (ch === '#') { return { delta, inString: null }; }
        if (ch === '"' || ch === "'") {
            if (line.slice(i, i + 3) === ch.repeat(3)) {
                const quote = ch.repeat(3);
                const end = line.indexOf(quote, i + 3);
                if (end === -1) { return { delta, inString: { quote, triple: true } }; }
                i = end + 3;
                continue;
            }
            let j = i + 1;
            let closed = false;
            while (j < line.length) {
                if (line[j] === '\\') { j += 2; continue; }
                if (line[j] === ch) { closed = true; break; }
                j++;
            }
            i = closed ? j + 1 : line.length;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') { delta++; i++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { delta--; i++; continue; }
        i++;
    }
    return { delta, inString: str };
}

/**
 * Compute the indent plan for a Python source string.
 * The plan covers every physical line (including blanks, which get level 0
 * since their rendered text is empty regardless).
 */
export function planIndentation(source: string, opts?: { captureFrames?: boolean }): IndentPlan & { planLines?: PlanLine[] } {
    const physical = splitPhysicalLines(source);
    const logical = toLogicalLines(source);
    const levels: number[] = new Array(physical.length).fill(0);
    const captureFrames = opts?.captureFrames ?? false;

    const stack: BlockFrame[] = [];
    let baseLevel = 0;          // indent the NEXT regular statement gets
    let prevWasDecorator = false;

    // Per-physical-line context for Pass 3 (only built when requested).
    const planLines: PlanLine[] = [];

    const popGE = (indent: number) => {
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
    };
    const findFrame = (types: BlockType[]): BlockFrame | null => {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (types.indexOf(stack[i].type) !== -1) { return stack[i]; }
        }
        return null;
    };
    const top = (): BlockFrame | null => (stack.length ? stack[stack.length - 1] : null);

    for (const L of logical) {
        if (L.kind === 'blank') {
            // Blanks render as empty strings; they do not disturb state
            // (mirrors v1: blanks are pushed before any rule runs).
            if (captureFrames) {
                for (let p = L.start; p <= L.end; p++) {
                    planLines.push({ index: p, level: 0, text: '', frames: stack.map(f => [f.type, f.indent] as [string, number]), keyword: 'blank' });
                }
            }
            continue;
        }

        const firstLine = L.text.split('\n')[0].trim();

        if (L.kind === 'comment') {
            for (let p = L.start; p <= L.end; p++) {
                levels[p] = baseLevel;
                if (captureFrames) {
                    planLines.push({ index: p, level: baseLevel, text: physical[p].trim(), frames: stack.map(f => [f.type, f.indent] as [string, number]), keyword: 'comment' });
                }
            }
            prevWasDecorator = false;
            continue;
        }

        const kw = classifyLine(firstLine);
        let lineIndent: number;

        switch (kw) {
            case 'hardreset':
                lineIndent = 0;
                popGE(0);
                break;
            case 'class':
                lineIndent = 0;
                popGE(0);
                break;
            case 'decorator': {
                const cls = findFrame(['class']);
                lineIndent = cls ? cls.indent + 1 : 0;
                popGE(lineIndent);
                break;
            }
            case 'def': {
                const cls = findFrame(['class']);
                const isMethod = /\b(self|cls)\b/.test(firstLine) || prevWasDecorator;
                lineIndent = (cls && isMethod) ? cls.indent + 1 : 0;
                popGE(lineIndent);
                break;
            }
            case 'section': {
                const def = findFrame(['def']);
                lineIndent = def ? def.indent + 1 : 0;
                popGE(lineIndent);
                break;
            }
            case 'else':
            case 'elif':
            case 'except':
            case 'finally':
            case 'case': {
                const host = findFrame(CLOSER_HOSTS[kw]);
                lineIndent = host
                    ? (kw === 'case' ? host.indent + 1 : host.indent)
                    : (kw === 'case' ? baseLevel : Math.max(0, baseLevel - 1));
                popGE(lineIndent);
                break;
            }
            default:
                // regular statements and return/raise/break/continue/pass
                lineIndent = baseLevel;
                popGE(lineIndent);
                break;
        }

        // Emit levels for all physical lines of this logical line.
        if (L.start === L.end) {
            levels[L.start] = Math.max(0, lineIndent);
            if (captureFrames) {
                // Snapshot AFTER placement pops but BEFORE this line pushes
                // its own frame — exactly the frames open when the line sat.
                planLines.push({ index: L.start, level: levels[L.start], text: physical[L.start].trim(), frames: stack.map(f => [f.type, f.indent] as [string, number]), keyword: kw });
            }
        } else {
            // v1-exact continuation rendering: walk physical lines, applying
            // the same per-line opener/closer adjustments the legacy engine
            // applies as it streams (Rule E on closers, Rule 2 on openers).
            let lvl = lineIndent;
            for (let p = L.start; p <= L.end; p++) {
                const trimmed = physical[p].trim();
                if (p > L.start && STARTS_WITH_CLOSER.test(trimmed)) {
                    lvl = Math.max(0, lvl - 1);
                }
                levels[p] = Math.max(0, lvl);
                if (captureFrames) {
                    planLines.push({ index: p, level: levels[p], text: trimmed, frames: stack.map(f => [f.type, f.indent] as [string, number]), keyword: p === L.start ? kw : 'regular' });
                }
                if (ENDS_WITH_OPENER.test(trimmed)) {
                    lvl += 1;
            }
            }
        }

        // Push frame if this line opens a block. Non-opener colons (lambda
        // defaults, dict displays) must not create frames.
        if (L.opensBlock && OPENER_TYPES.has(kw as BlockType)) {
            stack.push({ type: kw as BlockType, indent: lineIndent });
        }

        // Update base level for the next line (v1's next-line rules).
        // Keyed on opensBlock itself: `if __name__ == "__main__":` is a
        // hard-reset opener — v1 resets the level AND increments after the
        // colon (Rule A + Rule 2 both fire there).
        if (L.opensBlock) {
            baseLevel = lineIndent + 1;
        } else if (kw === 'return') {
            const t = top();
            baseLevel = t ? t.indent : 0;
        } else if (kw === 'raise' || kw === 'break' || kw === 'continue' || kw === 'pass') {
            baseLevel = Math.max(0, lineIndent - 1);
        } else {
            baseLevel = lineIndent;
        }

        prevWasDecorator = kw === 'decorator';
    }

    return { levels, planLines: captureFrames ? planLines : undefined };
}

/**
 * Render source through the full v2 pipeline (Pass 1 → 2 → 3 → render).
 * Pass 3 (resolver) applies its two documented, precondition-guarded rules
 * on every run; they only rewrite the two ambiguity patterns, so output is
 * unchanged for all other code.
 *
 * `useResolver: false` skips Pass 3 — used by the Pass 4 verifier to build
 * an alternative candidate when the default output fails Python's ast.parse.
 */
export function renderPlanned(source: string, opts?: { useResolver?: boolean }): string {
    const physical = splitPhysicalLines(source);
    const useResolver = opts?.useResolver ?? true;
    const { levels, planLines } = planIndentation(source, { captureFrames: useResolver });

    if (!planLines || planLines.length !== physical.length || !useResolver) {
        // Fallback (or resolver disabled): render Pass 2 output directly.
        const out: string[] = [];
        for (let i = 0; i < physical.length; i++) {
            const trimmed = physical[i].trim();
            out.push(trimmed === '' ? '' : ' '.repeat(levels[i] * INDENT_SIZE) + trimmed);
        }
        return out.join('\n');
    }

    // Pass 3: resolve documented ambiguities.
    const r1 = applyRule1LoopReturnEscape(planLines);
    const r2 = applyRule2NestedDefRescue(r1.lines);
    const resolved = r2.lines;

    const out: string[] = [];
    for (let i = 0; i < physical.length; i++) {
        const trimmed = physical[i].trim();
        if (trimmed === '') {
            out.push('');
        } else {
            out.push(' '.repeat(resolved[i].level * INDENT_SIZE) + trimmed);
        }
    }
    return out.join('\n');
}

// Re-export for convenience in tests.
export type { LogicalLine };
