// Аудит: вихідні видаткові (продажі товарів) із сумою, але БЕЗ складських рухів → втрачені списання.
// Read-only. SUPABASE_SERVICE_KEY=... node migrations/audit_sales_no_stock.mjs
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error("Встанови SUPABASE_SERVICE_KEY=...");process.exit(1);}
const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
const all=async(t,sel,f="")=>{let o=[],from=0,s=1000;for(;;){const r=await fetch(`${BASE}/rest/v1/${t}?select=${sel}${f}`,{headers:{...H,Range:`${from}-${from+s-1}`}});const c=await r.json();if(!Array.isArray(c)||!c.length)break;o=o.concat(c);if(c.length<s)break;from+=s;}return o;};

// вихідні документи типів, що продають товар (видаткова накладна). Акти/рахунки — не товарні за замовч.
const GOODS_OUT=new Set(["waybill"]);
const docs=await all("documents","id,type,doc_number,doc_date,doc_role,direction,amount,source,contractor_id");
const contractors=await all("contractors","id,name");
const cn=Object.fromEntries(contractors.map(c=>[c.id,c.name]));
// рухи по документах
const mv=await all("stock_movements","document_id,type");
const mvCount={};mv.forEach(m=>{if(m.document_id)mvCount[m.document_id]=(mvCount[m.document_id]||0)+1;});

const isSale=d=>(d.doc_role==="outgoing"||d.direction==="receivable");
const candidates=docs.filter(d=>GOODS_OUT.has(d.type)&&isSale(d)&&Number(d.amount)>0);
const lost=candidates.filter(d=>!mvCount[d.id]);

console.log(`\nВидаткових накладних (продаж, сума>0): ${candidates.length}`);
console.log(`🔴 БЕЗ складських рухів (можливі втрачені списання): ${lost.length}\n`);
lost.sort((a,b)=>(a.doc_date||"").localeCompare(b.doc_date||""));
for(const d of lost){
  console.log(`  №${String(d.doc_number).padEnd(10)} ${d.doc_date} | ${Number(d.amount).toLocaleString("uk")} грн | src=${d.source||"-"} | ${cn[d.contractor_id]||"?"}`);
}

// довідково — акти/інші вихідні з сумою без рухів (можуть бути послуги, не обов'язково проблема)
const otherOut=docs.filter(d=>!GOODS_OUT.has(d.type)&&isSale(d)&&Number(d.amount)>0&&!mvCount[d.id]);
console.log(`\n── Довідково: інші вихідні (акти/рахунки) без рухів: ${otherOut.length} (часто послуги — норма) ──`);
const byType={};otherOut.forEach(d=>{(byType[d.type]||=0);byType[d.type]++;});
console.log("  за типом:",Object.entries(byType).map(([t,n])=>`${t}:${n}`).join(", "));
