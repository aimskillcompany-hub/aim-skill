-- ═══════════════════════════════════════════════════════════════════
-- Фікс: документи не оновлювались (не було UPDATE-політики RLS) + номер документа.
-- Запусти в Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

-- 1) UPDATE-політика для documents (була відсутня → "Розпізнати" тихо не зберігалось)
drop policy if exists "Update documents" on documents;
create policy "Update documents" on documents
  for update to authenticated using (true) with check (true);

-- 2) Номер документа
alter table documents add column if not exists doc_number text;
