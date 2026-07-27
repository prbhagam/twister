# TWISTER

**T**ests **W**ritten **I**ndividually via **S**eeded, **T**raceable **E**xam **R**andomization.

Every student sits a different paper. For each student TWISTER draws one variation of
each question, permutes that variation's answer choices, and permutes the question
order — all derived deterministically from the student's identifier (GT ID or GT
username) combined with a secret instructor seed. Copying a neighbour's answers is worthless, and any paper can be
traced back to its exact layout weeks later.

Grading rides on Gradescope's bubble-sheet OCR. Gradescope reports *which letter each
student marked at each position*; TWISTER maps that position back to the question and
variation that student actually received. **Gradescope's own "correct response"
columns are ignored** — they are meaningless when every paper differs.

## Setup

```bash
npm install
npm run setup      # creates the SQLite database and installs Chromium
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|---|---|
| `TWISTER_ADMIN_EMAIL` / `TWISTER_ADMIN_PASSWORD` | The single instructor login. The account is created on first sign-in. |
| `TWISTER_SESSION_SECRET` | Signs the session cookie. Generate with `openssl rand -hex 32`. |
| `DATABASE_URL` | Defaults to `file:./dev.db`. |
| `TWISTER_OUTPUT_DIR` | Where generated PDFs are written. Defaults to `./output`. |
| `CANVAS_BASE_URL` / `CANVAS_TOKEN` | Optional. Enables Canvas roster sync and score push. Leave blank to use CSV only. |

Then:

```bash
npm run dev        # http://localhost:3000
```

### About `assets/`

`assets/Gradescope Bubble Sheet.pdf` is the blank scantron template and is committed —
it is required, and contains no data.

**Rosters and Gradescope exports are never committed.** They are FERPA-protected
education records containing student names, GT IDs, and emails, so `assets/*.csv` is
gitignored. Import your roster through the web UI. To use `npm run db:seed`, which
loads a demo exam plus a roster, first drop your own export at
`assets/GaTech Roster.csv`.

## Workflow

1. **Create a course**, then import the GT roster CSV (or sync from Canvas). Only `Role = Student` rows are
   imported; sections are normalized (the duplicated `/i` variants collapse) and
   re-importing updates students rather than duplicating them.
2. **Create an exam** and add questions. Each question holds 2–3 variations; each
   variation holds 2–5 answer choices in markdown (code blocks, tables, and LaTeX all
   render). Mark one correct answer, and optionally pin "None of the above" to last.
   Questions can also be imported and exported as CSV.
3. **Generate.** Pick sections, then run. This *freezes a snapshot* of every question
   and computes each student's layout. Editing questions afterwards can never change
   what has already been printed or how it grades.
4. **Print.** Each student's PDF is page 1 a Gradescope bubble sheet with their name
   and identifier pre-filled, page 2 a cover page, then their questions. A single merged
   print file contains the whole class in last-name order.
5. **Grade.** Upload the Gradescope export. TWISTER shows a match report before
   writing anything, then scores each student against their own key.
6. **Review and export.** Each student's page shows their actual PDF beside a
   question-by-question comparison of the key against what they marked. Export scores
   alphabetically by last name, or as a Canvas gradebook import.

## Deleting things

Courses, exams, and generation runs can each be deleted from their own page. Deletes
cascade — a course takes its roster, every exam, every run, all grades, and the
generated PDFs on disk with it — so each one requires typing the course name, the
exam title, or the word `delete` before the button becomes active. There is no undo.

Deleting a run makes any paper already printed from it ungradable: the answer keys
live in that run.

## Scoring rules

| Situation | Result |
|---|---|
| One mark, matches that student's key | full points |
| One mark, does not match | 0 |
| Blank | 0, flagged |
| Multiple bubbles (`A;B`) | 0, flagged |
| A letter past the end of a short variation | 0, flagged as out-of-range |
| Gradescope reports `Missing` | recorded as not taken, excluded from the Canvas export |

Every flagged question can be manually overridden. Overrides are stored against the
student's exam, not the import, so re-importing a corrected CSV does not wipe them.

## Canvas

Optional. Set `CANVAS_BASE_URL` and `CANVAS_TOKEN` (a personal access token from
Canvas → Account → Settings) and two things light up. Leave them blank and
everything still works through CSV import/export.

Courses you **teach, TA, or design** all appear in the picker; the role is shown
beside the term so a course you support is distinguishable from one you run.

**Roster sync.** Link the course to a Canvas course, then pull the live roster —
which picks up students who added or dropped since your last import, the failure
mode a CSV snapshot cannot catch. The sync shows added / dropped / changed before
writing anything. Students who left Canvas are *not* deleted: they may already have
a generated exam and grades attached, so exclude them by section at generation time.

**Score push.** Pick the Canvas assignment and preview the push: how many scores are
new, how many already match, and which ones would overwrite a different score that
is already in Canvas. Only then does it send. Students with no scanned sheet are
skipped rather than pushed a zero — "absent" and "scored zero" are different claims,
and only you should make the second one.

### Choosing the seeding identity

One value does three jobs, and they have to agree:

1. it seeds the randomization, so it must be stable per student forever;
2. it is stamped into the bubble sheet's ID box, so it **must be whatever
   Gradescope matches its roster on** — otherwise no scanned sheet auto-matches;
3. it joins the Gradescope export back to a student at grading time.

Set it per exam under **Student identifier**: *GT ID* (stamps `903000101`) or
*GT username* (stamps `mbello3`). Check what your Gradescope roster uses as each
student's SID and match it. The setting locks once a run exists, because changing it
reseeds every student onto a different paper.

Username exists for two reasons: a Canvas token without SIS permission cannot see GT
IDs at all, and some Gradescope rosters are keyed on the GT account rather than the
nine-digit number.

Both identifiers are stored whenever available, and grading matches an export keyed
on either one plus email — so a roster imported one way still grades against an
export keyed the other. Only the *stamped* value has to be right.

Roster import is permissive: it stores whatever identifiers the source supplies and
rejects only a student who has none at all. The strict check happens at generation,
which refuses to start if any student lacks the identity that exam seeds from and
names them. Canvas's own internal user id is never used as a fallback — seeding on
it would produce exams that cannot be reproduced.

If your Canvas token cannot read SIS data, the sync says so explicitly and reports
how many usernames it did get, so you know to set the exam to *GT username*.

Run `npx tsx scripts/canvas-identity-check.ts <canvasCourseId>` to see which
identifiers your token can actually read. It prints counts and uniqueness only, with
redacted samples, so it is safe to paste into a ticket.

### When Canvas refuses the score push

Reading and writing grades needs the **Grades - edit** permission, granted per course
role. TA roles commonly have it withheld, so a token that works in a course you teach
can be refused in one you TA. Errors name the endpoint that was refused rather than
saying "permission denied", and
`npx tsx scripts/canvas-permission-check.ts <courseId> <assignmentId>` probes each
endpoint separately so you can see exactly what is allowed.

The push is never required: the **Canvas gradebook (CSV)** download on the run page
uploads through Canvas → Grades → Import and needs no API permission at all.

### Token handling

A Canvas personal access token cannot be scoped: it carries the full permissions of
whoever minted it, across every course they can reach, including writing grades. It
is read from server environment only, is never written to the database, and never
reaches a browser. Treat the machine running TWISTER accordingly. If a Canvas admin
will issue a Developer Key (OAuth2), that is scoped and revocable and materially
safer — `src/lib/canvas/client.ts` is the only module that would need to change.

## How the randomization works

```
studentSeed  = HMAC-SHA256(instructorSeed, `${examId}:${identity}`)
questionSeed = HMAC-SHA256(studentSeed, `q:${questionId}`)
orderSeed    = HMAC-SHA256(studentSeed, "order")
```

where `identity` is the exam's chosen identifier — see *Choosing the seeding
identity*. Each feeds an sfc32 PRNG. Per-question sub-streams mean editing question 7 does not
reshuffle questions 1–6, which keeps regenerated runs diffable. The exam page shows
the total number of distinct papers the current question bank can produce.

The **exam code** printed in each footer is the first six hex digits of the student
seed — enough to identify a stray page and recover its layout.

## Scripts

| Command | What it does |
|---|---|
| `npm run verify` | Full end-to-end verification against a throwaway `verify.db`. Never touches your real database. |
| `npm test` | Unit tests against the synthetic fixtures in `src/lib/__fixtures__/`. If real files are present in `assets/`, extra checks run against them too; otherwise those are skipped. |
| `npm run db:seed` | Loads a 12-question demo exam and the sample roster |
| `npx tsx scripts/e2e-check.ts HP` | ⚠ writes to `DATABASE_URL` — prefer `npm run verify`. |
| _(the check scripts below all write to `DATABASE_URL`)_ | Generates one section, verifies the PDFs, then grades a synthesized export with known errors injected and checks the scores |
| `npx tsx scripts/preview-exam.ts` | Renders two sample exams without touching the database |
| `npx tsx scripts/preview-bubble-sheet.ts` | Renders stamped bubble sheets for checking field placement |
| `npx tsx scripts/full-run.ts` | Generates the entire seeded class, for timing |
| `npx tsx scripts/seed-grading.ts` | Writes a synthetic grading import against the newest run |
| `npx tsx scripts/canvas-identity-check.ts <courseId>` | Reports which student identifiers your Canvas token can read |
| `npx tsx scripts/canvas-permission-check.ts <courseId> [assignmentId]` | Probes each Canvas endpoint separately and reports which your token may call. Read-only. |
| `npx tsx scripts/canvas-check.ts` | Drives the Canvas client against a local stand-in for the Canvas API over real HTTP — pagination, bearer auth, grade-push encoding, Progress polling. Needs a graded run. |

## Notes and limits

- The Gradescope template in `assets/` is copied verbatim into every PDF and only
  drawn on. Its corner fiducials are what Gradescope's scanner registers against, so
  the page is never resized or re-encoded. Field coordinates live in
  `src/lib/pdf/bubble-sheet.ts`.
- **Confirm one real scan before a full print run.** Gradescope's Name/ID OCR is
  tuned for handwriting. Printed text normally reads fine and unmatched students are
  fixable in Gradescope's UI, but this is worth verifying on a single sheet before
  committing to thousands of pages.
- A full 404-student run renders in about 20 seconds and produces a ~91 MB, ~2,800
  page print file. The bubble sheet artwork is embedded once and shared across the
  print file; each student's individual PDF carries its own copy.
- Authoring input is trusted — the only author is the authenticated instructor — so
  markdown is rendered without sanitization.
- `npm audit` reports advisories in transitive build dependencies (`sharp` and
  `postcss` under Next, `valibot` under Prisma). None has a non-breaking fix;
  `--force` would downgrade Next to v9.
