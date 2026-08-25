-- 036_fix_handle_new_user.sql
-- Фікс «Database error creating new user» при створенні акаунта адміном.
-- Причина: тригер handle_new_user (авто-створення профілю) падав — не заданий
-- search_path, тож `insert into profiles` не знаходив таблицю в контексті auth.
-- Робимо функцію стійкою: schema-qualified + search_path + on conflict + не блокує
-- створення користувача навіть якщо профіль з якоїсь причини не створився.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;  -- не блокувати створення користувача через помилку профілю
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
