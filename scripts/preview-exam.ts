/**
 * Renders one sample exam end to end (markdown -> HTML -> PDF -> spliced bubble
 * sheet) so the printed result can be eyeballed without touching the database.
 *
 * Run: npx tsx scripts/preview-exam.ts [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renderMarkdown } from '../src/lib/markdown'
import { buildLayout, type SeedQuestion } from '../src/lib/seed'
import { ExamRenderer, stageRenderAssets } from '../src/lib/pdf/renderer'
import type { RenderExam } from '../src/lib/pdf/exam-html'

const outDir = process.argv[2] ?? path.join(process.cwd(), 'output', 'preview')

const bank = [
  {
    prompt: 'What does the following print?\n\n```python\nxs = [1, 2, 3]\nprint(len(xs))\n```',
    choices: ['`1`', '`2`', '`3`', '`TypeError`', 'None of the above'],
  },
  {
    prompt: 'Which expression evaluates to `True`?',
    choices: ['`1 == "1"`', '`bool([])`', '`3 in [1, 2, 3]`', '`None > 0`', 'All of the above'],
  },
  {
    prompt:
      'A loop runs $n$ times and does $O(1)$ work per iteration. What is its overall complexity?',
    choices: ['$O(1)$', '$O(\\log n)$', '$O(n)$', '$O(n^2)$', '$O(2^n)$'],
  },
  {
    prompt:
      'Given the table below, which row violates the invariant?\n\n| step | x | y |\n|---|---|---|\n| 1 | 0 | 0 |\n| 2 | 1 | 2 |\n| 3 | 2 | 3 |',
    choices: ['Step 1', 'Step 2', 'Step 3', 'No row violates it'],
  },
]

// The preview carries the choice text alongside the seeding fields so it can render
// without a database; a real run reads that text from the run snapshot instead.
type PreviewChoice = SeedQuestion['variations'][number]['choices'][number] & { text: string }
type PreviewVariation = Omit<SeedQuestion['variations'][number], 'choices'> & { choices: PreviewChoice[] }
type PreviewQuestion = Omit<SeedQuestion, 'variations'> & { variations: PreviewVariation[] }

const questions: PreviewQuestion[] = Array.from({ length: 12 }, (_, q) => ({
  key: `q${q + 1}`,
  refId: `rq${q + 1}`,
  points: 1,
  variations: Array.from({ length: 3 }, (_, v) => {
    const source = bank[(q + v) % bank.length]
    return {
      refId: `rv${q + 1}-${v}`,
      choices: source.choices.map((text, c) => ({
        refId: `rc${q + 1}-${v}-${c}`,
        isCorrect: c === 2,
        pinToLast: /above$/i.test(text),
        text,
      })),
    }
  }),
}))

// Prompt/choice HTML is rendered once per variation, exactly as a real run does.
const html = new Map<string, string>()
for (const q of questions) {
  for (const [v, variation] of q.variations.entries()) {
    const source = bank[(Number(q.key.slice(1)) - 1 + v) % bank.length]
    html.set(variation.refId, await renderMarkdown(source.prompt))
    for (const choice of variation.choices) {
      html.set(choice.refId, await renderMarkdown(choice.text))
    }
  }
}

const students = [
  { name: 'Nadia Abbott', gtId: '903000101' },
  { name: 'Marc Bello', gtId: '903000102' },
]

await mkdir(outDir, { recursive: true })
const shellPath = await stageRenderAssets(outDir)
const renderer = await ExamRenderer.launch({ shellPath, concurrency: 2 })

try {
  for (const student of students) {
    const layout = buildLayout({
      instructorSeed: 'preview-seed',
      examId: 'preview-exam',
      gtId: student.gtId,
      questions,
    })

    const exam: RenderExam = {
      examTitle: 'Exam 1',
      courseName: 'CS 1301 — Introduction to Computing',
      studentName: student.name,
      gtId: student.gtId,
      traceCode: layout.traceCode,
      instructionsHtml: await renderMarkdown(
        'You have **50 minutes**. Mark every answer on the bubble sheet — answers written on this booklet are not graded.',
      ),
      katexHref: 'katex.min.css',
      questions: layout.entries.map((entry) => ({
        position: entry.position,
        points: entry.points,
        promptHtml: html.get(entry.runVariationId) ?? '',
        choicesHtml: entry.choiceOrder.map((id) => html.get(id) ?? ''),
      })),
    }

    const { pdf, pageCount } = await renderer.render(exam)
    const file = path.join(outDir, `exam-${student.gtId}.pdf`)
    await writeFile(file, pdf)
    console.log(`wrote ${file}  (${pageCount} pages, trace ${layout.traceCode})`)
    console.log(`  order: ${layout.entries.map((e) => e.runQuestionId).join(' ')}`)
    console.log(`  key:   ${layout.entries.map((e) => e.correctLetter).join('')}`)
  }
} finally {
  await renderer.close()
}
