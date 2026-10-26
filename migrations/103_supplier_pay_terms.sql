-- 103: умови оплати постачальнику окремо для кожного замовлення й кожного постачальника в ньому (завдання власника 26.10.2026).
--
-- order_payment_plan (067) уже має рядки kind='supplier' з supplier_id і plan_date — один рядок на постачальника.
-- Додаємо:
--   part_no    — номер частини оплати (1, 2, …): кілька рядків на одного постачальника = оплата частинами;
--   share_pct  — частка суми закупки цього постачальника, % (null = уся сума; разом частини мають давати 100%);
--   base_date  — дата отримання товару від постачальника (від неї рахуються дні; null — загальна дата відвантаження);
--   is_manual  — plan_date вписано вручну (клік по даті картки) і більше не перераховується.
--   days       — уже є (067): платимо через N днів від відвантаження / отримання; від'ємне — передоплата.
-- order_items.pay_days — (опційно) відстрочка для окремої позиції; пріоритет: позиція → постачальник у замовленні → картка постачальника.
-- Зворотна: лише нові колонки з безпечними значеннями; наявні рядки = одна частина 100%, як і раніше.
begin;

alter table order_payment_plan add column if not exists part_no smallint not null default 1;
alter table order_payment_plan add column if not exists share_pct numeric(7,4);
alter table order_payment_plan add column if not exists base_date date;
alter table order_payment_plan add column if not exists is_manual boolean not null default false;

alter table order_payment_plan drop constraint if exists order_payment_plan_share_chk;
alter table order_payment_plan add constraint order_payment_plan_share_chk check (share_pct is null or (share_pct > 0 and share_pct <= 100));
alter table order_payment_plan drop constraint if exists order_payment_plan_days_chk;
alter table order_payment_plan add constraint order_payment_plan_days_chk check (days is null or days between -366 and 366);
alter table order_payment_plan drop constraint if exists order_payment_plan_part_chk;
alter table order_payment_plan add constraint order_payment_plan_part_chk check (part_no between 1 and 12);

alter table order_items add column if not exists pay_days integer;
alter table order_items drop constraint if exists order_items_pay_days_chk;
alter table order_items add constraint order_items_pay_days_chk check (pay_days is null or pay_days between -366 and 366);

commit;

-- Відкат (за потреби):
-- alter table order_items drop column if exists pay_days;
-- alter table order_payment_plan drop column if exists is_manual, drop column if exists base_date, drop column if exists share_pct, drop column if exists part_no;
