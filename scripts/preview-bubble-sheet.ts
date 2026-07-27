/**
 * Renders a stamped bubble sheet so the Name/ID placement can be eyeballed against
 * the real template. Run: npx tsx scripts/preview-bubble-sheet.ts [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BubbleSheetStamper } from '../src/lib/pdf/bubble-sheet'

const outDir = process.argv[2] ?? path.join(process.cwd(), 'output', 'preview')

const samples = [
  { name: 'Nadia Abbott', gtId: '903000101' },
  { name: 'Marc Bello', gtId: '903000102' },
  // Deliberately long, to prove the auto-shrink keeps it inside the field box.
  { name: 'Bartholomew Maximilian Featherstonehaugh III', gtId: '903000103' },
]

const stamper = await BubbleSheetStamper.load()
await mkdir(outDir, { recursive: true })

for (const [i, sample] of samples.entries()) {
  const bytes = await stamper.renderSingle(sample)
  const file = path.join(outDir, `sheet-${i + 1}.pdf`)
  await writeFile(file, bytes)
  console.log(`wrote ${file}  (${sample.name})`)
}
