# 5. One zod schema per input, shared by the API and the app; the rules that need data stay in the use cases

Date: 2026-11-21

## Context

A form that lets a value through which the API then refuses is a bad form; a form that refuses what the API would accept is worse. The rules exist at three depths: the shape of the input (a number between 0 and 1439, an email that looks like one), the rules that need a value from the database (a slug already taken, a budget larger than the model's context, a library the member may not read), and the state machines.

## Options considered

1. **Validate in the API only**, and show its errors in the form. Correct, but every keystroke's feedback is a round trip, and the form knows nothing about the field until the server answers.
2. **Validate in the form and in the API separately.** Two definitions that drift.
3. **One zod schema per procedure in `packages/api`, which the router parses with and the web app imports for its forms.** Shape rules live in the schema; rules that need data live in the use cases and come back as tRPC errors with a `reason`; the state machines are the transition tables.

## Decision

Option 3. `packages/api/src/inputs.ts` holds every input schema, built from the domain's constants (`NAME_MAX`, `CONTEXT_MIN`, `RETENTION_RANGE`, `MAX_PAGE_SIZE`) so a limit is written once. The router's `.input(schema)` is the API's validation; the web app's forms will use the same schemas for field-level feedback. A use case re-checks what it must (an empty name after trimming, a model that exists and is on) and answers a `Result` whose failure the router maps: `invalid` → `BAD_REQUEST`, `rule` → `PRECONDITION_FAILED` with `reason` such as `last_admin`, `conflict` → `CONFLICT` with `forbidden_transition`. The app switches on `data.reason`, never on the message.

## Consequences

The domain package stays free of zod: its use cases take plain inputs and answer `Result`s, which keeps them testable without a schema. The API package depends on the domain for its constants, and the web app on the API for its schemas and the router's type, which is the dependency direction the packages already had. A rule that moves from "shape" to "needs data" moves from the schema to a use case and keeps its tests.
