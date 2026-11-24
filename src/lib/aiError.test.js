import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./companyConfig', () => ({ getCompany: () => ({}) }))
import { explainAiError } from './ai'
describe('explainAiError', () => {
  it('кошти / ключ / модель / розмір', () => {
    expect(explainAiError('Your credit balance is too low to access the Anthropic API.').text).toMatch(/кошти/)
    expect(explainAiError('invalid x-api-key').text).toMatch(/Ключ/)
    expect(explainAiError('model: claude-sonnet-4-6 not_found_error').text).toMatch(/Модель/)
    expect(explainAiError('Файл завеликий для розпізнавання.').text).toMatch(/завеликий/)
    expect(explainAiError('щось інше').text).toBe('щось інше')
  })
})
