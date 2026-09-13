export interface AssociationDocument {
  id: number
  title: string
  description: string
  is_active: boolean
  created_at: string
  file_id: number | null
  file_name: string | null
  file_size: number | null
  mime_type: string | null
}

export interface SaveAssociationDocumentBody {
  id?: number
  title: string
  description?: string
  is_active?: boolean
}
