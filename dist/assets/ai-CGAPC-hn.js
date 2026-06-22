async function w(e){return["image/heic","image/heif"].includes(e.type.toLowerCase())||/\.(heic|heif)$/i.test(e.name)?new Promise(a=>{const o=URL.createObjectURL(e),t=new Image;t.onload=()=>{try{const s=document.createElement("canvas");s.width=t.naturalWidth||t.width,s.height=t.naturalHeight||t.height,s.getContext("2d").drawImage(t,0,0),s.toBlob(i=>{if(URL.revokeObjectURL(o),i){const l=e.name.replace(/\.(heic|heif)$/i,".jpg");a(new File([i],l,{type:"image/jpeg"}))}else reject(new Error("Не вдалося конвертувати HEIC. Збережіть фото як JPEG або PNG і спробуйте знову."))},"image/jpeg",.92)}catch{URL.revokeObjectURL(o),reject(new Error("Не вдалося конвертувати HEIC. Збережіть фото як JPEG або PNG і спробуйте знову."))}},t.onerror=()=>{URL.revokeObjectURL(o),reject(new Error("Формат HEIC не підтримується вашим браузером. Збережіть фото як JPEG або PNG."))},t.src=o}):e}async function E(e,r){return _([e],r)}async function _(e,r){var m,p;if(!(e!=null&&e.length))throw new Error("Немає файлів");const a=[];for(let n of e){n=await w(n);const d=await f(n),y=n.type.startsWith("image/"),g=n.type==="application/pdf";if(!y&&!g)throw new Error(`Непідтримуваний формат: ${n.name}`);const h=["image/jpeg","image/jpg","image/png","image/gif","image/webp"].includes(n.type)?n.type:"image/jpeg";g?a.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:d}}):a.push({type:"image",source:{type:"base64",media_type:h,data:d}})}a.push({type:"text",text:e.length>1?`Це ${e.length} сторінок одного документу. Розпізнай як єдиний документ та поверни JSON з усіма позиціями.`:"Розпізнай цей документ та поверни JSON з усіма позиціями."});const t={model:"claude-sonnet-4-6",max_tokens:2e3,system:`Ти бухгалтерський асистент. Аналізуй українські первинні документи.
Якщо документ на кількох сторінках — збери дані з усіх сторінок разом.

ВАЖЛИВО — визначення напряму документу:
Наша компанія: ТОВ "ЕЙМ СКІЛ", ЄДРПОУ 45505924.
- Якщо в документі ПОСТАЧАЛЬНИК = наша компанія (ЄДРПОУ 45505924 або "ЕЙМ СКІЛ") → це ВИХІДНИЙ документ від нас до клієнта. В полі "contractor" вкажи ПОКУПЦЯ (не нашу компанію), "suggestedDirection" = "Доходи", "docRole" = "outgoing".
- Якщо в документі ПОСТАЧАЛЬНИК = інша компанія → це ВХІДНИЙ документ. В полі "contractor" вкажи ПОСТАЧАЛЬНИКА, "suggestedDirection" = "Витрати", "docRole" = "incoming".

СТАТТІ ОБЛІКУ — обирай ТІЛЬКИ з цього списку:
${r!=null&&r.length?r.map(n=>`- ${n.name} (${n.type})`).join(`
`):"(статті не задані — вкажи null)"}

Для поля "suggestedArticle" обери найбільш відповідну статтю ТІЛЬКИ з наведеного списку вище. Якщо жодна не підходить — вкажи null. НЕ ВИГАДУЙ нових назв статтей.

Поверни ТІЛЬКИ валідний JSON без markdown та пояснень:
{
  "docType": "рахунок-фактура|видаткова накладна|акт наданих послуг|прибуткова накладна|інше",
  "docNumber": "номер або null",
  "date": "YYYY-MM-DD або null",
  "contractor": "назва контрагента (покупця або постачальника — залежно від напряму)",
  "edrpou": "ЄДРПОУ/ІПН контрагента (не наш) або null",
  "totalAmount": число_без_знаку,
  "vatAmount": число_без_знаку_або_0,
  "amountNoVat": число_без_знаку,
  "currency": "UAH",
  "description": "опис товарів/послуг до 100 символів",
  "suggestedDirection": "Витрати|Доходи|Інше",
  "suggestedArticle": "назва статті зі списку вище або null",
  "docRole": "incoming|outgoing",
  "invoiceRef": "номер пов'язаного рахунку (якщо в накладній вказано 'згідно рахунку №...') або null",
  "invoiceRefDate": "YYYY-MM-DD дата рахунку або null",
  "contractNum": "номер договору (якщо вказано 'згідно договору №...') або null",
  "contractDate": "YYYY-MM-DD дата договору або null",
  "items": [
    {
      "name": "назва товару або послуги",
      "sku": "артикул/код товару або null",
      "quantity": число_або_null,
      "unit": "шт|кг|л|м|компл|грн|null",
      "unitPrice": число_або_null,
      "amount": число_без_знаку,
      "vatRate": 20
    }
  ]
}
Суми завжди позитивні числа. Якщо поле невідоме — null.
Витягни ВСІ позиції з документу — кожен рядок товару/послуги окремо.`,messages:[{role:"user",content:a}]};let s;s=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});const c=await s.json();if(c.error)throw new Error(c.error.message);const i=((p=(m=c.content)==null?void 0:m.find(n=>n.type==="text"))==null?void 0:p.text)||"";let l=i.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();const u=l.match(/\{[\s\S]*\}/);u&&(l=u[0]);try{return JSON.parse(l)}catch{throw console.error("AI response:",i),new Error("Не вдалось розпізнати документ. Спробуйте ще раз або введіть дані вручну.")}}async function N(e){var l,u;if(!(e!=null&&e.trim()))throw new Error("Вставте текст з реквізитами");const a={model:"claude-sonnet-4-6",max_tokens:1e3,system:`Ти розпізнаєш реквізити українських компаній з будь-якого тексту.
Текст може містити реквізити з документів, листів, сайтів, візиток тощо.
Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "name": "повна офіційна назва компанії або null",
  "short_name": "скорочена назва (ТОВ/АТ/ФОП + коротка назва) або null",
  "edrpou": "код ЄДРПОУ (8 цифр) або РНОКПП (10 цифр) або null",
  "ipn": "ІПН/індивідуальний податковий номер (12 цифр) або null",
  "legal_form": "ТОВ/АТ/ПП/ФОП або null",
  "legal_address": "юридична адреса (повна, з індексом та містом) або null",
  "address": "те саме що legal_address",
  "iban": "IBAN (UA + 27 цифр) або null",
  "bank_name": "назва банку або null",
  "mfo": "МФО (6 цифр) або null",
  "phone": "телефон або null",
  "email": "email або null",
  "website": "сайт або null",
  "contact_person": "ПІБ директора або контактної особи або null",
  "contact_position": "посада (Директор тощо) або null",
  "is_vat_payer": true якщо є ІПН з 12 цифр або згадка ПДВ або свідоцтво ПДВ,
  "vat_certificate": "ІПН (12 цифр) = це і є номер свідоцтва ПДВ, або null",
  "type": "client/supplier/other"
}
ВАЖЛИВО:
- Якщо є ІПН з 12 цифр — це платник ПДВ, is_vat_payer=true, vat_certificate = цей ІПН
- Адресу завжди клади і в address і в legal_address
- Директора/керівника клади в contact_person + contact_position
- Якщо поле невідоме — null. НЕ вигадуй дані.`,messages:[{role:"user",content:e.trim()}]};let o;o=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a)});const t=await o.json();if(t.error)throw new Error(t.error.message);let c=(((u=(l=t.content)==null?void 0:l.find(m=>m.type==="text"))==null?void 0:u.text)||"").replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();const i=c.match(/\{[\s\S]*\}/);i&&(c=i[0]);try{return JSON.parse(c)}catch{throw new Error("Не вдалось розпізнати реквізити. Спробуйте ще раз.")}}function f(e){return new Promise((r,a)=>{const o=new FileReader;o.onload=()=>r(o.result.split(",")[1]),o.onerror=a,o.readAsDataURL(e)})}export{E as extractDocument,_ as extractDocumentMulti,N as parseCompanyFromText};
