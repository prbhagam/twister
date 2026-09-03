import { describe, expect, it } from 'vitest'
import { bucketFolderName } from './signup-export'

describe('bucketFolderName', () => {
  it('is the literal "Not signed up" for that bucket, regardless of rawLabel', () => {
    expect(bucketFolderName({ kind: 'not_signed_up', rawLabel: 'Not signed up', label: null })).toBe('Not signed up')
  })

  it('uses rawLabel for a session, with filesystem-illegal characters swapped out', () => {
    expect(bucketFolderName({ kind: 'session', rawLabel: '10/27/2026 1:35 PM (Scheller 101)', label: null })).toBe(
      '10-27-2026 1-35 PM (Scheller 101)',
    )
  })

  it('prefers the editable label for an exception, falling back to rawLabel when unset', () => {
    expect(
      bucketFolderName({
        kind: 'exception',
        rawLabel: 'Exception: all GTE students will be contacted with their exam arrangements.',
        label: 'GTE',
      }),
    ).toBe('GTE')
    expect(
      bucketFolderName({
        kind: 'exception',
        rawLabel: 'Exception: all GTE students will be contacted with their exam arrangements.',
        label: null,
      }),
    ).toBe('Exception- all GTE students will be contacted with their exam arrangements.')
  })

  it('collapses stray whitespace and trims', () => {
    expect(bucketFolderName({ kind: 'session', rawLabel: '  10/27/2026   1:35 PM (Scheller 101)  ', label: null })).toBe(
      '10-27-2026 1-35 PM (Scheller 101)',
    )
  })
})
