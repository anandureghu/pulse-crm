export interface EvolutionWebhookMessage {
  event: string
  instance: string
  data: {
    key: { remoteJid: string; fromMe: boolean; id: string }
    pushName?: string
    message?: {
      conversation?: string
      imageMessage?: { url: string; caption?: string }
      audioMessage?: { url: string }
      videoMessage?: { url: string; caption?: string }
      documentMessage?: { url: string; title?: string }
    }
    messageType: string
    messageTimestamp?: number | string | { low: number; high?: number }
    status?: string
  }
}

export interface EvolutionWebhookStatus {
  event: string
  instance: string
  data: {
    key: { remoteJid: string; fromMe: boolean; id: string }
    status: 'DELIVERY_ACK' | 'READ' | 'PLAYED'
  }
}
