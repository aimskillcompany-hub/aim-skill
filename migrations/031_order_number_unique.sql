-- 031_order_number_unique.sql
-- Атомна нумерація замовлень: усуває задвоєння номерів (напр. два №0039).
--
-- Причина багу: усі 5 місць створення заявки (веб-форма, копіювання, Telegram-бот,
-- API-бот, заявка з пошти) рахували номер як count(*)+1. Це ламалось двома способами:
--   (1) ВИДАЛЕННЯ будь-якого замовлення нижче максимуму → count падав → наступний
--       номер збігався з уже наявним;
--   (2) ГОНКА: одночасне створення (веб + бот + пошта) читало однаковий count →
--       два замовлення з однаковим номером.
--
-- Рішення: послідовність + атомна функція next_order_number() (nextval стійкий до
-- гонок і видалень) + унікальний індекс як тверда гарантія.

-- 1. Послідовність, синхронізована з поточним максимальним номером
create sequence if not exists orders_number_seq;
select setval(
  'orders_number_seq',
  coalesce((select max(nullif(regexp_replace(order_number, '\D', '', 'g'), '')::int) from orders), 0),
  true  -- is_called=true → наступний nextval поверне max+1
);

-- 2. Розшити наявні дублікати: найраніше замовлення в групі лишає свій номер,
--    решта отримують свіжі номери з послідовності (зверху діапазону).
do $$
declare r record;
begin
  for r in (
    select o.id
    from orders o
    where exists (
      select 1 from orders o2
      where o2.order_number = o.order_number and o2.id <> o.id
        and (o2.created_at < o.created_at
             or (o2.created_at = o.created_at and o2.id < o.id))
    )
    order by o.created_at, o.id
  ) loop
    update orders set order_number = lpad(nextval('orders_number_seq')::text, 4, '0')
    where id = r.id;
  end loop;
end $$;

-- 3. Тверда гарантія унікальності (майбутні баги не задвоять мовчки)
create unique index if not exists orders_order_number_uniq on orders (order_number);

-- 4. Атомна функція наступного номера (security definer — щоб authenticated міг
--    викликати nextval без окремого GRANT USAGE на послідовність)
create or replace function next_order_number() returns text
language sql
security definer
set search_path = public
as $$ select lpad(nextval('orders_number_seq')::text, 4, '0') $$;

grant execute on function next_order_number() to authenticated, anon, service_role;
