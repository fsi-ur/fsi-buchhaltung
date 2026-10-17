export interface ApiKey {
  id: number
  name: string
  /** The first characters of the key, so it can be recognised without being stored. */
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdBy: string | null
}
