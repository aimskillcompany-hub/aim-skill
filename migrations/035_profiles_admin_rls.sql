-- 035_profiles_admin_rls.sql
-- Рольова модель: адмін має бачити всіх користувачів і змінювати їхні ролі.
-- Стара схема мала лише «update own profile» → адмін тихо не міг змінити роль іншому
-- (update зачіпав 0 рядків без помилки). Додаємо політики для адміна.
--
-- is_admin() — SECURITY DEFINER, тож внутрішній select із profiles обходить RLS
-- (без рекурсії політик на самій таблиці profiles).

create or replace function is_admin() returns boolean
language sql security definer stable
set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

grant execute on function is_admin() to authenticated;

-- Адмін бачить усі профілі (решта — лише свій)
drop policy if exists profiles_admin_select on profiles;
create policy profiles_admin_select on profiles for select
  using (is_admin() or id = auth.uid());

-- Адмін змінює будь-який профіль (роль); користувач — лише свій
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update
  using (is_admin() or id = auth.uid())
  with check (is_admin() or id = auth.uid());
