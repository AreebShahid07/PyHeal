function healIndentation(text) {
    const lines = text.split(/\r?\n/);
    const healedLines = [];
    let currentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        line = line.replace(/\u00A0/g, ' ');
        if (!line) {
            healedLines.push("");
            continue;
        }

        // Snap back for class/import
        if (line.match(/^(import|from|class)\b/)) {
            currentLevel = 0;
        }

        const indentStr = " ".repeat(currentLevel * 4);
        healedLines.push(indentStr + line);
        console.log(`[${line}] | Level: ${currentLevel} -> ${line.match(/:\s*(#.*)?$/) ? currentLevel + 1 : (line.match(/^(return|raise|break|continue|pass)\b/) ? currentLevel - 1 : currentLevel)}`);

        if (line.match(/:\s*(#.*)?$/)) {
            currentLevel++;
        } else if (line.match(/^(return|raise|break|continue|pass)\b/)) {
            currentLevel = Math.max(0, currentLevel - 1);
        }
    }
    return healedLines.join("\n");
}

const input = `import asyncio
import random

class NetworkService:
@staticmethod
def validate_packet(data):
if not data:
return False

if len(data) < 10:
print("Packet too small")
return False

return True

async def connect_with_retry(self, endpoint):
attempts = 0
max_retries = 3

while attempts < max_retries:
print(f"Attempt {attempts + 1} connecting to {endpoint}...")
await asyncio.sleep(1)

if random.choice([True, False]):
print("Connection established.")
return True

print("Connection failed. Retrying...")
attempts += 1

print("All attempts failed.")
raise ConnectionError("Could not connect to host")`;

healIndentation(input);
