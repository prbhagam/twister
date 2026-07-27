'use client'

import { useActionState, useState } from 'react'
import { Badge, Button, Card, CardHeader, Input, Label, Notice } from '@/components/ui'
import { MAX_CHOICES } from '@/lib/seed'
import { saveQuestion, type EditableVariation, type SaveState } from './actions'
import { MarkdownField } from './MarkdownField'

function blankVariation(index: number): EditableVariation {
  return {
    label: String.fromCharCode(65 + index),
    promptMarkdown: '',
    choices: Array.from({ length: MAX_CHOICES }, (_, i) => ({
      textMarkdown: '',
      isCorrect: i === 0,
      pinToLast: false,
    })),
  }
}

export function QuestionEditor({
  examId,
  questionId,
  order,
  initialPoints,
  initialTitle,
  initialVariations,
}: {
  examId: string
  questionId: string
  order: number
  initialPoints: number
  initialTitle: string
  initialVariations: EditableVariation[]
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveQuestion, {})
  const [variations, setVariations] = useState<EditableVariation[]>(
    initialVariations.length > 0 ? initialVariations : [blankVariation(0)],
  )

  const update = (index: number, patch: Partial<EditableVariation>) =>
    setVariations((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)))

  const updateChoice = (vIndex: number, cIndex: number, patch: Partial<EditableVariation['choices'][number]>) =>
    setVariations((prev) =>
      prev.map((v, i) =>
        i === vIndex
          ? { ...v, choices: v.choices.map((c, j) => (j === cIndex ? { ...c, ...patch } : c)) }
          : v,
      ),
    )

  // Exactly one correct answer per variation, enforced in the UI as a radio group.
  const setCorrect = (vIndex: number, cIndex: number) =>
    setVariations((prev) =>
      prev.map((v, i) =>
        i === vIndex ? { ...v, choices: v.choices.map((c, j) => ({ ...c, isCorrect: j === cIndex })) } : v,
      ),
    )

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="questionId" value={questionId} />
      <input type="hidden" name="examId" value={examId} />
      <input type="hidden" name="variations" value={JSON.stringify(variations)} />

      {state.error ? <Notice tone="red" title="Not saved">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="green">Saved.</Notice> : null}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="title">Internal label (optional, never printed)</Label>
            <Input id="title" name="title" defaultValue={initialTitle} placeholder="Loops — trace output" />
          </div>
          <div>
            <Label htmlFor="points">Points</Label>
            <Input id="points" name="points" type="number" step="0.5" min="0" defaultValue={initialPoints} />
          </div>
        </div>
      </Card>

      {variations.map((variation, vIndex) => (
        <Card key={vIndex}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Variation
                <input
                  value={variation.label}
                  onChange={(e) => update(vIndex, { label: e.target.value })}
                  className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                />
                {variation.choices.length < MAX_CHOICES ? (
                  <Badge tone="amber">{variation.choices.length} choices</Badge>
                ) : null}
              </span>
            }
            subtitle="One variation is drawn per student, then its choices are shuffled."
            action={
              variations.length > 1 ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setVariations((prev) => prev.filter((_, i) => i !== vIndex))}
                >
                  Remove
                </Button>
              ) : null
            }
          />

          <div className="space-y-4 px-5 py-4">
            <div>
              <Label>Prompt (markdown)</Label>
              <MarkdownField
                value={variation.promptMarkdown}
                rows={6}
                placeholder={'What does this print?\n\n```python\nprint(len([1, 2, 3]))\n```'}
                onChange={(promptMarkdown) => update(vIndex, { promptMarkdown })}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Answer choices</Label>
                <span className="text-xs text-slate-500">
                  Printed order is randomized per student; letters below are authoring order only.
                </span>
              </div>

              <div className="space-y-3">
                {variation.choices.map((choice, cIndex) => (
                  <div key={cIndex} className="rounded-md border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-4">
                      <span className="text-xs font-semibold text-slate-400">#{cIndex + 1}</span>
                      <label className="flex items-center gap-1.5 text-xs text-slate-700">
                        <input
                          type="radio"
                          name={`correct-${vIndex}`}
                          checked={choice.isCorrect}
                          onChange={() => setCorrect(vIndex, cIndex)}
                        />
                        Correct answer
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={choice.pinToLast}
                          onChange={(e) => updateChoice(vIndex, cIndex, { pinToLast: e.target.checked })}
                        />
                        Pin to last
                        <span className="text-slate-400">(&ldquo;None of the above&rdquo;)</span>
                      </label>
                      {variation.choices.length > 2 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setVariations((prev) =>
                              prev.map((v, i) => {
                                if (i !== vIndex) return v
                                const choices = v.choices.filter((_, j) => j !== cIndex)
                                // Never leave a variation without a correct answer.
                                if (!choices.some((c) => c.isCorrect) && choices[0]) choices[0].isCorrect = true
                                return { ...v, choices }
                              }),
                            )
                          }
                          className="ml-auto text-xs text-red-600 hover:underline"
                        >
                          Remove choice
                        </button>
                      ) : null}
                    </div>
                    <MarkdownField
                      value={choice.textMarkdown}
                      rows={2}
                      placeholder="`3`"
                      onChange={(textMarkdown) => updateChoice(vIndex, cIndex, { textMarkdown })}
                    />
                  </div>
                ))}
              </div>

              {variation.choices.length < MAX_CHOICES ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  onClick={() =>
                    update(vIndex, {
                      choices: [...variation.choices, { textMarkdown: '', isCorrect: false, pinToLast: false }],
                    })
                  }
                >
                  Add choice
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setVariations((prev) => [...prev, blankVariation(prev.length)])}
        >
          Add variation
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : `Save question ${order}`}
        </Button>
      </div>
    </form>
  )
}
