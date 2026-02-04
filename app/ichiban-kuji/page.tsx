'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'

type Product = {
  id: string
  name: string
  item_code: string
  cost: number
  unit: string
}

type Prize = {
  id: string
  prize_tier: string
  prize_name?: string | null
  product_id: string | null
  quantity: number
  remaining: number
  products: Product | null
}

type ComboPrice = {
  draws: number
  price: number
}

type IchibanKuji = {
  id: string
  name: string
  total_draws: number
  avg_cost: number
  price?: number
  is_active: boolean
  set_type?: 'custom' | 'official'
  total_cost?: number
  created_at: string
  combo_prices?: ComboPrice[]
  opening_combo_prices?: ComboPrice[]
  ichiban_kuji_prizes: Prize[]
}

export default function IchibanKujiPage() {
  const router = useRouter()
  const [kujis, setKujis] = useState<IchibanKuji[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'staff' | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          setUserRole(data.data.role)
        }
      })
      .catch(() => { })
  }, [])

  useEffect(() => {
    fetchKujis()
  }, [])

  const fetchKujis = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ichiban-kuji')
      const data = await res.json()
      if (data.ok) {
        setKujis(data.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch ichiban kuji:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const getProfitColor = (profit: number) => {
    if (profit >= 200) return 'text-green-700 dark:text-green-400'
    if (profit >= 50) return 'text-green-600 dark:text-green-300'
    if (profit >= 0) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`確定要刪除一番賞「${name}」嗎？\n\n此操作無法復原。`)) {
      return
    }

    setDeleting(id)
    try {
      const res = await fetch(`/api/ichiban-kuji/${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        alert('刪除成功！')
        fetchKujis()
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">一番賞管理</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/barcode-print')}
              className="rounded bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700"
            >
              打印條碼
            </button>
            <button
              onClick={() => router.push('/ichiban-kuji/new')}
              className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              + 新增一番賞
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : kujis.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">
              <p className="mb-4">尚未建立任何一番賞</p>
              <button
                onClick={() => router.push('/ichiban-kuji/new')}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                建立第一個一番賞
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">名稱</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">總抽數</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">賞項數</th>
                    {userRole === 'admin' && (
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">平均成本/抽</th>
                    )}
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">售價/抽</th>
                    {userRole === 'admin' && (
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">利潤/抽</th>
                    )}
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">狀態</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">建立時間</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {kujis.map((kuji) => (
                    <React.Fragment key={kuji.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                        onClick={() => toggleRow(kuji.id)}
                      >
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-600">
                              {expandedRows.has(kuji.id) ? '▼' : '▶'}
                            </span>
                            {kuji.name}
                            {kuji.set_type === 'official' ? (
                              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                                官方
                              </span>
                            ) : (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                自製
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center text-sm text-gray-900 dark:text-gray-100">
                          {kuji.total_draws}
                        </td>
                        <td className="px-6 py-4 text-center text-sm text-gray-900 dark:text-gray-100">
                          {kuji.ichiban_kuji_prizes?.length || 0}
                        </td>
                        {userRole === 'admin' && (
                          <td className="px-6 py-4 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {formatCurrency(kuji.avg_cost)}
                          </td>
                        )}
                        <td className="px-6 py-4 text-right text-sm font-semibold text-green-600">
                          {formatCurrency(kuji.price || 0)}
                        </td>
                        {userRole === 'admin' && (
                          <td className="px-6 py-4 text-right text-sm font-bold">
                            <span className={getProfitColor((kuji.price || 0) - kuji.avg_cost)}>
                              {formatCurrency((kuji.price || 0) - kuji.avg_cost)}
                            </span>
                          </td>
                        )}
                        <td className="px-6 py-4 text-center text-sm">
                          <span
                            className={`inline-block rounded px-2 py-1 text-xs ${kuji.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                              }`}
                          >
                            {kuji.is_active ? '啟用' : '停用'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                          {formatDate(kuji.created_at)}
                        </td>
                        <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="relative flex items-center justify-center gap-2">
                            <button
                              onClick={() => router.push(`/ichiban-kuji/${kuji.id}/edit`)}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                            >
                              編輯
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenMenuId(openMenuId === kuji.id ? null : kuji.id)
                              }}
                              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-lg font-bold"
                              title="更多操作"
                            >
                              ⋯
                            </button>
                            {openMenuId === kuji.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-10"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOpenMenuId(null)
                                  }}
                                />
                                <div className="absolute right-0 top-8 z-20 w-32 rounded-lg bg-white dark:bg-gray-700 shadow-lg border border-gray-200 dark:border-gray-600 py-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (!kuji.is_active) {
                                        handleDelete(kuji.id, kuji.name)
                                        setOpenMenuId(null)
                                      } else {
                                        alert('請先停用一番賞再刪除')
                                      }
                                    }}
                                    disabled={deleting === kuji.id || kuji.is_active}
                                    className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed"
                                  >
                                    {deleting === kuji.id ? '刪除中...' : '刪除'}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedRows.has(kuji.id) && kuji.ichiban_kuji_prizes && (
                        <tr key={`${kuji.id}-details`} className="animate-[fadeIn_200ms_ease-in-out]">
                          <td colSpan={9} className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
                            <div className="space-y-4">
                              {/* 組合價資訊 */}
                              {kuji.combo_prices && kuji.combo_prices.length > 0 && (
                                <div className="rounded-lg border-2 border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/30 p-4">
                                  <h4 className="mb-2 text-sm font-semibold text-purple-700 dark:text-purple-300">組合價優惠</h4>
                                  <div className="flex flex-wrap gap-3">
                                    {kuji.combo_prices.map((combo, index) => (
                                      <div key={index} className="rounded bg-white dark:bg-gray-800 px-3 py-2 shadow-sm border border-purple-200 dark:border-purple-700">
                                        <span className="font-semibold text-purple-600 dark:text-purple-400">{combo.draws} 抽</span>
                                        <span className="mx-2 text-gray-500 dark:text-gray-400">→</span>
                                        <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(combo.price)}</span>
                                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                                          (平均 {formatCurrency(combo.price / combo.draws)}/抽)
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {kuji.opening_combo_prices && kuji.opening_combo_prices.length > 0 && (
                                <div className="rounded-lg border-2 border-amber-300 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-900/30 p-4">
                                  <h4 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">開套優惠（僅限未開套）</h4>
                                  <div className="flex flex-wrap gap-3">
                                    {kuji.opening_combo_prices.map((combo, index) => (
                                      <div key={index} className="rounded bg-white dark:bg-gray-800 px-3 py-2 shadow-sm border border-amber-200 dark:border-amber-700">
                                        <span className="font-semibold text-amber-600 dark:text-amber-400">{combo.draws} 抽</span>
                                        <span className="mx-2 text-gray-500 dark:text-gray-400">→</span>
                                        <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(combo.price)}</span>
                                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                                          (平均 {formatCurrency(combo.price / combo.draws)}/抽)
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 賞項明細 */}
                              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                                <h4 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">賞項明細</h4>
                                <table className="w-full">
                                  <thead className="border-b">
                                    <tr>
                                      <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">賞別</th>
                                      <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品名稱</th>
                                      {kuji.set_type !== 'official' && (
                                        <th className="pb-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">品號</th>
                                      )}
                                      <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">總數</th>
                                      <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">剩餘</th>
                                      {userRole === 'admin' && kuji.set_type !== 'official' && (
                                        <>
                                          <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">單位成本</th>
                                          <th className="pb-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">小計</th>
                                        </>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {kuji.ichiban_kuji_prizes.map((prize) => (
                                      <tr key={prize.id}>
                                        <td className="py-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                          {prize.prize_tier}
                                        </td>
                                        <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                          {kuji.set_type === 'official'
                                            ? (prize.prize_name || '-')
                                            : (prize.products?.name || '-')}
                                        </td>
                                        {kuji.set_type !== 'official' && (
                                          <td className="py-2 text-sm text-gray-500 dark:text-gray-400">
                                            {prize.products?.item_code || '-'}
                                          </td>
                                        )}
                                        <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                          {prize.quantity} {prize.products?.unit || '抽'}
                                        </td>
                                        <td className="py-2 text-right text-sm font-semibold">
                                          <span className={
                                            prize.remaining === 0
                                              ? 'text-gray-500 dark:text-gray-400'
                                              : prize.remaining <= 5
                                                ? 'text-orange-600 dark:text-orange-400'
                                                : 'text-green-600 dark:text-green-400'
                                          }>
                                            {prize.remaining === 0
                                              ? '完售'
                                              : prize.remaining <= 5
                                                ? `⚠ ${prize.remaining} 抽`
                                                : `${prize.remaining} 抽`}
                                          </span>
                                        </td>
                                        {userRole === 'admin' && kuji.set_type !== 'official' && (
                                          <>
                                            <td className="py-2 text-right text-sm text-gray-900 dark:text-gray-100">
                                              {formatCurrency(prize.products?.cost || 0)}
                                            </td>
                                            <td className="py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                              {formatCurrency((prize.products?.cost || 0) * prize.quantity)}
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                  {userRole === 'admin' && (
                                    <tfoot className="border-t-2 bg-gray-100 dark:bg-gray-800">
                                      <tr>
                                        <td colSpan={kuji.set_type === 'official' ? 3 : 5} className="py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-400">
                                          Σ 總成本:
                                        </td>
                                        <td colSpan={kuji.set_type === 'official' ? 1 : 2} className="py-3 text-right text-base font-bold text-gray-700 dark:text-gray-300">
                                          {formatCurrency(
                                            kuji.set_type === 'official'
                                              ? (kuji.total_cost || 0)
                                              : kuji.ichiban_kuji_prizes.reduce(
                                                  (sum, prize) => sum + (prize.products?.cost || 0) * prize.quantity,
                                                  0
                                                )
                                          )}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
