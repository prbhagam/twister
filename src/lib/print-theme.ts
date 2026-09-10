import type { ThemeRegistrationRaw } from '@shikijs/types'

/**
 * The exam booklet — and the practice exam, which is the same document with a
 * sample identity — is the only thing here that gets mass-printed on a
 * black-and-white laser printer and then, often, photocopied. Both stages are
 * unforgiving in ways a screen is not, so the palette below is grayscale by
 * construction rather than by accident: nothing on a printed paper depends on a
 * hue surviving a trip through a toner cartridge.
 *
 * Deliberately scoped. The graded report, the question bank, and the review UI are
 * read on screen and stay in full colour — they are not covered by any of this.
 *
 * Three rules hold for the printed booklet. Break them and something either
 * disappears on paper or, worse, becomes ambiguous:
 *
 *  1. **A fill never carries meaning on its own.** Two tints that read as obviously
 *     different colors on screen land within a few percent of each other in
 *     grayscale, and a copier flattens what is left. Anything a fill says must also
 *     be said by a border, a rule, or a word.
 *  2. **Hairlines stay at or below `--rule`.** Lighter than this and a 0.5pt line
 *     dithers into a dotted smudge, or drops out of the page entirely.
 *  3. **Body text is pure black.** Near-black greys cost contrast for nothing once
 *     there is no color left to soften.
 *
 * To put the booklet back into colour, this block and `PRINT_CODE_THEME` are the
 * only two places that need to change.
 */
export const EXAM_PRINT_PALETTE = String.raw`
    --ink: #000000;
    --ink-soft: #2b2b2b;
    /* Labels and captions. Dark enough to survive a generation of photocopying,
       which is where the old blue-greys fell apart. */
    --muted: #4a4a4a;
    /* Running footers only — the one place a lighter grey is wanted, so the
       identity strip never competes with the question it sits under. */
    --faint: #5f5f5f;
    --rule: #a2a2a2;
    --rule-strong: #000000;
    /* Panel fill. Always paired with a border: on a printer set to a heavy toner
       saving mode this drops out completely, and the border is what keeps the
       block legible as a block. */
    --surface: #f0f0f0;
    /* Emphasis fill, for a row that has been singled out. Still holds black text
       at full contrast. */
    --surface-alt: #e2e2e2;
    --sans: "Helvetica Neue", Helvetica, Arial, "Segoe UI", system-ui, sans-serif;
    --mono: "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
`

/**
 * Syntax highlighting for the printed booklet.
 *
 * A stock editor theme leans entirely on hue, so in grayscale a Python keyword, an
 * identifier, and a string collapse into three barely-distinguishable greys — and
 * the lightest of them, comments, can vanish outright. This maps the token classes
 * that actually appear in CS 1301 code onto **weight and slant** instead, which
 * reproduce exactly at any toner level, with a short grey ramp underneath as a
 * secondary cue:
 *
 *   - keywords and operators — bold black
 *   - comments               — italic grey, deliberately receding
 *   - strings and numbers    — plain mid-grey
 *   - everything else        — plain black
 *
 * Shiki emits these as inline `font-weight` / `font-style`, so they survive being
 * printed, scanned, and copied in a way `color:` alone does not.
 */
export const PRINT_CODE_THEME: ThemeRegistrationRaw = {
  name: 'twister-print',
  type: 'light',
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#000000',
  },
  settings: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#5f5f5f', fontStyle: 'italic' } },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'keyword.operator.logical',
        'keyword.operator.new',
        'variable.language',
      ],
      settings: { foreground: '#000000', fontStyle: 'bold' },
    },
    {
      scope: ['string', 'string.quoted', 'punctuation.definition.string', 'constant.character.escape'],
      settings: { foreground: '#3a3a3a' },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.language.boolean', 'support.constant'],
      settings: { foreground: '#3a3a3a' },
    },
    // Definition sites are worth picking out when reading code on paper; call
    // sites are left plain so a dense line does not turn mostly bold.
    { scope: ['entity.name.function', 'entity.name.class', 'entity.name.type'], settings: { foreground: '#000000', fontStyle: 'bold' } },
    { scope: ['variable', 'variable.parameter', 'meta.function-call', 'support.function'], settings: { foreground: '#000000' } },
    { scope: ['punctuation', 'meta.brace'], settings: { foreground: '#000000' } },
  ],
}

/** The colour theme every on-screen document keeps. */
export const SCREEN_CODE_THEME = 'github-light'

/**
 * Prefix for the CSS custom properties Shiki emits.
 *
 * The two themes above are rendered *together*, into one piece of HTML, because a
 * single render has to serve both audiences: `createRun` freezes the rendered
 * prompt into the run snapshot, and that one copy is what the printed booklet, the
 * graded report, and the on-screen review page all read. Rather than render twice
 * or store two copies, Shiki writes both palettes as custom properties on each
 * token and each document picks the one it wants with `codeThemeCss`.
 */
export const CODE_VAR_PREFIX = '--twister-'

/**
 * The rule that selects a palette for rendered code. Every document showing
 * markdown needs exactly one of these — without it the custom properties resolve
 * to nothing and code renders as one flat colour.
 *
 * The `inherit` fallbacks matter: Shiki emits a `-font-weight` or `-font-style`
 * property only for tokens where at least one theme sets it, so most spans carry
 * neither.
 *
 * The browser UI has its own copy of this rule in `globals.css`, which Tailwind
 * compiles and cannot import from here — keep the two in step.
 */
export function codeThemeCss(which: 'screen' | 'print'): string {
  const v = `${CODE_VAR_PREFIX}${which}`
  return `
  .shiki, .shiki span {
    color: var(${v});
    font-weight: var(${v}-font-weight, inherit);
    font-style: var(${v}-font-style, inherit);
  }`
}
