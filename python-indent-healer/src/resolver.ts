/**
 * Ambiguity resolver — Pass 3 of the v2 healing pipeline (M3).
 *
 * Applies the deterministic tie-break rules documented in V2_PLAN.md §4 to
 * repair the two documented ambiguity zones where a flat line-stream cannot
 * distinguish sibling-of-loop from nested-in-if, and def-after-def from
 * nested-def. Every rule is guarded by explicit preconditions and rewrites
 * only levels that provably fall into the pattern; everything else is left
 * untouched (minimum-change principle).
 */

import { INDENT_SIZE } from './lexer';

export interface PlanLine {
    /** Physical line index. */
    index: number;
    /** Assigned level from Pass 2 (in 4-space steps). */
    level: number;
    /** Trimmed text of the physical line ('' for blanks). */
    text: string;
    /**
     * Stack of open block frames visible to this line: [type, indentLevel].
     * From Pass 2 (structure.ts), ordered outermost → innermost.
     */
    frames: Array<[string, number]>;
    /** Pass 2's classification keyword for the logical line owning this line. */
    keyword: string;
}

export interface ResolverStats {
    rule1Applications: number;
    rule2Applications: number;
}

/**
 * R1 — Loop-return escape (live-code beats dead-code).
 *
 * Documented idiom (V2_PLAN.md §4, rule 2):
 *
 *     def can_craft(self, inventory):
 *         for item, count in ...:
 *             if inventory.count(item) < count:
 *                 return False
 *         return True          <- intended: loop sibling
 *
 * Flat healing leaves the value-return nested (current v1: inside the if).
 * Evidence chain required to rewrite (all must hold):
 *   1. cur is `return <value>` (not bare) nested inside an open for/while
 *      frame (cur.level > loopIndent).
 *   2. The previous code line is a `return`/`raise` exactly one level
 *      deeper — i.e. cur is the sibling of a single-statement conditional
 *      child inside the loop (distinguishes this from a legitimate last
 *      statement directly in the loop body, which must NOT be moved).
 *   3. The next code line dedents strictly below cur.level and is not a
 *      block-closer keyword — the conditional block has ended.
 * Transform: cur.level → loopIndent. The next line is NEVER moved.
 */
export function applyRule1LoopReturnEscape(lines: PlanLine[]): { lines: PlanLine[]; stats: ResolverStats } {
    const stats: ResolverStats = { rule1Applications: 0, rule2Applications: 0 };
    const n = lines.length;
    const edited = lines.map(l => ({ ...l }));

    // Index of the previous non-blank, non-comment code line.
    const prevCode = (i: number): number => {
        for (let k = i - 1; k >= 0; k--) {
            if (edited[k].text !== '' && edited[k].keyword !== 'comment') { return k; }
        }
        return -1;
    };

    for (let i = 0; i < n; i++) {
        const cur = edited[i];
        if (cur.keyword !== 'return' || cur.text === '') { continue; }
        if (/^return\s*$/.test(cur.text)) { continue; }   // bare return

        const loopFrame = [...cur.frames].reverse().find(f =>
            f[0] === 'for' || f[0] === 'while'
        );
        if (!loopFrame) { continue; }
        const loopIndent = loopFrame[1];

        // (1) The return must sit strictly inside the loop.
        if (cur.level <= loopIndent) { continue; }

        // (2) Previous code line is a return/raise exactly one level deeper
        // (the single-statement conditional child inside the loop).
        const pi = prevCode(i);
        if (pi === -1) { continue; }
        const prev = edited[pi];
        if (!/^(return|raise)\b/.test(prev.text)) { continue; }
        if (prev.level !== cur.level + 1) { continue; }

        // (3) Next code line dedents strictly below cur.level; not a closer.
        let j = i + 1;
        while (j < n && edited[j].text === '') { j++; }
        if (j >= n) { continue; }
        const nxt = edited[j];
        if (/^(else|elif|except|finally|case)\b/.test(nxt.text)) { continue; }
        if (nxt.level >= cur.level) { continue; }

        // Transform: the return becomes the loop's sibling. Next line untouched.
        cur.level = loopIndent;
        stats.rule1Applications++;
    }

    return { lines: edited, stats };
}

/**
 * R2 — Nested-def rescue (use-site evidence).
 *
 * Documented shape (V2_PLAN.md §4, rule 3) — note the outer def's body
 * statements may appear BETWEEN the two defs in flat form:
 *
 *     def complex_algorithm_test():      F
 *         data = [...]                   F+1   (outer local — evidence A)
 *     def quicksort(arr):                F     <- R2 target: nest under outer
 *         ...                                  body ...
 *     sorted_data = quicksort(data)      <=F+1 (dead placement — evidence B)
 *     return sorted_data
 *
 * Evidence chain required to rewrite (all must hold):
 *   1. def1 (no self/cls params) at level F.
 *   2. def2 (no self/cls) at the SAME level F, reachable by scanning
 *      forward over def1's body lines (level > F); any other line at
 *      level <= F before def2 aborts the rule.
 *   3. An outer-local assignment exists in def1's scanned body.
 *   4. A later line calls helperName( while referencing the outer local,
 *      currently dead (level <= F+1), before any other def/class at
 *      level <= F.
 * Transform: def2's block shifts +1 level (nested under def1's body); the
 * dead call line and its trailing same-body return re-pin to F+1.
 */
export function applyRule2NestedDefRescue(lines: PlanLine[]): { lines: PlanLine[]; stats: ResolverStats } {
    const stats: ResolverStats = { rule1Applications: 0, rule2Applications: 0 };
    const n = lines.length;
    const edited = lines.map(l => ({ ...l }));

    for (let i = 0; i < n; i++) {
        const first = edited[i];
        const m1 = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:$/.exec(first.text);
        if (!m1) { continue; }
        if (/\b(self|cls)\b/.test(m1[2])) { continue; }
        const F = first.level;

        // Scan forward over def1's body: collect the outer local, find def2.
        let outerLocal: string | null = null;
        let j = -1; // def2 index
        for (let k = i + 1; k < n; k++) {
            const t = edited[k].text;
            if (t === '' || t.startsWith('#')) { continue; }
            if (edited[k].level > F) {
                if (!outerLocal) {
                    const m = /^([A-Za-z_]\w*)\s*=/.exec(t);
                    if (m) { outerLocal = m[1]; }
                }
                continue;
            }
            // First line at level <= F after def1's body.
            const m2 = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:$/.exec(t);
            if (m2 && edited[k].level === F && !/\b(self|cls)\b/.test(m2[2])) {
                j = k;
            }
            break;
        }
        if (j === -1 || !outerLocal) { continue; }

        const second = edited[j];
        const m2b = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(second.text);
        if (!m2b) { continue; }
        const helperName = m2b[1];

        // Use-site: call helperName( referencing outerLocal, dead placement
        // (level <= F+1), before any other def/class at level <= F.
        // Regexes are built once per def-pair (not per scanned line) —
        // identifiers are \w+ so no escaping is needed.
        const callRe = new RegExp(`\\b${helperName}\\s*\\(`);
        const localRe = new RegExp(`\\b${outerLocal}\\b`);
        let callIdx = -1;
        for (let k = j + 1; k < n; k++) {
            const t = edited[k].text;
            if (t === '' || t.startsWith('#')) { continue; }
            if (/^(def|class)\b/.test(t) && edited[k].level <= F) { break; }
            if (/^(def|class)\b/.test(t) && edited[k].level === F + 1) { break; }
            if (edited[k].level <= F + 1 && callRe.test(t) && localRe.test(t)) {
                callIdx = k;
                break;
            }
            if (edited[k].level <= F) { break; }
        }
        if (callIdx === -1) { continue; }

        // Transform: nest def2's block under def1's body (+1 level); re-pin
        // the dead call line and its trailing return to F+1.
        for (let k = j; k < callIdx; k++) {
            if (edited[k].text === '') { continue; }
            edited[k].level += 1;
        }
        edited[callIdx].level = F + 1;

        for (let k = callIdx + 1; k < n; k++) {
            const t = edited[k].text;
            if (t === '') { continue; }
            if (edited[k].level > F + 1 || edited[k].keyword === 'return') {
                edited[k].level = F + 1;
            } else {
                break;
            }
        }

        stats.rule2Applications++;
        i = callIdx; // skip past the rewritten region
    }

    return { lines: edited, stats };
}

/** Render a plan back to text with 4-space steps. */
export function renderPlan(lines: PlanLine[]): string {
    return lines.map(l => (l.text === '' ? '' : ' '.repeat(l.level * INDENT_SIZE) + l.text)).join('\n');
}
