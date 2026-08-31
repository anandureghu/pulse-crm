export const tenantKeys = {
  all: ['tenant'] as const,
  context: (userId: string) => [...tenantKeys.all, 'context', userId] as const,
}

export const adminKeys = {
  all: ['admin'] as const,
  organizations: () => [...adminKeys.all, 'organizations'] as const,
  platformEvolution: () => [...adminKeys.all, 'platform-evolution'] as const,
}
