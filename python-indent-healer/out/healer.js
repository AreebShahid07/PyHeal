"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healIndentation = healIndentation;
function healIndentation(text) {
    const lines = text.split(/\r?\n/);
    const healedLines = [];
    const INDENT_SIZE = 4;
    let currentLevel = 0;
    // "Ghost Tracker": Remembers the last actual code line (ignoring blanks)
    let lastRealLine = "";
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        // Clean up unusual whitespace
        line = line.replace(/\u00A0/g, ' ');
        // 1. PRESERVE BLANK LINES
        if (!line) {
            healedLines.push("");
            continue;
        }
        // --- LEVEL ADJUSTMENT LOGIC (Current Line) ---
        // Rule A: Hard Reset for Main Guard & Imports
        if (line.match(/^(import|from|class)\b/) || (line.startsWith('if __name__') && line.includes('"__main__"'))) {
            currentLevel = 0;
        }
        // Rule B: Section Header Snapping (The "Demo Fix")
        // If we see a major print header, snap to script/function root.
        else if (line.match(/^print\s*\(\s*["']\\n---/)) {
            const defLevel = findParentLevel(healedLines, 'def');
            currentLevel = (defLevel !== -1) ? defLevel + 1 : 0;
        }
        // Rule C: Sibling Def / Decorator Snapping (Fixes Staircasing)
        else if (line.startsWith('def ') || (line.startsWith('async ') && line.includes('def ')) || line.startsWith('@')) {
            const classLevel = findParentLevel(healedLines, 'class');
            if (classLevel !== -1) {
                // Heuristic: If it has 'self', 'cls', or follows a decorator, it's likely a method.
                const isMethod = line.startsWith('@') || line.match(/\b(self|cls)\b/);
                const followsDecorator = lastRealLine.startsWith('@');
                currentLevel = (isMethod || followsDecorator) ? classLevel + 1 : 0;
            }
            else {
                currentLevel = 0;
            }
        }
        // Rule D: Parent Snapping (else, elif, except, finally)
        else if (line.match(/^(else|elif|except|finally)\b/)) {
            const matchType = (line.startsWith('ex') || line.startsWith('fin')) ? 'try' : 'if';
            const parentIndent = findParentLevel(healedLines, matchType);
            currentLevel = (parentIndent !== -1) ? parentIndent : Math.max(0, currentLevel - 1);
        }
        else if (line.startsWith('case ')) {
            const matchLevel = findParentLevel(healedLines, 'match');
            if (matchLevel !== -1)
                currentLevel = matchLevel + 1;
        }
        // Rule E: Closing Brackets (Data Structures)
        else if (line.match(/^[\]\}\)]/)) {
            currentLevel = Math.max(0, currentLevel - 1);
        }
        // --- PRINT THE LINE ---
        const indentStr = " ".repeat(Math.max(0, currentLevel) * INDENT_SIZE);
        healedLines.push(indentStr + line);
        // --- NEXT LINE PREDICTION ---
        // Rule 1: RETURN ESCAPE / Terminal Drop (The "None" Fix)
        // Adjust level for the NEXT line immediately.
        if (line.match(/^(return|raise|break|continue|pass)\b/)) {
            if (line.startsWith('return')) {
                // Return Escape: Snap to the level of the closest parent block (sibling level)
                currentLevel = findClosestParentLevel(healedLines);
            }
            else {
                currentLevel = Math.max(0, currentLevel - 1);
            }
        }
        // Rule 2: Openers
        else if (line.match(/[:\{\[\(]\s*(#.*)?$/)) {
            currentLevel++;
        }
        // Update Ghost Tracker
        lastRealLine = line;
    }
    return healedLines.join("\n");
}
/**
 * Helper: Scans backwards to find the indentation level of the nearest block opener or sibling.
 */
function findClosestParentLevel(lines) {
    const INDENT_SIZE = 4;
    for (let j = lines.length - 1; j >= 0; j--) {
        const content = lines[j].trim();
        if (!content)
            continue;
        // Any keyword that starts a block or is a block sibling/closer
        if (content.match(/^(if|for|while|try|with|def|class|else|elif|except|finally|match|case)\b/) ||
            (content.startsWith('async ') && content.match(/^async\s+(def|for|with|if)\b/))) {
            const spaces = lines[j].search(/\S/);
            return spaces >= 0 ? Math.floor(spaces / INDENT_SIZE) : 0;
        }
    }
    return 0;
}
/**
 * Helper: Scans backwards to find the indentation level of a keyword family parent.
 * Uses a 'Closers-Aware' approach to skip nested blocks at the same level.
 */
function findParentLevel(lines, keyword) {
    const INDENT_SIZE = 4;
    const seenClosersAtLevel = new Set();
    for (let j = lines.length - 1; j >= 0; j--) {
        const content = lines[j].trim();
        if (!content)
            continue;
        const spaces = lines[j].search(/\S/);
        const level = spaces >= 0 ? Math.floor(spaces / INDENT_SIZE) : 0;
        // Opener keywords (e.g., if, try, match)
        const isOpener = content.startsWith(keyword) ||
            (content.startsWith('async ') && content.substring(6).startsWith(keyword));
        // Closes or terminates a block family for its peers
        const isCloser = (keyword === 'if' && content.startsWith('else:')) ||
            (keyword === 'try' && (content.startsWith('except ') || content.startsWith('finally:'))) ||
            (keyword === 'match' && content.startsWith('case '));
        if (isCloser) {
            seenClosersAtLevel.add(level);
        }
        else if (isOpener) {
            if (!seenClosersAtLevel.has(level)) {
                return level;
            }
            // Once we see the opener for a closer at this level, we reset.
            seenClosersAtLevel.delete(level);
        }
    }
    return -1;
}
//# sourceMappingURL=healer.js.map