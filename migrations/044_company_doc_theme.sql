-- 044: тема (дизайн) документів на компанію.
-- null/порожньо → авто (aim для ЕЙМ СКІЛ, clean/лист для решти).
-- Значення: 'clean' (класичний лист), 'bit' (BIT Group, індиго), 'aim' (фірмовий зелений).
alter table companies add column if not exists doc_theme text;
