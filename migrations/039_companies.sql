-- 039: мультикомпанійність (Фаза 0) — таблиці компаній і призначень користувачам.
-- Скоуп даних (company_id на грошових таблицях) додається окремими міграціями (040+).
-- Рівень A: окремі книги + перемикач, без консолідації/елімінації.

-- Юрособи, які ведуться в системі.
create table if not exists companies (
  id uuid default gen_random_uuid() primary key,
  name text not null,                       -- повна назва
  short_name text,                          -- коротка (для перемикача/шапки)
  edrpou text,                              -- ЄДРПОУ (ТОВ) — у ФОП порожнє
  ipn text,                                 -- ІПН / РНОКПП
  tax_group text not null default 'tov_vat',-- tov_vat | tov_single_5 | fop_group2 | fop_group3 | other
  is_vat_payer boolean not null default false,
  is_fop boolean not null default false,    -- ФОП → інші реквізити/підпис у документах
  address text,
  iban text,
  bank_name text,
  mfo text,
  phone text,
  email text,
  director text,                            -- ПІБ директора (ТОВ) або ФОП
  director_position text default 'Директор',
  sort_order int default 0,
  archived_at timestamptz,                  -- прихована з перемикача, але дані лишаються
  created_at timestamptz default now()
);

-- Які компанії доступні кожному користувачу (перемикач показує лише їх).
create table if not exists user_companies (
  user_id uuid references profiles(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, company_id)
);
create index if not exists idx_user_companies_user on user_companies (user_id);

-- RLS: узгоджено з поточною відкритою моделлю (авторизований бачить/пише).
-- Тонший замок за роллю — окрема фаза.
alter table companies enable row level security;
drop policy if exists companies_all on companies;
create policy companies_all on companies for all to authenticated using (true) with check (true);

alter table user_companies enable row level security;
drop policy if exists user_companies_all on user_companies;
create policy user_companies_all on user_companies for all to authenticated using (true) with check (true);

-- Сід: наявна компанія ЕЙМ СКІЛ (реквізити з companyConfig).
-- Фіксований id — щоб міграції 040+ ставили його дефолтом company_id для наявних даних.
insert into companies (id, name, short_name, edrpou, ipn, tax_group, is_vat_payer, is_fop,
                       address, iban, bank_name, mfo, phone, email, director, director_position, sort_order)
values ('00000000-0000-0000-0000-000000000001',
  'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "ЕЙМ СКІЛ"', 'ТОВ "ЕЙМ СКІЛ"',
  '45505924', '455059226514', 'tov_vat', true, false,
  'Україна, 04052, місто Київ, вул. Глибочицька, будинок 72, офіс 320/1',
  'UA353220010000026009700001305', 'ПУБЛІЧНЕ АКЦІОНЕРНЕ ТОВАРИСТВО "УНІВЕРСАЛ БАНК"', '322001',
  '+380737007758', 'office@aim-skill.com.ua', 'Редько Дмитро Вікторович', 'Директор', 0)
on conflict (id) do nothing;

-- Плейсхолдери двох нових юросіб (реквізити заповнюються у Налаштуваннях, Фаза 5).
insert into companies (id, name, short_name, tax_group, is_vat_payer, is_fop, director_position, sort_order)
values
  ('00000000-0000-0000-0000-000000000002', 'ФОП (2 група) - заповнити реквізити', 'ФОП 2 гр.', 'fop_group2', false, true, 'ФОП', 1),
  ('00000000-0000-0000-0000-000000000003', 'ТОВ (3 група, 5%) - заповнити реквізити', 'ТОВ 3 гр. 5%', 'tov_single_5', false, false, 'Директор', 2)
on conflict (id) do nothing;

-- Доступ: наразі всі наявні користувачі бачать усі компанії (тонше — Фаза 5).
insert into user_companies (user_id, company_id)
select p.id, c.id from profiles p cross join companies c
on conflict do nothing;
