import { describe, expect, it } from 'vitest'
import { renderArticle } from '~/server/utils/wiki/render'

function render(markdown: string) {
  const outcome = renderArticle(markdown)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome
}

describe('wiki links', () => {
  it('links an article with [[wiki:bereich/artikel]]', () => {
    const outcome = render('Siehe [[wiki:finanzen/belege|Belege]].')
    expect(outcome.html).toContain('data-wiki-article="finanzen/belege"')
    expect(outcome.articleLinks).toEqual([{ spaceSlug: 'finanzen', slug: 'belege' }])
    expect(outcome.spaceLinks).toEqual([])
  })

  it('links a whole space with [[wiki:bereich]]', () => {
    const outcome = render('Alles zu [[wiki:Finanzen|den Finanzen]] und [[wiki:veranstaltungen]].')
    expect(outcome.html).toContain('data-wiki-space="finanzen"')
    expect(outcome.html).toContain('data-wiki-label="den Finanzen"')
    expect(outcome.html).toContain('data-wiki-space="veranstaltungen"')
    expect(outcome.spaceLinks).toEqual(['finanzen', 'veranstaltungen'])
    expect(outcome.articleLinks).toEqual([])
    // The label is searchable text like any other link.
    expect(outcome.text).toContain('den Finanzen')
  })

  it('rejects malformed wiki links with a hint at both forms', () => {
    const outcome = renderArticle('[[wiki:a/b/c]]')
    expect(outcome).toEqual({ ok: false, error: 'Der Wiki-Link „wiki:a/b/c" muss die Form [[wiki:bereich]] oder [[wiki:bereich/artikel]] haben.' })
  })
})
