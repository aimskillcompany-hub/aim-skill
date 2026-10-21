-- 084: згенеровані видаткові й рахунки без запису в реєстрі → картки в documents (рішення власника 2026-10-21).
-- Створюється картка (як робить генератор: тип, номер, дата, контрагент, замовлення, сума, ПДВ, напрям «дебіторка»,
-- source 'generated', generated_doc_id) — поля PDF заповнює тригер 083. НЕ створюється, якщо:
--   • у реєстрі вже є документ того ж типу з тим самим номером і контрагентом (генератор тоді свідомо не робив
--     картку — інакше борг подвоївся б);
--   • документ у закритому місяці.
-- Інші типи (КП, договори, акти тощо) лишаються в архіві. Складські рухи для видаткових не створюються —
-- їх списання робиться з картки («Списати зі складу»), щоб ви бачили, що саме списується.
-- Результат — один jsonb: created (створені картки) і skipped (пропущені з причиною). INSERT лише; UPDATE/DELETE немає.
begin;

with orphans as (
  select g.*, to_jsonb(g) as gj
    from generated_docs g
   where not exists (select 1 from documents d where d.generated_doc_id = g.id)
     and g.doc_type in ('waybill', 'invoice')
), checked as (
  select o.*,
         exists (select 1 from documents d where d.type = o.doc_type and coalesce(d.doc_number, '') = coalesce(o.doc_number, '')
                   and d.contractor_id is not distinct from o.contractor_id
                   and d.company_id is not distinct from (o.gj ->> 'company_id')::uuid) as dup,
         period_is_closed((o.gj ->> 'company_id')::uuid, o.doc_date) as closed
    from orphans o
), ins as (
  insert into documents (company_id, type, doc_number, doc_date, contractor_id, order_id, amount, vat_amount,
                         direction, doc_role, file_name, file_path, source, generated_doc_id)
  select (c.gj ->> 'company_id')::uuid, c.doc_type, c.doc_number, c.doc_date, c.contractor_id, (c.gj ->> 'order_id')::uuid,
         c.total, c.vat_amount, 'receivable', 'outgoing',
         case c.doc_type when 'waybill' then 'Видаткова накладна' else 'Рахунок на оплату' end || '_' || coalesce(c.doc_number, '') || '.pdf',
         'generated/' || c.id || '.pdf', 'generated', c.id
    from checked c
   where not c.dup and not c.closed
  returning id, type, doc_number, doc_date, amount, generated_doc_id
)
select jsonb_build_object(
  'created', coalesce((select jsonb_agg(jsonb_build_object('number', i.doc_number, 'type', i.type, 'date', i.doc_date, 'amount', i.amount)) from ins i), '[]'::jsonb),
  'skipped', coalesce((select jsonb_agg(jsonb_build_object('number', c.doc_number, 'type', c.doc_type, 'date', c.doc_date, 'amount', c.total,
                         'reason', case when c.dup then 'у реєстрі вже є документ з таким номером і контрагентом' else 'закритий місяць' end))
                         from checked c where c.dup or c.closed), '[]'::jsonb),
  'other_types_left_in_archive', (select count(*) from generated_docs g
                                    where not exists (select 1 from documents d where d.generated_doc_id = g.id)
                                      and g.doc_type not in ('waybill', 'invoice'))
) as result;

commit;
