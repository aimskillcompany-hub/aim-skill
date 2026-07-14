// Зонд стану "⏳ запустити вручну" міграцій — перевіряє наявність колонок/таблиць.
// Запуск: SUPABASE_SERVICE_KEY=... node migrations/probe.mjs
const URL = process.env.SUPABASE_URL || "https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("Встанови SUPABASE_SERVICE_KEY=..."); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// перевірка колонки: select=col → 200 ок; 400/42703 = нема колонки; 404 = нема таблиці
async function col(table, column) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=${column}&limit=1`, { headers: H });
  if (r.ok) return "OK";
  const body = await r.text();
  if (r.status === 404) return "НЕМА ТАБЛИЦІ";
  if (body.includes("42703") || body.includes("does not exist")) return "НЕМА КОЛОНКИ";
  return `HTTP ${r.status}`;
}
async function table(t) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  if (r.ok) return `OK (${Number((r.headers.get("content-range")||"/?").split("/")[1])} рядків)`;
  return r.status === 404 ? "НЕМА ТАБЛИЦІ" : `HTTP ${r.status}`;
}

const checks = [
  ["007_mail_section", "таблиця emails", () => table("emails")],
  ["012_supplier_prices_extra", "supplier_prices.uktzed", () => col("supplier_prices","uktzed")],
  ["012_supplier_prices_extra", "supplier_prices.warranty", () => col("supplier_prices","warranty")],
  ["012_supplier_prices_extra", "supplier_prices.warranty_term", () => col("supplier_prices","warranty_term")],
  ["019_items_sku", "order_items.sku", () => col("order_items","sku")],
  ["019_items_sku", "supplier_order_items.sku", () => col("supplier_order_items","sku")],
  ["020_orders_lead_source", "orders.lead_source", () => col("orders","lead_source")],
  ["020_orders_lead_source", "таблиця bot_sessions", () => table("bot_sessions")],
  ["021_proposals_storage", "commercial_proposals.storage_path", () => col("commercial_proposals","storage_path")],
  ["022_pricelist_source", "supplier_price_lists.source", () => col("supplier_price_lists","source")],
  ["023_brain_categories", "supplier_price_lists.categories", () => col("supplier_price_lists","categories")],
  ["024_contractor_edr_extract", "contractors.edr_extract_path", () => col("contractors","edr_extract_path")],
  ["024_contractor_edr_extract", "contractors.edr_extract_name", () => col("contractors","edr_extract_name")],
  ["025_suborder_item_ordered", "supplier_order_items.ordered", () => col("supplier_order_items","ordered")],
  ["026_period_closings", "таблиця period_closings", () => table("period_closings")],
  // фонові таблиці прайсів (010/011/013–018) — вибірково
  ["010_supplier_price_lists", "таблиця supplier_price_lists", () => table("supplier_price_lists")],
  ["010_supplier_price_lists", "таблиця supplier_prices", () => table("supplier_prices")],
  ["011_supplier_prices_currency", "supplier_prices.currency", () => col("supplier_prices","currency")],
  ["013_order_items_cost", "order_items.cost_price", () => col("order_items","cost_price")],
  ["014_suborders_auto", "order_items.supplier_id", () => col("order_items","supplier_id")],
  ["015_order_items_vat", "order_items.vat_rate", () => col("order_items","vat_rate")],
  ["016_order_items_vat_incl", "order_items.price_includes_vat", () => col("order_items","price_includes_vat")],
  ["017_documents_generated_link", "documents.generated_doc_id", () => col("documents","generated_doc_id")],
  ["018_orders_procurement", "orders.procurement_type", () => col("orders","procurement_type")],
];

console.log("\n═══ СТАН МІГРАЦІЙ (PostgREST зонд) ═══\n");
let last = "";
for (const [mig, what, fn] of checks) {
  if (mig !== last) { console.log(`\n${mig}:`); last = mig; }
  const res = await fn();
  const mark = res.startsWith("OK") ? "✅" : "❌";
  console.log(`  ${mark} ${what.padEnd(38)} → ${res}`);
}
console.log("");
