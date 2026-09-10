-- 053: помітка «передано клієнту на підпис» на самому документі (у вкладці «Документи» замовлення).
alter table generated_docs add column if not exists to_sign boolean not null default false;
alter table documents      add column if not exists to_sign boolean not null default false;
