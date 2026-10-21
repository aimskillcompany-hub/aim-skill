-- 087: «Розділити картку» — виправлення помилкових об'єднань товарів (2026-10-21).
-- Обрані рухи складу (і синоніми назв) переносяться з картки на іншу наявну або нову картку.
--  • Лише «Адміністратор» / «Бухгалтер» (require_cost_editor). Закритий місяць — відмова.
--  • Рухи з ручною прив'язкою, ручною собівартістю або із закритої партії — відмова (спершу зняти).
--  • Розподіл по партіях, що поєднував перенесені й неперенесені рухи (різні товари), видаляється —
--    його збережено в журналі; собівартість (cost_price) НЕ змінюється. Нова собівартість — лише після
--    «Застосувати FIFO» (з резервною копією, після вашого підтвердження).
--  • Кожне розділення записане в cost_action_log (action 'split') і скасовується split_undo().
-- UPDATE / DELETE лише з конкретним WHERE; TRUNCATE немає.
begin;

create or replace function split_product(p_src uuid, p_movs uuid[], p_target uuid default null,
                                         p_new_name text default null, p_new_sku text default null,
                                         p_aliases text[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s record; v_target uuid; v_created boolean := false; v_movs uuid[] := coalesce(p_movs, '{}');
  v_bad int; v_alloc jsonb; v_ti text[]; v_al text[]; v_log uuid; v_moved int;
begin
  perform require_cost_editor();
  select * into s from products where id = p_src;
  if not found then raise exception 'Картку товару не знайдено'; end if;
  if cardinality(v_movs) = 0 and coalesce(cardinality(p_aliases), 0) = 0 then
    raise exception 'Оберіть рухи або синоніми, які треба перенести';
  end if;

  -- перевірки рухів
  select count(*) into v_bad from unnest(v_movs) u(id)
   where not exists (select 1 from stock_movements m where m.id = u.id and m.product_id = p_src);
  if v_bad > 0 then raise exception 'Деякі рухи не належать цій картці (%)', v_bad; end if;
  if exists (select 1 from stock_movements m where m.id = any (v_movs) and m.source = 'assembly') then
    raise exception 'Рухи збірки переносяться разом зі збіркою, а не окремо';
  end if;
  if exists (select 1 from unnest(v_movs) u(id) where movement_closed(u.id)) then
    raise exception 'PERIOD_CLOSED: серед рухів є документ закритого місяця — відкрийте період у «Закритті періоду»';
  end if;
  if exists (select 1 from shipment_links l where l.removed_at is null
               and (l.out_movement_id = any (v_movs) or l.in_movement_id = any (v_movs))) then
    raise exception 'LINKED: для деяких рухів є ручна прив''язка партії — спершу зніміть її у звірці';
  end if;
  if exists (select 1 from manual_costs c where c.removed_at is null and c.out_movement_id = any (v_movs)) then
    raise exception 'LINKED: для деяких рухів задано ручну собівартість — спершу зніміть її у звірці';
  end if;
  if exists (select 1 from batch_locks b where b.removed_at is null and b.in_movement_id = any (v_movs)) then
    raise exception 'LOCKED: серед рухів є закрита партія — спершу відкрийте її';
  end if;

  -- куди переносити
  if p_target is not null then
    if p_target = p_src then raise exception 'Оберіть іншу картку'; end if;
    perform 1 from products where id = p_target;
    if not found then raise exception 'Картку, на яку переносимо, не знайдено'; end if;
    v_target := p_target;
    update products set status = 'active' where id = v_target and status = 'archived';
  else
    if coalesce(trim(p_new_name), '') = '' then raise exception 'Вкажіть назву нової картки'; end if;
    v_target := gen_random_uuid();
    -- нова картка — копія налаштувань вихідної (одиниця, тип, категорія, компанія), з новою назвою й артикулом
    insert into products
    select (jsonb_populate_record(null::products, to_jsonb(s) - 'created_at' - 'is_verified' - 'buy_price' - 'current_stock'
             || jsonb_build_object('id', v_target, 'name', trim(p_new_name), 'sku', nullif(trim(coalesce(p_new_sku, '')), ''),
                                   'status', 'active'))).*;
    v_created := true;
  end if;

  -- розподіл по партіях між перенесеними й неперенесеними рухами — це вже різні товари
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_alloc from stock_allocations a
   where (a.out_movement_id = any (v_movs)) <> (a.in_movement_id = any (v_movs));
  delete from stock_allocations a
   where (a.out_movement_id = any (v_movs)) <> (a.in_movement_id = any (v_movs));

  perform set_config('aim.skip_alloc', 'on', true);   -- розподіл не перезапускаємо (собівартість не змінюється)
  update stock_movements set product_id = v_target where id = any (v_movs) and product_id = p_src;
  get diagnostics v_moved = row_count;
  perform set_config('aim.skip_alloc', 'off', true);

  -- позиції банківських / первинних документів, з яких створено ці рухи
  if to_regclass('public.transaction_items') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'transaction_item_id') then
    execute 'with u as (update transaction_items t set product_id = $1
                          where t.product_id = $2 and t.id in (select m.transaction_item_id from stock_movements m where m.id = any ($3))
                        returning t.id) select array_agg(id::text) from u'
      into v_ti using v_target, p_src, v_movs;
  end if;

  -- синоніми назв: щоб майбутній імпорт підставляв правильну картку
  if coalesce(cardinality(p_aliases), 0) > 0 and to_regclass('public.product_aliases') is not null then
    execute 'with u as (update product_aliases set product_id = $1
                          where product_id = $2 and alias = any ($3) returning id) select array_agg(id::text) from u'
      into v_al using v_target, p_src, p_aliases;
  end if;

  insert into cost_action_log (action, document_id, line, before, after)
  values ('split', null, p_src::text,
          jsonb_build_object('src', jsonb_build_object('id', s.id, 'name', s.name, 'sku', s.sku),
                             'target', v_target, 'created', v_created, 'allocations', v_alloc),
          jsonb_build_object('stock_movements', to_jsonb(v_movs::text[]), 'transaction_items', to_jsonb(v_ti), 'product_aliases', to_jsonb(v_al)))
  returning id into v_log;

  return jsonb_build_object('log_id', v_log, 'target', v_target, 'created', v_created, 'movements', v_moved,
                            'aliases', coalesce(cardinality(v_al), 0), 'allocations_removed', jsonb_array_length(v_alloc));
end $$;

-- скасування розділення — повертає саме те, що було перенесено, і відновлює видалений розподіл
create or replace function split_undo(p_log uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare g record; v_src uuid; v_target uuid; a jsonb; v_movs uuid[];
begin
  perform require_cost_editor();
  select * into g from cost_action_log where id = p_log and action = 'split';
  if not found then raise exception 'Запис розділення не знайдено'; end if;
  if exists (select 1 from cost_action_log where action = 'split_undo' and (before ->> 'split_log') = p_log::text) then
    raise exception 'Це розділення вже скасовано';
  end if;
  v_src := (g.before -> 'src' ->> 'id')::uuid; v_target := (g.before ->> 'target')::uuid; a := g.after;
  v_movs := jsonb_text_list(a -> 'stock_movements')::uuid[];
  if exists (select 1 from unnest(v_movs) u(id) where movement_closed(u.id)) then
    raise exception 'PERIOD_CLOSED: серед рухів є документ закритого місяця';
  end if;

  perform set_config('aim.skip_alloc', 'on', true);
  update stock_movements set product_id = v_src where product_id = v_target and id = any (v_movs);
  perform set_config('aim.skip_alloc', 'off', true);
  if to_regclass('public.transaction_items') is not null then
    execute 'update transaction_items set product_id = $1 where product_id = $2 and id::text = any (jsonb_text_list($3))'
      using v_src, v_target, a -> 'transaction_items';
  end if;
  if to_regclass('public.product_aliases') is not null then
    execute 'update product_aliases set product_id = $1 where product_id = $2 and id::text = any (jsonb_text_list($3))'
      using v_src, v_target, a -> 'product_aliases';
  end if;
  -- відновити розподіл, якщо обидва рухи ще існують і такого рядка немає
  insert into stock_allocations
  select r.* from jsonb_populate_recordset(null::stock_allocations, coalesce(g.before -> 'allocations', '[]'::jsonb)) r
   where exists (select 1 from stock_movements m where m.id = r.out_movement_id)
     and exists (select 1 from stock_movements m where m.id = r.in_movement_id)
     and not exists (select 1 from stock_allocations x where x.id = r.id);
  -- створену розділенням картку архівувати, якщо на ній більше нічого немає
  if (g.before ->> 'created')::boolean then
    update products set status = 'archived'
     where id = v_target and not exists (select 1 from stock_movements m where m.product_id = v_target);
  end if;
  insert into cost_action_log (action, document_id, line, before, after)
  values ('split_undo', null, v_src::text, jsonb_build_object('split_log', p_log), g.after);
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['split_product(uuid, uuid[], uuid, text, text, text[])', 'split_undo(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
