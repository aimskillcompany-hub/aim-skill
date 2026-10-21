export const normalizeName = (s) => String(s || '').toLowerCase().split(/\s+/).sort().join(' ')
export const supabase = { rpc: async (fn, a) => { globalThis.calls.push([fn, a]); return { data: { created: fn.startsWith('split') && !a.p_target, target: a.p_target || 'new-' + globalThis.calls.length, unit_cost: 1 }, error: null } },
  from: () => ({ update: (ch) => ({ eq: async (k, v) => { globalThis.calls.push(['update', ch, v]); return { error: null } } }) }) }
export const qc = () => { throw new Error('no db') }
