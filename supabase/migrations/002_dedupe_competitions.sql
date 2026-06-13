-- Remove duplicate competition links (keeps manual rows over web, then newest id).
-- Run once in Supabase → SQL Editor if duplicate links exist.

delete from public.competitions
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by lower(trim(link))
        order by
          case when coalesce(source, 'manual') = 'manual' then 0 else 1 end,
          id desc
      ) as row_num
    from public.competitions
    where link is not null and trim(link) <> ''
  ) ranked
  where row_num > 1
);

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'competitions'
      and indexname = 'competitions_link_unique'
  ) then
    create unique index competitions_link_unique
      on public.competitions (lower(trim(link)))
      where link is not null and trim(link) <> '';
  end if;
end $$;
