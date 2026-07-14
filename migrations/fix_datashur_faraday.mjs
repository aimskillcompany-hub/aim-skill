// (1) Чистка аліасів datAshur (прибрати «16GB» з товару 128GB + дедуп, дати 16GB власні аліаси).
// (2) Коригуючий рух-списання Faraday Mojave bag (продаж не створив руху) → баланс 0.
// Запуск: SUPABASE_SERVICE_KEY=... node migrations/fix_datashur_faraday.mjs
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error("Встанови SUPABASE_SERVICE_KEY=...");process.exit(1);}
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,"Content-Type":"application/json"};
const q=(t,qs)=>fetch(`${BASE}/rest/v1/${t}?${qs}`,{headers:H}).then(r=>r.json());
const del=(t,qs)=>fetch(`${BASE}/rest/v1/${t}?${qs}`,{method:"DELETE",headers:H}).then(r=>r.ok);
const post=(t,b)=>fetch(`${BASE}/rest/v1/${t}`,{method:"POST",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify(b)}).then(async r=>({ok:r.ok,status:r.status,t:await r.text().catch(()=>"")}));
function normalizeName(n){return !n?"":n.toLowerCase().replace(/[«»""”“‘’`]/g,"").replace(/[()[\]{},;:!?]/g," ").replace(/[\/\\]/g," ").replace(/\s+/g," ").trim().split(" ").filter(Boolean).sort().join(" ");}

// ── (1) datAshur аліаси ──
const p128=(await q("products","name=eq.Флеш-носій захищений iStorage datAshur BT 128GB USB 3.2 Gen 1&select=id"))[0];
const p16 =(await q("products","name=eq.Флеш-носій захищений iStorage datAshur BT 16GB USB 3.2 Gen 1&select=id"))[0];
const al128=await q("product_aliases",`product_id=eq.${p128.id}&select=id,alias`);
const seen=new Set(); const removed=[];
for(const a of al128){
  const is16=/\b16\s*gb\b/i.test(a.alias);
  const key=a.alias.trim().toLowerCase();
  if(is16){ removed.push(a.id); continue; }            // чужа ємність 16GB → геть з товару 128GB
  if(seen.has(key)){ removed.push(a.id); continue; }    // дубль
  seen.add(key);
}
for(const id of removed) await del("product_aliases",`id=eq.${id}`);
console.log(`(1) datAshur 128GB: видалено ${removed.length} аліасів (16GB+дублі). Лишилось ${al128.length-removed.length}.`);

// дати 16GB товару власні аліаси
const want16=["Периферійній пристрій datAshur BT USB3 256-bit 16 GB","Периферійний пристрій datAshur BT USB3 256-bit 16GB","Флеш-носій захищений iStorage datAshur BT 16GB USB 3.2 Gen 1"];
const have16=new Set((await q("product_aliases",`product_id=eq.${p16.id}&select=alias`)).map(a=>a.alias.trim().toLowerCase()));
let added=0;
for(const alias of want16){
  if(have16.has(alias.trim().toLowerCase())) continue;
  const r=await post("product_aliases",{product_id:p16.id,alias,normalized:normalizeName(alias)});
  if(r.ok) added++; else if(!/duplicate|conflict|23505/i.test(r.t)) console.log("   alias FAIL:",r.status,r.t.slice(0,80));
}
console.log(`(1) datAshur 16GB: додано ${added} аліасів.`);

// ── (2) Faraday Mojave — коригуючий рух ──
const moj=(await q("products","name=eq.Захисна сумка Фарадея Mission Darkness Mojave Faraday Tablet Bag&select=id,buy_price"))[0];
const outs=await q("stock_movements",`product_id=eq.${moj.id}&type=eq.out&select=id`);
if(outs.length){
  console.log("(2) Faraday Mojave: OUT вже є — пропускаю.");
}else{
  const cost=Number(moj.buy_price)||2915;
  const r=await post("stock_movements",{product_id:moj.id,type:"out",quantity:1,price:cost,cost_price:cost,total:cost,source:"manual",date:"2026-02-25",description:"Коригування: продаж Faraday Mojave bag (рух не створився з видаткової; ціну продажу уточнити)"});
  console.log("(2) Faraday Mojave: створено коригуючий OUT ×1 @"+cost+":",r.ok?"OK":`FAIL ${r.status} ${r.t.slice(0,80)}`);
}

// ── перевірка ──
console.log("\n=== БАЛАНСИ ===");
const ps=await q("product_stock","or=(name.ilike.*datAshur*,name.ilike.*Mojave*)&select=name,computed_stock");
ps.forEach(p=>console.log(`  ${p.name} = ${p.computed_stock}`));
console.log("\ndatAshur 128GB аліаси після чистки:");
(await q("product_aliases",`product_id=eq.${p128.id}&select=alias`)).forEach(a=>console.log("  ",a.alias));
console.log("datAshur 16GB аліаси:");
(await q("product_aliases",`product_id=eq.${p16.id}&select=alias`)).forEach(a=>console.log("  ",a.alias));
