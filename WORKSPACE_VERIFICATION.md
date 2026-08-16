# Network-isolated workspace verification

Forge verifies generated workspace changes in `forge-verification:latest`. The
runner never falls back to host execution. It creates containers with no
network, a memory limit, a PID limit, dropped capabilities and
`no-new-privileges`, and forcibly removes each container after success,
failure, cancellation or timeout.

Only a sanitized snapshot of `sandbox/`, `lib/` and `artifacts/` is bind-mounted
read-only. Host package manifests, lockfiles, environment files, keys,
dependency directories, build output and TypeScript incremental state are not
copied into that snapshot. Dependencies and trusted command manifests are
baked into the image. Verification runs with pnpm offline, dependency repair
disabled and lifecycle scripts disabled.

The image also contains Git and the three read-only runtime context fixtures
used by deterministic learning: `GOVERNANCE/ROADMAP.md`,
`reconstruction/CURRENT_STATE.md` and `reconstruction/NEXT_MISSION.md`.
Runtime state is redirected to disposable `/tmp/forge-storage`. Workspace
tmpfs mounts permit execution because isolated verification must run candidate
code and trusted native build tools; network, capabilities, host storage and
package installation remain unavailable.

## Rebuild the image

Rebuild after any dependency, lockfile, workspace manifest, verification
command or toolchain change:

```powershell
.\scripts\build-verification-image.ps1
```

Use `FORGE_VERIFICATION_IMAGE` to select a different image reference. Before
each run Forge resolves that reference to a local `sha256` image ID and creates
the container from that immutable ID. A missing or invalid image fails closed.

## Live proof

After rebuilding, generate the success, rollback, network and host-denial
evidence:

```powershell
pnpm.cmd --filter @workspace/forge-runtime exec tsx src/workspace-verification-live.ts
```

The proof is written to
`reconstruction/WORKSPACE_VERIFICATION_ISOLATION_PROOF.json`.