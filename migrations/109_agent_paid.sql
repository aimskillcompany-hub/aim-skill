-- 109: відмітка «агентські сплачено» у звіті «Прибутковість» (рішення власника 05.11.2026).
-- Накладна із замовленням — відмітка замовлення (orders.commission_paid, як у списку замовлень і звіті інвестору).
-- Накладна без замовлення — тут, в agent_commissions (один рядок на видаткову).
begin;
alter table agent_commissions add column if not exists paid boolean not null default false;
alter table agent_commissions add column if not exists paid_at date;
commit;
