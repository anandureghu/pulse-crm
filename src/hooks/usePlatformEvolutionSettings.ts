import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminKeys } from '../lib/queryKeys'
import {
  fetchPlatformEvolutionSettings,
  savePlatformEvolutionSettings,
  type PlatformEvolutionSettings,
} from '../lib/platformSettings'

export function usePlatformEvolutionSettings() {
  return useQuery({
    queryKey: adminKeys.platformEvolution(),
    queryFn: fetchPlatformEvolutionSettings,
  })
}

export function useSavePlatformEvolutionSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: savePlatformEvolutionSettings,
    onSuccess: (data) => {
      queryClient.setQueryData<PlatformEvolutionSettings>(adminKeys.platformEvolution(), data)
    },
  })
}
