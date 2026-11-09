import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { applySplits, validateSplit, articleText, splitErrorText } from './txSplits'

const tx = (id, amount, extra = {}) => ({ id, amount, article: 'Товар', direction: 'Витрати', account_id: 'acc', ...extra })

describe('Розбиття операції на статті', () => {
  it('розбита операція → частини зі своєю статтею й сумою, решта полів з операції', () => {
    const rows = applySplits([tx('a', -1000, { is_split: true, article: null }), tx('b', -50)], [
      { id: 's2', transaction_id: 'a', article: 'Доставка', article_id: 'd', amount: '-100', position: 2 },
      { id: 's1', transaction_id: 'a', article: 'Товар', article_id: 't', amount: '-900', position: 1 },
    ])
    expect(rows.map(r => [r.id, r.article, r.amount, r.direction, r.account_id])).toEqual([
      ['a', 'Товар', -900, 'Витрати', 'acc'], ['a', 'Доставка', -100, 'Витрати', 'acc'], ['b', 'Товар', -50, 'Витрати', 'acc'],
    ])
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(-1050)   // сума не змінилась
  })
  it('частини без позначки is_split не застосовуються', () => {
    expect(applySplits([tx('a', -10)], [{ id: 's', transaction_id: 'a', article: 'X', amount: -10 }])[0].article).toBe('Товар')
  })
  it('перевірка форми', () => {
    expect(validateSplit(-1000, [{ article_id: 't', amount: '900' }, { article_id: 'd', amount: '100,00' }]).ok).toBe(true)
    expect(validateSplit(-1000, [{ article_id: 't', amount: '900' }, { article_id: 'd', amount: '50' }]).error).toBe('Не розподілено 50.00 грн')
    expect(validateSplit(-1000, [{ article_id: 't', amount: '900' }, { article_id: 'd', amount: '150' }]).rest).toBe(-50)
    expect(validateSplit(-1000, [{ article_id: 't', amount: '1000' }]).ok).toBe(false)
    expect(validateSplit(-1000, [{ article_id: '', amount: '500' }, { article_id: 'd', amount: '500' }]).error).toMatch(/статтю/)
    expect(validateSplit(1234.56, [{ article_id: 't', amount: '1 000.06' }, { article_id: 'd', amount: '234.5' }]).ok).toBe(true)
  })
  it('текст статті розбитої операції — усі частини', () => {
    expect(articleText({ is_split: true, _splits: [{ article: 'Зарплата' }, { article: 'ЄСВ' }] })).toBe('Зарплата ЄСВ')
    expect(articleText({ article: 'Оренда' })).toBe('Оренда')
  })
  it('зрозумілі помилки', () => {
    expect(splitErrorText('SPLIT_SUM: сума частин (900) не дорівнює сумі операції (1000)')).toBe('сума частин (900) не дорівнює сумі операції (1000)')
    expect(splitErrorText('PERIOD_CLOSED: період 03/2026 закрито')).toMatch(/Період закрито/)
    expect(splitErrorText('Could not find the function public.split_transaction in the schema cache')).toMatch(/міграцію 110/)
  })
})
