-- 017: дзеркало згенерованих документів у таблиці documents.
-- generated_docs лишається джерелом для редагування/регенерації; documents —
-- канонічний список (Документи, картка контрагента, борги, P&L). Видалення
-- generated_doc каскадно прибирає дзеркальний рядок.
alter table documents add column if not exists generated_doc_id uuid references generated_docs(id) on delete cascade;
create index if not exists idx_documents_generated on documents(generated_doc_id);
