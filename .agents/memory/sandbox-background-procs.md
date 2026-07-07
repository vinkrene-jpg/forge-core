---
name: Sandbox background processes
description: Background processes started in a bash tool call do not survive the call
---
Processes started with `&`, `nohup`, or `setsid` in a bash tool call are killed when that call returns (sandbox process-group cleanup).
**Why:** During the mock-AI E2E demo, the mock server repeatedly died between calls, causing "fetch failed" in the AI gateway.
**How to apply:** Start any helper server and everything that depends on it inside a single bash call, and kill it at the end of that call. Also: `pkill -f`/`pgrep -f` match the current shell's own command line — use PID filtering or bracketed patterns carefully.
