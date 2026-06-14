# AIM SKILL — Управлінський облік

## Запуск за 10 хвилин

### Крок 1: Supabase (база даних + файли)

1. Зайдіть на https://supabase.com → **Start your project**
2. Створіть проєкт: назва `aim-skill`, регіон `Frankfurt (eu-central-1)`
3. Дочекайтесь запуску (~2 хв)
4. Йдіть в **SQL Editor** → вставте вміст файлу `supabase_schema.sql` → **Run**
5. Йдіть в **Storage** → **New bucket** → назва `documents` → **Private** → Create

Запишіть з **Settings → API**:
- `Project URL` → це VITE_SUPABASE_URL
- `anon public` key → це VITE_SUPABASE_ANON_KEY

---

### Крок 2: GitHub (сховище коду)

1. Зайдіть на https://github.com → **New repository**
2. Назвіть `aim-skill` → Create
3. Завантажте всі файли цієї папки в репозиторій

---

### Крок 3: Vercel (хостинг)

1. Зайдіть на https://vercel.com → **New Project**
2. Підключіть GitHub → оберіть `aim-skill`
3. В **Environment Variables** додайте:
   ```
   VITE_SUPABASE_URL = https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJhbGci...
   VITE_ANTHROPIC_KEY = sk-ant-...
   ```
4. **Deploy** → через 2 хв система доступна за посиланням

---

### Крок 4: Перший вхід

1. Відкрийте посилання від Vercel
2. Натисніть **Зареєструватись** → введіть email та пароль
3. Зайдіть в **Supabase → Table Editor → profiles**
4. Знайдіть свій запис → змініть `role` з `viewer` на `admin`
5. Оновіть сторінку → тепер маєте повний доступ

---

## Як запрошувати бухгалтера

1. Дайте бухгалтеру посилання на систему
2. Нехай зареєструється
3. Ви як admin → Settings → змініть роль на `accountant`

**Ролі:**
- `admin` — повний доступ, управління користувачами
- `accountant` — перегляд всього, введення операцій, завантаження документів
- `manager` — створення проєктів та операцій
- `viewer` — лише перегляд

---

## Локальна розробка

```bash
npm install
cp .env.example .env
# Заповніть .env своїми ключами
npm run dev
```

---

## Зміни через промпт

Пишіть Claude (в цьому чаті або через Claude Code):
> "Додай поле 'відповідальний менеджер' до проєкту"
> "Зроби фільтр по даті в реєстрі"
> "Додай експорт в Excel"

Claude внесе зміни в код → push до GitHub → Vercel задеплоїть автоматично.
