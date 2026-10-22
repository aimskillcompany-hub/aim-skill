-- 097: номер документа не повторюється в межах юрособи, типу й року (ТЗ редизайну 6.6, помилка 4: дубль ВН-0038) — 2026-10-23.
-- Лише для документів, які нумеруємо ми: видаткова, акт, рахунок, КП, договори, замовлення постачальнику.
-- Номери прихідних ставить постачальник — їх не перевіряємо.
-- Наявні дублі НЕ змінюються й не блокують редагування інших полів (їх видно в «Документах» чипом «номер двічі»);
-- відмова лише коли створюють новий документ із зайнятим номером або змінюють номер / тип / дату / юрособу на зайняті:
--   DOC_NUMBER_TAKEN: номер … уже є в документі цього типу за … рік.
-- Порівняння без регістру й пробілів по краях. Права й дані не змінюються. Скрипт можна запускати повторно.
begin;

create or replace function guard_doc_number_unique()
returns trigger
language plpgsql set search_path = public as $$
declare v_year int; v_taken boolean;
begin
  if new.doc_number is null or btrim(new.doc_number) = '' then return new; end if;
  if new.type is null or new.type not in ('waybill', 'serviceAct', 'invoice', 'commercialProposal', 'loanAgreement', 'supplyAgreement', 'purchaseOrder') then
    return new;
  end if;
  v_year := extract(year from coalesce(new.doc_date, new.created_at::date, current_date))::int;
  -- редагування без зміни «ключа» (номер, тип, рік, юрособа) — не перевіряємо: наявні дублі не заважають правити суму тощо
  if tg_op = 'UPDATE'
     and upper(btrim(coalesce(old.doc_number, ''))) = upper(btrim(new.doc_number))
     and old.type is not distinct from new.type
     and old.company_id is not distinct from new.company_id
     and extract(year from coalesce(old.doc_date, old.created_at::date, current_date))::int = v_year then
    return new;
  end if;
  select exists (
    select 1 from documents d
     where d.id <> new.id
       and d.type = new.type
       and d.company_id is not distinct from new.company_id
       and upper(btrim(d.doc_number)) = upper(btrim(new.doc_number))
       and extract(year from coalesce(d.doc_date, d.created_at::date, current_date))::int = v_year
  ) into v_taken;
  if v_taken then
    raise exception 'DOC_NUMBER_TAKEN: номер % уже є в документі цього типу за % рік', btrim(new.doc_number), v_year;
  end if;
  return new;
end $$;

drop trigger if exists trg_doc_number_unique on documents;
create trigger trg_doc_number_unique
  before insert or update of doc_number, type, doc_date, company_id on documents
  for each row execute function guard_doc_number_unique();

-- пошук зайнятого номера — за індексом
create index if not exists documents_number_lookup on documents (company_id, type, upper(btrim(doc_number)));

commit;
