-- 086: видалення документа однією транзакцією + попередній перегляд «що зникне» (2026-10-21, ред. 2026-10-22).
-- Документ = один рядок documents. Видаляються: його рухи складу (крім збірок), сама картка (оплати, ручні прив'язки
-- / собівартість / закриття партій / «перевірено» звірки, агентська комісія — каскадом), архівна версія в
-- generated_docs (якщо є). Посилання «дочірніх» документів на нього обнуляються (інакше — технічна помилка FK).
-- Права НЕ змінюються. Функція працює з правами того, хто викликає (security invoker), тож якщо правила доступу
-- не дозволяють видалити рухи складу (вони просто «ховають» рядки, без помилки), — відкочується ВСЕ з
-- зрозумілою причиною: документ без своїх рухів не лишається («рухи-сироти» неможливі).
-- Закритий місяць — відмова тригерів, не видаляється нічого. DELETE / UPDATE лише з конкретним WHERE; TRUNCATE немає.
begin;

create or replace function delete_document_full(p_doc uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare v_gen uuid; v_left integer; v_prev text;
begin
  select generated_doc_id into v_gen from documents where id = p_doc;
  if not found then raise exception 'Документ не знайдено або немає прав на видалення'; end if;

  delete from stock_movements where document_id = p_doc and coalesce(source, '') <> 'assembly';
  select count(*) into v_left from stock_movements where document_id = p_doc and coalesce(source, '') <> 'assembly';
  if v_left > 0 then
    raise exception 'NO_RIGHTS: недостатньо прав, щоб видалити складські рухи документа (%). Нічого не видалено — видалити може адміністратор.', v_left;
  end if;

  -- «дочірні» документи (напр. акт до рахунку): посилання на цей документ обнулити
  v_prev := coalesce(current_setting('aim.doc_backfill', true), '');
  perform set_config('aim.doc_backfill', 'on', true);   -- закритий місяць дочірнього: змінюється лише посилання, не гроші (083)
  update documents set parent_doc_id = null
   where parent_doc_id is not null and (parent_doc_id = p_doc or parent_doc_id = v_gen);
  if v_gen is not null and to_regclass('public.generated_docs') is not null then
    execute 'update generated_docs set parent_doc_id = null where parent_doc_id = $1' using v_gen;
  end if;
  perform set_config('aim.doc_backfill', v_prev, true);

  delete from documents where id = p_doc;
  if not found then raise exception 'NO_RIGHTS: документ не видалено (недостатньо прав)'; end if;
  if v_gen is not null and to_regclass('public.generated_docs') is not null then
    execute 'delete from generated_docs where id = $1' using v_gen;
  end if;
end $$;

-- Попередній перегляд (лише читання): що зникне або зміниться разом із документом
create or replace function delete_document_preview(p_doc uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb; v_gen uuid;
begin
  select generated_doc_id into v_gen from documents where id = p_doc;
  r := jsonb_build_object(
    'movements', (select count(*) from stock_movements where document_id = p_doc and coalesce(source, '') <> 'assembly'),
    'payments', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(abs(amount)), 0)) from transaction_documents where document_id = p_doc),
    -- продано з партій цієї прихідної (собівартість цих продажів перерахується)
    'sold_from_batches', (select jsonb_build_object('qty', coalesce(sum(a.qty), 0),
                                   'docs', coalesce(jsonb_agg(distinct coalesce(d.doc_number, 'б/н')) filter (where d.id is not null), '[]'::jsonb))
                            from stock_allocations a
                            join stock_movements i on i.id = a.in_movement_id and i.document_id = p_doc
                            join stock_movements o on o.id = a.out_movement_id
                            left join documents d on d.id = o.document_id
                           where coalesce(o.document_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_doc),
    'manual', (select count(*) from shipment_links where removed_at is null and (out_document_id = p_doc or in_document_id = p_doc))
              + (select count(*) from manual_costs where removed_at is null and out_document_id = p_doc)
              + (select count(*) from batch_locks where removed_at is null and in_document_id = p_doc),
    'recon_acks', (select count(*) from recon_acks where removed_at is null and out_document_id = p_doc),
    'agent_commission', (select count(*) from agent_commissions where document_id = p_doc),
    'children', (select count(*) from documents where parent_doc_id is not null and (parent_doc_id = p_doc or parent_doc_id = v_gen) and id <> p_doc));
  return r;
end $$;

revoke execute on function delete_document_full(uuid) from public;
revoke execute on function delete_document_full(uuid) from anon;
grant execute on function delete_document_full(uuid) to authenticated;
revoke execute on function delete_document_preview(uuid) from public;
revoke execute on function delete_document_preview(uuid) from anon;
grant execute on function delete_document_preview(uuid) to authenticated;

commit;
