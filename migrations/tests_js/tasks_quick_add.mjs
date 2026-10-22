import { parseQuick, bucket, isOverdue } from './tasks.js'
import { todayKyiv, addDaysIso } from './dates.js'
let fails = 0; const ok = (n, c) => { if (!c) fails++; console.log(c ? '  ✓' : '  ✗', n) }
const people = [{ id: 'd', full_name: 'Дмитро Редько' }, { id: 'o', full_name: 'Олена Коваль' }]
const today = todayKyiv()
let q = parseQuick('Надіслати акт ПРООН завтра 15:00 @Олена !високий', people, 'd')
ok(`${JSON.stringify(q)}`, q.title === 'Надіслати акт ПРООН' && q.assignee === 'o' && q.due === addDaysIso(today, 1) && q.time === '15:00' && q.priority === 'high')
q = parseQuick('Зателефонувати сьогодні', people, 'd'); ok('сьогодні, на себе', q.due === today && q.assignee === 'd' && q.title === 'Зателефонувати')
q = parseQuick('Звірити банк 31.10 !терміново', people, 'd'); ok('дата 31.10, терміново', q.due === today.slice(0, 4) + '-10-31' && q.priority === 'urgent')
q = parseQuick('Зустріч 9:30', people, 'd'); ok('лише час → сьогодні 09:30', q.due === today && q.time === '09:30')
q = parseQuick('Написати @олені', people, 'd'); ok('@олені (відмінок) → Олена', q.assignee === 'o' && q.title === 'Написати')
const past = new Date(Date.now() - 3600e3).toISOString(), fut = new Date(Date.now() + 864e5 * 30).toISOString()
ok('прострочена (термін минув)', bucket({ status: 'new', due_at: past, due_date: today }) === 'overdue' && isOverdue({ status: 'in_progress', due_at: past }))
ok('виконана не прострочена', bucket({ status: 'done', due_at: past }) === 'done' && !isOverdue({ status: 'done', due_at: past }))
ok('відкладена — окрема група', bucket({ status: 'on_hold', due_at: past, due_date: today }) === 'hold')
ok('пізніше / без терміну', bucket({ status: 'new', due_at: fut, due_date: fut.slice(0, 10) }) === 'later' && bucket({ status: 'new' }) === 'nodate')
console.log(fails ? 'ПОМИЛОК ' + fails : 'УСЕ ОК')
