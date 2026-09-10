export const SLASH_COMMANDS = [
  {
    id: 'products' as const,
    aliases: ['products', 'product', 'prod', 'p'],
    label: 'Products',
    hint: 'Preview and send a product',
    insert: '/products ',
    icon: '🛍️',
  },
  {
    id: 'replies' as const,
    aliases: ['reply', 'replies', 'r'],
    label: 'Reply',
    hint: 'Insert a saved reply',
    insert: '/reply ',
    icon: '💬',
  },
]

export function parseSlashInput(text: string): {
  open: boolean
  mode: 'commands' | 'products' | 'replies'
  query: string
} {
  if (!text.startsWith('/') || /\n/.test(text)) {
    return { open: false, mode: 'commands', query: '' }
  }
  const rest = text.slice(1)
  const spaceIdx = rest.indexOf(' ')
  const token = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase()
  const after = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1)

  if (spaceIdx !== -1) {
    const exact = SLASH_COMMANDS.find((c) => c.aliases.includes(token))
    if (!exact) return { open: false, mode: 'commands', query: '' }
    return { open: true, mode: exact.id, query: after }
  }

  if (!token) return { open: true, mode: 'commands', query: '' }

  const exact = SLASH_COMMANDS.find((c) => c.aliases.includes(token))
  if (exact) return { open: true, mode: exact.id, query: '' }

  const prefixMatches = SLASH_COMMANDS.filter(
    (c) => c.aliases.some((a) => a.startsWith(token)) || c.label.toLowerCase().startsWith(token),
  )
  if (prefixMatches.length === 1) return { open: true, mode: prefixMatches[0].id, query: '' }
  if (prefixMatches.length > 1) return { open: true, mode: 'commands', query: token }
  return { open: false, mode: 'commands', query: '' }
}
