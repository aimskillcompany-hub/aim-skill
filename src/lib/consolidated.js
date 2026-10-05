// Зведений (консолідований) баланс по ВСІХ юрособах системи — повна картина бізнесу для інвестора.
// Рахуємо баланс кожної компанії через той самий computeSnapshot (щоб цифри збігались з Балансом
// в Аналітиці), тимчасово перемикаючи активну компанію в companyScope, і підсумовуємо.
//
// Логіка балансу однакова з BalanceView: Активи = гроші + склад + дебіторка + ОЗ;
// Пасиви = кредиторка + ПФД (чиста, знакова); Капітал = Активи − Кредиторка − ПФД.
// ПФД сумується ЧИСТОЮ → внутрішньогрупова ПФД (одна наша компанія позичила іншій) самознищується.
// УВАГА: внутрішньогрупові дебіторка/кредиторка НЕ елімінуються (показані «грос»); на Капітал це не впливає.
import { computeSnapshot } from './periodClose'
import { getActiveCompanyId, setActiveCompanyId } from './companyScope'
import { clearCompanyCache } from './companyConfig'

// КРИТИЧНО: computeSnapshot читає активну компанію з ГЛОБАЛЬНОГО скоупу (_activeCompanyId).
// Ми перемикаємо його по колу. Якщо два computeConsolidated запустяться паралельно (повторний
// useEffect на зміну companies/місяця/року), вони клобберять один одному глобальний скоуп і дані
// юросіб змішуються. Тому СЕРІАЛІЗУЄМО: кожен виклик чекає завершення попереднього.
let _lock = Promise.resolve()

export async function computeConsolidated(year, month, companies) {
  const run = async () => {
    const saved = getActiveCompanyId()
    const rows = []
    try {
      for (const c of companies) {
        setActiveCompanyId(c.id)
        clearCompanyCache()
        let s = null, error = null
        try { s = await computeSnapshot(year, month) }
        catch (e) { error = e.message }
        const cash = s?.cashBankTotal || 0
        const stock = s?.stock?.totalValue || 0
        const recv = s?.receivable || 0
        const fa = s?.fixedAssets || 0
        const pay = s?.payable || 0
        const loans = s?.loansNet || 0
        const assets = cash + stock + recv + fa
        const equity = assets - pay - loans
        rows.push({ id: c.id, name: c.short_name || c.name, cash, stock, recv, fa, assets, pay, loans, equity, error })
      }
    } finally {
      setActiveCompanyId(saved)
      clearCompanyCache()
    }
    const sum = (k) => Math.round(rows.reduce((t, r) => t + (r[k] || 0), 0) * 100) / 100
    const total = {
      cash: sum('cash'), stock: sum('stock'), recv: sum('recv'), fa: sum('fa'),
      assets: sum('assets'), pay: sum('pay'), loans: sum('loans'), equity: sum('equity'),
    }
    return { rows, total }
  }
  // Ланцюжимо за попереднім викликом (навіть якщо той впав), щоб скоуп не перетинався.
  const result = _lock.then(run, run)
  _lock = result.then(() => {}, () => {})
  return result
}
