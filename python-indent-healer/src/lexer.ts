/**
 * Logical-line assembler — Pass 1 of the v2 healing pipeline.
 *
 * Assembles raw (possibly broken-indentation) Python source text into
 * "logical lines": one entry per Python statement/heading, with physical
 * line continuations (open brackets, backslashes, triple-quoted strings)
 * merged into a single unit. Each logical line is then classified so later
 * passes never have to worry about lexical trivia:
 *
 *  - a `:` that ends a line inside a string or comment is NOT a block opener
 *  - content inside open brackets/strings keeps its own physical lines,
 *    tracked via `contStart`/`contEnd` so alignment decisions can be made
 *  - NBSP and other exotic whitespace is normalized to plain spaces
 *  - CRLF / CR / LF line endings and a leading BOM are handled
 *
 * Pass 1 is deliberately conservative: it NEVER decides indentation. It
 * only produces a faithful, classified stream for Pass 2 (structure
 * inference). The engine entrypoint `healIndentation` in `healer.ts`
 * remains untouched in this milestone (M1).
 */

export const INDENT_SIZE = 4;

/** Why a logical line ends where it does — useful for tests and Pass 2/3. */
export type ContinuationKind =
    | 'none'          // single physical line
    | 'brackets'      // open ( [ { at end of line
    | 'backslash'     // explicit line continuation
    | 'string';       // unclosed triple-quoted (or single-quoted) string

/** Classification of a logical line for structure inference. */
export type LineKind =
    | 'code'      // ordinary statement
    | 'comment'   // whole-line comment (kept, not merged into neighbors)
    | 'blank';    // empty after normalization (kept to preserve blank lines)

export interface RawLine {
    /** The line content with leading/trailing whitespace stripped and NBSP normalized. */
    text: string;
    /** Original index in the physical line array (0-based). */
    index: number;
    /** Kind assigned by the assembler. */
    kind: LineKind;
}

export interface LogicalLine {
    /** First physical line (0-based), inclusive. */
    start: number;
    /** Last physical line (0-based), inclusive. */
    end: number;
    /** Full text of the logical line, physical lines joined with '\n'. */
    text: string;
    /** Why the line spans multiple physical lines (or 'none'). */
    cont: ContinuationKind;
    /** Classification of the line. */
    kind: LineKind;
    /** True if the line ends a block opener: `...:` outside strings/brackets. */
    opensBlock: boolean;
    /** Depth of open brackets at the END of this logical line. */
    openBrackets: number;
}

// ---------------------------------------------------------------------------
// Character scanning helpers
// ---------------------------------------------------------------------------

/**
 * Normalize exotic whitespace (NBSP, tabs are kept — tab handling is a
 * policy decision made by later passes) to plain spaces.
 */
export function normalizeWhitespace(s: string): string {
    return s.replace(/[\u00A0\u2000-\u200B\u3000]/g, ' ');
}

/** Split source text into physical lines, tolerating CRLF / CR / LF. */
export function splitPhysicalLines(text: string): string[] {
    // Strip a UTF-8 BOM if present.
    const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    return clean.split(/\r\n|\r|\n/);
}

/**
 * Scan a single physical line, tracking string state across the line.
 * `state.inString` carries triple-quote state between lines; bracket depth
 * only matters within a logical line but is threaded through for convenience.
 */
interface ScanState {
    inString: null | { quote: string; triple: boolean };
}

/**
 * Returns the string/bracket state after scanning `line` given `state`.
 * Handles: single/double quotes, triple quotes, escapes, f-string prefixes,
 * and comments (a `#` outside strings ends the scan for this line).
 */
function scanLine(line: string, inString: ScanState['inString']): { openBrackets: number; inString: ScanState['inString']; contBackslash: boolean } {
    let openBrackets = 0;
    let i = 0;
    let str = inString;

    if (str) {
        const { quote, triple } = str;
        if (triple) {
            const end = line.indexOf(quote, i);
            if (end === -1) {
                // Still inside the triple-quoted string.
                return { openBrackets, inString: str, contBackslash: false };
            }
            i = end + quote.length;
            str = null;
        } else {
            // Single-quoted strings cannot span lines (Python treats them as
            // syntax errors); treat as closed at end of line.
            str = null;
        }
    }

    while (i < line.length) {
        const ch = line[i];

        if (ch === '#') {
            // Comment — rest of the physical line is inert. (Bracket depth
            // inside a comment does not count; a trailing backslash inside a
            // comment does NOT continue the line.)
            return { openBrackets, inString: null, contBackslash: false };
        }

        if (ch === '"' || ch === "'") {
            // Detect triple quotes.
            if (line.slice(i, i + 3) === ch.repeat(3)) {
                const quote = ch.repeat(3);
                const end = line.indexOf(quote, i + 3);
                if (end === -1) {
                    return { openBrackets, inString: { quote, triple: true }, contBackslash: false };
                }
                i = end + 3;
                continue;
            }
            // Single quote (single-line).
            const end = findSingleQuoteEnd(line, i, ch);
            if (end === -1) {
                // Unterminated single-quote string on this physical line.
                // Invalid Python — but the assembler must not poison later
                // lines: treat the string as terminated at end of line.
                return { openBrackets, inString: null, contBackslash: false };
            }
            i = end + 1;
            continue;
        }

        if (ch === '(' || ch === '[' || ch === '{') {
            openBrackets++;
            i++;
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            // Raw delta — may go negative for fragments that start mid-
            // expression (common in broken pastes). The assembler
            // accumulates raw deltas, so a fragment consisting of only
            // closers flushes immediately instead of blocking forever.
            openBrackets--;
            i++;
            continue;
        }

        if (ch === '\\' && i === line.length - 1) {
            // Explicit line continuation (outside comments/strings).
            return { openBrackets, inString: str, contBackslash: true };
        }

        i++;
    }

    return { openBrackets, inString: str, contBackslash: false };
}

/** Find the closing quote of a single-quoted string starting at `start`. */
function findSingleQuoteEnd(line: string, start: number, quote: string): number {
    let i = start + 1;
    while (i < line.length) {
        if (line[i] === '\\') {
            i += 2; // skip escaped char
            continue;
        }
        if (line[i] === quote) {
            return i;
        }
        i++;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * Assemble physical lines into logical lines.
 *
 * A new logical line starts when:
 *  - the previous physical line was a complete statement (no open brackets,
 *    no open string, no backslash continuation), and
 *  - the current physical line is non-blank.
 *
 * Blank lines and whole-line comments inside a bracket/string continuation
 * are absorbed into the logical line; standalone blank lines and comments
 * become their own entries (kind 'blank' / 'comment') so downstream passes
 * can preserve the file's visual rhythm.
 */
export function assembleLogicalLines(physicalLines: string[]): LogicalLine[] {
    const logical: LogicalLine[] = [];
    const state: ScanState = { inString: null };

    // A trailing newline at EOF produces one phantom empty physical line;
    // drop a single trailing empty so it does not become a fake blank line.
    const lines = physicalLines.slice();
    if (lines.length > 1 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    let cur: { start: number; parts: string[]; cont: ContinuationKind } | null = null;
    let openBrackets = 0;

    const flush = () => {
        if (!cur) { return; }
        const text = cur.parts.join('\n');
        const trimmed = text.trim();
        // A trailing comment must not hide a block-opening colon
        // (v1 regex: /[:\{\[\(]\s*(#.*)?$/ — colon then optional comment).
        const codeText = stripTrailingComment(trimmed);
        const opensBlock = openBrackets <= 0 &&
            state.inString === null &&
            endsWithBlockColon(codeText);
        logical.push({
            start: cur.start,
            end: cur.start + cur.parts.length - 1,
            text: cur.parts.join('\n'),
            cont: cur.cont,
            kind: 'code',
            opensBlock,
            openBrackets,
        });
        cur = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = normalizeWhitespace(lines[i]);
        const stripped = raw.trim();

        // Inside an open string continuation: absorb everything.
        if (state.inString) {
            if (!cur) {
                cur = { start: i, parts: [], cont: 'string' };
            }
            cur.parts.push(lines[i]);
            const res = scanLine(stripped, state.inString);
            state.inString = res.inString;
            openBrackets += res.openBrackets;
            if (!state.inString && openBrackets <= 0 && !res.contBackslash) {
                flush();
            }
            continue;
        }

        if (stripped === '') {
            if (cur && (openBrackets > 0 || state.inString)) {
                // Blank line inside brackets — absorb.
                cur.parts.push(lines[i]);
                continue;
            }
            flush();
            logical.push({ start: i, end: i, text: '', cont: 'none', kind: 'blank', opensBlock: false, openBrackets: 0 });
            continue;
        }

        // Whole-line comment?
        if (stripped.startsWith('#') && !cur) {
            logical.push({ start: i, end: i, text: stripped, cont: 'none', kind: 'comment', opensBlock: false, openBrackets: 0 });
            continue;
        }

        // Continue an open logical line?
        if (cur && (openBrackets > 0 || cur.cont === 'backslash')) {
            cur.parts.push(lines[i]);
            const res = scanLine(stripped, state.inString);
            state.inString = res.inString;
            openBrackets += res.openBrackets;
            if (openBrackets <= 0 && !state.inString && !res.contBackslash) {
                flush();
            }
            continue;
        }

        // Start a new logical line.
        cur = { start: i, parts: [lines[i]], cont: 'none' };
        const res = scanLine(stripped, state.inString);
        state.inString = res.inString;
        openBrackets += res.openBrackets;

        if (state.inString && state.inString.triple) {
            cur.cont = 'string';
            continue; // wait for closing quotes
        }
        if (openBrackets > 0) {
            cur.cont = 'brackets';
            continue; // wait for closing brackets
        }
        if (res.contBackslash) {
            cur.cont = 'backslash';
            continue; // wait for continuation line
        }
        flush();
    }

    flush();
    return logical;
}

/**
 * Strip a trailing `# ...` comment from a (trimmed) line, respecting
 * quoted strings on that line. Used only for the block-colon check.
 */
export function stripTrailingComment(line: string): string {
    let inStr: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === inStr) { inStr = null; }
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; continue; }
        if (ch === '#') { return line.slice(0, i).trim(); }
    }
    return line.trim();
}

/**
 * True if the (trimmed) logical line ends with a `:` that opens a block —
 * i.e. the colon is not inside a string and not the trailing colon of a
 * slice/dict display (dicts end with `}` and slices end with `]`, so by the
 * time we are called with openBrackets === 0, a trailing `:` can only be a
 * block opener, an annotation (handled by keyword checks in Pass 2), or part
 * of a lambda default — `lambda: x` does not end a line, so it is safe).
 */
export function endsWithBlockColon(trimmed: string): boolean {
    if (!trimmed.endsWith(':')) { return false; }
    // Strip a trailing comment is impossible here (comments were excluded
    // during scanning); just guard against a bare `:` line, e.g. a labeled
    // block in a docstring pasted as code is still fine to treat as opener
    // only if it looks like a heading.
    const head = trimmed.slice(0, -1).trim();
    if (head === '') { return false; }
    // Common block openers all end in ':' after a keyword-ish clause.
    // Anything else ending in ':' at top level is rare enough that Pass 2
    // re-checks with keyword context.
    return true;
}

/** Convenience: run the full Pass 1 on raw source text. */
export function toLogicalLines(source: string): LogicalLine[] {
    return assembleLogicalLines(splitPhysicalLines(source));
}
