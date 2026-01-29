"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const healer_1 = require("./src/healer");
const code = `import json
import os

class UserDatabase:
def __init__(self, filepath):
self.filepath = filepath
self.users = []

def load_data(self):
try:
if os.path.exists(self.filepath):
with open(self.filepath, 'r') as f:
self.users = json.load(f)
print(f"Loaded {len(self.users)} users.")
else:
print("Database file not found. Starting fresh.")
self.users = []
except Exception as e:
print(f"Failed to load database: {e}")
self.users = []

def add_user(self, username, role):
if not username:
print("Error: Username cannot be empty.")
return False
for user in self.users:
if user['name'] == username:
print(f"User {username} already exists.")
return False
new_user = {'name': username, 'role': role, 'active': True}
self.users.append(new_user)
print(f"User {username} added.")
return True

def get_active_admins(self):
admins = []
for user in self.users:
if user['active']:
if user['role'] == 'admin':
admins.append(user['name'])
else:
continue
else:
print(f"Skipping inactive user: {user['name']}")
return admins

def save_data(self):
with open(self.filepath, 'w') as f:
json.dump(self.users, f, indent=4)
print("Database saved successfully.")

if __name__ == "__main__":
db = UserDatabase("users.json")
db.load_data()
db.add_user("Alice", "admin")
db.add_user("Bob", "guest")
admins = db.get_active_admins()
print(f"Active Admins: {admins}")
db.save_data()`;
console.log((0, healer_1.healIndentation)(code));
//# sourceMappingURL=debug_boss.js.map