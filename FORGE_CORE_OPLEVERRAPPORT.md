# Forge Core — Technisch Opleverrapport

**Datum:** 6 juli 2026
**Scope:** verificatie van alle 15 sprints + expliciete controlepunten. Geen nieuwe functionaliteit gebouwd.

---

## Samenvatting

| Onderdeel | Oordeel |
|---|---|
| Sprints volledig gebouwd | 16 van 16 (Sprint 0–15) |
| Sprints deels klaar / placeholder | 0 — wel 2 onderdelen met **bewust vereenvoudigde (regelgebaseerde) logica**, expliciet gemarkeerd hieronder |
| Typecheck (hele workspace) | ✅ geslaagd, 0 fouten |
| Live geverifieerde controlepunten | 13 van 14 volledig, 1 gedeeltelijk (Docker Compose: db-service live getest, app-service alleen configuratie-validatie) |
| Falende tests | geen |

---

## Rapportage per sprint

### Sprint 0 — Projectbasis
**Status: ✅ klaar**
- **Bestanden:** `artifacts/api-server/` (Express 5 backend), `artifacts/forge-core/` (React + TypeScript frontend, Vite), `lib/db/` (Drizzle ORM), `lib/api-spec/openapi.yaml` (1.837 regels, contract-first), `lib/api-zod` + `lib/api-client` (gegenereerd)
- **Routes:** `GET /api/healthz` (controleert database én storage-schrijfbaarheid)
- **Databasetabellen:** — (basis; tabellen per domein-sprint hieronder)
- **Werkt echt:** server start pas nadat storage-mappen bestaan en de Locked Core geseed is; healthcheck; volledige request- én response-validatie met gegenereerde Zod-schema's
- **Mock/placeholder:** geen
- **Tests:** `pnpm run typecheck` (alle packages groen); `GET /api/healthz` → `{"status":"ok","database":"ok","storage":"ok"}`
- **Beperkingen:** geen

### Sprint 1 — Locked Core Registry
**Status: ✅ klaar**
- **Bestanden:** `lib/db/src/schema/core.ts`, `artifacts/api-server/src/lib/corelock.ts`, `src/lib/seed.ts`, `src/routes/core.ts`, frontendpagina `core-components.tsx`
- **Routes:** `GET /api/core-components`, `PATCH /api/core-components/:id`, `GET /api/audit-logs`
- **Databasetabellen:** `core_components`, `audit_logs`
- **Werkt echt:** 13 kerncomponenten worden bij het opstarten geseed (vóór de server verkeer accepteert); elke wijzigingspoging → **403 + audit-log**; enige bypass is `CORE_ADMIN_OVERRIDE=true` in `.env`
- **Mock/placeholder:** geen
- **Tests:** `PATCH /api/core-components/1` → HTTP 403 met duidelijke foutmelding, geverifieerd in audit-log ✅
- **Beperkingen:** override is een env-schakelaar, geen aparte admin-login (platform is single-owner, zie Algemene beperkingen)

### Sprint 2 — AI Gateway
**Status: ✅ klaar**
- **Bestanden:** `src/lib/aiGateway.ts`, `src/routes/ai.ts`, frontendpagina `ai-gateway.tsx`
- **Routes:** `GET /api/ai/providers`, `POST /api/ai/invoke`, `GET /api/ai/calls`
- **Databasetabellen:** `ai_calls` (logging van elke aanroep incl. tokens/kostenindicatie)
- **Werkt echt:** één centrale gateway; providers (openai / anthropic / custom, bijv. Ollama) puur via `.env`; per-taaktype routing (`AI_ROUTE_<TASKTYPE>`); fallback-provider; gateway-fouten worden nette 400's, nooit een crash
- **Mock/placeholder:** geen — maar er is **nog geen API-key geconfigureerd**, dus echte AI-aanroepen zijn nog niet uitgevoerd
- **Tests:** `GET /api/ai/providers` toont 3 providers met `configured:false`; `POST /api/ai/invoke` zonder key → HTTP 400 met melding welke `.env`-variabelen nodig zijn ✅
- **Beperkingen:** werking mét echte provider is pas verifieerbaar zodra een key in `.env` staat

### Sprint 3 — Project & Task Manager
**Status: ✅ klaar**
- **Bestanden:** `lib/db/src/schema/projects.ts`, `src/routes/projects.ts`, `src/routes/tasks.ts`, frontendpagina's `projects.tsx`, `tasks.tsx`
- **Routes:** volledige CRUD op `/api/projects`, `/api/goals`, `/api/backlog-items`, `/api/tasks` (+ subtaken via `parentTaskId`), `/api/decisions`, `/api/risks`
- **Databasetabellen:** `projects`, `goals`, `backlog_items`, `tasks`, `decisions`, `risks`
- **Werkt echt:** alles — taken met 9 statussen, beslissingen en risico's per taak
- **Mock/placeholder:** geen
- **Tests:** project aangemaakt/verwijderd via API (201/204); taak automatisch aangemaakt via improvement-conversie ✅
- **Beperkingen:** geen

### Sprint 4 — Module Manager
**Status: ✅ klaar**
- **Bestanden:** `lib/db/src/schema/modules.ts`, `src/routes/modules.ts`, frontendpagina `modules.tsx`
- **Routes:** CRUD `/api/modules`, plus `/activate`, `/deactivate`, `/install`, `/rollback`, `/snapshots`, `/guardian-review`
- **Databasetabellen:** `modules`, `module_snapshots`
- **Werkt echt:** 11 moduletypes; manifest is verplicht JSON met padvalidatie — een manifest dat Locked Core-paden declareert wordt geweigerd (403 + audit); risiconiveaus low/medium/high; materiële wijziging (manifest/versie/dependencies) laat eerdere goedkeuringen **vervallen** en zet teststatus terug op `untested`
- **Mock/placeholder:** geen
- **Tests:** module met ongeldig type → 400 met exacte enum-lijst; met core-pad in manifest → 403; volledig install-traject doorlopen ✅
- **Beperkingen:** geen

### Sprint 5 — Sandbox Manager
**Status: ✅ klaar**
- **Bestanden:** `lib/db/src/schema/sandboxes.ts`, `src/lib/storage.ts`, `src/routes/sandboxes.ts`, frontendpagina `sandboxes.tsx`
- **Routes:** CRUD `/api/sandboxes`, `POST /api/sandboxes/:id/files`, `DELETE /api/sandboxes/:id/files/:fileId`
- **Databasetabellen:** `sandboxes`, `sandbox_files`
- **Werkt echt:** elke sandbox krijgt een eigen fysieke map onder `storage/sandboxes/<id>`; bestanden worden echt op schijf geschreven (geverifieerd op het bestandssysteem); schrijven naar beschermde core-paden of buiten de sandbox → **403 + audit**
- **Mock/placeholder:** geen
- **Tests:** sandbox aangemaakt, `src/index.ts` geschreven en fysiek op schijf teruggevonden; schrijfpoging naar `core/aiGateway.ts` → 403 ✅
- **Beperkingen:** sandboxbestanden worden niet uitgevoerd/gecompileerd binnen de sandbox (er is geen container-isolatie per sandbox); het is een bestands-workspace met padbescherming

### Sprint 6 — Test Runner
**Status: ✅ klaar — met bewust vereenvoudigde checklogica**
- **Bestanden:** `src/lib/testRunner.ts`, `src/routes/governance.ts` (test-run-endpoints), frontendpagina `tests.tsx`
- **Routes:** `GET /api/test-runs`, `POST /api/test-runs`
- **Databasetabellen:** `test_runs`
- **Werkt echt:** 7 testtypes (unit, integration, lint, typecheck, build, security, performance); resultaat per type wordt opgeslagen; teststatus wordt op de module bijgewerkt; `types`-array is verplicht (400 zonder)
- **⚠️ Vereenvoudigd (géén mock, wel deterministisch):** de checks zijn **regelgebaseerde validaties** op de module (manifest-integriteit, naamconventies, dependency-checks, verboden paden) — er wordt geen echte testcode van de module gecompileerd of uitgevoerd. Dit is de eerlijke huidige stand: de pipeline-mechanica is echt, de testinhoud is heuristisch.
- **Tests:** run zonder `types` → 400; run met 5 types → status `passed` met resultaat per type ✅
- **Beperkingen:** echte code-executie van modultests vereist een uitvoeringsomgeving per sandbox (bewust buiten scope gehouden)

### Sprint 7 — Approval Engine
**Status: ✅ klaar**
- **Bestanden:** `lib/db/src/schema/governance.ts`, `src/routes/governance.ts`, frontendpagina `approvals.tsx`
- **Routes:** `GET /api/approvals`, `POST /api/approvals/:id/decide`
- **Databasetabellen:** `approvals`
- **Werkt echt:** drie niveaus (automatisch / review vereist / eigenaar akkoord); **afwijzing zonder reden → 400**; goedkeuring voltooit de installatie direct via de Governor; beslissingsidentiteit wordt server-side op `owner` gezet — een meegestuurde `decidedBy` wordt genegeerd (getest met gespoofde waarde); goedkeuringen **vervallen automatisch** wanneer de module daarna wijzigt
- **Mock/placeholder:** geen
- **Tests:** medium-risk module → approval aangemaakt; goedkeuring met `decidedBy:"attacker"` → opgeslagen als `owner`; module gewijzigd → approval-status `expired`, herinstallatie → `review_required` ✅
- **Beperkingen:** geen

### Sprint 8 — Guardian
**Status: ✅ klaar — met regelgebaseerde reviewlogica**
- **Bestanden:** `src/lib/guardian.ts`, review-endpoint in `src/routes/modules.ts`
- **Routes:** `POST /api/modules/:id/guardian-review`, `GET /api/guardian-reviews`
- **Databasetabellen:** `guardian_reviews`
- **Werkt echt:** uitkomsten pass / warning / fail met bevindingen (categorie, ernst, boodschap); controleert architectuurimpact, duplicatie, core-aanrakingen, testaanwezigheid, manifestkwaliteit
- **⚠️ Vereenvoudigd:** de Guardian gebruikt **deterministische regels**, geen AI-beoordeling. De AI Gateway staat klaar om de Guardian later AI-ondersteund te maken, maar dat is niet gebouwd (en was ook geen eis voor deze oplevering).
- **Tests:** module zonder testrun → `warning` met bevinding "tests are mandatory"; met groene tests → `pass` zonder bevindingen ✅
- **Beperkingen:** zie hierboven

### Sprint 9 — Governor
**Status: ✅ klaar**
- **Bestanden:** `src/lib/governor.ts`
- **Routes:** `POST /api/modules/:id/install`, `GET /api/governor-decisions`
- **Databasetabellen:** `governor_decisions`
- **Werkt echt:** combineert testresultaten + Guardianrapport + risiconiveau + rollback-gereedheid + goedkeuringen tot één besluit: `install_allowed` / `install_blocked` / `review_required` / `rollback_required`. Harde blokkades: core-aanraking, ontbrekend manifest (= geen rollback mogelijk), geen of gefaalde tests, Guardian-fail. Low-risk + alles groen → automatische installatie; anders approval-flow. Elke beslissing wordt met inputs vastgelegd en geauditeerd.
- **Mock/placeholder:** geen
- **Tests:** volledige matrix live doorlopen: geen tests → `install_blocked`; groen + low → `install_allowed` + auto-install; groen + medium → `review_required` + approval; na goedkeuring → geïnstalleerd ✅
- **Beperkingen:** geen

### Sprint 10 — Rollback Engine
**Status: ✅ klaar**
- **Bestanden:** snapshot-logica in `src/lib/governor.ts` (`performInstall`), rollback-endpoint in `src/routes/modules.ts`
- **Routes:** `POST /api/modules/:id/rollback`, `GET /api/modules/:id/snapshots`
- **Databasetabellen:** `module_snapshots`
- **Werkt echt:** **vóór elke installatie** wordt automatisch een snapshot gemaakt (naam, type, versie, manifest, dependencies, status); rollback herstelt de module naar de snapshot-staat en deactiveert hem; alles geauditeerd
- **Mock/placeholder:** geen
- **Tests:** module geïnstalleerd (snapshot aanwezig geverifieerd) → rollback → status `rolled_back`, `active:false`, rollback-info gevuld ✅
- **Beperkingen:** snapshot herstelt module-metadata en manifest; sandboxbestanden worden niet mee-gesnapshot (module-installatie verplaatst geen bestanden, dus dit dekt de huidige werking volledig)

### Sprint 11 — Memory Engine
**Status: ✅ klaar**
- **Bestanden:** `lib/db/src/schema/memory.ts`, `src/routes/memory.ts`, frontendpagina `memory.tsx`
- **Routes:** `GET /api/memory-items` (met `search` en `category`-filter), `POST /api/memory-items`, `DELETE /api/memory-items/:id`
- **Databasetabellen:** `memory_items`
- **Werkt echt:** 9 categorieën (successful_module, failed_module, error, solution, architecture_choice, dependency_issue, …); vrije tekst-zoekfunctie; koppeling aan taken mogelijk
- **Mock/placeholder:** geen
- **Tests:** item aangemaakt (201), teruggevonden via `?search=` ✅; ongeldige categorie → 400 met enum-lijst ✅
- **Beperkingen:** zoeken is tekstueel (ILIKE), geen semantische/vector-zoekfunctie

### Sprint 12 — Self-Improvement Backlog
**Status: ✅ klaar**
- **Bestanden:** improvement-endpoints in `src/routes/memory.ts`, frontendpagina `improvements.tsx`
- **Routes:** `GET/POST /api/improvements`, `PATCH /api/improvements/:id`, `POST /api/improvements/:id/convert`
- **Databasetabellen:** `improvements`
- **Werkt echt:** verbeterpunten met probleem/oorzaak/voorgestelde module/verwachte verbetering/risico/prioriteit; conversie naar een echte taak (incl. acceptatiecriteria) werkt; de Daily Loop maakt zelf improvements aan bij gefaalde builds/tests
- **Mock/placeholder:** geen
- **Tests:** improvement aangemaakt → geconverteerd → taak `planned` aangemaakt (geverifieerd) ✅
- **Beperkingen:** geen

### Sprint 13 — Daily Autonomous Loop
**Status: ✅ klaar**
- **Bestanden:** `src/routes/dailyLoop.ts`, frontendpagina `daily-loop.tsx`
- **Routes:** `GET /api/daily-loop/runs`, `POST /api/daily-loop/run`
- **Databasetabellen:** `daily_loop_runs`
- **Werkt echt:** de loop analyseert openstaande/geblokkeerde taken, modules, gefaalde testruns en wachtende approvals; converteert open improvements naar taken; produceert een leesbaar dagrapport (ANALYSIS / PLANNED / BLOCKADES / OWNER ACTION REQUIRED)
- **Mock/placeholder:** geen — de analyse draait op echte databasegegevens
- **Tests:** `POST /api/daily-loop/run` → status `completed` met volledig rapport ✅
- **Beperkingen:** de loop wordt **handmatig of via een externe scheduler** gestart (cron/`POST`-aanroep); er draait geen ingebouwde timer in het proces. De loop bouwt zelf geen nieuwe modulecode — hij plant, converteert en rapporteert (modulebouw vereist een geconfigureerde AI-provider)

### Sprint 14 — Dashboard
**Status: ✅ klaar**
- **Bestanden:** `src/routes/dashboard.ts`, frontend: 14 pagina's in `artifacts/forge-core/src/pages/` — dashboard, projects, tasks, modules, sandboxes, tests, approvals, ai-gateway, memory, improvements, daily-loop, core-components, audit-logs (+ not-found)
- **Routes:** `GET /api/dashboard/summary`
- **Werkt echt:** mission-control overzicht met alle tellers (projecten, actieve/geblokkeerde taken, sandboxen, modules, wachtende approvals, gefaalde tests, improvements, memory-items, 13 locked cores), laatste dagrapport en recente audit-logs; donker thema; Engelstalige UI
- **Mock/placeholder:** geen
- **Tests:** alle pagina's bereikbaar; dashboard en Locked Core-pagina visueel geverifieerd (screenshots); frontend-typecheck groen ✅
- **Beperkingen:** geen

### Sprint 15 — Portability & Local Deployment
**Status: ✅ klaar (app-service in Docker: configuratie gevalideerd, niet volledig opgestart in deze omgeving)**
- **Bestanden:** `docker-compose.yml`, `.env.example` (volledig geannoteerd), `INSTALL.md` (Windows + Linux), `scripts/src/install.sh`, `backup.sh`, `restore.sh`, `migrate.sh`
- **Werkt echt:** zie controlepunten hieronder
- **Beperkingen:** zie controlepunt 1 en 14

---

## Expliciete controlepunten

| # | Controle | Resultaat | Bewijs |
|---|---|---|---|
| 1 | **Lokale Docker Compose start** | ⚠️ **gedeeltelijk live getest** | `docker compose config -q` geldig; **db-service echt gestart**: Postgres 16-container kwam op, log toont "database system is ready to accept connections". De **app-service** is niet volledig opgestart binnen deze omgeving (installatie van alle dependencies in de container duurt te lang voor deze sessie) — de configuratie (build, envs, healthcheck, volumes) is wel gevalideerd. Let op: `cp .env.example .env` is vereist vóór `docker compose up`. |
| 2 | **PostgreSQL-migraties** | ✅ | `pnpm --filter @workspace/db run push` → "No changes detected" (schema volledig gesynchroniseerd); alle 20 tabellen aanwezig |
| 3 | **AI Gateway via .env** | ✅ (zonder key geverifieerd) | Providers-endpoint leest configuratie puur uit env; aanroep zonder key → nette 400 met instructie welke `.env`-variabelen nodig zijn; routing/fallback-logica aanwezig. Echte AI-call vereist een key. |
| 4 | **Locked Core bescherming** | ✅ | PATCH op locked component → 403 + audit-log; sandbox-schrijfactie naar core-pad → 403; manifest met core-pad → 403 |
| 5 | **Module Manager** | ✅ | CRUD, 11 types afgedwongen (400 bij ongeldig type), manifestvalidatie, activate/deactivate, approval-verval bij wijziging |
| 6 | **Sandbox Manager** | ✅ | Sandbox aangemaakt; bestand fysiek op schijf teruggevonden (`storage/sandboxes/1/src/index.ts`); beschermde paden geblokkeerd |
| 7 | **Test Runner** | ✅ (regelgebaseerd) | 7 types; verplichte `types`-array; resultaten per type opgeslagen; teststatus op module bijgewerkt. Checks zijn deterministische validaties, geen echte code-executie. |
| 8 | **Guardian review** | ✅ (regelgebaseerd) | `warning` zonder tests, `pass` met groene pipeline; bevindingen met categorie/ernst |
| 9 | **Governor beslissing** | ✅ | Alle 4 uitkomsten geverifieerd: blocked (geen tests), allowed (low+groen, auto-install), review_required (medium), rollback-pad aanwezig |
| 10 | **Approval Engine** | ✅ | Afwijzing zonder reden → 400; identiteit server-side afgedwongen (spoof-test); goedkeuring voltooit installatie; verval bij modulewijziging |
| 11 | **Rollback Engine** | ✅ | Snapshot automatisch vóór installatie; rollback → `rolled_back` + gedeactiveerd |
| 12 | **Memory Engine** | ✅ | Item aanmaken, zoeken, verwijderen; 9 categorieën afgedwongen |
| 13 | **Daily Autonomous Loop** | ✅ | Handmatige run → volledig dagrapport op echte data; improvements → taken-conversie |
| 14 | **Forge buiten Replit** | ✅ | Geen enkele Replit-specifieke import in server-, db- of contractcode (geverifieerd met grep); alle configuratie via `.env`; Docker Compose + installatiescripts + Windows/Linux-documentatie aanwezig. Enige vereisten: Node 24+ en PostgreSQL. |

---

## Uitgevoerde tests (deze sessie)

1. Workspace-brede typecheck — **groen, 0 fouten**
2. ~60 API-endpoints via de proxy gesmoke-test (health, core, projects, tasks, modules, sandboxes, test-runs, approvals, ai, memory, improvements, daily-loop, dashboard, audit-logs)
3. Volledige governance-pipeline end-to-end (2×: low-risk auto-install en medium-risk approval-flow)
4. Security-tests: identiteits-spoofing, stale-approval-hergebruik, core-pad-injectie via manifest en sandbox — **alle geblokkeerd**
5. Rollback end-to-end
6. Docker Compose: config-validatie + live start van de database-service
7. Drizzle-migratiecontrole
8. Visuele verificatie dashboard + Locked Core-pagina

**Falende tests: geen.** (Er is geen geautomatiseerde unit-testsuite in de repository; alle verificatie is via API-integratietests en typechecks gedaan — zie Bekende beperkingen.)

---

## Bekende beperkingen (totaaloverzicht)

1. **Geen authenticatie** — het platform is single-owner by design; iedereen met netwerktoegang tot de API kan als eigenaar handelen. Voor productie-exposure is een login-laag nodig.
2. **Test Runner en Guardian zijn regelgebaseerd** — de pipeline-mechanica (blokkeren, statussen, audit) is volledig echt, maar er wordt geen modulecode uitgevoerd en geen AI-review gedaan. De AI Gateway staat klaar om dit later aan te sluiten.
3. **Geen AI-provider geconfigureerd** — AI-functies geven nu een nette 400 totdat een key in `.env` staat.
4. **Daily Loop heeft geen ingebouwde timer** — starten via de UI-knop, `POST /api/daily-loop/run` of een externe cron.
5. **Docker app-service niet volledig opgestart in deze omgeving** — configuratie gevalideerd en db-service live getest; volledige `docker compose up` moet op de doelmachine één keer worden doorlopen (`cp .env.example .env` eerst).
6. **Geen geautomatiseerde testsuite** (vitest e.d.) in de repo — verificatie gebeurt via typechecks en API-integratietests.
7. **Memory-zoeken is tekstueel**, geen semantische zoekfunctie.
8. **Sandboxen zijn bestands-workspaces met padbescherming**, geen container-geïsoleerde uitvoeringsomgevingen.

---

## Database-inventaris (20 tabellen)

`core_components`, `audit_logs` · `ai_calls` · `projects`, `goals`, `backlog_items`, `tasks`, `decisions`, `risks` · `modules`, `module_snapshots` · `sandboxes`, `sandbox_files` · `test_runs`, `approvals`, `guardian_reviews`, `governor_decisions` · `memory_items`, `improvements` · `daily_loop_runs`
