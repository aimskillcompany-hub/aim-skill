-- 028: результат замовлення (для тендерних/конкурсних) — виграно / програно.
-- Задається при архівуванні; null = без результату (звичайне архівування).

alter table orders add column if not exists outcome text;  -- 'won' | 'lost' | null
