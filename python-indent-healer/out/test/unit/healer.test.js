"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const healer_1 = require("../../healer");
suite('Indentation Healer Logic Test Suite', () => {
    test('Heal simple indentation', () => {
        const input = `def foo():
print("bar")
if True:
print("baz")`;
        const expected = `def foo():
    print("bar")
    if True:
        print("baz")`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
    test('Heal nested blocks', () => {
        const input = `if a:
if b:
print("c")
else:
print("d")`;
        const expected = `if a:
    if b:
        print("c")
    else:
        print("d")`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
    test('Respect comments', () => {
        const input = `def foo(): # comment
print("bar")`;
        const expected = `def foo(): # comment
    print("bar")`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
    test('Heal match/case blocks', () => {
        const input = `match x:
case 1:
print(1)
case 2:
print(2)`;
        const expected = `match x:
    case 1:
        print(1)
    case 2:
        print(2)`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
    test('Test Case 1: Flat Indentation', () => {
        const input = `def calculate_grade(score):
if score >= 90:
return "A"
elif score >= 80:
return "B"
else:
return "C"`;
        const expected = `def calculate_grade(score):
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    else:
        return "C"`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
    test('Test Case 3: Broken Block Class', () => {
        const input = `class Dog:
def __init__(self, name):
self.name = name
def bark(self):
if self.name:
return f"{self.name} says Woof!"
else:
return "Woof!"`;
        const expected = `class Dog:
    def __init__(self, name):
        self.name = name
    def bark(self):
        if self.name:
            return f"{self.name} says Woof!"
        else:
            return "Woof!"`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
    test('Ultimate Boss Fight', () => {
        const input = `import json
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

def save_data(self):
with open(self.filepath, 'w') as f:
json.dump(self.users, f, indent=4)
print("Database saved successfully.")

if __name__ == "__main__":
db = UserDatabase("users.json")
db.load_data()
db.save_data()`;
        const expected = `import json
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

    def save_data(self):
        with open(self.filepath, 'w') as f:
            json.dump(self.users, f, indent=4)
            print("Database saved successfully.")

if __name__ == "__main__":
    db = UserDatabase("users.json")
    db.load_data()
    db.save_data()`;
        assert.strictEqual((0, healer_1.healIndentation)(input), expected);
    });
});
//# sourceMappingURL=healer.test.js.map