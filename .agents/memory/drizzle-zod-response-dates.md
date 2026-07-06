---
name: Drizzle rows vs response Zod schemas
description: Why every response .parse() in the API server must wrap data in jsonSafe()
---

Rule: when validating API response payloads with OpenAPI-generated Zod schemas, always serialize DB rows first (`jsonSafe()` = JSON round-trip) before `.parse()`.

**Why:** Drizzle returns `timestamp` columns as JS `Date` objects, but the generated schemas type dates as ISO strings. Parsing raw rows throws ZodError → 500 on every route returning rows with timestamps. This surfaced only at runtime — typecheck passes because the schemas accept `unknown` input.

**How to apply:** any new route in the API server that does `SomeResponse.parse(rows)` must use `SomeResponse.parse(jsonSafe(rows))`. Helper lives with the other server libs. Empty arrays pass without it, so smoke tests on fresh tables can hide the bug — test with at least one row.
