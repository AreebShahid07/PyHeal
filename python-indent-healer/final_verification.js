const { healIndentation } = require('./out/healer');

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
raise ConnectionError("Could not connect to host")

def process_queue(self):
queue = ["job1", "job2", "job3"]
for job in queue:
try:
if job == "job2":
print("Skipping bad job")
continue

print(f"Processing {job}")
except Exception as e:
print(f"Error: {e}")
finally:
print("Cleanup done")

print("Queue processing complete.")`;

const result = healIndentation(input);
console.log(result);
