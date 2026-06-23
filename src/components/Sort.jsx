import { useState } from 'react'

// Переюзовне сортування таблиць. Клік по заголовку → сортує; повторний клік — зміна напряму.
export function useSort(initialKey = null, initialDir = 'asc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir })
  const onSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  // accessors: { key: (row) => value } для обчислюваних колонок (embed, мітки тощо)
  const sorted = (rows, accessors = {}) => {
    if (!sort.key) return rows
    const get = accessors[sort.key] || (r => r[sort.key])
    return [...rows].sort((a, b) => {
      let va = get(a), vb = get(b)
      const ea = va == null || va === '', eb = vb == null || vb === ''
      if (ea && eb) return 0
      if (ea) return 1            // порожні — завжди вниз
      if (eb) return -1
      if (typeof va === 'number' && typeof vb === 'number') return sort.dir === 'asc' ? va - vb : vb - va
      const r = String(va).localeCompare(String(vb), 'uk', { numeric: true })
      return sort.dir === 'asc' ? r : -r
    })
  }
  return { sort, onSort, sorted }
}

// Заголовок-кнопка сортування
export function SortTh({ label, k, sort, onSort, align }) {
  const active = sort.key === k
  return (
    <th onClick={() => onSort(k)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: align, whiteSpace: 'nowrap' }} title="Сортувати">
      {label}{' '}
      <span style={{ opacity: active ? 1 : 0.25, fontSize: 10 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  )
}
