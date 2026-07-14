// Аудит дублів документів, що подвоюють склад (той самий контрагент+номер, у кількох є рухи).
// Read-only. Запуск: SUPABASE_SERVICE_KEY=... node migrations/audit_dup_docs.mjs
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error("Встанови SUPABASE_SERVICE_KEY=...");process.exit(1);}
const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
const all=async(t,sel)=>{let out=[],from=0,step=1000;for(;;){const r=await fetch(`${BASE}/rest/v1/${t}?select=${sel}`,{headers:{...H,Range:`${from}-${from+step-1}`}});const c=await r.json();if(!Array.isArray(c)||!c.length)break;out=out.concat(c);if(c.length<step)break;from+=step;}return out;};

const docs=await all("documents","id,doc_number,doc_date,doc_role,type,contractor_id,amount,source,created_at,file_name");
const contractors=await all("contractors","id,name");
const cn=Object.fromEntries(contractors.map(c=>[c.id,c.name]));
// кількість складських рухів на кожен документ
const mv=await all("stock_movements","document_id");
const mvCount={};mv.forEach(m=>{if(m.document_id)mvCount[m.document_id]=(mvCount[m.document_id]||0)+1;});

// групуємо за контрагент + нормалізований номер
const norm=s=>(s||"").toString().trim().toLowerCase().replace(/\s+/g,"");
const groups={};
for(const d of docs){
  if(!d.doc_number) continue;
  const key=`${d.contractor_id||"?"}|${norm(d.doc_number)}`;
  (groups[key]||=[]).push(d);
}

const dups=Object.values(groups).filter(g=>g.length>1);
console.log(`\nГруп «контрагент+номер» з >1 документом: ${dups.length}\n`);

// найважливіше: де в 2+ документах є складські рухи (реальне подвоєння складу)
let stockDup=0, otherDup=0;
const report=[];
for(const g of dups){
  const withStock=g.filter(d=>mvCount[d.id]);
  const isStockDup=withStock.length>=2;
  if(isStockDup) stockDup++; else otherDup++;
  report.push({g,withStock,isStockDup});
}
report.sort((a,b)=>(b.isStockDup?1:0)-(a.isStockDup?1:0));

console.log(`🔴 З ПОДВОЄННЯМ СКЛАДУ (рухи у 2+ документах групи): ${stockDup}`);
console.log(`⚪ Інші дублі номера (без подвоєння складу): ${otherDup}\n`);

for(const {g,withStock,isStockDup} of report){
  if(!isStockDup) continue;
  const d0=g[0];
  console.log(`🔴 «${cn[d0.contractor_id]||"?"}» №${d0.doc_number} — ${g.length} документи:`);
  for(const d of g){
    console.log(`     ${d.doc_date} ${d.doc_role} amount=${d.amount} src=${d.source||"-"} рухів=${mvCount[d.id]||0} створено=${(d.created_at||"").slice(0,10)} id=${d.id.slice(0,8)}`);
  }
  console.log("");
}

console.log("── Інші дублі номера (для довідки, без подвоєння складу) ──");
for(const {g,isStockDup} of report){
  if(isStockDup) continue;
  const d0=g[0];
  const stocked=g.filter(d=>mvCount[d.id]).length;
  console.log(`  «${cn[d0.contractor_id]||"?"}» №${d0.doc_number} ×${g.length} (з рухами: ${stocked}) — ${g.map(d=>`${d.doc_date}/${d.amount}`).join("  ")}`);
}
