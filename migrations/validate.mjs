// Валідація цілісності після застосування 001_phase1_schema.sql
// Запуск:  node migrations/validate.mjs
// Використовує service-role ключ (читання, обхід RLS).

// Запуск:  SUPABASE_SERVICE_KEY=<service-role-key> node migrations/validate.mjs
const URL = process.env.SUPABASE_URL || "https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("Встанови SUPABASE_SERVICE_KEY=... перед запуском (service-role ключ із Supabase Dashboard)."); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const count = async (t, qs = "") => {
  const r = await fetch(`${URL}/rest/v1/${t}?select=id${qs ? "&" + qs : ""}`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, n: Number((r.headers.get("content-range") || "/0").split("/")[1]) };
};
const rows = async (t, qs = "") => {
  const r = await fetch(`${URL}/rest/v1/${t}?${qs}`, { headers: H });
  return r.ok ? r.json() : [];
};

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };

console.log("\n═══ ВАЛІДАЦІЯ ФАЗИ 1 ═══\n");

// Очікувані лічильники наявних даних (не мають зменшитись)
const baseline = {
  contractors: 102, products: 298, product_aliases: 610, documents: 159,
  bank_transactions: 476, transaction_items: 385, stock_movements: 371,
  assemblies: 4, assembly_items: 17, plans: 15, generated_docs: 5,
  articles: 34, projects: 22,
};

console.log("1. Наявні дані збережені (>= baseline):");
for (const [t, base] of Object.entries(baseline)) {
  const c = await count(t);
  if (!c.ok) { bad(`${t}: HTTP ${c.status}`); continue; }
  if (c.n >= base) ok(`${t}: ${c.n} (baseline ${base})`);
  else bad(`${t}: ${c.n} < baseline ${base} — ВТРАТА ДАНИХ!`);
}

console.log("\n2. Нові таблиці існують:");
for (const t of ["accounts","orders","commercial_proposals","supplier_orders",
  "supplier_order_items","order_documents","transaction_documents","notes"]) {
  const c = await count(t);
  c.ok ? ok(`${t} (${c.n})`) : bad(`${t}: HTTP ${c.status} — НЕ СТВОРЕНА`);
}

console.log("\n3. Рахунки засіяні:");
const accs = await rows("accounts", "select=name,type&order=sort_order");
const names = accs.map(a => a.name);
for (const want of ["ПУМБ","Monobank","Готівка"])
  names.includes(want) ? ok(`рахунок «${want}»`) : bad(`немає рахунку «${want}»`);

console.log("\n4. Backfill bank_transactions:");
const total = (await count("bank_transactions")).n;
const withAcc = (await count("bank_transactions", "account_id=not.is.null")).n;
const withArt = (await count("bank_transactions", "article_id=not.is.null")).n;
withAcc === total ? ok(`account_id: ${withAcc}/${total}`)
  : bad(`account_id: ${withAcc}/${total} — ${total-withAcc} без рахунку`);
ok(`article_id: ${withArt}/${total} (${Math.round(withArt/total*100)}% збіг по назві статті)`);

console.log("\n5. Прапорці контрагентів:");
const cl = (await count("contractors","is_client=eq.true")).n;
const sp = (await count("contractors","is_supplier=eq.true")).n;
ok(`is_client=${cl}, is_supplier=${sp}`);

console.log("\n6. View боргів (contractor_balances) працює — топ-5 за оборотом:");
const bal = await rows("contractor_balances",
  "select=name,documents_total,transactions_total,balance&order=transactions_total.desc&limit=5");
if (bal.length) {
  ok("view відповідає");
  for (const b of bal)
    console.log(`     ${(b.name||"").slice(0,32).padEnd(33)} док:${b.documents_total} тр:${b.transactions_total} баланс:${b.balance}`);
  console.log("     ⓘ documents_total≈0 поки суми документів не заповнені (cutover/Aging) — очікувано.");
} else bad("view contractor_balances не повертає даних");

console.log("\n7. product_stock view працює:");
const ps = await rows("product_stock","select=name,computed_stock&order=computed_stock.desc&limit=3");
ps.length ? ok(`приклад залишків: ${ps.map(p=>`${(p.name||"").slice(0,18)}=${p.computed_stock}`).join(", ")}`)
          : bad("product_stock порожній");

console.log(`\n═══ ПІДСУМОК: ${pass} ✓ / ${fail} ✗ ═══\n`);
process.exit(fail ? 1 : 0);
