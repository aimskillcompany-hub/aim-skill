-- 107: Менеджер доступів до порталів постачальників (рішення власника 27.10.2026).
-- Портал: контрагент, назва, посилання, логін, примітка. Пароль НЕ зберігається в таблиці — лише в Supabase Vault
-- (зашифровано); у supplier_portal_secrets — тільки посилання на секрет, таблиця без політик RLS (прямо її не читає ніхто).
-- Пароль видає функція portal_get_password — усім ролям, крім «перегляду» (viewer), і пише кожен перегляд у журнал.
-- Записує / змінює / видаляє пароль — portal_set_password (ті самі ролі). Видалення порталу видаляє і секрет у Vault.
begin;

create table if not exists supplier_portals (
  id uuid default gen_random_uuid() primary key,
  contractor_id uuid references contractors(id) on delete cascade,
  title text not null,
  url text not null,
  login text,
  note text,
  has_password boolean not null default false,   -- ставить лише portal_set_password
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supplier_portals_contractor on supplier_portals (contractor_id);

create table if not exists supplier_portal_secrets (
  portal_id uuid primary key references supplier_portals(id) on delete cascade,
  secret_id uuid not null
);
create table if not exists supplier_portal_log (
  id uuid default gen_random_uuid() primary key,
  portal_id uuid references supplier_portals(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  action text not null,            -- reveal | set | clear
  at timestamptz not null default now()
);

-- хто має доступ: будь-яка роль, крім «перегляду»
create or replace function portal_can() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and coalesce(role, '') <> 'viewer')
$$;
grant execute on function portal_can() to authenticated;

alter table supplier_portals enable row level security;
drop policy if exists supplier_portals_rw on supplier_portals;
create policy supplier_portals_rw on supplier_portals for all to authenticated using (portal_can()) with check (portal_can());
alter table supplier_portal_secrets enable row level security;   -- без політик: лише функції нижче
alter table supplier_portal_log enable row level security;
drop policy if exists supplier_portal_log_admin on supplier_portal_log;
create policy supplier_portal_log_admin on supplier_portal_log for select to authenticated using (is_admin());

-- has_password змінює лише функція (клієнт не може «намалювати» пароль)
create or replace function trg_portal_guard() returns trigger language plpgsql as $$
begin
  if current_setting('app.portal_fn', true) is distinct from '1' then
    new.has_password := case when tg_op = 'INSERT' then false else old.has_password end;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_portal_guard on supplier_portals;
create trigger trg_portal_guard before insert or update on supplier_portals for each row execute function trg_portal_guard();

create or replace function portal_set_password(p_portal uuid, p_password text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if not portal_can() then raise exception 'PORTAL_FORBIDDEN: немає доступу'; end if;
  if not exists (select 1 from supplier_portals where id = p_portal) then raise exception 'PORTAL_NOT_FOUND'; end if;
  select secret_id into sid from supplier_portal_secrets where portal_id = p_portal;
  perform set_config('app.portal_fn', '1', true);
  if p_password is null or p_password = '' then
    if sid is not null then
      delete from vault.secrets where id = sid;
      delete from supplier_portal_secrets where portal_id = p_portal;
    end if;
    update supplier_portals set has_password = false where id = p_portal;
    insert into supplier_portal_log (portal_id, user_id, action) values (p_portal, auth.uid(), 'clear');
  else
    if sid is null then
      sid := vault.create_secret(p_password, 'portal_' || p_portal::text, 'Пароль до порталу постачальника');
      insert into supplier_portal_secrets (portal_id, secret_id) values (p_portal, sid);
    else
      perform vault.update_secret(sid, p_password);
    end if;
    update supplier_portals set has_password = true where id = p_portal;
    insert into supplier_portal_log (portal_id, user_id, action) values (p_portal, auth.uid(), 'set');
  end if;
end $$;
grant execute on function portal_set_password(uuid, text) to authenticated;

create or replace function portal_get_password(p_portal uuid) returns text
language plpgsql security definer set search_path = public, vault as $$
declare pw text;
begin
  if not portal_can() then raise exception 'PORTAL_FORBIDDEN: немає доступу'; end if;
  select d.decrypted_secret into pw
    from supplier_portal_secrets s join vault.decrypted_secrets d on d.id = s.secret_id
   where s.portal_id = p_portal;
  insert into supplier_portal_log (portal_id, user_id, action) values (p_portal, auth.uid(), 'reveal');
  return pw;
end $$;
grant execute on function portal_get_password(uuid) to authenticated;

-- видалили портал → видалити і секрет у Vault
create or replace function trg_portal_secret_drop() returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end $$;
drop trigger if exists trg_portal_secret_drop on supplier_portal_secrets;
create trigger trg_portal_secret_drop after delete on supplier_portal_secrets for each row execute function trg_portal_secret_drop();

commit;
