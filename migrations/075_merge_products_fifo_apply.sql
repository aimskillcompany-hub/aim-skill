-- 075: об'єднання карток товарів одним кроком + збережені оцінки для «Застосувати FIFO».
--  1) merge_products(keep, dup) — одна транзакція: рухи складу, позиції замовлень/транзакцій/збірок, збірки,
--     синоніми → keep; dup → архів. Розподіл по партіях при цьому НЕ перезапускається (рухи лише міняють
--     товар; партії й списання ті самі) — собівартість відвантажень не змінюється до «Застосувати FIFO».
--     Закритий місяць → помилка PERIOD_CLOSED, нічого не змінено.
--  2) fifo_estimate_sets — мапа оцінок, з якою застосовано FIFO (для перевірки і запуску з SQL Editor,
--     якщо з сайту не вистачить часу запиту).
-- Усі UPDATE — з конкретним WHERE; DELETE і TRUNCATE немає.
begin;

-- тригер розподілу: можна вимкнути в межах однієї транзакції (set_config('aim.skip_alloc', 'on', true))
create or replace function trg_stock_alloc() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(current_setting('aim.skip_alloc', true), '') = 'on' then return null; end if;
  perform allocate_out(new.id, new.type = 'out');
  return null;
end $$;

create or replace function merge_products(p_keep uuid, p_dup uuid)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_mov integer := 0; v_oi integer := 0; v_ti integer := 0; v_ai integer := 0; v_as integer := 0; v_al integer := 0;
begin
  if p_keep is null or p_dup is null or p_keep = p_dup then raise exception 'Оберіть два різні товари'; end if;
  if not exists (select 1 from products where id = p_keep) then raise exception 'Товар, який лишається, не знайдено'; end if;
  if not exists (select 1 from products where id = p_dup) then raise exception 'Товар-дубль не знайдено'; end if;

  perform set_config('aim.skip_alloc', 'on', true);   -- лише до кінця цієї транзакції
  update stock_movements set product_id = p_keep where product_id = p_dup;
  get diagnostics v_mov = row_count;
  perform set_config('aim.skip_alloc', 'off', true);

  update order_items set product_id = p_keep where product_id = p_dup;
  get diagnostics v_oi = row_count;
  if to_regclass('public.transaction_items') is not null then
    execute 'update transaction_items set product_id = $1 where product_id = $2' using p_keep, p_dup;
    get diagnostics v_ti = row_count;
  end if;
  if to_regclass('public.assembly_items') is not null then
    execute 'update assembly_items set product_id = $1 where product_id = $2' using p_keep, p_dup;
    get diagnostics v_ai = row_count;
  end if;
  if to_regclass('public.assemblies') is not null then
    execute 'update assemblies set result_product_id = $1 where result_product_id = $2' using p_keep, p_dup;
    get diagnostics v_as = row_count;
  end if;
  if to_regclass('public.product_aliases') is not null then
    execute 'update product_aliases set product_id = $1 where product_id = $2' using p_keep, p_dup;
    get diagnostics v_al = row_count;
  end if;
  update products set status = 'archived' where id = p_dup;

  return jsonb_build_object('movements', v_mov, 'order_items', v_oi, 'transaction_items', v_ti,
                            'assembly_items', v_ai, 'assemblies', v_as, 'aliases', v_al);
end $$;
grant execute on function merge_products(uuid, uuid) to authenticated;

create table if not exists fifo_estimate_sets (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  created_by uuid default auth.uid(),
  cost_from date not null,
  estimates jsonb not null default '{}'::jsonb,
  backup_id uuid,          -- заповнюється після застосування
  result jsonb
);
alter table fifo_estimate_sets enable row level security;
drop policy if exists fifo_estimate_sets_auth_all on fifo_estimate_sets;
create policy fifo_estimate_sets_auth_all on fifo_estimate_sets for all to authenticated using (true) with check (true);

-- застосування за збереженим набором оцінок (з сайту або з SQL Editor): select fifo_apply_set('<id>');
create or replace function fifo_apply_set(p_set uuid, p_label text default null)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare s record; v_res jsonb;
begin
  select * into s from fifo_estimate_sets where id = p_set;
  if not found then raise exception 'Набір оцінок % не знайдено', p_set; end if;
  if s.backup_id is not null then raise exception 'Цей набір уже застосовано (резервна копія %)', s.backup_id; end if;
  v_res := fifo_apply(s.cost_from, coalesce(p_label, 'FIFO з ' || s.cost_from || ' (сайт)'), s.estimates);
  update fifo_estimate_sets set backup_id = (v_res ->> 'backup_id')::uuid, result = v_res where id = p_set;
  return v_res;
end $$;
grant execute on function fifo_apply_set(uuid, text) to authenticated;

commit;
