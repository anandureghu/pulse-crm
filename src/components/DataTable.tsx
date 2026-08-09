import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type SortDir = 'asc' | 'desc'

export interface DataTableColumn<T> {
  id: string
  header: string
  /** Value used for sort / default cell text */
  accessor: (row: T) => string | number | null | undefined | boolean
  sortable?: boolean
  /** Unique filter values derived from accessor; enable column filter dropdown */
  filterable?: boolean
  cell?: (row: T) => ReactNode
  className?: string
  headerClassName?: string
}

export interface DataTableProps<T> {
  data: T[]
  columns: DataTableColumn<T>[]
  getRowId: (row: T) => string
  loading?: boolean
  emptyMessage?: string
  searchPlaceholder?: string
  /** Custom search matcher; default matches all column accessor string values */
  searchFilter?: (row: T, query: string) => boolean
  pageSizeOptions?: number[]
  defaultPageSize?: number
  defaultSort?: { id: string; dir: SortDir }
  /**
   * Partitioning compare applied *before* the active column sort.
   * Use to pin groups (e.g. Shopify-tagged rows) to the bottom while still
   * sorting within each group.
   */
  secondaryCompare?: (a: T, b: T) => number
  onRowClick?: (row: T) => void
  toolbar?: ReactNode
  className?: string
}

function defaultSearch<T>(row: T, query: string, columns: DataTableColumn<T>[]) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return columns.some((col) => {
    const v = col.accessor(row)
    return v != null && String(v).toLowerCase().includes(q)
  })
}

function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  const empty = (v: unknown) => v == null || v === ''
  if (empty(a) && empty(b)) return 0
  if (empty(a)) return 1
  if (empty(b)) return -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mul
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }) * mul
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading = false,
  emptyMessage = 'No rows found.',
  searchPlaceholder = 'Search…',
  searchFilter,
  pageSizeOptions = [10, 25, 50, 100],
  defaultPageSize = 25,
  defaultSort,
  secondaryCompare,
  onRowClick,
  toolbar,
  className = '',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortId, setSortId] = useState<string | null>(defaultSort?.id ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? 'asc')
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [page, setPage] = useState(0)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})

  const filterableColumns = columns.filter((c) => c.filterable)

  const filterOptions = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const col of filterableColumns) {
      const set = new Set<string>()
      for (const row of data) {
        const v = col.accessor(row)
        if (v != null && String(v).trim()) set.add(String(v))
      }
      map[col.id] = Array.from(set).sort((a, b) => a.localeCompare(b))
    }
    return map
  }, [data, filterableColumns])

  const filtered = useMemo(() => {
    const q = search.trim()
    return data.filter((row) => {
      const matchesSearch = searchFilter
        ? searchFilter(row, q)
        : defaultSearch(row, q, columns)
      if (!matchesSearch) return false
      for (const col of filterableColumns) {
        const selected = columnFilters[col.id]
        if (!selected) continue
        if (String(col.accessor(row) ?? '') !== selected) return false
      }
      return true
    })
  }, [data, search, columns, searchFilter, filterableColumns, columnFilters])

  const sorted = useMemo(() => {
    const col = sortId ? columns.find((c) => c.id === sortId) : null
    const rows = [...filtered]
    rows.sort((a, b) => {
      if (secondaryCompare) {
        const group = secondaryCompare(a, b)
        if (group !== 0) return group
      }
      if (col) return compareValues(col.accessor(a), col.accessor(b), sortDir)
      return 0
    })
    return rows
  }, [filtered, columns, sortId, sortDir, secondaryCompare])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  useEffect(() => {
    setPage(0)
  }, [search, pageSize, columnFilters, sortId, sortDir, data.length])

  const toggleSort = (id: string) => {
    if (sortId !== id) {
      setSortId(id)
      setSortDir('asc')
      return
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const from = sorted.length === 0 ? 0 : safePage * pageSize + 1
  const to = Math.min(sorted.length, (safePage + 1) * pageSize)

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        {filterableColumns.map((col) => (
          <select
            key={col.id}
            value={columnFilters[col.id] ?? ''}
            onChange={(e) =>
              setColumnFilters((prev) => ({ ...prev, [col.id]: e.target.value }))
            }
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">All {col.header.toLowerCase()}</option>
            {filterOptions[col.id]?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ))}
        {toolbar}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map((col) => {
                const active = sortId === col.id
                return (
                  <th
                    key={col.id}
                    className={`text-left px-4 py-3 text-gray-600 font-medium ${col.headerClassName ?? ''}`}
                  >
                    {col.sortable === false ? (
                      col.header
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className="inline-flex items-center gap-1 hover:text-gray-900"
                      >
                        {col.header}
                        <span className={`text-[10px] ${active ? 'text-green-600' : 'text-gray-300'}`}>
                          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-400 text-sm">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-400 text-sm">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading && pageRows.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-gray-100 last:border-0 ${
                  onRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''
                }`}
              >
                {columns.map((col) => (
                  <td key={col.id} className={`px-4 py-3 ${col.className ?? ''}`}>
                    {col.cell
                      ? col.cell(row)
                      : (() => {
                          const v = col.accessor(row)
                          return v == null || v === '' ? '—' : String(v)
                        })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <span>
          {sorted.length === 0
            ? '0 results'
            : `Showing ${from}–${to} of ${sorted.length}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-2 text-xs">
            Page {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
