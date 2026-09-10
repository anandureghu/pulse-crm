import { supabase } from './supabase'
import type { InboxSnippet, InboxSnippetInput, InboxSnippetKind } from '../types'

type Unsubscribe = () => void

function fromRow(row: Record<string, unknown>): InboxSnippet {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    kind: row.kind as InboxSnippetKind,
    title: row.title as string,
    body: (row.body as string) ?? '',
    imageUrl: (row.image_url as string | null) ?? null,
    price: (row.price as string | null) ?? null,
    productUrl: (row.product_url as string | null) ?? null,
    shopifyProductId: row.shopify_product_id == null ? null : Number(row.shopify_product_id),
    shopifyVariantId: row.shopify_variant_id == null ? null : Number(row.shopify_variant_id),
    sku: (row.sku as string | null) ?? null,
    variantTitle: (row.variant_title as string | null) ?? null,
    shared: Boolean(row.shared),
    sharedWith: Array.isArray(row.shared_with) ? (row.shared_with as string[]) : [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function toRow(input: Partial<InboxSnippetInput> & { ownerId?: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.ownerId !== undefined) out.owner_id = input.ownerId
  if (input.kind !== undefined) out.kind = input.kind
  if (input.title !== undefined) out.title = input.title
  if (input.body !== undefined) out.body = input.body
  if (input.imageUrl !== undefined) out.image_url = input.imageUrl
  if (input.price !== undefined) out.price = input.price
  if (input.productUrl !== undefined) out.product_url = input.productUrl
  if (input.shopifyProductId !== undefined) out.shopify_product_id = input.shopifyProductId
  if (input.shopifyVariantId !== undefined) out.shopify_variant_id = input.shopifyVariantId
  if (input.sku !== undefined) out.sku = input.sku
  if (input.variantTitle !== undefined) out.variant_title = input.variantTitle
  if (input.shared !== undefined) out.shared = input.shared
  if (input.sharedWith !== undefined) out.shared_with = input.sharedWith
  return out
}

export async function listInboxSnippets(): Promise<InboxSnippet[]> {
  const { data, error } = await supabase
    .from('inbox_snippets')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => fromRow(row as Record<string, unknown>))
}

export async function createInboxSnippet(
  ownerId: string,
  input: InboxSnippetInput,
): Promise<InboxSnippet> {
  const { data, error } = await supabase
    .from('inbox_snippets')
    .insert(toRow({ ...input, ownerId }))
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('Failed to create snippet')
  return fromRow(data as Record<string, unknown>)
}

export async function updateInboxSnippet(
  id: string,
  input: Partial<InboxSnippetInput>,
): Promise<InboxSnippet> {
  const { data, error } = await supabase
    .from('inbox_snippets')
    .update(toRow(input))
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('Failed to update snippet')
  return fromRow(data as Record<string, unknown>)
}

export async function deleteInboxSnippet(id: string): Promise<void> {
  const { error } = await supabase.from('inbox_snippets').delete().eq('id', id)
  if (error) throw error
}

export function subscribeToInboxSnippets(onData: (rows: InboxSnippet[]) => void): Unsubscribe {
  const fetch = () => {
    listInboxSnippets()
      .then(onData)
      .catch(() => onData([]))
  }

  fetch()

  const channel = supabase
    .channel(`inbox_snippets:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_snippets' }, fetch)
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
