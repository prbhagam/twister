import { Button, Input, Label } from '@/components/ui'

/**
 * No roster, no section picker, no background run: this is a plain GET form, so
 * clicking any button just navigates the browser to the PDF route. Each variant
 * button carries its own `variant` value; the "download all" button has none, so
 * the route returns every variant merged instead. Whatever name is typed travels
 * along as a query param either way.
 *
 * The answer-key buttons sit in the same form and override its target with
 * `formAction`, which keeps one source of truth for the variant values: a key and
 * a paper for "variant B" cannot drift apart because both submit the same control
 * value to routes that lay the paper out the same way.
 */
export function PracticeGeneratePanel({
  examId,
  variantLabels,
  blocked,
}: {
  examId: string
  variantLabels: string[]
  blocked: boolean
}) {
  const variantCount = variantLabels.length
  const keyAction = `/api/exams/${examId}/practice-key.pdf`

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

      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">
          {variantCount} variant{variantCount === 1 ? '' : 's'} — download one at a time, or all together
        </p>
        {variantCount === 0 ? (
          <p className="text-sm text-slate-500">This exam has no variations yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {variantLabels.map((label) => (
              <Button key={label} type="submit" name="variant" value={label} variant="secondary" disabled={blocked}>
                Variant {label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-slate-100 pt-3">
        <Button type="submit" disabled={blocked || variantCount === 0}>
          Download all {variantCount} as one PDF
        </Button>
        <p className="text-xs text-slate-500">
          Every question must have the same number of variations for &quot;variant A&quot; to mean the
          same slot everywhere.
        </p>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-600">
          Answer key — correct letters at a glance, then every question with its answer marked
        </p>
        {variantCount === 0 ? (
          <p className="text-sm text-slate-500">This exam has no variations yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {variantLabels.map((label) => (
                <Button
                  key={label}
                  type="submit"
                  formAction={keyAction}
                  name="variant"
                  value={label}
                  variant="secondary"
                  disabled={blocked}
                >
                  Key {label}
                </Button>
              ))}
            </div>
            <Button type="submit" formAction={keyAction} disabled={blocked}>
              Answer key for all {variantCount}
            </Button>
          </>
        )}
        <p className="text-xs text-slate-500">
          Written for students to score themselves, so it is safe to post alongside the paper. It
          says nothing about where a question came from in the bank. Rendered from the same
          questions and the same shuffle as the paper, so post the pair together — editing a
          question changes both.
        </p>
      </div>

      {blocked ? (
        <p className="text-xs text-red-700">Resolve the blocking issues above before generating.</p>
      ) : null}
    </form>
  )
}
