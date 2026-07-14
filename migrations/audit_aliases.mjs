// Аудит аліасів: шукає товари, у яких аліаси, схоже, належать ІНШОМУ товару
// (латинські/цифрові токени аліаса не перетинаються з токенами назви товару) +
// товари з мінусовим залишком (ознака розриву прихід/видаток через злипання).
// Read-only. Запуск: SUPABASE_SERVICE_KEY=... node migrations/audit_aliases.mjs
const BASE = "https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("Встанови SUPABASE_SERVICE_KEY=..."); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const all = async (t, sel) => {
  let out = [], from = 0, step = 1000;
  for (;;) {
    const r = await fetch(`${BASE}/rest/v1/${t}?select=${sel}`, { headers: { ...H, Range: `${from}-${from + step - 1}` } });
    const chunk = await r.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    out = out.concat(chunk);
    if (chunk.length < step) break;
    from += step;
  }
  return out;
};

// «Значущі» токени = латиниця/цифри (бренд/модель). Кирилиця-генерик відкидається.
const STOP = new Set(["pro", "max", "mini", "plus", "new", "gold", "white", "black", "silver"]); // латинські, але не бренд
function distinct(name) {
  return [...new Set((name || "").toLowerCase()
    .replace(/[«»""”“‘’`()[\]{},;:!?/\\]/g, " ")
    .split(/\s+/)
    .filter(w => /[a-z0-9]/.test(w) && w.length >= 2 && !STOP.has(w)))];
}

(async () => {
  const [prods, aliases, stock] = await Promise.all([
    all("products", "id,name,status"),
    all("product_aliases", "product_id,alias"),
    all("product_stock", "id,name,computed_stock,status"),
  ]);
  const byId = Object.fromEntries(prods.map(p => [p.id, p]));
  const aliByProd = {};
  aliases.forEach(a => (aliByProd[a.product_id] ||= []).push(a.alias));

  console.log(`\nТоварів: ${prods.length}, аліасів: ${aliases.length}\n`);

  // ── A. Мінусові залишки (пріоритет) ──
  const neg = stock.filter(s => Number(s.computed_stock) < 0).sort((a, b) => a.computed_stock - b.computed_stock);
  console.log(`═══ A. Мінусові залишки: ${neg.length} ═══`);
  neg.forEach(s => console.log(`  ⚠ ${s.computed_stock}  ${s.name} (${s.status})`));

  // ── B. Аліаси з чужими брендами/моделями ──
  console.log(`\n═══ B. Підозрілі аліаси (токени не перетинаються з назвою товару) ═══`);
  let flagged = 0;
  for (const p of prods) {
    const pTok = new Set(distinct(p.name));
    if (!pTok.size) continue; // назва без латині/цифр — не можемо судити
    const bad = [];
    for (const al of (aliByProd[p.id] || [])) {
      const aTok = distinct(al);
      if (!aTok.length) continue;                       // аліас без значущих токенів — ок
      if (aTok.some(t => pTok.has(t))) continue;        // є спільний токен — ок
      bad.push({ al, aTok });
    }
    if (bad.length) {
      flagged++;
      console.log(`\n  ▸ ${p.name}  [${[...pTok].join(", ")}]  (${p.status})`);
      bad.forEach(b => console.log(`      ✗ «${b.al}»  → чужі токени: ${b.aTok.join(", ")}`));
    }
  }
  console.log(`\nПідсумок B: товарів з підозрілими аліасами — ${flagged}.`);
})();
