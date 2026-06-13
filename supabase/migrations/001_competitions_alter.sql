-- Extend existing competitions table (preserves all rows).
-- Run in Supabase → SQL Editor.

alter table public.competitions
  add column if not exists age text,
  add column if not exists source text not null default 'manual';

comment on column public.competitions.source is 'manual = curated in DB, web = imported from internet search';

-- Unique link index for web dedupe (skip if duplicates exist).
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'competitions'
      and indexname = 'competitions_link_unique'
  ) then
    if (
      select count(*) from (
        select link from public.competitions
        where link is not null and trim(link) <> ''
        group by link having count(*) > 1
      ) dup
    ) = 0 then
      create unique index competitions_link_unique
        on public.competitions (link)
        where link is not null and trim(link) <> '';
    else
      raise notice 'Skipped unique index on link — duplicate links exist. Resolve duplicates then re-run.';
    end if;
  end if;
end $$;

create index if not exists competitions_source_idx on public.competitions (source);
