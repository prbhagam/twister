/**
 * Seeds a realistic CS 1301 exam: 12 questions, 2-3 variations each, mostly five
 * choices. Two are deliberate edge cases — one 4-choice variation (the
 * out-of-range grading path) and several pinned "None of the above" choices.
 *
 * Run: npm run db:seed
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { parseRoster } from '../src/lib/roster'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

interface SeedVariation {
  label: string
  prompt: string
  choices: string[]
  correct: number // 0-based
  pinLast?: number[]
}

const QUESTIONS: { points: number; title: string; variations: SeedVariation[] }[] = [
  {
    points: 1,
    title: 'len() on a list',
    variations: [
      {
        label: 'A',
        prompt: 'What does the following print?\n\n```python\nxs = [1, 2, 3]\nprint(len(xs))\n```',
        choices: ['`1`', '`2`', '`3`', '`TypeError`', 'None of the above'],
        correct: 2,
        pinLast: [4],
      },
      {
        label: 'B',
        prompt: 'What does the following print?\n\n```python\nxs = [4, 5]\nprint(len(xs))\n```',
        choices: ['`1`', '`2`', '`3`', '`TypeError`', 'None of the above'],
        correct: 1,
        pinLast: [4],
      },
      {
        label: 'C',
        prompt: "What does the following print?\n\n```python\nprint(len('cat'))\n```",
        choices: ['`1`', '`2`', '`3`', '`TypeError`', 'None of the above'],
        correct: 2,
        pinLast: [4],
      },
    ],
  },
  {
    points: 1,
    title: 'Truthiness',
    variations: [
      {
        label: 'A',
        prompt: 'Which expression evaluates to `True`?',
        choices: ['`1 == "1"`', '`bool([])`', '`3 in [1, 2, 3]`', '`None > 0`', 'All of the above'],
        correct: 2,
        pinLast: [4],
      },
      {
        label: 'B',
        prompt: 'Which expression evaluates to `False`?',
        choices: ['`bool("0")`', '`bool([])`', '`1 in [1, 2]`', '`2 == 2.0`', 'All of the above'],
        correct: 1,
        pinLast: [4],
      },
    ],
  },
  {
    points: 1,
    title: 'String slicing',
    variations: [
      {
        label: 'A',
        prompt: "What does `'computing'[0:4]` evaluate to?",
        choices: ["`'comp'`", "`'compu'`", "`'omp'`", "`'c'`", '`IndexError`'],
        correct: 0,
      },
      {
        label: 'B',
        prompt: "What does `'computing'[-3:]` evaluate to?",
        choices: ["`'ing'`", "`'ting'`", "`'ng'`", "`'comput'`", '`IndexError`'],
        correct: 0,
      },
      {
        label: 'C',
        prompt: "What does `'computing'[::2]` evaluate to?",
        choices: ["`'cmuig'`", "`'optn'`", "`'computing'`", "`'gnitupmoc'`", '`TypeError`'],
        correct: 0,
      },
    ],
  },
  {
    points: 1,
    title: 'Loop counting',
    variations: [
      {
        label: 'A',
        prompt: 'How many times does the body of this loop run?\n\n```python\nfor i in range(2, 10, 3):\n    print(i)\n```',
        choices: ['`2`', '`3`', '`4`', '`8`', 'None of the above'],
        correct: 1,
        pinLast: [4],
      },
      {
        label: 'B',
        prompt: 'How many times does the body of this loop run?\n\n```python\nfor i in range(0, 10, 2):\n    print(i)\n```',
        choices: ['`2`', '`4`', '`5`', '`10`', 'None of the above'],
        correct: 2,
        pinLast: [4],
      },
    ],
  },
  {
    points: 1,
    title: 'Mutability (4 choices — exercises out-of-range grading)',
    variations: [
      {
        label: 'A',
        // Deliberately four choices: a student who bubbles E here is scored 0 and
        // flagged as out_of_range.
        prompt: 'Which of these is **mutable** in Python?',
        choices: ['`tuple`', '`str`', '`list`', '`int`'],
        correct: 2,
      },
      {
        label: 'B',
        prompt: 'Which of these is **immutable** in Python?',
        choices: ['`list`', '`dict`', '`set`', '`tuple`'],
        correct: 3,
      },
    ],
  },
  {
    points: 1,
    title: 'Dictionary access',
    variations: [
      {
        label: 'A',
        prompt: 'What does the following print?\n\n```python\nd = {"a": 1, "b": 2}\nprint(d.get("c", 0))\n```',
        choices: ['`0`', '`None`', '`KeyError`', '`2`', "`'c'`"],
        correct: 0,
      },
      {
        label: 'B',
        prompt: 'What does the following print?\n\n```python\nd = {"a": 1, "b": 2}\nprint(d["c"])\n```',
        choices: ['`0`', '`None`', '`KeyError`', '`2`', "`'c'`"],
        correct: 2,
      },
    ],
  },
  {
    points: 1,
    title: 'Function return',
    variations: [
      {
        label: 'A',
        prompt: 'What does `f(3)` return?\n\n```python\ndef f(n):\n    if n > 2:\n        n = n * 2\n    return n\n```',
        choices: ['`3`', '`6`', '`None`', '`2`', 'None of the above'],
        correct: 1,
        pinLast: [4],
      },
      {
        label: 'B',
        prompt: 'What does `f(1)` return?\n\n```python\ndef f(n):\n    if n > 2:\n        n = n * 2\n    return n\n```',
        choices: ['`1`', '`2`', '`None`', '`0`', 'None of the above'],
        correct: 0,
        pinLast: [4],
      },
      {
        label: 'C',
        prompt: 'What does `f(4)` return?\n\n```python\ndef f(n):\n    if n > 2:\n        n = n * 2\n```',
        choices: ['`4`', '`8`', '`None`', '`2`', 'None of the above'],
        correct: 2,
        pinLast: [4],
      },
    ],
  },
  {
    points: 1,
    title: 'Complexity (LaTeX)',
    variations: [
      {
        label: 'A',
        prompt: 'A loop runs $n$ times and does $O(1)$ work per iteration. What is its overall complexity?',
        choices: ['$O(1)$', '$O(\\log n)$', '$O(n)$', '$O(n^2)$', '$O(2^n)$'],
        correct: 2,
      },
      {
        label: 'B',
        prompt: 'Two nested loops each run $n$ times, doing $O(1)$ work innermost. What is the overall complexity?',
        choices: ['$O(1)$', '$O(n)$', '$O(n \\log n)$', '$O(n^2)$', '$O(n^3)$'],
        correct: 3,
      },
    ],
  },
  {
    points: 1,
    title: 'Table reading (GFM table)',
    variations: [
      {
        label: 'A',
        prompt:
          'After the loop below finishes, the trace is:\n\n| step | x | y |\n|---|---|---|\n| 1 | 0 | 0 |\n| 2 | 1 | 2 |\n| 3 | 2 | 4 |\n\nWhat is the relationship between `x` and `y`?',
        choices: ['`y == x`', '`y == 2 * x`', '`y == x + 2`', '`y == x ** 2`', 'None of the above'],
        correct: 1,
        pinLast: [4],
      },
      {
        label: 'B',
        prompt:
          'After the loop below finishes, the trace is:\n\n| step | x | y |\n|---|---|---|\n| 1 | 1 | 1 |\n| 2 | 2 | 4 |\n| 3 | 3 | 9 |\n\nWhat is the relationship between `x` and `y`?',
        choices: ['`y == x`', '`y == 2 * x`', '`y == x + 2`', '`y == x ** 2`', 'None of the above'],
        correct: 3,
        pinLast: [4],
      },
    ],
  },
  {
    points: 2,
    title: 'List aliasing (worth 2 points)',
    variations: [
      {
        label: 'A',
        prompt: 'What does the following print?\n\n```python\na = [1, 2]\nb = a\nb.append(3)\nprint(len(a))\n```',
        choices: ['`1`', '`2`', '`3`', '`4`', '`TypeError`'],
        correct: 2,
      },
      {
        label: 'B',
        prompt: 'What does the following print?\n\n```python\na = [1, 2]\nb = a[:]\nb.append(3)\nprint(len(a))\n```',
        choices: ['`1`', '`2`', '`3`', '`4`', '`TypeError`'],
        correct: 1,
      },
    ],
  },
  {
    points: 1,
    title: 'Integer division',
    variations: [
      {
        label: 'A',
        prompt: 'What does `7 // 2` evaluate to?',
        choices: ['`3`', '`3.5`', '`4`', '`1`', '`TypeError`'],
        correct: 0,
      },
      {
        label: 'B',
        prompt: 'What does `7 % 2` evaluate to?',
        choices: ['`0`', '`1`', '`3`', '`3.5`', '`TypeError`'],
        correct: 1,
      },
      {
        label: 'C',
        prompt: 'What does `7 / 2` evaluate to?',
        choices: ['`3`', '`3.5`', '`4`', '`1`', '`TypeError`'],
        correct: 1,
      },
    ],
  },
  {
    points: 1,
    title: 'Scope',
    variations: [
      {
        label: 'A',
        prompt: 'What does the following print?\n\n```python\nx = 10\n\ndef f():\n    x = 20\n\nf()\nprint(x)\n```',
        choices: ['`10`', '`20`', '`None`', '`NameError`', 'None of the above'],
        correct: 0,
        pinLast: [4],
      },
      {
        label: 'B',
        prompt: 'What does the following print?\n\n```python\nx = 10\n\ndef f():\n    global x\n    x = 20\n\nf()\nprint(x)\n```',
        choices: ['`10`', '`20`', '`None`', '`NameError`', 'None of the above'],
        correct: 1,
        pinLast: [4],
      },
    ],
  },
]

async function main() {
  const existing = await prisma.course.findFirst({ where: { name: 'CS 1301' } })
  if (existing) {
    console.log('Removing the previous CS 1301 seed data…')
    await prisma.course.delete({ where: { id: existing.id } })
  }

  const course = await prisma.course.create({
    data: { name: 'CS 1301', title: 'Introduction to Computing', term: 'Summer 2026' },
  })

  const exam = await prisma.exam.create({
    data: {
      courseId: course.id,
      title: 'Exam 1',
      instructorSeed: 'cs1301-summer-2026-exam1',
      instructions:
        'You have **50 minutes**. Mark every answer on the bubble sheet — answers written in this booklet are not graded. Calculators are not permitted.',
    },
  })

  for (const [index, question] of QUESTIONS.entries()) {
    await prisma.question.create({
      data: {
        examId: exam.id,
        order: index + 1,
        title: question.title,
        points: question.points,
        variations: {
          create: question.variations.map((variation, v) => ({
            order: v,
            label: variation.label,
            promptMarkdown: variation.prompt,
            choices: {
              create: variation.choices.map((text, c) => ({
                order: c,
                textMarkdown: text,
                isCorrect: c === variation.correct,
                pinToLast: variation.pinLast?.includes(c) ?? false,
              })),
            },
          })),
        },
      },
    })
  }

  const rosterPath = path.join(process.cwd(), 'assets', 'GaTech Roster.csv')
  const roster = parseRoster(readFileSync(rosterPath, 'utf8'))
  await prisma.rosterImport.create({
    data: {
      courseId: course.id,
      filename: 'GaTech Roster.csv',
      imported: roster.students.length,
      skipped: roster.excluded.reduce((n, e) => n + e.count, 0),
      skipDetail: JSON.stringify(roster.excluded),
      students: {
        create: roster.students.map((student) => ({
          courseId: course.id,
          gtId: student.gtId,
          username: student.username,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          sections: JSON.stringify(student.sections),
          role: student.role,
        })),
      },
    },
  })

  console.log(`Seeded ${course.name} / ${exam.title}`)
  console.log(`  ${QUESTIONS.length} questions, ${QUESTIONS.reduce((n, q) => n + q.variations.length, 0)} variations`)
  console.log(`  ${roster.students.length} students across ${roster.sections.length} sections`)
  console.log(`  excluded: ${roster.excluded.map((e) => `${e.count} ${e.role}`).join(', ')}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
