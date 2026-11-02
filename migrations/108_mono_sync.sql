-- 108: Автоматична виписка monobank (корпоративний API corp-api.monobank.ua) — рішення власника 02.11.2026.
-- Токен API — лише на сервері (app_secrets, ключ 'mono_token:<company_id>'), у браузер не потрапляє.
-- Рахунки зіставляються за IBAN (accounts.iban). Синхронізація: pg_cron щогодини викликає /api/mono-sync
-- (токен виклику — app_secrets 'mono_sync'), або кнопка «Синхронізувати зараз» (адмін / бухгалтер).
-- Нові операції потрапляють у «Банк» непідтвердженими — як після імпорту файлу.
begin;

alter table accounts add column if not exists iban text;
alter table accounts add column if not exists mono_synced_at timestamptz;

create table if not exists bank_sync_log (
  id uuid default gen_random_uuid() primary key,
  company_id uuid,
  account_id uuid references accounts(id) on delete set null,
  source text not null default 'monobank',
  at timestamptz not null default now(),
  added integer not null default 0,
  skipped integer not null default 0,
  error text
);
create index if not exists idx_bank_sync_log_at on bank_sync_log (at desc);
alter table bank_sync_log enable row level security;
drop policy if exists bank_sync_log_read on bank_sync_log;
create policy bank_sync_log_read on bank_sync_log for select to authenticated using (true);

-- токен виклику для pg_cron → /api/mono-sync
insert into app_secrets (key, value) values ('mono_sync', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;

-- записати / прибрати токен monobank для юрособи — лише адмін або бухгалтер
create or replace function set_mono_token(p_company uuid, p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'accountant')) then
    raise exception 'MONO_FORBIDDEN: лише адміністратор або бухгалтер';
  end if;
  if p_company is null then raise exception 'Не вказано юрособу'; end if;
  if p_token is null or btrim(p_token) = '' then
    delete from app_secrets where key = 'mono_token:' || p_company::text;
  else
    insert into app_secrets (key, value) values ('mono_token:' || p_company::text, btrim(p_token))
    on conflict (key) do update set value = excluded.value;
  end if;
end $$;
grant execute on function set_mono_token(uuid, text) to authenticated;

-- чи задано токен (сам токен не повертається)
create or replace function mono_token_set(p_company uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from app_secrets where key = 'mono_token:' || p_company::text)
$$;
grant execute on function mono_token_set(uuid) to authenticated;

-- щогодини о :07 — лише якщо хоч одна юрособа має токен
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'aim_mono_sync';
select cron.schedule('aim_mono_sync', '7 * * * *', $cron$
  select net.http_post(
           url := 'https://aim-skill.vercel.app/api/mono-sync',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select value from app_secrets where key = 'mono_sync')),
           body := '{}'::jsonb,
           timeout_milliseconds := 60000)
   where exists (select 1 from app_secrets where key like 'mono_token:%');
$cron$);

commit;
