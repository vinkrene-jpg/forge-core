---
name: node --test vs permission model
description: node --test child processes break under NODE_OPTIONS permission flags; require --test-isolation=none
---

Under Node 24, `node --test` spawns one child process per test file, and when the parent runs with the permission model via `NODE_OPTIONS` (`--permission --allow-fs-read=... --allow-child-process`), the children fail with `--allow-fs-read= requires an argument` — the flag value gets lost on re-serialization.

**Why:** Discovered when a generated sandbox module's unit test failed inside the real test runner despite passing standalone (July 2026).

**How to apply:** Any test script that must run inside the sandboxed real test runner should use `node --test --test-isolation=none` (in-process, no child spawn). Any prompt or template that produces sandbox test scripts must mandate this flag.
