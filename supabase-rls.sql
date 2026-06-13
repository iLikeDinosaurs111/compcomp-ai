-- Run this in Supabase → SQL Editor if competitions reads are blocked.

alter table public.competitions enable row level security;

drop policy if exists "Allow public read access on competitions" on public.competitions;

create policy "Allow public read access on competitions"
on public.competitions
for select
to anon, authenticated
using (true);

-- Writes go through Edge Functions using the service role key only.
-- Do NOT add a public INSERT policy here.
