-- 085: картка-скан + її згенерована версія = один документ (2026-10-21, рішення власника).
-- РФ-0001 і ВН-0026: у реєстрі є картки (завантажені скани, без прив'язки до PDF), а їхні згенеровані версії лежали
-- окремо. Тип, номер, контрагент, дата й сума збігаються → картка прив'язується до згенерованого документа
-- (generated_doc_id); скан у картці лишається, поля PDF заповнює тригер 083. Грошові поля не змінюються.
-- Прив'язка лише за повного збігу і лише коли кандидат один (з кожного боку). UPDATE лише з конкретним WHERE.
begin;

select set_config('aim.doc_backfill', 'on', true);   -- закритий місяць: змінюється лише прив'язка, не гроші (083); діє до кінця транзакції

with cand as (
  select d.id as document_id, o.id as generated_id
    from documents d
    join generated_docs o on o.doc_type = d.type and o.doc_number = d.doc_number
                         and o.contractor_id is not distinct from d.contractor_id
                         and o.doc_date is not distinct from d.doc_date
                         and abs(coalesce(o.total, 0) - coalesce(d.amount, 0)) < 0.01
   where d.generated_doc_id is null
     and d.type in ('waybill', 'invoice')
     and not exists (select 1 from documents x where x.generated_doc_id = o.id)
), uniq as (
  select c.* from cand c
   where (select count(*) from cand c2 where c2.document_id = c.document_id) = 1
     and (select count(*) from cand c3 where c3.generated_id = c.generated_id) = 1
), upd as (
  update documents d set generated_doc_id = u.generated_id, source = coalesce(d.source, 'generated')
    from uniq u
   where d.id = u.document_id and d.generated_doc_id is null
  returning d.doc_number, d.type, d.doc_date, d.amount
)
select coalesce(jsonb_agg(jsonb_build_object('number', doc_number, 'type', type, 'date', doc_date, 'amount', amount)), '[]'::jsonb) as linked from upd;


commit;
