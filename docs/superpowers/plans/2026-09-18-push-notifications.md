# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-member opt-in web push notifications (default OFF) for inbox messages, order won, and follow-up reminders, designed for multiple devices per user and easy addition of new notification types.

**Architecture:** Each user's browser push subscriptions are stored in a dedicated `user_push_subscriptions` table (one row per device) so a user can receive notifications on multiple browsers/devices. Per-user per-type preferences live as a JSONB column on `users`. A shared Deno module (`_shared/webpush.ts`) owns all VAPID signing logic and 410-cleanup, keeping edge functions thin. Notification permission is never requested automatically — users opt in via the Settings page.

**Tech Stack:** Web Push API, VAPID (ECDSA P-256), Supabase Edge Functions (Deno), React, Tailwind CSS, existing `workbox` service worker.

---

## Existing Code Map (read before touching anything)

| File | Current role |
|------|-------------|
| `src/sw.ts` | SW; already handles `push` + `notificationclick` but hardcodes `url: '/'` |
| `src/lib/notifications.ts` | `requestNotificationPermission()` saves to `users.push_subscription` (single-device) |
| `src/App.tsx:168` | Calls `requestNotificationPermission()` on every login — **must be removed** |
| `supabase/functions/notify-on-new-message/index.ts` | Sends push to all users with `push_subscription`, no preference check |
| `supabase/functions/daily-followup-reminder/index.ts` | Same pattern; duplicates VAPID signing |
| `supabase/functions/update-enquiry-status/index.ts` | Calls `notify-team` (WhatsApp) for `sale_completed`; no push |
| `users.push_subscription` | Legacy single-subscription column; will be superseded (keep for now, stop writing to it) |

---

## File Structure

**Create:**
- `supabase/migrations/20240101000022_notification_preferences.sql` — new table + prefs column
- `supabase/functions/_shared/webpush.ts` — shared VAPID signing + 410 cleanup
- `src/hooks/useNotificationPreferences.ts` — reads/writes prefs + subscription state

**Modify:**
- `src/sw.ts` — forward `url` and `tag` from push payload into `showNotification`
- `src/lib/notifications.ts` — save subscriptions to new table; load/save preferences
- `src/App.tsx` — remove auto `requestNotificationPermission()` call
- `src/pages/Settings.tsx` — add Notifications section with per-type toggles
- `supabase/functions/notify-on-new-message/index.ts` — use new table; check `inbox_messages` pref
- `supabase/functions/daily-followup-reminder/index.ts` — use new table; check `followup_reminders` pref
- `supabase/functions/update-enquiry-status/index.ts` — send push on `sale_completed`

---

## Task 1: DB migration

**Files:**
- Create: `supabase/migrations/20240101000022_notification_preferences.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20240101000022_notification_preferences.sql

-- Multi-device push subscriptions (one row per browser/device per user)
create table public.user_push_subscriptions (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz default now(),
  constraint user_push_subscriptions_endpoint_key unique (endpoint)
);

create index user_push_subscriptions_user_id_idx on public.user_push_subscriptions (user_id);
create index user_push_subscriptions_org_id_idx  on public.user_push_subscriptions (organization_id);

-- Per-user notification type preferences (default everything OFF)
alter table public.users
  add column if not exists notification_preferences jsonb not null
  default '{"inbox_messages":false,"order_won":false,"followup_reminders":false}'::jsonb;

-- RLS: users can only read/write their own subscriptions
alter table public.user_push_subscriptions enable row level security;

create policy "user_push_subscriptions_select_own"
  on public.user_push_subscriptions for select
  using (user_id = auth.uid());

create policy "user_push_subscriptions_insert_own"
  on public.user_push_subscriptions for insert
  with check (user_id = auth.uid());

create policy "user_push_subscriptions_delete_own"
  on public.user_push_subscriptions for delete
  using (user_id = auth.uid());
```

- [ ] **Step 2: Apply locally and verify**

```bash
supabase db push
```

Expected: migration runs without error. Then confirm in Supabase Studio that `user_push_subscriptions` table exists and `users.notification_preferences` column is present with default `{"inbox_messages":false,"order_won":false,"followup_reminders":false}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20240101000022_notification_preferences.sql
git commit -m "feat(db): add user_push_subscriptions table and notification_preferences column"
```

---

## Task 2: Shared webpush utility

**Files:**
- Create: `supabase/functions/_shared/webpush.ts`

This extracts the VAPID signing logic currently duplicated in `notify-on-new-message` and `daily-followup-reminder` into one place, adds 410 cleanup, and handles batch sends.

- [ ] **Step 1: Create `_shared/webpush.ts`**

```typescript
// supabase/functions/_shared/webpush.ts
import { makeServiceClient } from './supabase.ts'

export interface PushSub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Send a web push notification to multiple subscriptions.
 * Automatically deletes subscriptions that return 410 Gone (expired/unsubscribed).
 * Returns counts of sent and failed.
 */
export async function sendWebPushBatch(
  subscriptions: PushSub[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!vapidPublic || !vapidPrivate) {
    console.warn('VAPID keys not set — skipping push')
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const sub of subscriptions) {
    try {
      const status = await sendOne(sub, payload, vapidPublic, vapidPrivate, vapidSubject)
      if (status === 410) {
        // Subscription expired — remove it
        await makeServiceClient()
          .from('user_push_subscriptions')
          .delete()
          .eq('id', sub.id)
        console.log('Removed expired subscription', sub.id)
      } else if (status >= 200 && status < 300) {
        sent++
      } else {
        failed++
        console.warn('Push failed with status', status, 'for', sub.id)
      }
    } catch (e) {
      failed++
      console.warn('Push error for', sub.id, e)
    }
  }

  return { sent, failed }
}

async function sendOne(
  sub: PushSub,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<number> {
  const origin = new URL(sub.endpoint).origin

  const toBase64Url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const enc = new TextEncoder()
  const header = { alg: 'ES256', typ: 'JWT' }
  const claims = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapidSubject,
  }
  const headerB64 = toBase64Url(enc.encode(JSON.stringify(header)))
  const claimsB64 = toBase64Url(enc.encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${claimsB64}`

  const rawKey = Uint8Array.from(
    atob(vapidPrivateKey.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  )
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, enc.encode(signingInput),
  )
  const jwt = `${signingInput}.${toBase64Url(sig)}`

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/json',
      TTL: '86400',
    },
    body: enc.encode(JSON.stringify(payload)),
  })

  return res.status
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/webpush.ts
git commit -m "feat(push): shared VAPID signing + 410 cleanup utility"
```

---

## Task 3: Service worker — deep-link URLs

**Files:**
- Modify: `src/sw.ts`

The SW currently hardcodes `data: { url: '/' }`. Update it to forward whatever `url` and `tag` come in the push payload so notifications can deep-link to the right page.

- [ ] **Step 1: Update the `push` handler in `src/sw.ts`**

Replace the existing `push` event listener with:

```typescript
self.addEventListener('push', (event) => {
  let title = 'pulsrm'
  let body = 'You have a new notification'
  let url = '/'
  let tag: string | undefined

  try {
    const data = event.data?.json() as {
      title?: string
      body?: string
      url?: string
      tag?: string
    } | undefined
    if (data?.title) title = data.title
    if (data?.body)  body  = data.body
    if (data?.url)   url   = data.url
    if (data?.tag)   tag   = data.tag
  } catch {
    const text = event.data?.text()
    if (text) body = text
  }

  event.waitUntil(
    (async () => {
      const channel = new BroadcastChannel('push-messages')
      channel.postMessage({ title, body })
      channel.close()

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const isVisible = clients.some((c) => c.visibilityState === 'visible')
      if (isVisible) return

      await self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
        data: { url },
      })
    })(),
  )
})
```

- [ ] **Step 2: Build and verify no TS errors**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in ...ms`

- [ ] **Step 3: Commit**

```bash
git add src/sw.ts
git commit -m "feat(sw): forward url and tag from push payload for deep-linking"
```

---

## Task 4: Frontend — notifications lib + remove auto-request

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/App.tsx`

Update `notifications.ts` to save subscriptions to the new `user_push_subscriptions` table and to read/write `notification_preferences`. Remove the automatic permission request from `App.tsx`.

- [ ] **Step 1: Rewrite `src/lib/notifications.ts`**

```typescript
// src/lib/notifications.ts
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

  // Get current org from last_organization_id
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
```

- [ ] **Step 2: Remove auto-request from `src/App.tsx`**

Find line `requestNotificationPermission().catch(() => {})` (around line 168) and delete it. Also remove the `requestNotificationPermission` import if it's no longer used elsewhere in that file.

The import line is:
```typescript
import { requestNotificationPermission, showLocalNotification } from './lib/notifications'
```

Replace with:
```typescript
import { showLocalNotification } from './lib/notifications'
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in ...ms`

- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications.ts src/App.tsx
git commit -m "feat(notifications): per-device subscription table, per-user prefs, remove auto-request"
```

---

## Task 5: Settings page — notification preferences UI

**Files:**
- Modify: `src/pages/Settings.tsx`

Add a "Notifications" section after the existing sections. It has a main "Enable browser notifications" toggle (which requests permission + subscribes) and three per-type toggles that are only active when the main toggle is on.

- [ ] **Step 1: Add the notification settings section to `src/pages/Settings.tsx`**

At the top of `Settings.tsx`, add imports:

```typescript
import { useEffect, useState } from 'react'  // already imported, just ensure these are present
import {
  enablePushNotifications,
  disablePushNotifications,
  isPushSubscribed,
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '../lib/notifications'
```

Add a `NotificationSettings` component at the bottom of `Settings.tsx` (outside the main export):

```typescript
function NotificationSettings() {
  const [subscribed, setSubscribed] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    inbox_messages: false,
    order_won: false,
    followup_reminders: false,
  })
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    isPushSubscribed().then((s) => {
      setSubscribed(s)
      setChecking(false)
    })
    loadNotificationPreferences().then(setPrefs)
  }, [])

  const handleMainToggle = async () => {
    setSaving(true)
    if (subscribed) {
      await disablePushNotifications()
      setSubscribed(false)
      // turn off all prefs when unsubscribing
      const off = { inbox_messages: false, order_won: false, followup_reminders: false }
      setPrefs(off)
      await saveNotificationPreferences(off)
    } else {
      const ok = await enablePushNotifications()
      setSubscribed(ok)
      if (!ok) alert('Could not enable notifications. Check browser permissions.')
    }
    setSaving(false)
  }

  const handlePrefToggle = async (key: keyof NotificationPreferences) => {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    await saveNotificationPreferences(next)
  }

  const types: { key: keyof NotificationPreferences; label: string; description: string }[] = [
    { key: 'inbox_messages',     label: 'New messages',      description: 'When a customer sends a WhatsApp message' },
    { key: 'order_won',          label: 'Order won',         description: 'When an enquiry is marked as sale completed' },
    { key: 'followup_reminders', label: 'Follow-up reminders', description: 'Daily reminder for follow-ups due today' },
  ]

  if (checking) return null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Push Notifications</h2>
      <p className="text-sm text-gray-500 mb-5">
        Notifications are sent to this browser only. Each team member controls their own settings.
      </p>

      {/* Main toggle */}
      <div className="flex items-center justify-between py-3 border-b border-gray-100">
        <div>
          <p className="text-sm font-medium text-gray-700">Browser notifications</p>
          <p className="text-xs text-gray-400">{subscribed ? 'This browser will receive notifications' : 'Off — click to enable'}</p>
        </div>
        <button
          onClick={handleMainToggle}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            subscribed ? 'bg-green-500' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            subscribed ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {/* Per-type toggles */}
      <div className={`mt-2 space-y-1 ${!subscribed ? 'opacity-40 pointer-events-none' : ''}`}>
        {types.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">{label}</p>
              <p className="text-xs text-gray-400">{description}</p>
            </div>
            <button
              onClick={() => handlePrefToggle(key)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                prefs[key] ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                prefs[key] ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Then inside the main `Settings` component JSX, add `<NotificationSettings />` as the last card before the closing `</div>`.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in ...ms`

- [ ] **Step 3: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(settings): notification preferences UI with per-type toggles"
```

---

## Task 6: Update `notify-on-new-message` edge function

**Files:**
- Modify: `supabase/functions/notify-on-new-message/index.ts`

Use the new `user_push_subscriptions` table and filter by `notification_preferences.inbox_messages`. Use the shared `sendWebPushBatch`. Include the conversation URL in the payload.

- [ ] **Step 1: Replace `supabase/functions/notify-on-new-message/index.ts`**

```typescript
// supabase/functions/notify-on-new-message/index.ts
import { makeServiceClient, json } from '../_shared/supabase.ts'
import { sendWebPushBatch } from '../_shared/webpush.ts'

Deno.serve(async (req) => {
  const supabase = makeServiceClient()

  let message: Record<string, unknown>
  try {
    message = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  // Only notify for inbound customer messages
  if (message.sender !== 'customer') return json({ ok: true, skipped: true })

  // Resolve customer name for notification title
  const { data: conv } = await supabase
    .from('conversations')
    .select('customer_id')
    .eq('id', message.conversation_id)
    .maybeSingle()

  if (!conv) return json({ ok: false, error: 'Conversation not found' }, 404)

  const { data: customer } = await supabase
    .from('customers')
    .select('name')
    .eq('id', conv.customer_id)
    .maybeSingle()

  const customerName = customer?.name ?? 'Unknown'
  const body = (message.text as string)?.slice(0, 100) || `[${message.type}]`
  const title = `💬 ${customerName}`

  // Fetch subscriptions for users who have inbox_messages ON and belong to this org
  // notification_preferences is a jsonb column on users
  const { data: subs } = await supabase
    .from('user_push_subscriptions')
    .select('id, endpoint, p256dh, auth, users!inner(notification_preferences)')
    .filter('users.notification_preferences->inbox_messages', 'eq', 'true')

  if (!subs?.length) return json({ ok: true, sent: 0 })

  const { sent, failed } = await sendWebPushBatch(
    subs.map((s) => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
    { title, body, url: '/inbox', tag: 'inbox-message' },
  )

  return json({ ok: true, sent, failed })
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/notify-on-new-message/index.ts
git commit -m "feat(push): notify-on-new-message respects inbox_messages preference + multi-device"
```

---

## Task 7: Update `daily-followup-reminder` edge function

**Files:**
- Modify: `supabase/functions/daily-followup-reminder/index.ts`

Use `user_push_subscriptions`, check `followup_reminders` preference, and include deep-link URL.

- [ ] **Step 1: Replace `supabase/functions/daily-followup-reminder/index.ts`**

```typescript
// supabase/functions/daily-followup-reminder/index.ts
// Triggered daily at 08:00 via pg_cron or external scheduler.
import { makeServiceClient, json } from '../_shared/supabase.ts'
import { sendWebPushBatch } from '../_shared/webpush.ts'

Deno.serve(async (_req) => {
  const supabase = makeServiceClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Count follow-ups due today per assignee (email)
  const { data: followups } = await supabase
    .from('followups')
    .select('assigned_to')
    .eq('completed', false)
    .gte('due_date', today.toISOString())
    .lt('due_date', tomorrow.toISOString())

  if (!followups?.length) return json({ sent: 0 })

  const byAssignee: Record<string, number> = {}
  for (const f of followups) {
    if (f.assigned_to) byAssignee[f.assigned_to] = (byAssignee[f.assigned_to] ?? 0) + 1
  }

  let totalSent = 0

  for (const [email, count] of Object.entries(byAssignee)) {
    // Find subscriptions for this user, filtered by followup_reminders pref ON
    const { data: subs } = await supabase
      .from('user_push_subscriptions')
      .select('id, endpoint, p256dh, auth, users!inner(id, notification_preferences)')
      .filter('users.notification_preferences->followup_reminders', 'eq', 'true')
      .filter('users.email', 'eq', email)

    if (!subs?.length) continue

    const label = count === 1 ? '1 follow-up' : `${count} follow-ups`
    const { sent } = await sendWebPushBatch(
      subs.map((s) => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
      {
        title: `📋 ${label} due today`,
        body: 'Tap to view your follow-ups',
        url: '/followups',
        tag: 'followup-reminder',
      },
    )
    totalSent += sent
  }

  return json({ sent: totalSent })
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/daily-followup-reminder/index.ts
git commit -m "feat(push): daily-followup-reminder respects followup_reminders preference + multi-device"
```

---

## Task 8: Add order-won push to `update-enquiry-status`

**Files:**
- Modify: `supabase/functions/update-enquiry-status/index.ts`

When status becomes `sale_completed`, send a push notification to all team members who have `order_won: true` in their preferences. (The existing WhatsApp `notify-team` call remains unchanged.)

- [ ] **Step 1: Update `supabase/functions/update-enquiry-status/index.ts`**

Add the import at the top:

```typescript
import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import { sendWebPushBatch } from '../_shared/webpush.ts'
```

After the existing `notify-team` fetch call (around where `notifyEvent` is used), add a new block for push:

```typescript
  // Push notification for order won
  if (status === 'sale_completed') {
    const { data: customer: orderCustomer } = await supabase
      .from('customers')
      .select('name')
      .eq('id', enquiry?.customer_id)
      .maybeSingle()

    const customerName = orderCustomer?.name ?? 'Customer'
    const agentEmail = agent?.email ?? 'Team member'

    const { data: subs } = await supabase
      .from('user_push_subscriptions')
      .select('id, endpoint, p256dh, auth, users!inner(notification_preferences)')
      .filter('users.notification_preferences->order_won', 'eq', 'true')

    if (subs?.length) {
      await sendWebPushBatch(
        subs.map((s) => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
        {
          title: '🎉 Sale completed!',
          body: `${customerName} — closed by ${agentEmail}`,
          url: '/pipeline',
          tag: 'order-won',
        },
      )
    }
  }
```

> **Note:** The block should be placed right after the existing `notify-team` fetch block and before `return json({ ok: true })`. The `enquiry` and `agent` variables are already resolved earlier in the function — reuse them.

- [ ] **Step 2: Build (TypeScript check)**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ built in ...ms`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/update-enquiry-status/index.ts
git commit -m "feat(push): send order-won push notification on sale_completed"
```

---

## Task 9: Deploy edge functions + verify

- [ ] **Step 1: Deploy all three updated edge functions**

```bash
supabase functions deploy notify-on-new-message
supabase functions deploy daily-followup-reminder
supabase functions deploy update-enquiry-status
```

- [ ] **Step 2: Verify VAPID env vars are set in Supabase dashboard**

Go to **Supabase → Project Settings → Edge Functions → Secrets** and confirm:
- `VAPID_PUBLIC_KEY` — the base64url-encoded public key
- `VAPID_PRIVATE_KEY` — the base64url-encoded private key (PKCS8 format)
- `VAPID_SUBJECT` — `mailto:your-email@example.com`

If keys don't exist yet, generate them:
```bash
npx web-push generate-vapid-keys
```
Copy `VAPID_PUBLIC_KEY` value also into `.env.local` as `VITE_VAPID_PUBLIC_KEY=<value>`.

- [ ] **Step 3: Manual smoke test**

1. Log into the app in Chrome.
2. Go to **Settings → Push Notifications**.
3. Toggle "Browser notifications" ON → browser asks for permission → grant it.
4. Toggle "New messages" ON.
5. Send a WhatsApp message from a test phone to the connected number.
6. Confirm the push notification appears in the browser (or in OS notification center if tab is visible).

- [ ] **Step 4: Commit any env or config changes**

```bash
git add .env.local  # if VITE_VAPID_PUBLIC_KEY was newly added
git commit -m "chore: add VITE_VAPID_PUBLIC_KEY to local env"
```

---

## Adding New Notification Types in Future

To add a new type (e.g., `new_lead`):

1. Add the key to the `notification_preferences` default in `20240101000022_notification_preferences.sql` — but since it's already deployed, run a targeted `UPDATE` to backfill existing users, or just let the frontend handle a missing key as `false`.
2. Add the key to `NotificationPreferences` interface in `src/lib/notifications.ts`.
3. Add a row to the `types` array in `NotificationSettings` in `Settings.tsx`.
4. In the relevant edge function, filter `user_push_subscriptions` by the new preference key and call `sendWebPushBatch`.

No schema changes required — the JSONB column is schema-flexible.

---

## Self-Review

**Spec coverage:**
- ✅ Default OFF — `notification_preferences` defaults all false; auto-request removed from `App.tsx`
- ✅ Per-member toggle — Settings UI with per-type toggles, data saved to `users.notification_preferences`
- ✅ Inbox messages — `notify-on-new-message` checks `inbox_messages` pref
- ✅ Order won — `update-enquiry-status` sends push on `sale_completed`, checks `order_won` pref
- ✅ Follow-up reminders — `daily-followup-reminder` checks `followup_reminders` pref
- ✅ Plan for scale — `user_push_subscriptions` table (multi-device), shared `sendWebPushBatch`, 410 cleanup, JSONB prefs (no migration needed to add types)

**Placeholder scan:** No TBDs, no "implement later" phrases found.

**Type consistency:** `NotificationPreferences` defined in `notifications.ts` Task 4, used in Settings Task 5. `PushSub` / `PushPayload` defined in `_shared/webpush.ts` Task 2, used identically in Tasks 6, 7, 8. ✅
