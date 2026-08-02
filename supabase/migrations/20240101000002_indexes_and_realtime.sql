-- Performance indexes (matching the Firestore composite indexes)

-- customers
create index idx_customers_created_at on public.customers(created_at desc);
create index idx_customers_phone on public.customers(phone);

-- enquiries
create index idx_enquiries_customer_id on public.enquiries(customer_id);
create index idx_enquiries_created_at on public.enquiries(created_at desc);
create index idx_enquiries_status on public.enquiries(status);
create index idx_enquiries_assigned_to on public.enquiries(assigned_to);

-- conversations
create index idx_conversations_customer_id on public.conversations(customer_id);
create index idx_conversations_updated_at on public.conversations(updated_at desc);

-- messages
create index idx_messages_conversation_id on public.messages(conversation_id);
create index idx_messages_timestamp on public.messages(timestamp asc);

-- notes
create index idx_notes_enquiry_id on public.notes(enquiry_id);
create index idx_notes_created_at on public.notes(created_at desc);

-- activities
create index idx_activities_enquiry_id on public.activities(enquiry_id);
create index idx_activities_created_at on public.activities(created_at desc);

-- followups
create index idx_followups_assigned_to on public.followups(assigned_to);
create index idx_followups_completed on public.followups(completed);
create index idx_followups_due_date on public.followups(due_date asc);

-- customer_files
create index idx_customer_files_customer_id on public.customer_files(customer_id);
create index idx_customer_files_created_at on public.customer_files(created_at desc);

-- call_logs
create index idx_call_logs_customer_id on public.call_logs(customer_id);
create index idx_call_logs_created_at on public.call_logs(created_at desc);

-- payments
create index idx_payments_customer_id on public.payments(customer_id);
create index idx_payments_created_at on public.payments(created_at desc);

-- Enable Realtime for all tables the frontend subscribes to
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.enquiries;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.followups;
alter publication supabase_realtime add table public.customer_files;
alter publication supabase_realtime add table public.call_logs;
alter publication supabase_realtime add table public.payments;
