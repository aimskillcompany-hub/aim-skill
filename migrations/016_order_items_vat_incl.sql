-- 016: чи ціна продажу вже містить ПДВ.
-- true  → unit_price вже з ПДВ (товар з прайсу): без ПДВ = ціна/(1+rate/100)
-- false → unit_price без ПДВ (товар зі складу/довідника): ПДВ донараховується зверху
alter table order_items add column if not exists price_includes_vat boolean default false;
