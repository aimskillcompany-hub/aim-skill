-- 051: дозволити порожню дату документа (генерація «Без дати» — вписується вручну).
alter table generated_docs alter column doc_date drop not null;
alter table documents      alter column doc_date drop not null;
