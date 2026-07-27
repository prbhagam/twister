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

Then:

```bash
npm run dev        # http://localhost:3000
```

Sign in with `TWISTER_ADMIN_EMAIL` and `TWISTER_ADMIN_PASSWORD`. The account is
created on its first sign-in and is granted OWNER access. Local authentication is for
development or controlled deployment; Georgia Tech CAS/Duo is not implemented.

## Access control and operational safety

TWISTER has `OWNER`, `INSTRUCTOR`, `QUESTION_EDITOR`, `GRADER`, and `AUDITOR`
roles. Server-side checks require active per-course membership, so changing a route
or form identifier cannot grant access to another course. Sessions are opaque,
HTTP-only cookies backed by a database record with a 12-hour expiry.

The application writes append-only audit events for authentication and high-value
workflow actions. Normal course, exam, and question removal is archival. Existing
generation-run snapshots preserve exactly what was generated even after question
edits. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for the reviewed
baseline, security design, deferred work, CAS boundary, and PostgreSQL guidance.

### About `assets/`

`assets/Gradescope Bubble Sheet.pdf` is the blank scantron template and is committed —
it is required, and contains no data.

**Rosters and Gradescope exports are never committed.** They are FERPA-protected
education records containing student names, GT IDs, and emails, so `assets/*.csv` is
gitignored. Import your roster through the web UI. To use `npm run db:seed`, which
loads a demo exam plus a roster, first drop your own export at
`assets/GaTech Roster.csv`.

## Workflow

1. **Create a course**, then import the GT roster CSV. Only `Role = Student` rows are
   imported; sections are normalized (the duplicated `/i` variants collapse) and
   re-importing updates students rather than duplicating them.
2. **Create an exam** and add questions. Each question holds 2–3 variations; each
   variation holds 2–5 answer choices in markdown (code blocks, tables, and LaTeX all
   render). Mark one correct answer, and optionally pin "None of the above" to last.
   Questions can also be imported and exported as CSV.
   A ready-made bank of 50 questions with 107 variations is at
   `samples/sample-exam-50-questions.csv` if you just want something to test with.
3. **Generate.** Pick sections, then run. This *freezes a snapshot* of every question
   and computes each student's layout. Editing questions afterwards can never change
   what has already been printed or how it grades.
4. **Print.** Each student's PDF is page 1 a Gradescope bubble sheet with their name
   and identifier pre-filled, page 2 a cover page, then their questions. A single merged
   print file contains the whole class in last-name order. See *Printing* below.
5. **Grade.** Upload the Gradescope export. TWISTER shows a match report before
   writing anything, then scores each student against their own key.
6. **Review and export.** Each student's page shows their actual PDF beside a
   question-by-question comparison of the key against what they marked. Export scores
   alphabetically by last name, or as a Canvas gradebook import CSV.

## Printing

Booklets are built for **double-sided** printing:

| Sheet | Front | Back |
|---|---|---|
| 1 | Bubble sheet | *blank* |
| 2 | Cover page | first questions |
| … | questions | questions |
| last | … | *"This page is intentionally blank"* if needed |

Two pages exist purely so the paper behaves:

- **The blank behind the bubble sheet.** Students tear the scantron off before
  starting. Without it, page 2 prints on the back of the sheet and leaves with the
  scantron — and gets scanned alongside their answers. It is deliberately empty; a
  footer there could interfere with how Gradescope registers the sheet.
- **The trailing filler**, so every booklet ends on an even page. Booklets vary in
  length, and without this the *next* student's bubble sheet prints on the back of
  the previous student's last page. In one 404-student run, 259 booklets were
  odd-length.

These cost less than they look. Duplex sheets are `ceil(pages / 2)`, so padding an
odd page count to even is free — across a real 404-student run the two additions
came to 145 extra sheets in total, not one per student. Printing single-sided does
pay for both; if you need that, say so and the padding can be made conditional.

Stapling each booklet separately is a property of your copier, not of the PDF. A
copier's "staple each copy" applies to each copy of a repeated document, so a single
merged file is stapled once. Options, roughly in order of preference:

### With a release system (Canon uniFLOW, PaperCut)

Finishing is chosen at the device and applies to **each released job**. So submit one
job per student and release them together:

```bash
# dry run — prints the commands, sends nothing
npx tsx scripts/submit-print-jobs.ts --printer <queue> --limit 3
npx tsx scripts/submit-print-jobs.ts --printer <queue> --limit 3 --send
```

Release those three at the copier with duplex and stapling on. **Three stapled
booklets** means the whole run will work — drop `--limit` and send the rest.
**One stapled brick** means your release system merges jobs, and hand-stapling is
the answer.

Each job is titled `Lastname, Firstname — Exam title`, so the release list is
readable, and jobs are submitted in last-name order. There is a delay between
submissions because a queue handed 404 jobs at once tends to drop some; raise it
with `--delay`. If anything looks wrong: `cancel -a <queue>`.

### Other routes

- **Subset finishing**, if your copier can staple every *N* pages. This needs every
  booklet to be the same length, not merely even — ask and padding switches from
  even to uniform.
- **Staple by hand.** The bubble sheet makes each boundary obvious at a glance.

Note that a queue using a generic PostScript driver exposes no finishing at all
(`lpoptions -p <printer> -l | grep -i staple` returns nothing), which is fine under
a release system since the choice happens at the device.

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
| Gradescope reports `Missing` | recorded as not taken; exported as **MI**, never 0 |

A student with no scanned sheet exports as `MI` in the Score, Percent, and every
question column — a zero would assert they sat the exam and got everything wrong,
which is a different claim.

Every flagged question can be manually overridden. Overrides are stored against the
student's exam, not the import, so re-importing a corrected CSV does not wipe them.

## Getting scores into Canvas

Download **Canvas gradebook (CSV)** from the run page and upload it via Canvas →
Grades → Import. It matches students on SIS User ID and needs no API access, so it
works whatever your Canvas role permits.

By default every student appears, and one with no scanned sheet carries `MI`, matching
the scores export. Canvas's own import expects a number or `EX`, so it may reject or
ignore a non-numeric grade — import a two-row file first to see how your Canvas
handles it.

**Only students with submissions** on the run page drops those students from the file
instead. Canvas leaves a student's grade untouched when they are absent from the
import, so use this when you have already excused or scored them by hand and do not
want the import to overwrite that.

## Choosing the student identifier

One value does three jobs, and they have to agree:

1. it seeds the randomization, so it must be stable per student forever;
2. it is stamped into the bubble sheet's ID box, so it **must be whatever
   Gradescope matches its roster on** — otherwise no scanned sheet auto-matches;
3. it joins the Gradescope export back to a student at grading time.

Set it per exam under **Student identifier**: *GT ID* (stamps `903000101`) or
*GT username* (stamps `mbello3`). Check what your Gradescope roster uses as each
student's SID and match it. The setting locks once a run exists, because changing it
reseeds every student onto a different paper.

Both identifiers are stored when the roster supplies them, and grading matches an
export keyed on either one plus email — so a roster imported one way still grades
against an export keyed the other. Only the *stamped* value has to be right.

Generation refuses to start if any student lacks the identity their exam seeds from,
and names them. Seeding on a blank value would give every affected student the same
paper.

## How the randomization works

```
studentSeed  = HMAC-SHA256(instructorSeed, `${examId}:${identity}`)
questionSeed = HMAC-SHA256(studentSeed, `q:${questionId}`)
orderSeed    = HMAC-SHA256(studentSeed, "order")
```

where `identity` is the exam's chosen identifier — see *Choosing the student
identifier*. Each feeds an sfc32 PRNG. Per-question sub-streams mean editing question 7 does not
reshuffle questions 1–6, which keeps regenerated runs diffable. The exam page shows
the total number of distinct papers the current question bank can produce.

The **exam code** printed in each footer is the first six hex digits of the student
seed — enough to identify a stray page and recover its layout.

## Scripts

| Command | What it does |
|---|---|
| `python3 scripts/make-sample-questions.py` | Regenerates `samples/sample-exam-50-questions.csv` — 50 questions, 107 variations, 1 point each, for testing |
| `npm run verify` | Full end-to-end verification against a throwaway `verify.db`. Never touches your real database. |
| `npm test` | Unit tests against the synthetic fixtures in `src/lib/__fixtures__/`. If real files are present in `assets/`, extra checks run against them too; otherwise those are skipped. |
| `npm run db:seed` | Loads a 12-question demo exam and the sample roster |
| `npx tsx scripts/preview-exam.ts` | Renders two sample exams without touching the database |
| `npx tsx scripts/preview-bubble-sheet.ts` | Renders stamped bubble sheets for checking field placement |

These write to whichever database `DATABASE_URL` points at, so prefer `npm run
verify` unless you mean to touch your real data:

| Command | What it does |
|---|---|
| `npx tsx scripts/e2e-check.ts HP` | Generates one section, verifies the PDFs, then grades a synthesized export with known errors injected and checks the scores |
| `npx tsx scripts/full-run.ts` | Generates the entire seeded class, for timing |
| `npx tsx scripts/seed-grading.ts` | Writes a synthetic grading import against the newest run |
| `npx tsx scripts/make-sample-scans.ts [runId] [batchSize]` | Fills in bubble sheets for a real run, as if the class had sat the exam. See below. |
| `npx tsx scripts/submit-print-jobs.ts --printer <queue>` | Submits one print job per student so a release system staples each booklet. Dry run unless `--send`. See *Printing*. |

## Testing the grading loop without a real exam

`npx tsx scripts/make-sample-scans.ts [runId] [batchSize]` takes a generation run and
produces what you would otherwise need a room full of students to get. It defaults to
the newest completed run.

Into `<output>/<runId>-scans/`:

| File | Use |
|---|---|
| `filled-sheets-batch-NN.pdf` | Bubble sheets with answers filled in, 25 per file. Upload to Gradescope to exercise the real path: OCR → export → import here. |
| `batch-manifest.csv` | Which students are in which batch, so a failed upload traces to people rather than a page range. |
| `expected-gradescope-export.csv` | The export those sheets should produce, so you can test grading directly without scanning anything. |

Batch size defaults to 25 and is the second argument: `... [runId] 50`. Batches are
cut in the same last-name order as the print stack, so batch *n* of the scans lines
up with the same slice of the printed pile.

It deliberately seeds the cases that are tedious to produce by hand: roughly one
student in seventeen hands in no sheet at all (they appear as `Missing`, and export
as `MI`), plus blanks, double-bubbles, and the occasional letter that was never
printed on that student's paper.

The bubble coordinates are read off the Gradescope template — 18pt between letters,
17pt between rows, with a wider break every fifth row. If Gradescope ever reissues
the sheet, check `bubbleCentre()` in that script against the new one and re-render a
page before trusting it.

**These sheets carry real student names and IDs.** They are FERPA-protected
education records. The output directory is gitignored; do not commit them or send
them anywhere.

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
- A Canvas API integration (live roster sync, direct score push) was built and then
  removed. It is parked at the `canvas-api` git tag if it is ever wanted;
  `Course.canvasCourseId` and `Exam.canvasAssignmentId` remain in the schema, unused.
- `npm audit` reports advisories in transitive build dependencies (`sharp` and
  `postcss` under Next, `valibot` under Prisma). None has a non-breaking fix;
  `--force` would downgrade Next to v9.
