-- 045: відмітка «комісійні сплачені» на замовленні (ставиться в реєстрі замовлень).
alter table orders add column if not exists commission_paid boolean not null default false;
