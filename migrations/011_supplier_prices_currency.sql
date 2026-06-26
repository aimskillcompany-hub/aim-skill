-- 011: валюта + ПДВ для прайсів. Собівартість рахується в грн за курсом USD,
-- заданим при імпорті. Зберігаємо і оригінал (price_original+currency), і
-- обчислену гривню (price). Курс і ставка ПДВ фіксуються на рівні імпорту.
begin;

alter table supplier_prices add column if not exists currency text default 'UAH';
alter table supplier_prices add column if not exists price_original numeric(15,2);
alter table supplier_prices add column if not exists vat_rate numeric(5,2);

alter table supplier_price_lists add column if not exists usd_rate numeric(10,4);
alter table supplier_price_lists add column if not exists vat_rate numeric(5,2);

commit;
