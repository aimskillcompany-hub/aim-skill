// Заглушка таблиці під час завантаження: rows рядків по 48 px, cols стовпців.
export default function TableSkeleton({ rows = 6, cols = 5, label = 'Завантаження…' }) {
  return (
    <div className="tbl-wrap ui-skeleton" aria-busy="true" aria-label={label}>
      <table>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} style={{ height: 48 }}>
              {Array.from({ length: cols }).map((__, c) => (
                <td key={c} style={{ verticalAlign: 'middle' }}><span className="ui-skel-bar" style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
