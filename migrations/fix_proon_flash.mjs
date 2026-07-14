// Фікс рахунку №1 ПРООН (bc798d07): пропущений рух datAshur 16GB + перенос IronKey «D500S»→D300S 128GB.
// Запуск: SUPABASE_SERVICE_KEY=... node migrations/fix_proon_flash.mjs
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error("Встанови SUPABASE_SERVICE_KEY=...");process.exit(1);}
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,"Content-Type":"application/json"};
const q=(t,qs)=>fetch(`${BASE}/rest/v1/${t}?${qs}`,{headers:H}).then(r=>r.json());
const post=(t,b)=>fetch(`${BASE}/rest/v1/${t}`,{method:"POST",headers:{...H,Prefer:"return=representation"},body:JSON.stringify(b)}).then(async r=>({ok:r.ok,status:r.status,data:await r.json().catch(()=>null)}));
const patch=(t,qs,b)=>fetch(`${BASE}/rest/v1/${t}?${qs}`,{method:"PATCH",headers:{...H,Prefer:"return=representation"},body:JSON.stringify(b)}).then(async r=>({ok:r.ok,status:r.status,data:await r.json().catch(()=>null)}));

const DOC="bc798d07-96b4-4850-b440-a4fcbaf8e551";

const dat16=(await q("products","name=eq.Флеш-носій захищений iStorage datAshur BT 16GB USB 3.2 Gen 1&select=id"))[0];
const d300_128=(await q("products","name=eq.Флеш-носій захищений Kingston IronKey D300S 128GB USB 3.1 Gen 1&select=id"))[0];
const d500=(await q("products","name=ilike.*IronKey D500S*&select=id,name"))[0];
console.log("datAshur 16GB:",dat16?.id?.slice(0,8),"| D300S 128GB:",d300_128?.id?.slice(0,8),"| D500S(фантом):",d500?.id?.slice(0,8),d500?.name);

// 1) створити пропущений рух datAshur 16GB (рядок 6 рахунку: @6550, собівартість 2250)
const exists=await q("stock_movements",`product_id=eq.${dat16.id}&type=eq.out&document_id=eq.${DOC}&select=id`);
if(exists.length){
  console.log("1) Рух datAshur 16GB вже існує — пропускаю.");
}else{
  const r=await post("stock_movements",{product_id:dat16.id,type:"out",quantity:1,price:6550,cost_price:2250,total:6550,document_id:DOC,date:"2026-03-13",source:"document",description:"Рахунок-фактура №1: Периферійній пристрій datAshur BT USB3 256-bit 16 GB"});
  console.log("1) Створено рух datAshur 16GB out @6550:",r.ok?"OK":`FAIL ${r.status} ${JSON.stringify(r.data)}`);
}

// 2) перенести рух @33000 з D500S → D300S 128GB
const mvD500=await q("stock_movements",`product_id=eq.${d500.id}&type=eq.out&select=id,price`);
console.log("2) Рухів на D500S:",mvD500.length);
for(const m of mvD500){
  const r=await patch("stock_movements",`id=eq.${m.id}`,{product_id:d300_128.id});
  console.log(`   рух ${m.id.slice(0,8)} @${m.price} → D300S 128GB:`,r.ok?"OK":`FAIL ${r.status} ${JSON.stringify(r.data)}`);
}

// 3) заархівувати порожній D500S
const rArch=await patch("products",`id=eq.${d500.id}`,{status:"archived"});
console.log("3) D500S → archived:",rArch.ok?"OK":`FAIL ${rArch.status}`);

// перевірка балансів
console.log("\n=== БАЛАНСИ ПІСЛЯ ===");
const ps=await q("product_stock","or=(name.ilike.*datAshur*,name.ilike.*IronKey D300S*,name.ilike.*IronKey D500S*)&select=name,computed_stock,status");
ps.forEach(p=>console.log(`  ${p.name} = ${p.computed_stock} (${p.status})`));
