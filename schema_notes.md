# AiM Skill — Аналіз схеми бази даних

## Загальна статистика
- **18 таблиць** у public schema
- **6 груп:** Система, Контрагенти, Фінанси, Документи, Склад, Проєкти
- **1 VIEW:** `product_stock` (обчислюваний залишок)

---

## 1. ЗАСТАРІЛІ ТАБЛИЦІ / ПОЛЯ

### Таблиця `transactions` — ЗАСТАРІЛА
**Статус:** Не використовується в UI. Замінена на `bank_transactions`.
**Рекомендація:** Не видаляти поки є FK з `documents.transaction_id` та `transaction_items.transaction_id`. Поступово мігрувати залишки.
**Залежності:**
- `documents.transaction_id` → можна замінити на `documents.bank_transaction_id` (вже є)
- `transaction_items.transaction_id` → більшість записів вже мають `bank_transaction_id`
- `bank_transactions.matched_transaction_id` → можна видалити

### Поле `products.current_stock` — ЗАСТАРІЛЕ
**Статус:** Не використовується. Реальний залишок обчислюється через VIEW `product_stock.computed_stock` з `stock_movements`.
**Рекомендація:** Видалити колонку після верифікації.

---

## 2. ДУБЛЮВАННЯ ДАНИХ

### 2.1 Контрагент як текст замість FK

| Таблиця | Поле | Дублює | Рекомендація |
|---------|------|--------|-------------|
| `bank_transactions.counterparty` | text | `contractors.name` | ЗАЛИШИТИ — потрібен для імпорту банківських виписок де немає contractor_id |
| `bank_transactions.edrpou` | text | `contractors.edrpou` | ЗАЛИШИТИ — для матчінгу при імпорті |
| `cash_transactions.counterparty` | text | `contractors.name` | ЗАЛИШИТИ — аналогічно |
| `projects.contractor` | text | `contractors.name` | ЗАМІНИТИ на FK `contractor_id` |
| `projects.edrpou` | text | `contractors.edrpou` | ВИДАЛИТИ після додавання FK |
| `plans.contractor` | text | `contractors.name` | ЗАМІНИТИ на FK `contractor_id` |
| `generated_docs.contractor_name` | text | `contractors.name` | ЗАЛИШИТИ — для швидкого відображення без JOIN |

### 2.2 Стаття як текст замість FK

| Таблиця | Поле | Дублює | Рекомендація |
|---------|------|--------|-------------|
| `bank_transactions.article` | text | `articles.name` | ЗАЛИШИТИ — articles змінюються рідко, текст зручніше |
| `cash_transactions.article` | text | `articles.name` | ЗАЛИШИТИ |
| `transactions.article` | text | `articles.name` | ЗАСТАРІЛЕ — таблиця не використовується |
| `plans.article` | text | `articles.name` | ЗАЛИШИТИ |
| `contractors.default_article` | text | `articles.name` | ЗАЛИШИТИ |

### 2.3 Адреса як два поля

| Таблиця | Поля | Рекомендація |
|---------|------|-------------|
| `contractors` | `address` + `legal_address` | `address` = дублікат `legal_address`. ВИДАЛИТИ `address`, залишити `legal_address` |

### 2.4 Контактна особа — старі поля vs нова таблиця

| Таблиця | Поля | Рекомендація |
|---------|------|-------------|
| `contractors` | `contact_person`, `contact_position` | ЗАСТАРІЛЕ — замінити на `contractor_contacts` з `is_signer=true` |
| `contractors` | `director`, `director_position` | ЗАСТАРІЛЕ — замінити на `contractor_contacts` з `is_signer=true` |

### 2.5 Договір в generated_docs як текст

| Таблиця | Поля | Рекомендація |
|---------|------|-------------|
| `generated_docs` | `contract_num`, `contract_date` | ЗАМІНИТИ на FK `contract_id → contractor_contracts.id` |

---

## 3. ВІДСУТНІ FK (enforced в коді, не в БД)

| Таблиця | Поле | Має посилатись на | Рекомендація |
|---------|------|-------------------|-------------|
| `transaction_items.product_id` | uuid | `products.id` | ДОДАТИ FK |
| `contractors.default_article` | text | `articles.name` | ЗАЛИШИТИ текст (зручніше) |

---

## 4. РЕКОМЕНДАЦІЇ ПО ОПТИМІЗАЦІЇ

### Фаза 1 — Безпечні зміни (не ламають код)
1. Додати FK `transaction_items.product_id → products.id`
2. Додати FK `generated_docs.contract_id → contractor_contracts.id` (нова колонка)
3. Видалити `products.current_stock` (не використовується)
4. Додати індекси:
   - `bank_transactions(edrpou)` — для пошуку по ЄДРПОУ
   - `bank_transactions(contractor_id)` — для JOIN
   - `stock_movements(product_id, type)` — для розрахунку залишків
   - `generated_docs(contractor_id)` — для списку документів
   - `contractor_contacts(contractor_id)` — для списку контактів

### Фаза 2 — Міграція (потребує зміни коду)
1. `projects.contractor/edrpou` → додати `projects.contractor_id` FK
2. `plans.contractor` → додати `plans.contractor_id` FK
3. `contractors.address` → видалити, використовувати `legal_address`
4. `contractors.contact_person/contact_position` → видалити, використовувати `contractor_contacts`
5. `contractors.director/director_position` → видалити, використовувати `contractor_contacts`

### Фаза 3 — Видалення застарілого (після повної міграції)
1. Видалити таблицю `transactions` (після міграції всіх FK)
2. Видалити `bank_transactions.matched_transaction_id`
3. Видалити `documents.transaction_id`
4. Видалити `transaction_items.transaction_id`

---

## 5. VIEWS

### `product_stock` (існує)
```sql
-- Обчислюваний залишок з stock_movements
SELECT p.*, 
  COALESCE(SUM(CASE WHEN sm.type='in' THEN sm.quantity ELSE -sm.quantity END), 0) as computed_stock
FROM products p
LEFT JOIN stock_movements sm ON sm.product_id = p.id
GROUP BY p.id
```

---

## 6. АРХІТЕКТУРНІ НОТАТКИ

### bank_transactions як джерело правди
- Основна таблиця фінансів. Імпорт з банківських виписок.
- `direction` (не `amount > 0`) визначає тип операції.
- `counterparty` + `edrpou` — текстові поля з виписки, матчаться з `contractors`.

### FIFO собівартість
- Розраховується на льоту через `getFifoCost()` в stockService.js.
- Зберігається в `stock_movements.cost_price` для OUT рухів.
- `backfillCostPrices()` — масовий перерахунок.

### AI інтеграція
- Claude API для розпізнавання документів (PDF/фото → JSON).
- Claude API для розпізнавання реквізитів компанії (текст → JSON).
- Fuzzy matching продуктів через `product_aliases.normalized`.

### Генерація документів
- `generated_docs` — самостійна сутність (передує оплаті).
- `parent_doc_id` — ланцюжок: рахунок → видаткова/акт.
- `stockEffect` в коді: `in` для прихідних (авто), `out` для видаткових (з підтвердженням).
