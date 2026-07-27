# Production-readiness changes

## Authentication and access

- Replaced the shared environment-based instructor sign-in with local multi-user
  accounts, scrypt password hashes, opaque database-backed sessions, expiration,
  logout, and first-owner bootstrap configuration.
- Added centralized server-side permissions for OWNER, INSTRUCTOR, QUESTION_EDITOR,
  GRADER, and AUDITOR roles.
- Added active per-course memberships and authorization checks for course, exam,
  run, grading, and protected export access.
- Added a documented future trusted-identity/CAS integration boundary without
  implementing a fake CAS or Duo flow.

## Data safety and auditability

- Added append-only audit events for authentication and key authoring, import,
  generation, grading, and archival actions.
- Added archival fields and changed ordinary course, exam, and question removal to
  archive rather than destructive deletion.
- Restricted permanent generation-run deletion to OWNER users.
- Added secure response headers and private local-storage ignore rules.

## Question and generation workflow

- Added question workflow states: DRAFT, IN_REVIEW, APPROVED, and RETIRED.
- Added visible per-question status controls and an approved-all-valid-questions
  action; generation remains blocked until active questions are approved.
- Preserved the existing immutable generation snapshots and deterministic seeded
  layout behavior.
- Improved small-run generation progress and ensure renderer startup failures mark
  the run failed rather than leaving it indefinitely running.

## Prisma and local development

- Added Node 24 guidance (`.nvmrc`) and a supported Node engine range.
- Added a macOS arm64 Prisma schema-engine workaround to the database scripts.
- Updated the environment example and README with bootstrap and local-safety notes.

## Validation completed

- Prisma format, validate, and generate.
- Type-check.
- Unit tests: 138 passed, 2 skipped.
- Production build passed, with an existing Turbopack file-tracing warning.

## Intentionally excluded from commits

- Local `.env` files and databases.
- Test roster/grade CSV files and the local roster helper script.
- `PRODUCTION_READINESS.md`, which remains local planning documentation.
