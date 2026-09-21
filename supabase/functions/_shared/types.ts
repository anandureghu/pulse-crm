export interface EvolutionWebhookMessage {
  event: string
  instance: string
  data: {
    key: { remoteJid: string; fromMe: boolean; id: string; participant?: string }
    pushName?: string
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
      imageMessage?: { url: string; caption?: string }
      stickerMessage?: { url: string }
      audioMessage?: { url: string }
      videoMessage?: { url: string; caption?: string }
      documentMessage?: { url: string; title?: string; fileName?: string; mimetype?: string }
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
