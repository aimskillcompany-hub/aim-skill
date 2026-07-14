// Аудит даних ПДВ. Read-only. SUPABASE_SERVICE_KEY=... node migrations/audit_vat.mjs
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";const KEY=process.env.SUPABASE_SERVICE_KEY;
const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
const all=async(t,sel,f="")=>{let o=[],from=0,s=1000;for(;;){const r=await fetch(`${BASE}/rest/v1/${t}?select=${sel}${f}`,{headers:{...H,Range:`${from}-${from+s-1}`}});const c=await r.json();if(!Array.isArray(c)||!c.length)break;o=o.concat(c);if(c.length<s)break;from+=s;}return o;};

// компанія — платник ПДВ?
const self=await all("contractors","name,edrpou,is_vat_payer,tax_system","&edrpou=eq.45505924");
console.log("Компанія (self):",JSON.stringify(self[0]||{}));

const docs=await all("documents","id,doc_date,doc_role,direction,type,amount,vat_amount,contractor_id,source");
const withD=docs.filter(d=>d.doc_date);
const isPurch=d=>d.direction==="payable"||d.doc_role==="incoming"||d.type==="incomingWaybill";
const num=x=>Number(x)||0;

// по місяцях: вхідний ПДВ (кредит) з закупівель, вихідний (зобов'язання) з продажів
const byM={};
for(const d of withD){
  const m=d.doc_date.slice(0,7);
  const b=(byM[m]||={in:0,out:0,inDocs:0,outDocs:0,inNoVat:0,outNoVat:0});
  if(isPurch(d)){b.in+=num(d.vat_amount);b.inDocs++;if(!num(d.vat_amount))b.inNoVat++;}
  else{b.out+=num(d.vat_amount);b.outDocs++;if(!num(d.vat_amount))b.outNoVat++;}
}
console.log("\n=== ПДВ по місяцях (документи) ===");
console.log("місяць   | вих.ПДВ(зобов) | вх.ПДВ(кредит) | до сплати | прод(без ПДВ) | закуп(без ПДВ)");
let tin=0,tout=0;
Object.keys(byM).sort().forEach(m=>{const b=byM[m];tin+=b.in;tout+=b.out;
  console.log(`${m}  | ${b.out.toFixed(2).padStart(13)} | ${b.in.toFixed(2).padStart(13)} | ${(b.out-b.in).toFixed(2).padStart(9)} | ${b.outNoVat}/${b.outDocs} | ${b.inNoVat}/${b.inDocs}`);});
console.log(`РАЗОМ: вихідний ${tout.toFixed(2)} · вхідний ${tin.toFixed(2)} · сальдо до сплати ${(tout-tin).toFixed(2)}`);

// аномалії: ПДВ не ≈ amount/6 (для 20% gross vat=amount/6)
console.log("\n=== Аномалії ПДВ (vat ≠ amount/6, тобто не рівно 20% від нетто) ===");
let anom=0;
for(const d of withD){
  const a=num(d.amount),v=num(d.vat_amount);
  if(!a||!v)continue;
  const expect=a/6; // 20% gross
  if(Math.abs(v-expect)>Math.max(1,a*0.01)){anom++;if(anom<=15)console.log(`  ${d.doc_date} ${isPurch(d)?"закуп":"прод"} amount=${a} vat=${v} (очік ${expect.toFixed(2)}) type=${d.type}`);}
}
console.log(`Аномалій усього: ${anom} (з ${withD.filter(d=>num(d.amount)&&num(d.vat_amount)).length} док з ПДВ)`);

// документи без vat_amount взагалі
const noVat=withD.filter(d=>!num(d.vat_amount)).length;
console.log(`\nДокументів без ПДВ (vat_amount=0/null): ${noVat} з ${withD.length}`);
