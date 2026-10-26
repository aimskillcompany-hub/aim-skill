-- 104: назва контрагента — «Товариство з обмеженою відповідальністю» → «ТОВ» (будь-який регістр).
-- Тригер скорочує назву при створенні й зміні; разове оновлення — лише рядки, де назва починається з повної форми.
-- Інші поля (ЄДРПОУ, реквізити) і документи (ocr_data) не змінюються.
begin;

create or replace function contractor_short_name(n text) returns text language sql immutable as $$
  select case when n ~ '^\s*[Тт][Оо][Вв][Аа][Рр][Ии][Сс][Тт][Вв][Оо]\s+[Зз]\s+[Оо][Бб][Мм][Ее][Жж][Ее][Нн][Оо][Юю]\s+[Вв][Іі][Дд][Пп][Оо][Вв][Іі][Дд][Аа][Лл][Ьь][Нн][Іі][Сс][Тт][Юю]\s*'
    then 'ТОВ ' || btrim(regexp_replace(n, '^\s*[Тт][Оо][Вв][Аа][Рр][Ии][Сс][Тт][Вв][Оо]\s+[Зз]\s+[Оо][Бб][Мм][Ее][Жж][Ее][Нн][Оо][Юю]\s+[Вв][Іі][Дд][Пп][Оо][Вв][Іі][Дд][Аа][Лл][Ьь][Нн][Іі][Сс][Тт][Юю]\s*', ''))
    else n end
$$;

create or replace function trg_contractor_short_name() returns trigger language plpgsql as $$
begin
  new.name := contractor_short_name(new.name);
  return new;
end $$;

drop trigger if exists trg_contractor_short_name on contractors;
create trigger trg_contractor_short_name before insert or update of name on contractors
  for each row execute function trg_contractor_short_name();

update contractors set name = contractor_short_name(name)
 where name ~ '^\s*[Тт][Оо][Вв][Аа][Рр][Ии][Сс][Тт][Вв][Оо]\s+[Зз]\s+[Оо][Бб][Мм][Ее][Жж][Ее][Нн][Оо][Юю]\s+[Вв][Іі][Дд][Пп][Оо][Вв][Іі][Дд][Аа][Лл][Ьь][Нн][Іі][Сс][Тт][Юю]\s*';

commit;
