# How I Built This: Python Indentation Healer

## 1. The Problem
- **Issue**: Copying code from StackOverflow or ChatGPT often messes up Python indentation (tabs vs. spaces, wrong levels).
- **Solution**: A VS Code extension that "heals" indentation with one shortcut (`Ctrl+Alt+I`).

## 2. Project Setup
- **Tool Used**: `Unix/Linux/Windows Terminal`
- **Command**: `yo code` (Yeoman Generator for VS Code)
- **Settings**:
    - Type: TypeScript
    - Name: `python-indent-healer`

## 3. The Core Logic (`src/healer.ts`)
I built a heuristic engine that guesses the correct indentation level based on Python keywords:
- **Indent**: After lines ending in `:` (e.g., `def`, `if`, `class`).
- **De-indent**: After block-ending keywords (`return`, `break`, `pass`) or mid-blocks (`else`, `elif`).
- **Special Handling**: `match/case` statements required logic to avoid "staircase" indentation.

## 4. Testing Strategy
- **Framework**: `Mocha` + `assert`
- **Unit Tests**: Created `src/test/unit/healer.test.ts`.
- **Coverage**:
    - Verified nested `if/else` blocks.
    - Verified comment preservation.
    - **Regression Test**: Found and fixed a bug where `case` statements were over-indented.

## 5. Key Features
- **Smart Paste**: Intercepts `Ctrl+V` in Python files to auto-heal on paste.
- **Context Awareness**: Checks previous lines to decide if `case` belongs to a `match` block.

## 6. Packaging & Polish
- **Icon**: Created and optimized a custom icon (`icon.png`) to < 20KB.
- **Metadata**: Configured `categories` and `activationEvents` for better discoverability and performance.
- **Packaging**: Used `vsce package` to generate the `.vsix` file.

## 7. Results
- **Final Size**: ~30 KB
- **Status**: Published to VS Code Marketplace as `vyntri.python-indent-healer`.

---
*Built with ❤️ and TypeScript.*
