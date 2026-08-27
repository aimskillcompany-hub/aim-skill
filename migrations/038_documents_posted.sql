-- 038_documents_posted.sql
-- «Проведення» документа по системі. posted=false — документ завантажений у замовлення
-- як чернетка (видно лише в замовленні, не в розділі «Документи»/картці контрагента).
-- posted=true (за замовч.) — звичайний документ, видимий у розділі «Документи».
--
-- Додавання колонки з DEFAULT true заповнює наявні рядки true (усі поточні документи
-- лишаються проведеними). Лише нові завантаження в замовлення стартують чернетками.

alter table documents add column if not exists posted boolean default true;
create index if not exists idx_documents_posted on documents (posted);
