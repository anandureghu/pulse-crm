import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export interface NotificationPreferences {
  inbox_messages: boolean
  order_won: boolean
  followup_reminders: boolean
}

export const DEFAULT_PREFS: NotificationPreferences = {
  inbox_messages: false,
  order_won: false,
  followup_reminders: false,
}

/** Subscribe the current browser to push and save to user_push_subscriptions. */
export async function enablePushNotifications(): Promise<boolean> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  if (!VAPID_PUBLIC_KEY) { console.warn('VITE_VAPID_PUBLIC_KEY not set'); return false }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
    }
    await upsertSubscription(sub)
    return true
  } catch (e) {
    console.warn('Push subscribe error:', e)
    return false
  }
}

/** Unsubscribe this browser from push and delete from user_push_subscriptions. */
export async function disablePushNotifications(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await supabase.from('user_push_subscriptions').delete().eq('endpoint', endpoint)
}

/** Returns true if this browser is currently subscribed. */
export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}

/** Fetch notification preferences for the current user. */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return DEFAULT_PREFS
  const { data } = await supabase
    .from('users')
    .select('notification_preferences')
    .eq('id', user.id)
    .maybeSingle()
  return (data?.notification_preferences as NotificationPreferences | null) ?? DEFAULT_PREFS
}

/** Save notification preferences for the current user. */
export async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('users')
    .update({ notification_preferences: prefs })
    .eq('id', user.id)
}

async function upsertSubscription(sub: PushSubscription): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const json = sub.toJSON()
  const endpoint = json.endpoint!
  const p256dh = json.keys?.p256dh ?? ''
  const auth = json.keys?.auth ?? ''

  const { data: u } = await supabase
    .from('users')
    .select('last_organization_id')
    .eq('id', user.id)
    .maybeSingle()

  await supabase.from('user_push_subscriptions').upsert(
    {
      user_id: user.id,
      organization_id: u?.last_organization_id ?? null,
      endpoint,
      p256dh,
      auth,
    },
    { onConflict: 'endpoint' },
  )
}

export function showLocalNotification(title: string, body: string) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/pwa-192x192.png' })
  }
}
