// Рольова модель доступу (UI-рівень). Єдине джерело правди — матриця нижче.
// Захист на рівні інтерфейсу: розділи ховаються з навігації й закриваються роутером
// за роллю. (Дані в БД лишаються відкритими авторизованим — RLS-замок це окрема фаза.)

export const ROLES = ['admin', 'accountant', 'manager', 'viewer']

export const ROLE_LABELS = {
  admin: 'Адміністратор',
  accountant: 'Бухгалтер',
  manager: 'Менеджер',
  viewer: 'Перегляд',
}

// Короткий опис ролі (для екрана Користувачі)
export const ROLE_HINTS = {
  admin: 'Повний доступ, зокрема користувачі й налаштування',
  accountant: 'Фінанси, документи, склад, аналітика, закриття періоду',
  manager: 'Замовлення, контрагенти, прайси, документи, пошта, склад',
  viewer: 'Перегляд: замовлення, контрагенти, аналітика',
}

// Ключ розділу = сегмент маршруту без «/» (напр. '/period-close' → 'period-close')
const ALL = ['orders', 'tasks', 'contractors', 'bank', 'inventory', 'prices', 'documents', 'mail', 'analytics', 'period-close', 'settings']

export const ROLE_SECTIONS = {
  admin: ALL,
  accountant: ['orders', 'tasks', 'contractors', 'bank', 'inventory', 'prices', 'documents', 'mail', 'analytics', 'period-close'],
  manager: ['orders', 'tasks', 'contractors', 'inventory', 'prices', 'documents', 'mail'],
  viewer: ['orders', 'contractors', 'analytics'],
}

const sectionsFor = (role) => ROLE_SECTIONS[role] || ROLE_SECTIONS.viewer

// Чи має роль доступ до розділу
export const canAccess = (role, section) => sectionsFor(role).includes(section)

// Перший доступний розділ (куди вести після входу / при спробі відкрити заборонене)
export const firstSection = (role) => sectionsFor(role)[0] || 'orders'

// Ключ розділу з маршруту
export const sectionFromPath = (path) => (path || '').replace(/^\//, '').split('/')[0]
