-- 027: Поля-реквізити видаткової/акту в generated_docs
-- Раніше DocGenModal збирав ці поля, але їх не було куди зберегти →
-- при редагуванні/регенерації вони «злітали» (Рахунок №, дата рахунку, базис і адреса поставки).

alter table generated_docs add column if not exists invoice_ref       text;
alter table generated_docs add column if not exists invoice_ref_date  date;
alter table generated_docs add column if not exists delivery_basis     text;
alter table generated_docs add column if not exists delivery_address   text;
