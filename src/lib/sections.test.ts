import { describe, expect, it } from 'vitest'
import { excludedStudentCount, isStudentExcluded, parseSectionCodes, summarizeSections } from './sections'

const O1 = '202608/CS/1301/O1/87196'
const O1R = '202608/CS/1301R/O1R/87712'
const HP = '202608/CS/1301/HP/85083'
const OIT = '202608/CS/1301/OIT/91113'

const student = (...sections: string[]) => ({ sections: JSON.stringify(sections) })

describe('parseSectionCodes', () => {
  it('reads a stored JSON array', () => {
    expect(parseSectionCodes(JSON.stringify([O1, HP]))).toEqual([O1, HP])
  })

  it('treats an absent or malformed value as no sections rather than throwing', () => {
    // A student row with a corrupt sections cell must not take down the whole
    // course page or, worse, abort a generation run.
    expect(parseSectionCodes(null)).toEqual([])
    expect(parseSectionCodes('')).toEqual([])
    expect(parseSectionCodes('not json')).toEqual([])
    expect(parseSectionCodes('{"a":1}')).toEqual([])
    expect(parseSectionCodes('[1, "ok", null]')).toEqual(['ok'])
  })
})

describe('isStudentExcluded', () => {
  it('excludes a student when any one of their sections is excluded', () => {
    // GT cross-lists a lecture with its recitation, so an HP student sits in both
    // HP and HP1. Requiring every section to be ticked would make ticking HP alone
    // silently do nothing.
    expect(isStudentExcluded([O1, O1R], [O1])).toBe(true)
  })

  it('keeps students with no excluded section', () => {
    expect(isStudentExcluded([O1, O1R], [HP])).toBe(false)
  })

  it('excludes nobody when nothing is excluded', () => {
    expect(isStudentExcluded([O1], [])).toBe(false)
    expect(isStudentExcluded([], [])).toBe(false)
  })

  it('keeps a student who is in no section at all', () => {
    expect(isStudentExcluded([], [O1])).toBe(false)
  })
})

describe('summarizeSections', () => {
  it('counts each section, labels it, and marks the excluded ones', () => {
    const sections = summarizeSections(
      [student(O1), student(O1, O1R), student(HP)],
      [HP],
    )
    expect(sections).toEqual([
      { code: HP, label: 'HP', count: 1, excluded: true },
      { code: O1, label: 'O1', count: 2, excluded: false },
      { code: O1R, label: 'O1R', count: 1, excluded: false },
    ])
  })

  it('lists a known section that currently has no students', () => {
    // An empty section still has to be excludable, or it can only be dealt with
    // after somebody enrols in it.
    expect(summarizeSections([student(O1)], [], [O1, OIT])).toEqual([
      { code: O1, label: 'O1', count: 1, excluded: false },
      { code: OIT, label: 'OIT', count: 0, excluded: false },
    ])
  })

  it('falls back to the raw code as the label when it is not a registrar code', () => {
    // Rosters imported before Canvas section names were resolved stored the bare
    // numeric section id; it must still render rather than disappear.
    expect(summarizeSections([student('559177')], [])).toEqual([
      { code: '559177', label: '559177', count: 1, excluded: false },
    ])
  })
})

describe('excludedStudentCount', () => {
  it('counts a cross-listed student once, not once per excluded section', () => {
    // Summing the per-section counts would report 2 here and overstate how many
    // papers the exclusion removes.
    expect(excludedStudentCount([student(HP, O1)], [HP, O1])).toBe(1)
  })

  it('counts only the students actually withheld', () => {
    expect(excludedStudentCount([student(O1), student(HP), student(OIT)], [HP, OIT])).toBe(2)
  })
})
