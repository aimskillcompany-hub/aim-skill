-- 069: безпека (аудит 2026-10-19, пункти 2, 3, 5, 6).
-- Безпечно запускати повторно. Перед запуском — нічого не потрібно; після — перевірити вхід і роботу розділів.
begin;

-- ── 1. Анонімний доступ (без входу) до даних — повністю закрити ──
-- Застосунок працює лише після входу; публічний anon-ключ (є в коді сайту) не повинен читати/писати нічого.
-- Закриває: в'юхи product_stock / contractor_balances (ціни, залишки, борги), таблиці, створені вручну
-- без RLS (bank_transactions, generated_docs, articles, …), RPC next_order_number.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
-- функції за замовчуванням виконувані для PUBLIC (тобто й для anon) — лишаємо лише авторизованим і серверу
revoke execute on all functions in schema public from public;
grant  execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant  execute on functions to authenticated, service_role;

-- ── 2. В'юхи — з правами того, хто запитує (а не власника), щоб не обходили RLS ──
alter view if exists product_stock      set (security_invoker = on);
alter view if exists contractor_balances set (security_invoker = on);

-- ── 3. RLS на таблицях, створених вручну (поза міграціями) ──
-- Вмикаємо RLS; якщо політик ще немає — додаємо «лише авторизовані», щоб застосунок працював як раніше.
do $$
declare t text;
begin
  foreach t in array array['bank_transactions','generated_docs','articles','assemblies','assembly_items','contractor_contracts','cash_transactions']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
        execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_auth_all', t);
      end if;
    end if;
  end loop;
end $$;

-- ── 4. Роль користувача змінює лише адмін ──
-- Політика update на profiles дозволяє редагувати свій рядок (ім'я тощо) — але не колонку role.
create or replace function protect_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') <> 'service_role'   -- серверні функції (create-user) з service key
     and not is_admin() then
    raise exception 'Змінювати роль може лише адміністратор';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_profile_role on profiles;
create trigger trg_protect_profile_role before update on profiles
  for each row execute function protect_profile_role();

-- Вставка профілю напряму (в обхід handle_new_user) — лише з роллю viewer, крім адміна/сервера
create or replace function protect_profile_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.role, 'viewer') <> 'viewer'
     and coalesce(auth.role(), '') <> 'service_role'
     and auth.uid() is not null and not is_admin() then
    raise exception 'Створювати профіль з роллю може лише адміністратор';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_profile_insert on profiles;
create trigger trg_protect_profile_insert before insert on profiles
  for each row execute function protect_profile_insert();

-- ── 5. Реквізити компаній (IBAN тощо) і прив'язки користувачів — змінює лише адмін ──
drop policy if exists companies_all on companies;
drop policy if exists companies_select on companies;
drop policy if exists companies_admin_write on companies;
create policy companies_select on companies for select to authenticated using (true);
create policy companies_admin_write on companies for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists user_companies_all on user_companies;
drop policy if exists user_companies_select on user_companies;
drop policy if exists user_companies_admin_write on user_companies;
create policy user_companies_select on user_companies for select to authenticated using (true);
create policy user_companies_admin_write on user_companies for all to authenticated using (is_admin()) with check (is_admin());

commit;

-- ── Перевірка після запуску (окремо, не обов'язково) ──
-- 1) Таблиці без RLS (має бути порожньо):
--    select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;
-- 2) Що лишилось доступним для anon (має бути порожньо):
--    select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';
-- 3) Політики сховища документів:
--    select policyname, roles, cmd, qual from pg_policies where schemaname = 'storage' and tablename = 'objects';
