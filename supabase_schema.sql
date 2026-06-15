-- ═══════════════════════════════════════════════════
-- AIM SKILL — Управлінський облік
-- Запустіть цей SQL у Supabase: SQL Editor → Run
-- ═══════════════════════════════════════════════════

-- 1. PROFILES (розширення auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  role text default 'viewer' check (role in ('admin','accountant','manager','viewer')),
  created_at timestamptz default now()
);

-- 2. PROJECTS
create table if not exists projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  status text default 'active' check (status in ('active','completed','archived')),
  budget numeric(15,2),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. TRANSACTIONS
create table if not exists transactions (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete set null,
  date date not null,
  contractor text not null,
  edrpou text,
  doc_type text,
  doc_number text,
  amount numeric(15,2) not null,
  vat_amount numeric(15,2) default 0,
  amount_no_vat numeric(15,2),
  direction text not null,
  article text,
  description text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- 4. TRANSACTION ITEMS (позиції з документів)
create table if not exists transaction_items (
  id uuid default gen_random_uuid() primary key,
  transaction_id uuid references transactions(id) on delete cascade,
  name text not null,
  quantity numeric(15,4),
  unit text,
  unit_price numeric(15,4),
  amount numeric(15,2),
  vat_rate numeric(5,2) default 20,
  created_at timestamptz default now()
);

-- 5. DOCUMENTS (файли)
create table if not exists documents (
  id uuid default gen_random_uuid() primary key,
  transaction_id uuid references transactions(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  file_name text not null,
  file_path text not null,
  file_type text,
  file_size bigint,
  doc_role text default 'incoming' check (doc_role in ('incoming','outgoing')),
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════
alter table profiles enable row level security;
alter table projects enable row level security;
alter table transactions enable row level security;
alter table transaction_items enable row level security;
alter table documents enable row level security;

-- Profiles
create policy "View own profile" on profiles for select using (auth.uid() = id);
create policy "Update own profile" on profiles for update using (auth.uid() = id);
create policy "Admin view all" on profiles for select using (
  (select role from profiles where id = auth.uid()) = 'admin'
);

-- Projects (all authenticated can view)
create policy "View projects" on projects for select to authenticated using (true);
create policy "Insert projects" on projects for insert to authenticated with check (
  (select role from profiles where id = auth.uid()) in ('admin','manager')
);
create policy "Update projects" on projects for update to authenticated using (
  (select role from profiles where id = auth.uid()) in ('admin','manager')
);

-- Transactions (all can view, accountant/admin/manager can write)
create policy "View transactions" on transactions for select to authenticated using (true);
create policy "Insert transactions" on transactions for insert to authenticated with check (
  (select role from profiles where id = auth.uid()) in ('admin','accountant','manager')
);
create policy "Update transactions" on transactions for update to authenticated using (
  (select role from profiles where id = auth.uid()) in ('admin','accountant')
);
create policy "Delete transactions" on transactions for delete to authenticated using (
  (select role from profiles where id = auth.uid()) = 'admin'
);

-- Items
create policy "View items" on transaction_items for select to authenticated using (true);
create policy "Write items" on transaction_items for insert to authenticated with check (true);
create policy "Delete items" on transaction_items for delete to authenticated using (true);

-- Documents
create policy "View documents" on documents for select to authenticated using (true);
create policy "Insert documents" on documents for insert to authenticated with check (true);
create policy "Delete documents" on documents for delete to authenticated using (
  (select role from profiles where id = auth.uid()) in ('admin','accountant')
);

-- ═══════════════════════════════════════════════════
-- TRIGGER: створити profile при реєстрації
-- ═══════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ═══════════════════════════════════════════════════
-- 6. PLANS (планування доходів/витрат)
-- ═══════════════════════════════════════════════════
create table if not exists plans (
  id uuid default gen_random_uuid() primary key,
  direction text not null,
  article text,
  project_id uuid references projects(id) on delete set null,
  amount numeric(15,2) not null,
  description text,
  planned_date date,
  is_template boolean default false,
  year_month text,
  template_from text,
  template_to text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table plans enable row level security;
create policy "View plans" on plans for select to authenticated using (true);
create policy "Insert plans" on plans for insert to authenticated with check (
  (select role from profiles where id = auth.uid()) in ('admin','accountant','manager')
);
create policy "Update plans" on plans for update to authenticated using (
  (select role from profiles where id = auth.uid()) in ('admin','accountant')
);
create policy "Delete plans" on plans for delete to authenticated using (
  (select role from profiles where id = auth.uid()) in ('admin','accountant')
);

-- ═══════════════════════════════════════════════════
-- МІГРАЦІЯ: додати planned_date якщо таблиця вже існує
-- ═══════════════════════════════════════════════════
ALTER TABLE plans ADD COLUMN IF NOT EXISTS planned_date date;

-- ═══════════════════════════════════════════════════
-- 7. CONTRACTORS (реєстр контрагентів)
-- ═══════════════════════════════════════════════════
create table if not exists contractors (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  short_name text,
  edrpou text,
  type text default 'other' check (type in ('client','supplier','other')),
  legal_form text,
  tax_system text,
  is_vat_payer boolean default false,
  vat_certificate text,
  email text,
  phone text,
  phone2 text,
  contact_person text,
  contact_position text,
  website text,
  address text,
  legal_address text,
  actual_address text,
  city text,
  region text,
  postal_code text,
  iban text,
  bank_name text,
  mfo text,
  currency text default 'UAH',
  default_article text,
  default_direction text,
  notes text,
  status text default 'active' check (status in ('active','archived')),
  total_income numeric(15,2) default 0,
  total_expense numeric(15,2) default 0,
  operations_count integer default 0,
  last_operation_date date,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table contractors enable row level security;
create policy "View contractors" on contractors for select to authenticated using (true);
create policy "Insert contractors" on contractors for insert to authenticated with check (
  (select role from profiles where id = auth.uid()) in ('admin','accountant','manager')
);
create policy "Update contractors" on contractors for update to authenticated using (
  (select role from profiles where id = auth.uid()) in ('admin','accountant','manager')
);
create policy "Delete contractors" on contractors for delete to authenticated using (
  (select role from profiles where id = auth.uid()) = 'admin'
);

-- ═══════════════════════════════════════════════════
-- INDEXES для швидкості
-- ═══════════════════════════════════════════════════
create index if not exists idx_tx_date on transactions(date desc);
create index if not exists idx_tx_project on transactions(project_id);
create index if not exists idx_tx_direction on transactions(direction);
create index if not exists idx_docs_tx on documents(transaction_id);
create index if not exists idx_docs_project on documents(project_id);
create index if not exists idx_items_tx on transaction_items(transaction_id);
