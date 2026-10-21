-- 081: згенерований документ — одні дата й номер в обох таблицях (2026-10-21).
-- Згенерована видаткова / рахунок / акт зберігається у двох таблицях: generated_docs (дані для PDF) і documents
-- (реєстр: борги, склад, оплати). 077 синхронізував лише generated_docs → documents; зміна дати в картці «Документів»
-- не потрапляла в PDF (ВН-0040: картка 30.08, PDF 28.08). Тепер — в обидва боки, тригерами в базі (будь-яке місце
-- зміни: картка, редактор документа, бот). Цикл неможливий: кожен тригер оновлює лише відмінне значення.
-- UPDATE лише з конкретним WHERE; DELETE і TRUNCATE немає.
begin;

-- generated_docs → documents (077: лише дата) — тепер дата і номер
create or replace function trg_gendoc_date_sync() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (new.doc_date is not null and new.doc_date is distinct from old.doc_date)
     or (coalesce(new.doc_number, '') <> '' and new.doc_number is distinct from old.doc_number) then
    update documents
       set doc_date = coalesce(new.doc_date, doc_date),
           doc_number = case when coalesce(new.doc_number, '') <> '' then new.doc_number else doc_number end
     where generated_doc_id = new.id
       and (doc_date is distinct from coalesce(new.doc_date, doc_date)
            or (coalesce(new.doc_number, '') <> '' and doc_number is distinct from new.doc_number));
  end if;
  return null;
end $$;
drop trigger if exists trg_gendoc_date_sync on generated_docs;
create trigger trg_gendoc_date_sync after update of doc_date, doc_number on generated_docs
  for each row execute function trg_gendoc_date_sync();

-- documents → generated_docs: дата і номер картки «Документів» потрапляють у сам документ (PDF)
create or replace function trg_doc_to_gendoc_sync() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.generated_doc_id is null then return null; end if;
  if (new.doc_date is not null and new.doc_date is distinct from old.doc_date)
     or (coalesce(new.doc_number, '') <> '' and new.doc_number is distinct from old.doc_number) then
    update generated_docs
       set doc_date = coalesce(new.doc_date, doc_date),
           doc_number = case when coalesce(new.doc_number, '') <> '' then new.doc_number else doc_number end
     where id = new.generated_doc_id
       and (doc_date is distinct from coalesce(new.doc_date, doc_date)
            or (coalesce(new.doc_number, '') <> '' and doc_number is distinct from new.doc_number));
  end if;
  return null;
end $$;
drop trigger if exists trg_doc_to_gendoc_sync on documents;
create trigger trg_doc_to_gendoc_sync after update of doc_date, doc_number on documents
  for each row execute function trg_doc_to_gendoc_sync();

commit;
