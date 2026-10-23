// Зведений (консолідований) баланс по ВСІХ юрособах системи — повна картина бізнесу для інвестора.
// Рахуємо баланс кожної компанії через той самий computeSnapshot (щоб цифри збігались з Балансом
// в Аналітиці), тимчасово перемикаючи активну компанію в companyScope, і підсумовуємо.
//
// Логіка балансу однакова з BalanceView: Активи = гроші + склад + дебіторка + ОЗ;
// Пасиви = кредиторка + ПФД (чиста, знакова); Капітал = Активи − Кредиторка − ПФД.
// ПФД сумується ЧИСТОЮ → внутрішньогрупова ПФД (одна наша компанія позичила іншій) самознищується.
// Внутрішньогрупові дебіторка/кредиторка показані «грос»; ig — їхня частка по юрособах, щоб звіт міг їх прибрати
// (eliminateIntragroup у lib/group; капітал групи при цьому не змінюється, якщо обидві сторони обліковані однаково).
import { computeSnapshot } from './periodClose'
import { setReportScope, runExclusive } from './companyScope'
import { clearCompanyCache } from './companyConfig'
import { loadGroupContractors } from './group'


export async function computeConsolidated(year, month, companies) {
  const run = async () => {
    const rows = []
    const ig = {}   // ТЗ 6.4: частина дебіторки / кредиторки кожної юрособи перед іншими компаніями групи
    const grp = await loadGroupContractors().catch(() => null)
    try {
      for (const c of companies) {
        setReportScope(c.id)
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
        const igSum = (docs) => (docs || []).filter(d => { const g = grp?.byContractor.get(d.contractor_id); return g && g.companyId !== c.id }).reduce((t, d) => t + (Number(d.amount) || 0), 0)
        ig[c.id] = { recv: igSum(s?.receivableDocs), pay: igSum(s?.payableDocs) }
        rows.push({ id: c.id, name: c.short_name || c.name, cash, stock, recv, fa, assets, pay, loans, equity, error })
      }
    } finally {
      setReportScope(null)
      clearCompanyCache()
    }
    const sum = (k) => Math.round(rows.reduce((t, r) => t + (r[k] || 0), 0) * 100) / 100
    const total = {
      cash: sum('cash'), stock: sum('stock'), recv: sum('recv'), fa: sum('fa'),
      assets: sum('assets'), pay: sum('pay'), loans: sum('loans'), equity: sum('equity'),
    }
    return { rows, total, ig }
  }
  // Ланцюжимо за попереднім викликом (навіть якщо той впав), щоб скоуп не перетинався.
  return runExclusive(run)
}
