# Forge Validation Framework

Run the complete non-AI validation street from the repository root:

```powershell
pnpm forge:validate
```

For a strict status-only console without package-manager script headers, invoke the same root wrapper directly:

```powershell
node scripts/forge-validate-root.mjs
```

Include an isolated restart proof after builds and tests:

```powershell
pnpm forge:validate --restart
```

The console emits only `PASS`, `WARNING` and `FAIL` status lines. Detailed evidence is written to `reports/validation-report.json`; the generated report is intentionally Git-ignored.

Exit codes:

- `0`: no validation failures; Git may be reported as `WARNING` while a build change is in progress.
- `1`: one or more validation steps failed.
- `2`: the validator could not execute a required command or probe because of an infrastructure error.

## Configuration

`config/forge-validation.json` defines the validation street. Add future modules by appending a generic `command` or `http` step; no runner change is required.

Command step:

```json
{
  "id": "test-new-module",
  "label": "Tests new module",
  "type": "command",
  "command": ["pnpm.cmd", "--filter", "@workspace/new-module", "test"]
}
```

HTTP steps support status checks, scalar JSON expectations and `{missionId}` substitution. A preceding step with `captureMissionId: true` obtains the mission ID from the Mirror list.

The optional restart proof uses the configured built API command, a separate port and temporary runtime state. It starts and stops the isolated runtime twice and never replaces the active listener, deploys, commits or pushes.