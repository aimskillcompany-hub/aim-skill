-- 022: джерело прайсу постачальника (file = Excel-імпорт, brain_api = синхронізація з Brain API).
-- Потрібно, щоб відрізняти API-прайси від файлових (інша кнопка оновлення, не чіпати ручним імпортом).
begin;

alter table supplier_price_lists add column if not exists source text default 'file';

-- Існуючі рядки лишаються 'file' (default). API-синк створює/оновлює рядок із source='brain_api'.
create index if not exists idx_splists_source on supplier_price_lists(source);

commit;
