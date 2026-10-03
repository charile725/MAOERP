'use client'

import { useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { formatDbUtcAsTaiwan } from '@/lib/timezone'

type InventoryLog = {
  id: string
  ref_type: string
  ref_id: string | null
  qty_change: number
  unit_cost: number | null
  memo: string | null
  created_at: string
}

type Payload = {
  product: { id: string; item_code: string; name: string; unit: string | null; stock: number; cost: number | null; avg_cost: number | null }
  logs: InventoryLog[]
  summary: { init: number; purchase: number; delivery: number; adjustment: number; other: number }
  logged_total: number
  truncated: boolean
  matches_stock: boolean | null
}

/** 異動類型的中文與顏色 */
const TYPE_LABEL: Record<string, string> = {
  init: '初始庫存',
  purchase: '進貨入庫',
  purchase_delete: '刪進貨單回沖',
  purchase_item_delete: '刪進貨明細回沖',
  delivery: '出貨扣庫存',
  delivery_return: '撤銷出貨回補',
  delivery_delete: '刪出貨單回補',
  sale_delete: '刪銷售單回補',
  adjustment: '庫存調整',
  return: '退貨回補',
}

function typeLabel(t: string) {
  return TYPE_LABEL[t] || t
}

type Props = {
  productId: string | null
  onClose: () => void
}

export default function InventoryLogModal({ productId, onClose }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!productId) { setData(null); setError(''); return }
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/products/${productId}/inventory-logs`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        if (res.ok) setData(res.data)
        else setError(res.error || '載入失敗')
      })
      .catch(() => { if (!cancelled) setError('載入失敗') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [productId])

  if (!productId) return null

  // 由舊到新累加，第一列就是初始庫存
  let running = 0
  const rows = (data?.logs || []).map((log) => {
    running += Number(log.qty_change) || 0
    return { log, balance: running }
  })

  const unit = data?.product.unit || ''

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-lg bg-white dark:bg-gray-800 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">庫存異動紀錄</h2>
            {data && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {data.product.item_code}　{data.product.name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {loading && <div className="py-10 text-center text-gray-500 dark:text-gray-400">載入中...</div>}
          {error && <div className="py-10 text-center text-red-600 dark:text-red-400">{error}</div>}

          {data && !loading && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {([
                  ['初始庫存', data.summary.init],
                  ['進貨', data.summary.purchase],
                  ['出貨', data.summary.delivery],
                  ['調整', data.summary.adjustment],
                  ['目前庫存', data.product.stock],
                ] as const).map(([label, value], i) => (
                  <div
                    key={label}
                    className={`rounded-lg border p-3 text-center ${i === 4
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700'
                      }`}
                  >
                    <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
                    <div className={`text-xl font-bold ${Number(value) < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      {Number(value) > 0 && i > 0 && i < 4 ? '+' : ''}{value}
                    </div>
                  </div>
                ))}
              </div>

              {data.truncated && (
                <div className="mb-4 rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                  這個商品的異動筆數太多，只顯示最早的 {data.logs.length} 筆。
                </div>
              )}

              {data.matches_stock === false && (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  ⚠️ 異動累計 {data.logged_total} 與目前庫存 {data.product.stock} 不一致，代表有人繞過庫存日誌直接改過庫存數字。
                </div>
              )}

              {rows.length === 0 ? (
                <div className="py-10 text-center text-gray-500 dark:text-gray-400">
                  這個商品沒有任何庫存異動紀錄（包含初始庫存）。
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">時間</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">類型</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">異動</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">結存</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">單位成本</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-100">說明</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {rows.map(({ log, balance }) => (
                        <tr key={log.id} className={log.ref_type === 'init' ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">
                            {formatDbUtcAsTaiwan(log.created_at)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-900 dark:text-gray-100">
                            {typeLabel(log.ref_type)}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${Number(log.qty_change) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {Number(log.qty_change) > 0 ? '+' : ''}{log.qty_change}
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                            {balance} {unit}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                            {log.unit_cost === null || log.unit_cost === undefined ? '-' : formatCurrency(log.unit_cost)}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{log.memo || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
