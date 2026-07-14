// Видалити 2 дублі-документи, повторно завантажені 2026-07-14 (подвоювали склад).
// Оригінали (.jpg, з оплатою) лишаються. Запуск: SUPABASE_SERVICE_KEY=... node migrations/fix_dup_docs_0714.mjs
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error("Встанови SUPABASE_SERVICE_KEY=...");process.exit(1);}
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,"Content-Type":"application/json"};
const q=(t,qs)=>fetch(`${BASE}/rest/v1/${t}?${qs}`,{headers:H}).then(r=>r.json());
const del=(t,qs)=>fetch(`${BASE}/rest/v1/${t}?${qs}`,{method:"DELETE",headers:{...H,Prefer:"return=representation"}}).then(async r=>({ok:r.ok,status:r.status,body:await r.text().catch(()=>"")}));

// повні id дублів (створені 14.07)
const dupPrefixes=["b5884f68","0bd841e1"];
const docs=await q("documents","doc_number=in.(1043,929)&created_at=gte.2026-07-14&select=id,doc_number,contractor_id");
for(const d of docs){
  if(!dupPrefixes.some(p=>d.id.startsWith(p))) continue;
  const mv=await q("stock_movements",`document_id=eq.${d.id}&select=id`);
  for(const m of mv){const r=await del("stock_movements",`id=eq.${m.id}`);console.log(`  del рух ${m.id.slice(0,8)}: ${r.ok?"OK":`FAIL ${r.status} ${r.body.slice(0,80)}`}`);}
  const rd=await del("documents",`id=eq.${d.id}`);
  console.log(`del дубль №${d.doc_number} ${d.id.slice(0,8)}: ${rd.ok?"OK":`FAIL ${rd.status} ${rd.body.slice(0,80)}`}`);
}

console.log("\n=== БАЛАНСИ ПІСЛЯ ===");
const names=["Провід для вентилятора%","Термостат Fandis%","Модуль Keystone RJ45%EServer"];
for(const nm of names){
  const ps=await q("product_stock",`name=ilike.${encodeURIComponent(nm)}&select=name,computed_stock`);
  ps.forEach(p=>console.log(`  ${p.name.slice(0,50)} = ${p.computed_stock}`));
}
