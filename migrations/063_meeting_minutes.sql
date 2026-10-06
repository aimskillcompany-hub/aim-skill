-- 063: протоколи нарад (розділ «Інвестору»). Групові (не скоупляться за компанією) —
-- одна наглядова нарада по всьому бізнесу. Рішення зберігаються в jsonb-масиві.

create table if not exists meeting_minutes (
  id uuid default gen_random_uuid() primary key,
  meeting_date date not null default current_date,
  title text not null,
  participants text,            -- учасники (вільний текст)
  notes text,                   -- перебіг обговорення
  decisions jsonb default '[]', -- [{ text, owner, due, done }]
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_meeting_minutes_date on meeting_minutes (meeting_date desc);

alter table meeting_minutes enable row level security;
drop policy if exists meeting_minutes_all on meeting_minutes;
create policy meeting_minutes_all on meeting_minutes for all to authenticated using (true) with check (true);
