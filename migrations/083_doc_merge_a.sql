-- 083: етап 2 об'єднання документів — міграція A (лише ДОДАВАННЯ, нічого не видаляє).
--  1) Нові поля в documents для всього, що потрібно PDF: items, subtotal, gen_status, gen_bank_transaction_id,
--     parent_doc_id, contract_id, print_data (реквізити лише для друку), legacy_generated_id (старий id).
--  2) Копіювання з generated_docs у ці поля для всіх пар (documents.generated_doc_id). Поля читаються через
--     to_jsonb(g), тож міграція працює незалежно від того, які колонки є в generated_docs.
--  3) Синхронізація на перехідний період: новий / перепривʼязаний запис реєстру отримує дані згенерованого
--     (BEFORE-тригер), зміна згенерованого → у documents (разом із датою й номером, як у 081).
--  4) doc_merge_check_json() — лише читання: скільки скопійовано, чого бракує.
--  Захист закритих місяців: копіювання (крок 2) змінює лише нові поля — дозволено лише воно, лише в цій
--  транзакції (aim.doc_backfill) і лише якщо дата, сума, ПДВ, тип, напрям, контрагент, замовлення не змінюються.
-- UPDATE лише з конкретним WHERE; DELETE і TRUNCATE немає. Безпечно запускати повторно.
begin;

alter table documents add column if not exists items jsonb;
alter table documents add column if not exists subtotal numeric;
alter table documents add column if not exists gen_status text;
alter table documents add column if not exists gen_bank_transaction_id uuid;
alter table documents add column if not exists parent_doc_id uuid;
alter table documents add column if not exists contract_id uuid;
alter table documents add column if not exists print_data jsonb;
alter table documents add column if not exists legacy_generated_id uuid;
create index if not exists idx_documents_legacy_generated on documents (legacy_generated_id) where legacy_generated_id is not null;

-- items у generated_docs могли зберігатись рядком JSON — розібрати безпечно
create or replace function jsonb_parse_safe(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public as $$
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'string' then
    begin return (p #>> '{}')::jsonb; exception when others then return null; end;
  end if;
  return p;
end $$;

-- поля documents з рядка generated_docs (як jsonb, щоб не залежати від набору колонок)
create or replace function gen_doc_fields(g jsonb)
returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'items', jsonb_parse_safe(g -> 'items'),
    'subtotal', g -> 'subtotal',
    'gen_status', g -> 'status',
    'gen_bank_transaction_id', g -> 'bank_transaction_id',
    'parent_doc_id', g -> 'parent_doc_id',
    'contract_id', g -> 'contract_id',
    'print_data', jsonb_strip_nulls(jsonb_build_object(
      'contractor_name', g -> 'contractor_name', 'notes', g -> 'notes', 'contract_num', g -> 'contract_num',
      'contract_date', g -> 'contract_date', 'payment_due', g -> 'payment_due', 'city', g -> 'city',
      'invoice_ref', g -> 'invoice_ref', 'invoice_ref_date', g -> 'invoice_ref_date',
      'delivery_basis', g -> 'delivery_basis', 'delivery_address', g -> 'delivery_address')))
$$;

-- захист закритих місяців: дозволити лише копіювання полів PDF (грошові поля не змінюються)
create or replace function guard_period_by_docdate() returns trigger as $$
declare d date;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('aim.doc_backfill', true), '') = 'on'
     and new.doc_date is not distinct from old.doc_date and new.amount is not distinct from old.amount
     and new.vat_amount is not distinct from old.vat_amount and new.type is not distinct from old.type
     and new.direction is not distinct from old.direction and new.contractor_id is not distinct from old.contractor_id
     and new.order_id is not distinct from old.order_id and new.company_id is not distinct from old.company_id then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and period_is_closed(old.company_id, old.doc_date) then d := old.doc_date;
  elsif tg_op in ('INSERT', 'UPDATE') and period_is_closed(new.company_id, new.doc_date) then d := new.doc_date;
  end if;
  if d is not null then
    raise exception 'PERIOD_CLOSED: період %/% закрито. Переоткрийте його в розділі «Закриття періоду», щоб змінювати дані.',
      lpad(extract(month from d)::text, 2, '0'), extract(year from d)::int;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$ language plpgsql set search_path = public;

-- ── 2. Копіювання для наявних пар ──
select set_config('aim.doc_backfill', 'on', true);
update documents d
   set items = jsonb_parse_safe(to_jsonb(g) -> 'items'),
       subtotal = (gen_doc_fields(to_jsonb(g)) ->> 'subtotal')::numeric,
       gen_status = gen_doc_fields(to_jsonb(g)) ->> 'gen_status',
       gen_bank_transaction_id = (gen_doc_fields(to_jsonb(g)) ->> 'gen_bank_transaction_id')::uuid,
       parent_doc_id = (gen_doc_fields(to_jsonb(g)) ->> 'parent_doc_id')::uuid,
       contract_id = (gen_doc_fields(to_jsonb(g)) ->> 'contract_id')::uuid,
       print_data = gen_doc_fields(to_jsonb(g)) -> 'print_data',
       legacy_generated_id = g.id
  from generated_docs g
 where g.id = d.generated_doc_id and d.legacy_generated_id is null;
select set_config('aim.doc_backfill', 'off', true);

-- ── 3. Синхронізація на перехідний період ──
-- новий запис реєстру (або перепривʼязаний до іншого згенерованого) — одразу з даними PDF
create or replace function trg_doc_fill_from_gen() returns trigger
language plpgsql security invoker set search_path = public as $$
declare g jsonb; f jsonb;
begin
  if new.generated_doc_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.generated_doc_id is not distinct from old.generated_doc_id then return new; end if;
  select to_jsonb(x) into g from generated_docs x where x.id = new.generated_doc_id;
  if g is null then return new; end if;
  f := gen_doc_fields(g);
  new.items := f -> 'items';
  new.subtotal := (f ->> 'subtotal')::numeric;
  new.gen_status := f ->> 'gen_status';
  new.gen_bank_transaction_id := (f ->> 'gen_bank_transaction_id')::uuid;
  new.parent_doc_id := (f ->> 'parent_doc_id')::uuid;
  new.contract_id := (f ->> 'contract_id')::uuid;
  new.print_data := f -> 'print_data';
  new.legacy_generated_id := new.generated_doc_id;
  return new;
end $$;
drop trigger if exists trg_doc_fill_from_gen on documents;
create trigger trg_doc_fill_from_gen before insert or update of generated_doc_id on documents
  for each row execute function trg_doc_fill_from_gen();

-- зміна згенерованого → у documents: дата, номер (081) + поля PDF
create or replace function trg_gendoc_date_sync() returns trigger
language plpgsql security invoker set search_path = public as $$
declare f jsonb; v_prev text;
begin
  f := gen_doc_fields(to_jsonb(new));
  -- поля PDF (статус, «на підпис», реквізити) не грошові — у закритому місяці дозволено; дата / сума — ні (захист)
  v_prev := coalesce(current_setting('aim.doc_backfill', true), '');
  perform set_config('aim.doc_backfill', 'on', true);
  update documents
     set doc_date = coalesce(new.doc_date, doc_date),
         doc_number = case when coalesce(new.doc_number, '') <> '' then new.doc_number else doc_number end,
         items = f -> 'items',
         subtotal = (f ->> 'subtotal')::numeric,
         gen_status = f ->> 'gen_status',
         gen_bank_transaction_id = (f ->> 'gen_bank_transaction_id')::uuid,
         parent_doc_id = (f ->> 'parent_doc_id')::uuid,
         contract_id = (f ->> 'contract_id')::uuid,
         print_data = f -> 'print_data',
         legacy_generated_id = new.id
   where generated_doc_id = new.id
     and (doc_date is distinct from coalesce(new.doc_date, doc_date)
          or (coalesce(new.doc_number, '') <> '' and doc_number is distinct from new.doc_number)
          or items is distinct from (f -> 'items') or subtotal is distinct from (f ->> 'subtotal')::numeric
          or gen_status is distinct from (f ->> 'gen_status')
          or gen_bank_transaction_id is distinct from (f ->> 'gen_bank_transaction_id')::uuid
          or parent_doc_id is distinct from (f ->> 'parent_doc_id')::uuid or contract_id is distinct from (f ->> 'contract_id')::uuid
          or print_data is distinct from (f -> 'print_data') or legacy_generated_id is distinct from new.id);
  perform set_config('aim.doc_backfill', v_prev, true);
  return null;
end $$;
drop trigger if exists trg_gendoc_date_sync on generated_docs;
create trigger trg_gendoc_date_sync after update on generated_docs
  for each row execute function trg_gendoc_date_sync();

-- ── 4. Перевірка (лише читання) ──
create or replace function doc_merge_check_json()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'generated', (select count(*) from generated_docs),
    'pairs', (select count(*) from documents d where d.generated_doc_id is not null and exists (select 1 from generated_docs g where g.id = d.generated_doc_id)),
    'copied', (select count(*) from documents d where d.legacy_generated_id is not null),
    'not_copied', (select count(*) from documents d where d.generated_doc_id is not null and d.legacy_generated_id is null
                     and exists (select 1 from generated_docs g where g.id = d.generated_doc_id)),
    'items_missing', (select count(*) from documents d join generated_docs g on g.id = d.generated_doc_id
                       where jsonb_typeof(d.items) is distinct from 'array' and jsonb_typeof(jsonb_parse_safe(to_jsonb(g) -> 'items')) = 'array'),
    'items_differ', (select count(*) from documents d join generated_docs g on g.id = d.generated_doc_id
                      where d.items is distinct from jsonb_parse_safe(to_jsonb(g) -> 'items')),
    'orphans', (select count(*) from generated_docs g where not exists (select 1 from documents d where d.generated_doc_id = g.id)))
$$;

do $$
declare f text;
begin
  foreach f in array array['doc_merge_check_json()', 'gen_doc_fields(jsonb)', 'jsonb_parse_safe(jsonb)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
