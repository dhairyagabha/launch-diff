# 13 — Suggested Codex Master Prompt

Use the following prompt when starting the repository build with Codex:

---

Build the LaunchDiff project described by the documentation in this repository.

Before writing code, read `AGENTS.md` and `CODEX_START_HERE.md`, then read the referenced product, architecture, analysis, security, testing, and implementation-plan documents.

Treat the documentation as authoritative.

Work milestone-by-milestone from `docs/10-implementation-plan.md`. Start with Phase 01 only. Do not skip phases or attempt the full application in one implementation pass.

The highest-priority product rule is:

> When comparison certainty is insufficient, preserve and expose the potential difference. LaunchDiff may show an extra change, but it must never intentionally suppress a plausible deployed change merely to produce a cleaner diff.

Do not weaken tests, matching conservatism, privacy, SSRF controls, or deployed-artifact authority to simplify implementation.

At the end of each phase, report:

1. work completed
2. files created/changed
3. tests added
4. commands/tests run
5. acceptance criteria satisfied
6. remaining risks or gaps

Wait for the next instruction before moving to the following phase unless explicitly told to continue automatically.

---
