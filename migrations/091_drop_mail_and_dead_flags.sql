-- 091: прибирання пошти та мертвих позначок «перевірено» (2026-10-22, рішення власника: пошта не потрібна).
-- Код пошти вже видалено (коміт c2ea7b1): розділ «Пошта», «Надіслати email», api mail-sync / mail-send /
-- order-from-email, щоденний запуск синхронізації. Тут — таблиці й колонки, які більше ніхто не читає і не пише:
--   emails (листи, ~118 MB), mail_log (журнал відправлень), processed_emails (оброблені листи — не вживалась),
--   order_documents (зв'язок замовлення ↔ документ лише з листів; справжній зв'язок — documents.order_id) —
--     видаляється ЛИШЕ якщо порожня;
--   bank_transactions.is_verified — мертва (справжня позначка банку — is_validated);
--   stock_movements.is_verified — мертва.
-- НЕ видаляються:
--   • файли вкладень у сховищі (documents/email/…) — на них посилаються документи, створені з листів;
--   • documents.is_verified — живе поле (галочка «перевірено», «не звірено» в Дебіторці, закриття періоду);
--   • products.is_verified — теж мертве, але від products залежить в'юха product_stock (select p.*): видалення
--     вимагає перестворити в'юху з її правами доступу — зробимо разом з етапом 4, коли чіпатимемо в'юху.
-- Права доступу не змінюються. Документи, створені з листів, лишаються (вони в documents).
begin;

drop table if exists emails;
drop table if exists mail_log;
drop table if exists processed_emails;

do $$
begin
  if to_regclass('public.order_documents') is not null then
    if exists (select 1 from order_documents) then
      raise notice 'order_documents не порожня — лишаю';
    else
      drop table order_documents;
    end if;
  end if;
end $$;

alter table bank_transactions drop column if exists is_verified;
alter table stock_movements drop column if exists is_verified;

commit;
