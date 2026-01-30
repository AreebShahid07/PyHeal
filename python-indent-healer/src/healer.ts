export function healIndentation(text: string): string {
    const lines = text.split(/\r?\n/);
    const healedLines: string[] = [];
    const INDENT_SIZE = 4;
    let currentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Clean up unusual whitespace
        line = line.replace(/\u00A0/g, ' ');

        // Skip empty lines but keep them in output
        if (!line) {
            healedLines.push("");
            continue;
        }

        // --- INTELLIGENT LEVEL ADJUSTMENT ---

        // 1. HARD RESET KEYWORDS
        if (line.match(/^(import|from|class)\b/)) {
            currentLevel = 0;
        }
        else if (line.startsWith('if __name__') && line.includes('"__main__"')) {
            currentLevel = 0;
        }
        // Sibling Def Rule: if we see 'def' and we are deep, snap back to level 1 if inside a class
        else if (line.startsWith('def ')) {
            const classLevel = findParentLevel(healedLines, 'class');
            currentLevel = classLevel !== -1 ? classLevel + 1 : 0;
        }

        // 2. BLOCK SNAP-BACK (Else, Elif, Except, Finally)
        else if (line.match(/^(else|elif|except|finally)\b/)) {
            const matchType = (line.startsWith('ex') || line.startsWith('fin')) ? 'try' : 'if';
            const parentIndent = findParentLevel(healedLines, matchType);
            if (parentIndent !== -1) {
                currentLevel = parentIndent;
            } else {
                currentLevel = Math.max(0, currentLevel - 1);
            }
        }
        else if (line.startsWith('case ')) {
            const matchLevel = findParentLevel(healedLines, 'match');
            if (matchLevel !== -1) {
                currentLevel = matchLevel + 1;
            }
        }

        // 3. WRITE THE LINE
        const indentStr = " ".repeat(Math.max(0, currentLevel) * INDENT_SIZE);
        healedLines.push(indentStr + line);

        // 4. FUTURE LEVEL ADJUSTMENT
        // Openers (:) increase level, Closers (return, etc.) decrease level
        if (line.match(/:\s*(#.*)?$/)) {
            currentLevel++;
        } else if (line.match(/^(return|raise|break|continue|pass)\b/)) {
            currentLevel = Math.max(0, currentLevel - 1);
        }
    }

    return healedLines.join("\n");
}

/**
 * Helper: Scans backwards to find the indentation level of a keyword.
 */
function findParentLevel(lines: string[], keyword: string): number {
    const INDENT_SIZE = 4;
    for (let j = lines.length - 1; j >= 0; j--) {
        const content = lines[j].trim();
        // Match the keyword at the start of the line content
        if (content.startsWith(keyword) || (keyword === 'if' && content.startsWith('elif'))) {
            // Find how many spaces the original line has
            const spaces = lines[j].search(/\S/);
            return spaces >= 0 ? Math.floor(spaces / INDENT_SIZE) : 0;
        }
    }
    return -1;
}
