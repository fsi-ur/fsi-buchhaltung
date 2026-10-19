import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import anchor from 'markdown-it-anchor'
import sanitizeHtml from 'sanitize-html'
import { WIKI_EMBEDS_BY_KEY, type WikiEmbedDefinition } from '~/config/wikiEmbeds'

export interface WikiEmbedRef {
  key: string
  args: Record<string, string | number | boolean>
}

export interface WikiToolLinkRef {
  page: string
  meta: Record<string, any>
  label: string
}

export interface WikiArticleLinkRef {
  spaceSlug: string
  slug: string
}

export interface WikiHeading {
  id: string
  level: number
  title: string
}

export interface WikiRenderResult {
  html: string
  text: string
  embeds: WikiEmbedRef[]
  toolLinks: WikiToolLinkRef[]
  checklists: string[]
  articleLinks: WikiArticleLinkRef[]
  glossaryTerms: string[]
  headings: WikiHeading[]
  /** File ids of the `bild:<id>` images in the article. */
  images: number[]
}

export type WikiRenderOutcome =
  | ({ ok: true } & WikiRenderResult)
  | { ok: false, error: string }

export interface WikiRenderOptions {
  /** `key_slug`s of the checklists defined on the article, so `:::checklist{id="…"}` can be verified. */
  knownChecklists?: string[]
  //File ids of the images uploaded into the article
  knownImages?: number[]
}

interface RenderEnv {
  errors: string[]
  embeds: WikiEmbedRef[]
  toolLinks: WikiToolLinkRef[]
  checklists: string[]
  articleLinks: WikiArticleLinkRef[]
  glossaryTerms: string[]
  headings: WikiHeading[]
  images: number[]
  knownChecklists: string[] | null
  knownImages: number[] | null
}

const CALLOUT_NAMES = ['hinweis', 'warnung', 'tipp'] as const
// Greedy on purpose: attribute values carry JSON, so the closing brace is the last one on the line.
const DIRECTIVE_LINE = /^:::(tool|embed|checklist)\s*\{(.*)\}\s*$/
const ATTRIBUTE = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const WIKI_SLUG_PATH = /^[a-z0-9-]+\/[a-z0-9-]+$/
const GLOSSARY_KEY = /^[a-z0-9-]+$/

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' }

/** Stable, umlaut-aware heading ids — the table of contents and `#anchor` deep links depend on them. */
function slugify(value: string) {
  const normalized = value
    .replace(/[äöüßÄÖÜ]/g, char => UMLAUTS[char] ?? char)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'abschnitt'
}

function parseAttributes(raw: string) {
  const attributes: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTRIBUTE.exec(raw)) !== null) {
    attributes[match[1] ?? ''] = match[2] ?? match[3] ?? ''
  }
  return attributes
}

function coerceEmbedArg(
  definition: WikiEmbedDefinition,
  name: string,
  value: unknown,
  env: RenderEnv,
): string | number | boolean | undefined {
  const expected = definition.argsSchema?.[name]
  if (!expected) {
    env.errors.push(`Der Baustein „${definition.key}" kennt die Angabe „${name}" nicht.`)
    return undefined
  }

  if (expected === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(numeric)) {
      env.errors.push(`Der Baustein „${definition.key}" erwartet für „${name}" eine Zahl.`)
      return undefined
    }
    return numeric
  }

  if (expected === 'boolean') {
    const text = String(value).trim().toLowerCase()
    if (text === 'true' || text === '1') return true
    if (text === 'false' || text === '0') return false
    env.errors.push(`Der Baustein „${definition.key}" erwartet für „${name}" true oder false.`)
    return undefined
  }

  return String(value)
}

function buildEmbed(attributes: Record<string, string>, env: RenderEnv): WikiEmbedRef | null {
  const key = (attributes.widget ?? '').trim()
  if (!key) {
    env.errors.push('Ein :::embed-Baustein braucht die Angabe widget="…".')
    return null
  }

  const definition = WIKI_EMBEDS_BY_KEY[key]
  if (!definition) {
    env.errors.push(`Unbekannter Baustein „${key}". Bitte einen Baustein aus der Einfügen-Liste wählen.`)
    return null
  }

  const raw: Record<string, unknown> = {}

  if (attributes.args) {
    try {
      const parsed = JSON.parse(attributes.args)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      Object.assign(raw, parsed)
    } catch {
      env.errors.push(`Die args-Angabe des Bausteins „${key}" ist kein gültiges JSON-Objekt.`)
      return null
    }
  }

  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'widget' || name === 'args') continue
    raw[name] = value
  }

  const args: Record<string, string | number | boolean> = {}
  for (const [name, value] of Object.entries(raw)) {
    const coerced = coerceEmbedArg(definition, name, value, env)
    if (coerced !== undefined) args[name] = coerced
  }

  return { key, args }
}

function buildToolLink(attributes: Record<string, string>, env: RenderEnv): WikiToolLinkRef | null {
  const page = (attributes.page ?? '').trim()
  if (!page) {
    env.errors.push('Ein :::tool-Link braucht die Angabe page="…".')
    return null
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(page)) {
    env.errors.push(`„${page}" ist kein gültiger Seitenname für einen Tool-Link.`)
    return null
  }

  let meta: Record<string, any> = {}
  if (attributes.meta) {
    try {
      const parsed = JSON.parse(attributes.meta)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      meta = parsed
    } catch {
      env.errors.push(`Die meta-Angabe des Tool-Links „${page}" ist kein gültiges JSON-Objekt.`)
      return null
    }
  }

  return { page, meta, label: (attributes.label ?? '').trim() }
}

function buildChecklistRef(attributes: Record<string, string>, env: RenderEnv): string | null {
  const id = (attributes.id ?? '').trim()
  if (!id) {
    env.errors.push('Ein :::checklist-Block braucht die Angabe id="…".')
    return null
  }
  if (env.knownChecklists && !env.knownChecklists.includes(id)) {
    env.errors.push(`Es gibt keine Checkliste mit der Kennung „${id}" in diesem Artikel.`)
    return null
  }
  return id
}

function directiveRule(state: any, startLine: number, endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  const match = DIRECTIVE_LINE.exec(state.src.slice(start, max).trim())
  if (!match) return false
  if (silent) return true

  const env = state.env.wiki as RenderEnv
  const [, name, rawAttributes] = match
  const attributes = parseAttributes(rawAttributes ?? '')

  let nextLine = startLine + 1
  // Tolerate the `:::embed{…} … :::` spelling: the body is only a fallback and is not rendered
  if (name === 'embed') {
    for (let line = nextLine; line < endLine; line += 1) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim()
      if (DIRECTIVE_LINE.test(text) || /^:::\w/.test(text)) break
      if (text === ':::') {
        nextLine = line + 1
        break
      }
    }
  }

  const token = state.push('wiki_directive', '', 0)
  token.block = true
  token.map = [startLine, nextLine]
  token.meta = { name, attributes }

  if (name === 'embed') {
    const embed = buildEmbed(attributes, env)
    token.meta.embed = embed
    if (embed) env.embeds.push(embed)
  } else if (name === 'tool') {
    const tool = buildToolLink(attributes, env)
    token.meta.tool = tool
    if (tool) env.toolLinks.push(tool)
  } else {
    const checklist = buildChecklistRef(attributes, env)
    token.meta.checklist = checklist
    if (checklist) env.checklists.push(checklist)
  }

  state.line = nextLine
  return true
}

function wikiReferenceRule(state: any, silent: boolean) {
  if (state.src.charCodeAt(state.pos) !== 0x5B || state.src.charCodeAt(state.pos + 1) !== 0x5B) return false

  const end = state.src.indexOf(']]', state.pos + 2)
  if (end < 0) return false

  const body = state.src.slice(state.pos + 2, end).trim()
  const match = /^(wiki|glossar):(.+)$/i.exec(body)
  if (!match) return false
  if (silent) {
    state.pos = end + 2
    return true
  }

  const env = state.env.wiki as RenderEnv
  const kind = (match[1] ?? '').toLowerCase()
  const [rawTarget, rawLabel] = (match[2] ?? '').split('|')
  const targetRaw = (rawTarget ?? '').trim()
  const target = targetRaw.toLowerCase()
  const label = (rawLabel ?? '').trim()

  if (kind === 'wiki') {
    if (!WIKI_SLUG_PATH.test(target)) {
      env.errors.push(`Der Wiki-Link „${body}" muss die Form [[wiki:bereich/artikel]] haben.`)
      return false
    }
    const [spaceSlug = '', slug = ''] = target.split('/')
    env.articleLinks.push({ spaceSlug, slug })
    const token = state.push('wiki_article_link', '', 0)
    token.meta = { spaceSlug, slug, label }
  } else {
    if (!GLOSSARY_KEY.test(target)) {
      env.errors.push(`Der Glossar-Verweis „${body}" muss die Form [[glossar:begriff]] haben.`)
      return false
    }
    env.glossaryTerms.push(target)
    const token = state.push('wiki_glossary_ref', '', 0)
    token.meta = { term: target, label, display: targetRaw }
  }

  state.pos = end + 2
  return true
}

export function parseWikiImageRef(src: string): number | null {
  const match = /^bild:(\d+)$/i.exec(String(src ?? '').trim())
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Resolves every `bild:<id>` image to its file id; runs after inline parsing so errors stop the render. */
function wikiImagesRule(state: any) {
  const env = state.env.wiki as RenderEnv | undefined
  if (!env) return

  const visit = (tokens: any[]) => {
    for (const token of tokens) {
      if (token.children) visit(token.children)
      if (token.type !== 'image') continue

      const src = String(token.attrGet('src') ?? '')
      if (!/^bild:/i.test(src)) continue

      const fileId = parseWikiImageRef(src)
      if (fileId === null) {
        env.errors.push(`Der Bildverweis „${src}" ist ungültig. Bilder bitte über „Bild einfügen" hochladen.`)
        continue
      }
      if (env.knownImages && !env.knownImages.includes(fileId)) {
        env.errors.push(`Das Bild „${src}" gehört nicht zu diesem Artikel oder wurde gelöscht. Bitte das Bild in diesem Artikel hochladen.`)
        continue
      }
      token.meta = { ...(token.meta ?? {}), wikiImageId: fileId }
      if (!env.images.includes(fileId)) env.images.push(fileId)
    }
  }
  visit(state.tokens)
}

function createRenderer() {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false })

  md.use(anchor, {
    level: [1, 2, 3, 4],
    slugify,
    tabIndex: false,
    callback(token: any, info: { slug: string, title: string }) {
      // `anchor` runs inside core rules, where the render env is not handed to the callback — the
      // headings are collected from the token stream in renderArticle() instead.
      void token
      void info
    },
  })

  for (const name of CALLOUT_NAMES) {
    md.use(container, name, {
      render(tokens: any[], index: number) {
        if (tokens[index].nesting === 1) {
          return `<div class="wiki-callout wiki-callout-${name}" data-wiki-callout="${name}">\n`
        }
        return '</div>\n'
      },
    })
  }

  md.block.ruler.before('fence', 'wiki_directive', directiveRule, { alt: ['paragraph', 'blockquote', 'list'] })
  md.inline.ruler.before('link', 'wiki_reference', wikiReferenceRule)
  md.core.ruler.push('wiki_images', wikiImagesRule)

  const escape = md.utils.escapeHtml

  const defaultImage = md.renderer.rules.image!
  md.renderer.rules.image = (tokens: any[], index: number, options: any, env: any, self: any) => {
    const token = tokens[index]
    const fileId = token.meta?.wikiImageId
    if (!fileId) return defaultImage(tokens, index, options, env, self)

    // `src` is root-relative like every other /api/files link; ArticleBody prefixes the app base URL.
    const alt = self.renderInlineAsText(token.children ?? [], options, env)
    const title = token.attrGet('title')
    return `<img class="wiki-image" src="/api/files/${fileId}" data-wiki-image="${fileId}" alt="${escape(alt)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy">`
  }

  md.renderer.rules.wiki_directive = (tokens: any[], index: number) => {
    const { name, embed, tool, checklist } = tokens[index].meta
    if (name === 'embed') {
      if (!embed) return ''
      return `<div class="wiki-embed" data-wiki-embed="${escape(embed.key)}" data-wiki-args="${escape(JSON.stringify(embed.args))}"></div>\n`
    }
    if (name === 'tool') {
      if (!tool) return ''
      return `<div class="wiki-tool" data-wiki-tool="${escape(tool.page)}" data-wiki-tool-meta="${escape(JSON.stringify(tool.meta))}" data-wiki-label="${escape(tool.label)}"></div>\n`
    }
    if (!checklist) return ''
    return `<div class="wiki-checklist" data-wiki-checklist="${escape(checklist)}"></div>\n`
  }

  md.renderer.rules.wiki_article_link = (tokens: any[], index: number) => {
    const { spaceSlug, slug, label } = tokens[index].meta
    const path = `${spaceSlug}/${slug}`
    return `<a class="wiki-link" data-wiki-article="${escape(path)}" data-wiki-label="${escape(label)}">${escape(label || path)}</a>`
  }

  md.renderer.rules.wiki_glossary_ref = (tokens: any[], index: number) => {
    const { term, label, display } = tokens[index].meta
    return `<span class="wiki-glossary" data-wiki-glossary="${escape(term)}">${escape(label || display || term)}</span>`
  }

  return md
}

const renderer = createRenderer()

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 's', 'del', 'code', 'pre',
    'blockquote', 'hr', 'br', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'span', 'div',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'data-wiki-image', 'data-wiki-embed', 'data-wiki-args', 'data-wiki-tool', 'data-wiki-tool-meta', 'data-wiki-checklist', 'data-wiki-article', 'data-wiki-glossary', 'data-wiki-callout', 'data-wiki-label'],
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'title', 'loading'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => {
      if (!attribs.href) return { tagName, attribs }
      return { tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }
    },
  },
}

function collectText(tokens: any[], parts: string[]) {
  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block') {
      parts.push(token.content)
    } else if (token.type === 'inline' && token.children) {
      collectText(token.children, parts)
    } else if (token.type === 'text' || token.type === 'code_inline') {
      parts.push(token.content)
    } else if (token.type === 'wiki_article_link' || token.type === 'wiki_glossary_ref') {
      parts.push(token.meta.label || token.meta.term || `${token.meta.spaceSlug}/${token.meta.slug}`)
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      parts.push(' ')
    } else if (token.type === 'image' && token.children) {
      collectText(token.children, parts)
    }
  }
}

function collectHeadings(tokens: any[], headings: WikiHeading[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open') continue
    const id = token.attrGet('id')
    const inline = tokens[index + 1]
    if (!id || !inline) continue
    const parts: string[] = []
    collectText([inline], parts)
    headings.push({ id, level: Number(token.tag.slice(1)), title: parts.join('').trim() })
  }
}

export function renderArticle(markdown: string, options: WikiRenderOptions = {}): WikiRenderOutcome {
  const env: RenderEnv = {
    errors: [],
    embeds: [],
    toolLinks: [],
    checklists: [],
    articleLinks: [],
    glossaryTerms: [],
    headings: [],
    images: [],
    knownChecklists: options.knownChecklists ?? null,
    knownImages: options.knownImages ?? null,
  }

  const source = markdown ?? ''
  const renderEnv = { wiki: env }

  const tokens = renderer.parse(source, renderEnv)
  if (env.errors.length) return { ok: false, error: env.errors[0] ?? '' }

  collectHeadings(tokens, env.headings)

  const rawHtml = renderer.renderer.render(tokens, (renderer as any).options, renderEnv)
  const html = sanitizeHtml(rawHtml, SANITIZE_OPTIONS)

  const textParts: string[] = []
  collectText(tokens, textParts)
  const text = textParts.join(' ').replace(/\s+/g, ' ').trim()

  return {
    ok: true,
    html,
    text,
    embeds: env.embeds,
    toolLinks: env.toolLinks,
    checklists: env.checklists,
    articleLinks: env.articleLinks,
    glossaryTerms: env.glossaryTerms,
    headings: env.headings,
    images: env.images,
  }
}

export function parseArticleTokens(markdown: string, options: WikiRenderOptions = {}): any[] {
  const env: RenderEnv = {
    errors: [],
    embeds: [],
    toolLinks: [],
    checklists: [],
    articleLinks: [],
    glossaryTerms: [],
    headings: [],
    images: [],
    knownChecklists: options.knownChecklists ?? null,
    knownImages: options.knownImages ?? null,
  }

  return renderer.parse(markdown ?? '', { wiki: env })
}
