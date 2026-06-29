-- 021: збереження PDF комерційної пропозиції (для перегляду з бота).
alter table commercial_proposals add column if not exists storage_path text;
