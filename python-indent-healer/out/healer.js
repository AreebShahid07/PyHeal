"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healIndentation = healIndentation;
function healIndentation(text) {
    const lines = text.split(/\r?\n/);
    const healedLines = [];
    const INDENT_SIZE = 4;
    let currentLevel = 0;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        // Skip empty lines but keep them in output
        if (!line) {
            healedLines.push("");
            continue;
        }
        // --- INTELLIGENT LEVEL ADJUSTMENT ---
        // 1. HARD RESET KEYWORDS
        // if __name__ == "__main__" or top-level class/import/def
        if (line.startsWith('if __name__') && line.includes('"__main__"')) {
            currentLevel = 0;
        }
        else if (line.match(/^(import|from|class)\b/)) {
            currentLevel = 0;
        }
        // Sibling Def Rule: if we see 'def' and we are deep, snap back to level 1 if inside a class
        else if (line.startsWith('def ')) {
            const classLevel = findParentLevel(healedLines, 'class');
            currentLevel = classLevel !== -1 ? classLevel + 1 : 0;
        }
        // 2. BLOCK MATCHING (The "Look-Back" Fix)
        else if (line.match(/^(else|elif|except|finally)\b/)) {
            const matchType = (line.startsWith('ex') || line.startsWith('fin')) ? 'try' : 'if';
            const parentIndent = findParentLevel(healedLines, matchType);
            if (parentIndent !== -1) {
                currentLevel = parentIndent;
            }
            else {
                currentLevel = Math.max(0, currentLevel - 1);
            }
        }
        else if (line.startsWith('case ')) {
            const matchLevel = findParentLevel(healedLines, 'match');
            if (matchLevel !== -1) {
                currentLevel = matchLevel + 1;
            }
        }
        // 3. POST-RETURN DEDENT (Optional hint)
        // If previous line was return/break, we *might* want to dedent.
        // But Rule 1 & 2 are much stronger.
        if (i > 0) {
            const prevLine = lines[i - 1].trim();
            if (prevLine.match(/^(return|raise|break|continue|pass)\b/)) {
                if (!line.match(/^(else|elif|except|finally|case)\b/)) {
                    // We only dedent if we aren't already at or below the expected level
                    // This is tricky without a full parser, so we keep it conservative.
                    // currentLevel = Math.max(0, currentLevel - 1); 
                }
            }
        }
        // --- WRITE THE LINE ---
        const indentStr = " ".repeat(currentLevel * INDENT_SIZE);
        healedLines.push(indentStr + line);
        // --- FUTURE LEVEL ADJUSTMENT ---
        // If this line ends with ':', next line goes deeper
        if (line.match(/:\s*(#.*)?$/)) {
            currentLevel++;
        }
    }
    return healedLines.join("\n");
}
/**
 * Helper: Scans backwards to find the indentation level of a keyword.
 */
function findParentLevel(lines, keyword) {
    const INDENT_SIZE = 4;
    for (let j = lines.length - 1; j >= 0; j--) {
        const content = lines[j].trim();
        if (content.startsWith(keyword) || (keyword === 'if' && content.startsWith('elif'))) {
            const spaces = lines[j].search(/\S/);
            return spaces >= 0 ? Math.floor(spaces / INDENT_SIZE) : 0;
        }
    }
    return -1;
}
//# sourceMappingURL=healer.js.map