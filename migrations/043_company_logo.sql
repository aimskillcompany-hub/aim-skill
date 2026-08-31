-- 043: власне лого компанії для документів (base64 dataURL, для pdfmake).
-- AiM-брендинг у шаблонах лишається лише для ЕЙМ СКІЛ; інші юрособи друкують
-- своє лого (завантажене тут) або без лого, без згадок AiM.
alter table companies add column if not exists logo_base64 text;
