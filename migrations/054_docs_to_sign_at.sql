-- 054: дата помітки «передано на підпис» (коли поставлено).
alter table generated_docs add column if not exists to_sign_at timestamptz;
alter table documents      add column if not exists to_sign_at timestamptz;
