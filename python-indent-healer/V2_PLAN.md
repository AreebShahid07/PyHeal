# PyHeal v2 — Architecture Plan

> **Mission:** one task — heal broken Python indentation with **zero mistakes**. No new features.
> Your 3,000+ users are why correctness is the only goal.

---

## 0. Guardrails — what will NOT change

These are frozen. Every milestone must preserve them, verified by tests:

1. **Public API**: `healIndentation(text: string): string` — same signature, same module path (`src/healer.ts`).
2. **UX**: `Ctrl+V` smart paste stays silent by default; `Ctrl+Alt+I` manual heal unchanged; Command Palette entries unchanged.
3. **No new settings, commands, or UI** in v2.0.0.
4. **Byte-stability on correct inputs**: healing already-correct code must be a no-op (golden test enforced).
5. **v1 engine preserved internally** as `healIndentationLegacy` during migration, for output A/B comparison in dev builds and instant rollback if v2 regresses in the wild.

---

## 1. Evidence base — what was actually verified before writing this plan

All findings below were produced by running tools against the repo, not by eyeballing:

| File | `python -c "ast.parse(...)"` | Meaning |
|---|---|---|
| `test.py` (flat paste) | ❌ `IndentationError` at line 12 | Expected — it is the raw broken input |
| `test_healed.py` (healer output) | ✅ **parses clean** | The healer's output on the 499-line fixture is **valid Python** |
| `Mega.py` (assumed "ground truth") | ❌ `IndentationError` at line 384 | **The reference file itself is broken Python** |

### 1.1 The full diff between healer output and Mega.py is only 15 changed lines — and most are Mega.py's fault

| Region | Healer (`test_healed.py`) | Mega.py | Who is right? |
|---|---|---|---|
| Line 66 — `CraftingRecipe.can_craft` | `return True` after the loop (8 spaces) | `return True` inside the `if` (12 spaces) → returns after the **first** ingredient check | **Healer.** Mega's version is a classic logic bug |
| Lines 383/386/389 — `Logger` `@staticmethod` | Decorators at class level (4 spaces) → valid | Decorators nested at 8 spaces inside the previous method body → **`IndentationError: unexpected unindent` at line 384** | **Healer.** Rule C (decorator snap) did exactly the right thing |
| Lines 454/460 — `Matrix4x4` `@staticmethod` | Class level (4 spaces) → valid | 8 spaces → broken the same way | **Healer** |
| Lines 477–492 — file tail | Top-level `def complex_algorithm_test` / `def quicksort`; `sorted_data`/`return` become dead code inside `quicksort` — **parses, semantically dead** | `complex_algorithm_test`/`quicksort` as `Matrix4x4` methods; `return sorted_data` at class level → **`SyntaxError` (`return` outside function)** | **Neither.** Genuinely ambiguous flat input; see §4 |

### 1.2 Conclusions that reshape v2

- **The engine's core is healthier than the earlier visual audit suggested.** On the largest fixture, its output is syntactically perfect. The scary "bugs" (EventBus append nesting, NPC state nesting) are ambiguities where the healer matches Mega.py — no divergence exists.
- **`Mega.py` cannot serve as ground truth.** It must be repaired (§9) before it can anchor regression tests.
- **The one proven engine weakness** is the ambiguous tail: a nested `def` followed by lines that use its enclosing function's locals produced dead code instead of the semantically intended nesting. That is a heuristic gap v2 must close (§4).

---

## 2. Root causes in the v1 engine (`src/healer.ts`)

The v1 design is a single streaming pass over raw lines with a mutable `currentLevel` and ~9 regex rules. It performs remarkably well, but has structural ceilings:

1. **No lexical awareness.** A `:` ending a line increments the level even when it sits inside a string, docstring, or comment. Multi-line brackets are only handled for *closing* lines (`^[\]\}\)]`), not for continuation content.
2. **Order-dependent mutable state.** Each rule mutates `currentLevel` in sequence; a misclassification on line *N* poisons every line after it. There is no way to reconsider.
3. **Per-keyword special cases multiply.** `findParentLevel(lines, 'if'|'try'|'match')` + closers sets + ghost tracker + section-header snapping — each new edge case adds another branch. Complexity grows super-linearly with real-world inputs.
4. **No verification.** The engine cannot know when it has failed; it always commits its first guess.

---

## 3. v2 architecture — a four-pass pipeline

Same module, same exports. Internally, `healIndentation` becomes a composition of four pure passes. Pure functions = independently unit-testable = the safety the deleted suite used to provide, but stronger.

```
raw text
   │
   ▼
[Pass 1] LogicalLineAssembler   — text → LogicalLine[]
   │      (joins physical lines inside (), [], {}, strings, line-continuations;
   │       strips/labels comments; classifies string spans so ':' inside
   │       strings can never be mistaken for a block opener)
   ▼
[Pass 2] StructureInferencer    — LogicalLine[] → Plan[] (target indent per line)
   │      (explicit block stack: openers push, closers pop; else/elif/except/
   │       finally attach to the stack top of their family — generalizes v1's
   │       findParentLevel with no special cases; decorators snap to class level;
   │       return/break/continue mark the frame dead and the next line escapes
   │       to the nearest live sibling)
   ▼
[Pass 3] AmbiguityResolver      — Plan[] → Plan[]
   │      (deterministic tie-breaks for flat-input ambiguity, §4;
   │       nested-def/late-binding detection; dead-code avoidance)
   ▼
[Pass 4] PythonVerifier         — Plan[] → final text
          (optional, only when a Python interpreter is discoverable:
           render candidate → `python -c "import ast; ast.parse(...)"`;
           if it fails, retry the recorded ambiguous choices in
           most-likely-first order; if all fail or no Python, return
           Pass 1–3 output unchanged. Interpreter lookup cached once per session.
           Failure of this pass must NEVER block healing.)
```

**Design rules**

- Passes 1–3 are pure string-in/string-out transformations with typed intermediates (`LogicalLine`, `IndentPlan`). No VS Code imports inside the engine — it stays testable in plain Node/mocha, like the deleted suite did.
- Every ambiguous decision records **alternatives** (§4), which is what makes Pass 4's retry loop possible instead of guesswork.
- Tabs, CRLF, BOM, NBSP and exotic whitespace are normalized in Pass 1 (v1 already handles NBSP; this generalizes it).

---

## 4. Ambiguity policy — deterministic, documented, testable

Flat input is sometimes genuinely ambiguous (that is *why* v1 needs heuristics). v2 replaces implicit gut-feel rules with an explicit priority order, applied by Pass 3:

1. **Parseability wins** (when Python is available): a candidate that `ast.parse`s beats one that doesn't.
2. **Live-code beats dead code**: prefer plans where no statement sits after an unconditional `return` in the same block. *This alone fixes the fixture tail.*
3. **Use-site evidence**: a `def` whose name is referenced later by lines that also use an enclosing function's local should nest inside that function (fixes `quicksort(data)`-style cases).
4. **Minimum-change principle**: among equally valid candidates, choose the one closest to v1's output — protecting the 3,000 users' current experience.
5. **Else-family attachment**: `else/elif` prefer the nearest *open* `if` on the stack; `except/finally` the nearest open `try` — replacing the closers-set trick with stack truth.

Every tie-break rule gets its own named unit test with a minimal snippet.

---

## 5. Test & regression strategy

The test suite deleted in commit `793f40d` is the skeleton; v2 makes it the spine.

- **M0 restore**: `git show 79ac216:python-indent-healer/src/test/unit/healer.test.ts` recovers the 249-line suite verbatim. Reattach under `src/test/unit/`.
- **Golden corpus** (each = input + expected output, committed as fixtures):
  - `test.py` → repaired `Mega.py` (after §9 fixes)
  - Adversarial minimum: `:` inside strings/docstrings/f-strings; decorators over methods and functions; `match/case`; nested `try/except/else/finally`; multi-line calls/comprehensions/dicts; tabs mixed with spaces; CRLF; blank-line storms; already-correct files (must be byte-identical — guardrail #4).
- **Property tests** run over the whole corpus: idempotence (`heal(heal(x)) === heal(x)`) and stability.
- **A/B harness (dev-only)**: run v1 and v2 over the corpus, report divergences. Every divergence must be explained by a named v2 improvement or the change is rejected. This is the "don't ruin my previous efforts" enforcement mechanism.
- **CI**: `npm run compile && npm run lint && npm test` on every push (GitHub Actions, ~20 lines of YAML).

---

## 6. Compatibility & release

- Ship as **2.0.0** (engine rewrite, zero feature delta — the version number signals "same product, stronger core").
- Changelog template already fits README's style ("Release Notes" section): frame v2 as *precision*, matching 1.1.0's tone.
- Marketplace listing unchanged. No README behavior changes needed.
- Rollback plan: v1 engine stays in the bundle behind an internal constant (`ENGINE_VERSION`); if field reports regress, a single-constant dev build can re-point to legacy while a patch is prepared.

---

## 7. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| **M0** | Safety net | Restored suite passes against **v1**; golden fixtures committed; Mega.py repaired (§9) and diff-verified; CI green |
| **M1** | Pass 1 lexer/assembler | Logical-line assembly unit-tested: strings, brackets, continuations, comments, whitespace normalization. No behavior change yet (v2 pipeline not wired) |
| **M2** | Pass 2 stack inferencer | v2 pipeline replaces v1 behind `healIndentation`; full corpus passes; A/B shows divergences only from named rules; byte-identical on already-correct inputs |
| **M3** | Pass 3 resolver | Tail case + nested-def cases fixed; all ambiguity rules unit-tested; v1 legacy divergences documented |
| **M4** | Pass 4 verifier | ast.verify loop with graceful no-Python fallback; interpreter discovery cached; timeout-guarded (≤ 500 ms) |
| **M5** | Hardening + release | Large-file perf (10k-line file < 100 ms in Passes 1–3), lint clean, changelog, version bump, dev A/B harness documented |

---

## 8. Risk register

| Risk | Mitigation |
|---|---|
| v2 changes output on inputs users rely on today | Guardrail #4 + M2 A/B harness + minimum-change tie-break #4 |
| No Python on user machine | Pass 4 is strictly additive; engine never requires it |
| Verification subprocess hangs | Hard timeout + cached discovery; failure = fall back to Pass 1–3 result |
| Hidden ambiguities in the wild (3,000 users ≫ our corpus) | README issue-template invites breaking snippets; each becomes a golden fixture |
| Regex special cases regress during rewrite | v1 suite restored in M0 *before* any engine change; suite must be green on v1 first |

---

## 9. Required fixture repair — Mega.py (do in M0, before anything else)

`Mega.py` currently fails `ast.parse`. Three regions must be fixed so it can anchor tests (each fix restores the obvious intent; none touches healer logic):

1. **Lines 383–391 (Logger)**: the `@staticmethod` decorators for `info`/`error`/`warning` sit at 8 spaces (inside the previous method's body). Move each to class level (4 spaces) — exactly what the healer already produces.
2. **Lines 454, 460 (Matrix4x4)**: same decorator defect for `identity`/`translation` — move to class level.
3. **Lines 477–492 (tail)**: `complex_algorithm_test`/`quicksort` as class methods ends in a class-level `return` (SyntaxError). Restructure to the semantically evident original: `quicksort` nested inside `complex_algorithm_test`, with `sorted_data = quicksort(data)` / `return sorted_data` in `complex_algorithm_test`'s body.
4. **Line 66 note (do NOT change)**: healer's `return True` *after* the loop is semantically correct; Mega's inside-`if` version is a bug. The repaired fixture should adopt the healer's (correct) variant — this is a fixture fix, not an engine change.

After repair: `python -c "import ast; ast.parse(open('Mega.py').read())"` must exit 0, and the healer-output ↔ Mega diff must shrink to the tail case only (until M3 closes it).

---

*Plan written against commit `aad7368` (v1.1.0, engine at `src/healer.ts`). All evidence sections cite commands that were actually run in this workspace.*
