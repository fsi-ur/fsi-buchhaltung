export function findImageReferencesInText(markdown: string | null | undefined): Set<number> {
  const ids = new Set<number>()
  for (const match of String(markdown ?? '').matchAll(/bild:(\d+)/gi)) ids.add(Number(match[1]))
  return ids
}
