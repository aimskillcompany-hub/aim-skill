// Разовий фікс: розлипити «SafePal S1 Pro» та «CoolWallet Pro».
// CoolWallet Pro (прихід з накладної №251) помилково прив'язаний до SafePal через сміттєві аліаси.
// Запуск: SUPABASE_SERVICE_KEY=... node migrations/fix_safepal_coolwallet.mjs
const BASE = "https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("Встанови SUPABASE_SERVICE_KEY=..."); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const q = (t, qs) => fetch(`${BASE}/rest/v1/${t}?${qs}`, { headers: H }).then(r => r.json());
const patch = (t, qs, body) => fetch(`${BASE}/rest/v1/${t}?${qs}`, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => null) }));
const del = (t, qs) => fetch(`${BASE}/rest/v1/${t}?${qs}`, { method: "DELETE", headers: H }).then(r => ({ ok: r.ok, status: r.status }));
const ins = (t, body) => fetch(`${BASE}/rest/v1/${t}`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) }).then(r => ({ ok: r.ok, status: r.status }));

const SAFEPAL = "5a12cc64-b8f1-4368-9fe8-e1c0cc6fa000";
const COOLW   = "0980ecf2-0b77-435b-b4a0-8764d3014b02";
const ARCH_CW = "8538db1e-4860-41ae-b18d-3203d6f850ed"; // архівний дубль CoolWallet (HS)
const ARCH_SP = "db594160-5862-4ea5-8c0c-658c1bb55076"; // архівний дубль SafePal S1

(async () => {
  console.log("═══ ФІКС SafePal / CoolWallet ═══\n");

  // ── Крок 1: перепризначити прихідний рух CoolWallet (№251) з SafePal → CoolWallet ──
  const spMoves = await q("stock_movements", `product_id=eq.${SAFEPAL}&select=id,date,type,quantity,price,description&order=date`);
  const wrongIn = spMoves.find(m => m.type === "in" && Math.abs(Number(m.price) - 2575) < 0.01 && /CoolWallet/i.test(m.description || ""));
  if (wrongIn) {
    const r = await patch("stock_movements", `id=eq.${wrongIn.id}`, { product_id: COOLW });
    console.log(`1) Рух ${wrongIn.id.slice(0, 8)} (${wrongIn.date}, ${wrongIn.price}, "${wrongIn.description}") → CoolWallet: ${r.ok ? "OK" : "FAIL " + r.status + " " + JSON.stringify(r.data)}`);
  } else console.log("1) Помилковий рух не знайдено (можливо, вже виправлено).");

  // ── Крок 2: прибрати з SafePal аліаси CoolWallet + дедуп ──
  const spAliases = await q("product_aliases", `product_id=eq.${SAFEPAL}&select=id,alias`);
  const toDelete = [];
  const seen = new Set();
  for (const a of spAliases) {
    if (/CoolWallet/i.test(a.alias)) { toDelete.push(a.id); continue; }   // чужий товар
    const key = a.alias.trim().toLowerCase();
    if (seen.has(key)) { toDelete.push(a.id); continue; }                  // дубль
    seen.add(key);
  }
  for (const id of toDelete) await del("product_aliases", `id=eq.${id}`);
  console.log(`2) Видалено з SafePal аліасів: ${toDelete.length} (CoolWallet + дублі). Лишилось: ${spAliases.length - toDelete.length}.`);

  // ── Крок 3: дати CoolWallet власні аліаси (щоб OCR більше не плутав) ──
  const cwHave = new Set((await q("product_aliases", `product_id=eq.${COOLW}&select=alias`)).map(a => a.alias.trim().toLowerCase()));
  const cwWant = [
    "Апаратний криптогаманець CoolWallet Pro",
    "апаратний гаманець CoolWallet Pro (HS8523.52.0090)",
    "Апаратний крипто гаманець CoolWallet Pro",
    "CoolWallet Pro (hardware wallet)",
  ];
  let added = 0;
  for (const alias of cwWant) {
    if (cwHave.has(alias.trim().toLowerCase())) continue;
    const r = await ins("product_aliases", { product_id: COOLW, alias });
    if (r.ok) added++;
  }
  console.log(`3) Додано CoolWallet аліасів: ${added}.`);

  // ── Крок 4: собівартість за останньою закупівлею (рішення #16) ──
  await patch("products", `id=eq.${SAFEPAL}`, { buy_price: 1908.33 });
  const spOut = (await q("stock_movements", `product_id=eq.${SAFEPAL}&type=eq.out&select=id,date`));
  for (const m of spOut) await patch("stock_movements", `id=eq.${m.id}`, { cost_price: 1908.33 });
  await patch("products", `id=eq.${COOLW}`, { buy_price: 2575 });
  console.log(`4) Собівартість: SafePal buy/OUT→1908.33 (OUT-рухів: ${spOut.length}); CoolWallet buy→2575.`);

  // ── Крок 5: прибрати архівні дублі-порожняки ──
  for (const [pid, lbl] of [[ARCH_CW, "CoolWallet HS(arch)"], [ARCH_SP, "SafePal S1(arch)"]]) {
    await del("product_aliases", `product_id=eq.${pid}`);
    const r = await del("products", `id=eq.${pid}`);
    console.log(`5) Видалення дубля ${lbl}: ${r.ok ? "OK" : "FAIL " + r.status}`);
  }

  // ── Перевірка ──
  console.log("\n═══ ПІСЛЯ ФІКСУ ═══");
  const ps = await q("product_stock", "or=(name.ilike.*SafePal*,name.ilike.*CoolWallet*)&select=name,computed_stock,status");
  ps.forEach(p => console.log(`  ${p.name} = ${p.computed_stock} (${p.status})`));
})();
