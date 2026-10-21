-- 086: етап 3 об'єднання документів — видалення документа однією транзакцією (2026-10-21).
-- Документ тепер — один рядок documents. Видаляються: його рухи складу (крім збірок), сама картка (оплати —
-- каскадом), архівна версія в generated_docs (якщо була). Закритий місяць / права — не видаляється нічого.
-- DELETE лише з конкретним WHERE; TRUNCATE немає.
begin;

create or replace function delete_document_full(p_doc uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare v_gen uuid;
begin
  select generated_doc_id into v_gen from documents where id = p_doc;
  if not found then raise exception 'Документ не знайдено або немає прав на видалення'; end if;
  delete from stock_movements where document_id = p_doc and coalesce(source, '') <> 'assembly';
  delete from documents where id = p_doc;
  if v_gen is not null then delete from generated_docs where id = v_gen; end if;
end $$;
revoke execute on function delete_document_full(uuid) from public;
revoke execute on function delete_document_full(uuid) from anon;
grant execute on function delete_document_full(uuid) to authenticated;

commit;
