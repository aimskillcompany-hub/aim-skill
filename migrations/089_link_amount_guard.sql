-- 089: захист прив'язок «платіж ↔ документ» від задвоєння (2026-10-22).
-- Сума прив'язок одного платежу не може перевищувати суму платежу, а сума прив'язок одного документа — суму
-- документа (допуск 1 коп.). Раніше (до виправлення в «Банку») одна оплата могла «гасити» документи на подвійну
-- суму — тоді і картка контрагента, і «Дебіторка» показують менший борг, ніж є.
-- Перевіряється лише ДОДАВАННЯ або ЗБІЛЬШЕННЯ прив'язки: зменшувати й видаляти наявні задвоєні можна завжди
-- (щоб їх виправити). Права доступу не змінюються. Наявні дані не змінюються.
begin;

create or replace function trg_link_amount_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_tx numeric; v_doc numeric; v_tx_sum numeric; v_doc_sum numeric;
begin
  if tg_op = 'UPDATE' and abs(coalesce(new.amount, 0)) <= abs(coalesce(old.amount, 0))
     and new.transaction_id is not distinct from old.transaction_id and new.document_id is not distinct from old.document_id then
    return new;   -- зменшення — завжди можна
  end if;
  select abs(coalesce(amount, 0)) into v_tx from bank_transactions where id = new.transaction_id;
  select abs(amount) into v_doc from documents where id = new.document_id;
  select coalesce(sum(abs(coalesce(amount, 0))), 0) into v_tx_sum from transaction_documents
   where transaction_id = new.transaction_id and id is distinct from new.id;
  select coalesce(sum(abs(coalesce(amount, 0))), 0) into v_doc_sum from transaction_documents
   where document_id = new.document_id and id is distinct from new.id;
  if v_tx is not null and v_tx_sum + abs(coalesce(new.amount, 0)) > v_tx + 0.01 then
    raise exception 'OVERLINK: платіж уже розподілено на % з %, вільно %', round(v_tx_sum, 2), round(v_tx, 2), round(greatest(v_tx - v_tx_sum, 0), 2);
  end if;
  if v_doc is not null and v_doc_sum + abs(coalesce(new.amount, 0)) > v_doc + 0.01 then
    raise exception 'OVERLINK: документ уже оплачено на % з %, лишилось %', round(v_doc_sum, 2), round(v_doc, 2), round(greatest(v_doc - v_doc_sum, 0), 2);
  end if;
  return new;
end $$;

drop trigger if exists trg_link_amount_guard on transaction_documents;
create trigger trg_link_amount_guard before insert or update on transaction_documents
  for each row execute function trg_link_amount_guard();

commit;
