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

### v0.0.3 (The "Context" Update)
* **New Engine:** Switched from linear logic to **"Look-Back" logic**. The healer now scans backwards to snap blocks (`if/else`, `try/except`) to their correct parents.
* **Deep Nesting Fix:** Resolved issues with 3+ levels of indentation.
* **Documentation:** Added demo GIFs and verification tests.

### v0.0.1
* Initial Launch.
* Added Heuristic Processor and Smart Paste support.

---

## Contributing and Feedback
This project is open source. If you find a code block that breaks the Healer, please open an issue with the snippet!

**[Report a Bug](https://github.com/vyntri/python-indent-healer/issues)** | **[Rate the Extension](https://marketplace.visualstudio.com/items?itemName=vyntri.python-indent-healer&ssr=false#review-details)**
