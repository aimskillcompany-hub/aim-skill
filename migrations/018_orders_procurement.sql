-- 018: тип закупівлі замовлення — тендер чи пряма закупівля.
alter table orders add column if not exists procurement_type text default 'direct';
