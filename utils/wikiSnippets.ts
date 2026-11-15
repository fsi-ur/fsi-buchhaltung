/**
 * Builds the wiki markup the editor inserts and places it into the article text. Pure on purpose:
 * the insert helper, the toolbar and the keyboard shortcuts all go through `applyWikiSnippet`, and
 * the unit tests feed the built code straight into the server renderer.
 */

export interface WikiSnippet {
  /** The code to insert — or, when `wrapAfter` is set, the part in front of the wrapped text. */
  text: string
  /** Goes on a line of its own (directives, boxes, tables, images). */
  block: boolean
  /** Set → the selected text (or `placeholder`) is put between `text` and `wrapAfter`, and selected afterwards. */
  wrapAfter?: string
  placeholder?: string
  /** The snippet already used the selected text (e.g. as a link label), so it replaces it. */
  replacesSelection?: boolean
}

export interface AppliedWikiSnippet {
  value: string
  selectionStart: number
  selectionEnd: number
}

/** Inserts `snippet` in place of `value[start, end)`, keeping block snippets on lines of their own. */
export function applyWikiSnippet(value: string, start: number, end: number, snippet: WikiSnippet): AppliedWikiSnippet {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const selected = value.slice(start, end)

  let body: string
  let innerStart: number
  let innerEnd: number

  if (snippet.wrapAfter !== undefined) {
    const inner = selected || snippet.placeholder || ''
    body = `${snippet.text}${inner}${snippet.wrapAfter}`
    innerStart = snippet.text.length
    innerEnd = innerStart + inner.length
  } else if (selected && !snippet.replacesSelection) {
    // Keep what was selected and put the snippet behind it instead of overwriting the author's text.
    body = `${selected}${snippet.block ? '\n\n' : ' '}${snippet.text}`
    innerStart = innerEnd = body.length
  } else {
    body = snippet.text
    innerStart = innerEnd = body.length
  }

  let prefix = ''
  let suffix = ''
  if (snippet.block) {
    prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    // A blank line behind the block, so the following text doesn't become part of it (e.g. a table row).
    suffix = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  }

  const offset = before.length + prefix.length
  const atEnd = innerStart === body.length
  return {
    value: `${before}${prefix}${body}${suffix}${after}`,
    selectionStart: atEnd ? offset + body.length + suffix.length : offset + innerStart,
    selectionEnd: atEnd ? offset + body.length + suffix.length : offset + innerEnd,
  }
}

/**
 * Puts `prefix` (`## `, `- `, `> ` …) in front of every line the selection touches — wherever the
 * cursor is on the line. `1. ` counts up per line. A line that already carries the prefix loses it,
 * so the toolbar button toggles.
 */
export function prefixWikiLines(value: string, start: number, end: number, prefix: string): AppliedWikiSnippet {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', Math.max(end - (end > start && value[end - 1] === '\n' ? 1 : 0), start))
  const lineEnd = nextBreak < 0 ? value.length : nextBreak
  const lines = value.slice(lineStart, lineEnd).split('\n')

  const numbered = /^\d+\. $/.test(prefix)
  const pattern = numbered ? /^\d+\. / : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  const remove = lines.every(line => pattern.test(line))
  const changed = lines
    .map((line, index) => remove ? line.replace(pattern, '') : `${numbered ? `${index + 1}. ` : prefix}${line}`)
    .join('\n')

  const result = `${value.slice(0, lineStart)}${changed}${value.slice(lineEnd)}`
  const cursor = lineStart + changed.length
  return { value: result, selectionStart: lines.length > 1 ? lineStart : cursor, selectionEnd: cursor }
}

/** Attribute values sit in double quotes on a single line. */
export function directiveAttr(value: string) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '\'').trim()
}

/** Labels of `[[…|label]]` references end at `|` or `]]`. */
function referenceLabel(value: string | undefined) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[|[\]]/g, '').trim()
}

export type WikiToolMeta = Record<string, string | number | boolean>

export function buildToolLink(page: string, label: string, meta: WikiToolMeta = {}): string {
  const fullMeta = JSON.stringify({ returnTarget: 'self', ...meta }).replace(/'/g, '')
  return `:::tool{page="${directiveAttr(page)}" meta='${fullMeta}' label="${directiveAttr(label)}"}`
}

export function buildEmbed(widget: string, args: Record<string, string | number | boolean | null | undefined> = {}): string {
  const attributes = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => ` ${name}="${directiveAttr(String(value))}"`)
    .join('')
  return `:::embed{widget="${directiveAttr(widget)}"${attributes}}`
}

export function buildChecklist(id: string): string {
  return `:::checklist{id="${directiveAttr(id)}"}`
}

export function buildGlossaryRef(key: string, label?: string): string {
  const text = referenceLabel(label)
  return `[[glossar:${key}${text ? `|${text}` : ''}]]`
}

/** `target` is `bereich` (a whole space) or `bereich/artikel`. */
export function buildWikiLink(target: string, label?: string): string {
  const text = referenceLabel(label)
  return `[[wiki:${target}${text ? `|${text}` : ''}]]`
}

export function buildImage(fileId: number, alt: string): string {
  return `![${String(alt ?? '').replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim()}](bild:${fileId})`
}

/** Turns an upload's file name into readable alt text: `kassen_abrechnung-2.png` → `kassen abrechnung 2`. */
export function altFromFileName(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/[[\]]/g, '').trim()
}

export const WIKI_TABLE_SNIPPET = '| Spalte | Spalte |\n| --- | --- |\n| Wert | Wert |'
