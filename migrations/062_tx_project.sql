-- 062: прив'язка транзакції до проекту (для CashFlow-звіту з розбивкою по проектах).
-- Призначається транзакціям зі статтями «Виручка: товари / ПЗ» (надходження) та
-- «Закупівля товарів» (витрати), щоб у звіті бачити рух грошей у розрізі проектів.
alter table bank_transactions add column if not exists project_id uuid references finance_projects(id) on delete set null;
create index if not exists idx_bank_tx_project on bank_transactions (project_id);
