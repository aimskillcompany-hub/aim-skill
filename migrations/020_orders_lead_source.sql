-- 020: джерело заявки (звідки контакт) + сесії Telegram-бота.
alter table orders add column if not exists lead_source text;

-- Стан діалогу бота (для покрокового створення заявки у вебхуку)
create table if not exists bot_sessions (
  telegram_id bigint primary key,
  state jsonb,
  updated_at timestamptz default now()
);
alter table bot_sessions enable row level security;
-- доступ лише service-role (бот); політик для anon/authenticated не створюємо
