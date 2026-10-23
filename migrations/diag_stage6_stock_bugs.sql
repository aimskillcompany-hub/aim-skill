-- ЛИШЕ ЧИТАННЯ (нічого не змінює). Діагностика помилок складу з ТЗ редизайну 6.6:
--   8 — у вересні 2026 позиції продані за 0 ₴, а собівартість 19 009 ₴ = закупівля «Монтажного комплекту»;
--   9 — 3D-сканер і 3D-принтер одночасно продані, у залишку і мають −1.
-- Запустіть у Supabase → SQL Editor і надішліть результат (можна скріном або «Download CSV»).
with mv as (
  select m.id, m.product_id, m.type, m.quantity, m.price, m.date, m.created_at, m.document_id, m.description,
         to_jsonb(m) ->> 'source' as src, to_jsonb(m) ->> 'assembly_id' as asm, to_jsonb(m) ->> 'company_id' as co
    from stock_movements m
), bug8 as (       -- вересень 2026: продажі за 0 ₴ і все, що стосується «монтажного комплекту»
  select '8: продаж за 0 / комплект' as "розділ", mv.date as "дата", coalesce(d.doc_number, '—') as "документ", d.type as "тип док.",
         p.name as "товар", mv.type as "рух", mv.quantity as "к-сть", mv.price as "ціна", mv.src as "джерело", mv.asm as "збірка",
         mv.description as "примітка", null::numeric as "залишок після"
    from mv join products p on p.id = mv.product_id left join documents d on d.id = mv.document_id
   where (mv.type = 'out' and coalesce(mv.price, 0) = 0 and mv.date between '2026-09-01' and '2026-09-30')
      or p.name ilike '%монтаж%компл%' or p.name ilike '%компл%монтаж%'
      or mv.document_id in (select document_id from mv x join products px on px.id = x.product_id
                             where px.name ilike '%монтаж%компл%' and x.document_id is not null)
), bug9 as (       -- 3D-сканер / 3D-принтер: усі рухи по порядку і залишок після кожного
  select '9: 3D-сканер / принтер' as "розділ", mv.date, coalesce(d.doc_number, '—'), d.type, p.name, mv.type, mv.quantity, mv.price, mv.src, mv.asm, mv.description,
         sum(case when mv.type = 'in' then mv.quantity when mv.type = 'out' then -mv.quantity else mv.quantity end)
           over (partition by mv.product_id order by mv.date, mv.created_at, mv.id)
    from mv join products p on p.id = mv.product_id left join documents d on d.id = mv.document_id
   where p.name ilike '%3d%' or p.name ilike '%3-d%' or p.name ilike '%3д%'
)
select * from bug8
union all
select * from bug9
order by 1, 2, 5;
