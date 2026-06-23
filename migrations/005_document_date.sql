-- ═══════════════════════════════════════════════════════════════════
-- Дата документа. Раніше «Дата» = created_at (дата завантаження), а дата
-- з форми зберігалась лише в ocr_data → не показувалась і «не зберігалась».
-- Запусти в Supabase Dashboard → SQL Editor ПЕРЕД деплоєм коду.
-- ═══════════════════════════════════════════════════════════════════

alter table documents add column if not exists doc_date date;

-- Backfill з раніше розпізнаних (ocr_data.date), де є коректна дата
update documents
set doc_date = (ocr_data->>'date')::date
where doc_date is null
  and (ocr_data->>'date') ~ '^\d{4}-\d{2}-\d{2}$';
