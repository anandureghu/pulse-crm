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
    // Find subscriptions for this user with followup_reminders ON
    const { data: subs } = await supabase
      .from('user_push_subscriptions')
      .select('id, endpoint, p256dh, auth, users!inner(notification_preferences)')
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
