-- 012: додаткові поля прайсу — код УКТЗД (ТН ЗЕД), гарантія та її тип/термін.
alter table supplier_prices add column if not exists uktzed text;
alter table supplier_prices add column if not exists warranty text;
alter table supplier_prices add column if not exists warranty_term text;
