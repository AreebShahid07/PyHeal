function healIndentation(text) {
    const lines = text.split(/\r?\n/);
    const healedLines = [];
    let currentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) {
            healedLines.push("");
            continue;
        }

        const indentStr = " ".repeat(currentLevel * 4);
        healedLines.push(indentStr + line);
        console.log(`Line: [${line}] | Level Before: ${currentLevel}`);

        if (line.match(/:\s*(#.*)?$/)) {
            currentLevel++;
        } else if (line.match(/^(return|raise|break|continue|pass)\b/)) {
            currentLevel = Math.max(0, currentLevel - 1);
        }
        console.log(`Level After: ${currentLevel}`);
    }
    return healedLines.join("\n");
}

const input = `def foo():
if x:
return False
if y:
print(1)`;

console.log("--- START TEST ---");
healIndentation(input);
console.log("--- END TEST ---");
