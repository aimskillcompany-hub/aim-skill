-- 046: % агентської винагороди на замовленні (для звіту власника «Розрахунок»).
-- Частка від чистого прибутку (0.1 = 10%). Різна по замовленнях.
alter table orders add column if not exists agent_commission_pct numeric not null default 0;
