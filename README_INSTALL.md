# Install Forge Context Package

This package adds durable AI/session context to the Forge repository. It does not contain source-code changes, secrets or runtime state.

## Install

Close editors that are actively changing repository documentation. Then run in PowerShell:

```powershell
Expand-Archive `
  -Path "$env:USERPROFILE\Downloads\forge-context-package.zip" `
  -DestinationPath "C:\Forge\forge-core" `
  -Force

Set-Location "C:\Forge\forge-core"
git status --short
```

Review the new files before committing. Do not add `.env`, `storage` or provider credentials.

Suggested commit after review:

```powershell
git add AGENTS.md GOVERNANCE reconstruction
git commit -m "docs(context): establish durable Forge project memory"
git push
```

## New-session handoff

When an AI session has repository access, it must begin with `AGENTS.md`. If repository access is unavailable, provide at minimum:

- `AGENTS.md`
- `GOVERNANCE/FORGE_CONTEXT.md`
- `reconstruction/CURRENT_STATE.md`
- `reconstruction/NEXT_MISSION.md`
