-- 024: збереження файлу витягу з ЄДР у профілі контрагента.
begin;

alter table contractors add column if not exists edr_extract_path text; -- шлях у Storage (bucket documents)
alter table contractors add column if not exists edr_extract_name text; -- оригінальна назва файлу

commit;
