// Разове оновлення назв файлів документів у форматі «Тип №Номер Контрагент Дата.ext».
// Запуск: SUPABASE_SERVICE_KEY=... node migrations/normalize_filenames.mjs [--apply]
const BASE="https://ivhfwdojjaflvdbdmttf.supabase.co";const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error("Встанови SUPABASE_SERVICE_KEY=...");process.exit(1);}
const APPLY=process.argv.includes("--apply");
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,"Content-Type":"application/json"};
const all=async(t,sel)=>{let o=[],from=0,s=1000;for(;;){const r=await fetch(`${BASE}/rest/v1/${t}?select=${sel}`,{headers:{...H,Range:`${from}-${from+s-1}`}});const c=await r.json();if(!Array.isArray(c)||!c.length)break;o=o.concat(c);if(c.length<s)break;from+=s;}return o;};
const patch=(id,b)=>fetch(`${BASE}/rest/v1/documents?id=eq.${id}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify(b)}).then(async r=>({ok:r.ok,status:r.status,body:r.ok?"":await r.text()}));

const LABELS={invoice:"Рахунок на оплату",commercialProposal:"Комерційна пропозиція",waybill:"Видаткова накладна",serviceAct:"Акт наданих послуг",incomingWaybill:"Прихідна накладна",loanAgreement:"Договір фін. допомоги",supplyAgreement:"Договір поставки",purchaseOrder:"Замовлення постачальнику",salesOrder:"Замовлення від клієнта"};
function buildName(d){
  const label=LABELS[d.type]||"Документ";
  const num=d.doc_number?`№${String(d.doc_number).trim()}`:"";
  const cn=(d.contractors?.name||"").replace(/[«»"']/g,"").replace(/\s+/g," ").trim();
  const base=[label,num,cn,d.doc_date||""].filter(Boolean).join(" ").replace(/[\/\\:*?<>|]+/g,"-").replace(/\s+/g," ").trim();
  const src=d.file_name||d.storage_path||d.file_path||"";
  const ext=(src.split(".").pop()||"").toLowerCase();
  const cleanExt=/^(pdf|jpe?g|png|webp|gif|heic|heif)$/.test(ext)?ext:"pdf";
  // потрібно достатньо інфо: тип + (номер або контрагент)
  if(!LABELS[d.type]||(!num&&!cn))return null;
  return `${base}.${cleanExt}`;
}

const docs=await all("documents","id,type,doc_number,doc_date,file_name,storage_path,file_path,source,contractors(name)");
let changed=0,skipped=0,same=0,failed=0,closed=0;
const samples=[];
for(const d of docs){
  const nn=buildName(d);
  if(!nn){skipped++;continue;}
  if(nn===d.file_name){same++;continue;}
  if((d.doc_date||"").slice(0,7)==="2025-01"){closed++;continue;} // закритий період — пропускаємо
  if(samples.length<12)samples.push(`  «${(d.file_name||"—").slice(0,40)}» → «${nn}»`);
  if(APPLY){
    const r=await patch(d.id,{file_name:nn});
    if(r.ok)changed++;else{failed++;if(/PERIOD_CLOSED/.test(r.body))closed++;}
  }else changed++;
}
console.log(`Документів: ${docs.length}`);
console.log(`${APPLY?"Оновлено":"Буде оновлено"}: ${changed} | вже норм: ${same} | без інфо (пропуск): ${skipped} | закритий період: ${closed} | помилок: ${failed}`);
console.log("\nПриклади змін:");samples.forEach(s=>console.log(s));
if(!APPLY)console.log("\n(dry-run — додай --apply щоб застосувати)");
