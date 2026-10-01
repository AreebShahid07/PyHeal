# Python Indentation Healer

> **Paste without fear.**

Standard Python formatters (like Black or Autopep8) fail when code has indentation errors. They can't format what they can't parse.

**Python Indentation Healer** fixes the broken structure *first*, allowing you to copy code from PDFs, blogs, or messy forums and paste it directly into VS Code without breaking your workflow.

---

## See it in Action

### 1. Smart Paste (Ctrl + V)
Automatically detects logic flows and fixes indentation the moment you paste.
![Smart Paste Demo](https://github.com/AreebShahid07/PyHeal/raw/main/python-indent-healer/images/CTRL%2BV.gif)

### 2. Manual Heal (Ctrl + Alt + I)
Have an old file with broken indentation? Fix it instantly.
![Manual Heal Demo](https://github.com/AreebShahid07/PyHeal/raw/main/python-indent-healer/images/CTRL%2BALT%2BI.gif)

---

## Key Features

* **Context-Aware Engine (v3)**
    * Uses "Look-Back" logic to find the correct parent for `else`, `except`, and `finally` blocks.
    * Handles deep nesting and complex class structures that flat-line formatters miss.
* **Smart Paste Integration**
    * Intercepts `Ctrl+V` in Python files to apply fixes on the fly.
    * Works silently in the background.
* **"Boss Fight" Tested**
    * Verified against complex nested loops, context managers (`with open`), and mixed indentation styles.

---

## How to Use

| Goal | Action |
| :--- | :--- |
| **Fix on Paste** | Just press `Ctrl + V` inside any `.py` file. |
| **Fix Selection** | Highlight code and press `Ctrl + Alt + I` (Mac: `Cmd + Alt + I`). |
| **Command Palette** | Press `Ctrl + Shift + P` and search for **"Heal Python"**. |

---

## Release Notes

### 2.0.0 (The Engine Rebuild)
- **New Multi-Pass Engine**: Healing now runs as a four-pass pipeline — a string/bracket-aware logical-line assembler, an explicit block-stack structure inferencer, a deterministic ambiguity resolver, and an optional Python verifier. Regex special-cases are gone; structure is tracked, not guessed.
- **Verified Ambiguity Fixes**: Two long-standing ambiguity patterns are now resolved by documented, evidence-chained rules: value-`return` after a single-statement loop guard snaps to the loop sibling, and nested helper `def`s are rescued from dead code when a use-site call references an outer local. On the 499-line reference fixture, output is now byte-identical to hand-repaired ground truth.
- **Proof-Checked Output (Smart Paste)**: When a Python interpreter is available, smart paste verifies healed code with `ast.parse` and retries alternative candidates on failure — silently, with no new settings. Without Python, behavior is unchanged and just as fast.
- **Regression-Proofed**: A restored unit suite (74 tests) plus golden-corpus equivalence checks against the legacy engine guard every heuristic; the old engine ships inside the extension for A/B comparison and instant rollback.
- **Zero Workflow Change**: Same `Ctrl+V`, same `Ctrl+Alt+I`, same silent behavior, same public API. Just a stronger core.

### 1.1.0 (Precision Tuning)
- **Nested Block Fix**: Resolved an issue where multiple `else` statements at different nesting levels could align incorrectly.
- **Closers-Aware Detection**: Improved `findParentLevel` to intelligently skip over nested blocks by tracking closers (`else:`, `finally:`, etc.).
- **Nearest Parent Snap**: Refined the Return Escape to snap to the level of the most recent block, handling loops more accurately.

### 1.0.0 (The Ultimate Release)
- **Ghost Tracker**: Indentation logic now survives blank lines by remembering context.
- **Return Escape**: `return` statements now correctly snap out to the function level, preventing "None Type" and "Dead Code" errors.
- **Data Structure Support**: Added support for multi-line lists, sets, and dictionaries (indentation based on brackets `[]`, `{}`, `()`).
- **Section Header Snapping**: Powerful new heuristic for aligning major print/log statements in complex scripts.

### 0.0.7
- **Pylance Compatibility**: Fixed decorator alignment issues (`@staticmethod`, etc.).

### 0.0.5
- **Bug Fix**: Resolved the "Staircase Indentation" bug where statements after closer keywords (return/break) would over-indent.
- Improved scope tracking for sibling blocks.

### 0.0.4
- Performance optimizations for large file healing.
- Logic enhancements for `match/case` patterns.

### 0.0.3
- **Feature**: Initial implementation of "Smart Paste".

### 0.0.2
- Improved regex patterns for block detection.
- Added platform-specific keybindings (Cmd+Alt+I for Mac).

### 0.0.1
- **Initial Launch**.
- Core Heuristic Processor implementation.
- Basic command and shortcut registration.

---

## Contributing and Feedback
This project is open source. If you find a code block that breaks the Healer, please open an issue with the snippet!

**[Report a Bug](https://github.com/vyntri/python-indent-healer/issues)** | **[Rate the Extension](https://marketplace.visualstudio.com/items?itemName=vyntri.python-indent-healer&ssr=false#review-details)**
