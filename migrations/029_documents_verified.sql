-- 029: перевірка документів перед закриттям періоду.
-- «Перевірено» = людина звірила скан ↔ розпізнані поля (ціни, ПДВ, рухи) і підтвердила.
-- Закриття періоду вимагатиме, щоб усі документи періоду були перевірені.

alter table documents add column if not exists is_verified  boolean default false;
alter table documents add column if not exists verified_at   timestamptz;
alter table documents add column if not exists verified_by   uuid references profiles(id) on delete set null;

create index if not exists idx_documents_verified on documents (is_verified);
