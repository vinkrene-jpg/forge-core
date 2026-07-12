# Implementation Inventory

| Component | Status | Evidence |
|---|---|---|
| Existing API server | Present | artifacts/api-server |
| Existing frontend | Present | artifacts/forge-core |
| Mock-up sandbox | Present | artifacts/mockup-sandbox |
| Database schemas | Present | lib/db |
| Replit configuration | Present | root and artifact configuration |
| Kernel | Missing | No source or Git-history evidence |
| Mission Loop | Implemented | Persistent single-mission execution loop with live recovery verification |
| Mission Engine | Implemented | Persistent mission model, queue, executors and API verification |
| Learning Engine | Missing | No source or Git-history evidence |
| Capability Registry | Implemented | Persistent registry with baseline reconciliation and live API verification |
| Capability Analysis | Implemented | Mission precheck and manual gap analysis verified live |
| Evolution Engine | Implemented | Approval, verified execution, evidence persistence, capability promotion and negative safety gate verified live |
| Governance Engine | Implemented | Versioned risk policy, persistent approvals, blocking, approval and rejection verified live |
| Project Memory | Implemented | Persistent project memory and default Forge Core project verified live |
| Prompt Composer | Implemented | Grounded prompt composition from project memory and protected source files verified live |
| Model Router | Implemented | Deterministic routing-policy selection implemented; provider execution intentionally unbound |
| Forge Desktop runtime binding | Implemented | Production Desktop consumes authoritative runtime APIs and is served by the API container |
