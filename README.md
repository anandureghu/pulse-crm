# WhatsApp CRM

A full-stack WhatsApp CRM built with React + Supabase + Evolution API.

## Architecture

```
Customer WhatsApp → Evolution API (Docker/VPS)
                          ↓ HTTPS Webhook
                  Supabase Edge Functions
                    ↙              ↘
            PostgreSQL (RLS)   Supabase Storage
                    ↓
           React CRM Dashboard
```

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS v4, Zustand, React Router
- **Backend**: Supabase Auth, PostgreSQL, Edge Functions (Deno), Web Push
- **WhatsApp**: Evolution API (Docker), webhooks → Supabase Edge Functions

## Setup

### 1. Supabase project

```bash
# Install Supabase CLI
npm install -g supabase
supabase login

# Link to your project
supabase link --project-ref <your-project-ref>
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in your Supabase project values:

```bash
cp .env.example .env
```

### 3. Apply migrations

```bash
supabase db push
```

### 4. Edge Function secrets

```bash
supabase secrets set \
  EVOLUTION_API_KEY=your_key \
  EVOLUTION_API_URL=https://evo.yourdomain.com \
  EVOLUTION_INSTANCE=crm
```

For push notifications (optional):

```bash
npx web-push generate-vapid-keys
supabase secrets set \
  VAPID_PRIVATE_KEY=... \
  VAPID_PUBLIC_KEY=... \
  VAPID_SUBJECT=mailto:you@yourdomain.com
```

### 5. Deploy Edge Functions

```bash
supabase functions deploy
```

### 6. Evolution API webhook

In your Evolution API dashboard, set the webhook URL to:
```
https://<project-ref>.supabase.co/functions/v1/evolution-webhook
```

Enable events: `messages.upsert`, `messages.update`

### 7. Daily follow-up reminders (optional)

Enable `pg_cron` and add a scheduled job — see the comment at the top of
`supabase/functions/daily-followup-reminder/index.ts` for the SQL snippet.

### 8. Create first admin user

1. Create a user via Supabase Auth (Dashboard → Authentication → Users → Add user)
2. In the SQL editor, run:
   ```sql
   update public.users set role = 'admin' where email = 'your@email.com';
   ```

## Development

```bash
# Frontend
npm install
npm run dev

# Edge Functions (local)
supabase start
supabase functions serve
```

## CRM Pages

| Page | Path | Description |
|---|---|---|
| Dashboard | `/` | Stats, today's follow-ups, recent enquiries |
| Inbox | `/inbox` | WhatsApp conversation list + chat view |
| Customers | `/customers` | Searchable customer table |
| Customer 360 | `/customers/:id` | Profile, timeline, WhatsApp, notes, enquiries |
| Pipeline | `/pipeline` | Kanban board with 7 active stages |
| Follow-ups | `/followups` | Overdue, today, upcoming follow-ups |
| Calendar | `/calendar` | Monthly calendar view |
| Analytics | `/analytics` | Pipeline funnel, conversion rate, revenue |
| Settings | `/settings` | Evolution API config, WhatsApp QR connection |

## Sales Pipeline Stages

New Lead → Assigned → Contact Attempted → Interested → Follow-up Required →
Negotiation → Ready to Buy → Payment Pending → Sale Completed → After Sales → Repeat Customer

Lost branch: Not Interested / Lost / Spam / Duplicate

## Database Tables

`users` · `customers` · `enquiries` · `conversations` · `messages` ·
`notes` · `activities` · `followups` · `tags` · `settings`
