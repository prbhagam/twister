import { Button, Input, Label } from '@/components/ui'

/**
 * No roster, no section picker, no background run: this is a plain GET form, so
 * clicking the button just navigates the browser to the PDF route. Whatever name is
 * typed travels as a query param.
 */
export function PracticeGeneratePanel({
  examId,
  variantCount,
  blocked,
}: {
  examId: string
  variantCount: number
  blocked: boolean
}) {
  return (
    <form action={`/api/exams/${examId}/practice.pdf`} method="GET" className="space-y-4 px-5 py-4">
      <div>
        <Label htmlFor="practiceName">Name to print on the cover</Label>
        <Input id="practiceName" name="name" placeholder="e.g. your own name" />
        <p className="mt-1 text-xs text-slate-500">
          Stamped on every version along with a random sample ID — this is never a real student&apos;s
          paper.
        </p>
      </div>

      <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p>
          Generates <strong className="text-slate-900">{variantCount}</strong> practice paper
          {variantCount === 1 ? '' : 's'}, one per variant, as a single PDF.
        </p>
        <p className="mt-1">
          Every question must have the same number of variations for &quot;variant A&quot; to mean the
          same slot everywhere.
        </p>
      </div>

      <Button type="submit" disabled={blocked || variantCount === 0}>
        Generate {variantCount} practice exam{variantCount === 1 ? '' : 's'}
      </Button>
      {blocked ? (
        <p className="text-xs text-red-700">Resolve the blocking issues above before generating.</p>
      ) : null}
    </form>
  )
}
