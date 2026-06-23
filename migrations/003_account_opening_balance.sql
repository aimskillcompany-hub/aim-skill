-- ═══════════════════════════════════════════════════════════════════
-- Початковий залишок рахунків — щоб картка показувала реальний залишок,
-- а не лише рух коштів від першої виписки.
-- Залишок = opening_balance + сума рухів (неігнорованих) від opening_balance_date.
-- БЕЗПЕЧНО: лише ADD COLUMN. Запусти ПЕРЕД деплоєм нового коду.
-- ═══════════════════════════════════════════════════════════════════

alter table accounts add column if not exists opening_balance numeric(15,2) default 0;
alter table accounts add column if not exists opening_balance_date date;

-- (опційно) одразу задати початковий залишок ПУМБ станом на дату першої виписки.
-- Заміни 0 на реальний залишок рахунку на 2025-02-26 і розкоментуй:
-- update accounts set opening_balance = 0, opening_balance_date = '2025-02-26' where name = 'ПУМБ';
