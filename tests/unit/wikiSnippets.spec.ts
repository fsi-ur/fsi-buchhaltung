import { describe, expect, it } from 'vitest'
import { renderArticle } from '~/server/utils/wiki/render'
import { WIKI_EMBEDS } from '~/config/wikiEmbeds'
import {
  WIKI_TABLE_SNIPPET,
  altFromFileName,
  applyWikiSnippet,
  buildChecklist,
  buildEmbed,
  buildGlossaryRef,
  buildImage,
  buildToolLink,
  buildWikiLink,
  prefixWikiLines,
} from '~/utils/wikiSnippets'

function render(markdown: string, options: Parameters<typeof renderArticle>[1] = {}) {
  const outcome = renderArticle(markdown, options)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome
}

describe('wiki snippet builders produce code the renderer accepts', () => {
  it('builds tool links with a self return target and escaped label', () => {
    const code = buildToolLink('Settings', 'Einstellungen – "Kosten"\nstellen', { tab: 'costCentres' })
    expect(code).toBe(':::tool{page="Settings" meta=\'{"returnTarget":"self","tab":"costCentres"}\' label="Einstellungen – \'Kosten\' stellen"}')
    expect(render(code).toolLinks).toEqual([{
      page: 'Settings',
      meta: { returnTarget: 'self', tab: 'costCentres' },
      label: 'Einstellungen – \'Kosten\' stellen',
    }])
  })

  it('builds every registered widget with and without its arguments', () => {
    for (const embed of WIKI_EMBEDS) {
      expect(render(buildEmbed(embed.key)).embeds).toEqual([{ key: embed.key, args: {} }])
      const args = Object.fromEntries(Object.entries(embed.argsSchema ?? {}).map(([name, type]) =>
        [name, type === 'number' ? '7' : type === 'boolean' ? true : 'x']))
      const expected = Object.fromEntries(Object.entries(embed.argsSchema ?? {}).map(([name, type]) =>
        [name, type === 'number' ? 7 : type === 'boolean' ? true : 'x']))
      expect(render(buildEmbed(embed.key, args)).embeds).toEqual([{ key: embed.key, args: expected }])
    }
  })

  it('leaves out empty widget arguments', () => {
    expect(buildEmbed('budget-status', { year: '2026', costCentreId: '' })).toBe(':::embed{widget="budget-status" year="2026"}')
  })

  it('builds checklist, glossary, wiki and image references', () => {
    expect(render(buildChecklist('kasse'), { knownChecklists: ['kasse'] }).checklists).toEqual(['kasse'])
    expect(buildGlossaryRef('mwst', 'Mehr|wert[steuer]')).toBe('[[glossar:mwst|Mehrwertsteuer]]')
    expect(render(`Text ${buildGlossaryRef('mwst', 'MwSt')}`).glossaryTerms).toEqual(['mwst'])
    expect(render(buildWikiLink('finanzen/belege', 'Belege')).articleLinks).toEqual([{ spaceSlug: 'finanzen', slug: 'belege' }])
    expect(render(buildWikiLink('finanzen')).spaceLinks).toEqual(['finanzen'])
    expect(buildImage(12, 'Kasse [alt]')).toBe('![Kasse alt](bild:12)')
    expect(render(buildImage(12, altFromFileName('kassen_abrechnung-2.png')), { knownImages: [12] }).images).toEqual([12])
  })
})

describe('applyWikiSnippet', () => {
  it('puts a block on its own lines in the middle of a paragraph', () => {
    const value = 'Vorher Text'
    const result = applyWikiSnippet(value, 6, 6, { text: ':::checklist{id="a"}', block: true })
    expect(result.value).toBe('Vorher\n\n:::checklist{id="a"}\n\n Text')
    expect(result.selectionStart).toBe(result.value.indexOf(' Text'))
  })

  it('does not add blank lines that are already there', () => {
    const result = applyWikiSnippet('A\n\n\n\nB', 3, 3, { text: '---', block: true })
    expect(result.value).toBe('A\n\n---\n\nB')
  })

  it('wraps the selection and selects it again', () => {
    const result = applyWikiSnippet('ein Wort hier', 4, 8, { text: '**', wrapAfter: '**', block: false })
    expect(result.value).toBe('ein **Wort** hier')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Wort')
  })

  it('selects the placeholder of an empty box so it can be typed over', () => {
    const result = applyWikiSnippet('', 0, 0, { text: ':::tipp\n', wrapAfter: '\n:::', placeholder: 'Text', block: true })
    expect(result.value).toBe(':::tipp\nText\n:::\n')
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe('Text')
    expect(render(result.value).html).toContain('wiki-callout-tipp')
  })

  it('keeps selected text in front of an atomic snippet, unless the snippet used it', () => {
    expect(applyWikiSnippet('Satz', 0, 4, { text: '[[glossar:x]]', block: false }).value).toBe('Satz [[glossar:x]]')
    expect(applyWikiSnippet('Satz', 0, 4, { text: '[[glossar:x|Satz]]', block: false, replacesSelection: true }).value).toBe('[[glossar:x|Satz]]')
  })

  it('turns a single line break in front of a block into a blank line', () => {
    const result = applyWikiSnippet('Hallo\n', 6, 6, { text: WIKI_TABLE_SNIPPET, block: true })
    expect(result.value).toBe(`Hallo\n\n${WIKI_TABLE_SNIPPET}\n`)
    expect(render(result.value).html).toContain('<table>')
  })
})

describe('prefixWikiLines', () => {
  it('prefixes the current line wherever the cursor is', () => {
    expect(prefixWikiLines('eins\nzwei drei', 8, 8, '## ').value).toBe('eins\n## zwei drei')
  })

  it('numbers several selected lines and toggles the prefix off again', () => {
    const numbered = prefixWikiLines('a\nb\nc', 0, 5, '1. ')
    expect(numbered.value).toBe('1. a\n2. b\n3. c')
    expect(prefixWikiLines(numbered.value, 0, numbered.value.length, '1. ').value).toBe('a\nb\nc')
  })

  it('ignores a selection that ends right after a line break', () => {
    expect(prefixWikiLines('a\nb\nc', 0, 2, '- ').value).toBe('- a\nb\nc')
  })
})
