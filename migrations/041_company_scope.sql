-- 041: мультикомпанійність Фаза 1 — company_id на грошові таблиці.
-- Default = ЕЙМ СКІЛ (id ...0001) → наявні рядки backfill автоматично при ADD COLUMN.
-- NOT NULL безпечний (є default). Додавання константного default — metadata-only,
-- тригери періоду не спрацьовують (не чіпають рядки).
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','bank_transactions','documents','generated_docs','orders',
    'commercial_proposals','supplier_orders','stock_movements','assemblies',
    'period_closings','tasks','emails','plans','notes'
  ]
  loop
    execute format(
      'alter table %I add column if not exists company_id uuid not null default ''00000000-0000-0000-0000-000000000001'' references companies(id)', t);
    execute format(
      'create index if not exists %I on %I (company_id)', 'idx_' || t || '_company', t);
  end loop;
end $$;
