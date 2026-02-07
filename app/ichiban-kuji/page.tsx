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
  is_received?: boolean
  vendor_code?: string | null
  set_type?: 'custom' | 'official'
  total_cost?: number
  created_at: string
  combo_prices?: ComboPrice[]
  opening_combo_prices?: ComboPrice[]
  ichiban_kuji_prizes: Prize[]
  // 最後賞
  last_prize_name?: string | null
  last_prize_product_id?: string | null
  last_prize_product?: {
    id: string
    name: string
    item_code: string
    cost: number
  } | null
}

export default function IchibanKujiPage() {
  const router = useRouter()
  const [kujis, setKujis] = useState<IchibanKuji[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'staff' | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'custom' | 'official'>('all')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0
  })

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
    fetchKujis(page)
  }, [page, typeFilter])

  const fetchKujis = async (currentPage: number = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(currentPage) })
      if (typeFilter !== 'all') params.set('set_type', typeFilter)
      const res = await fetch(`/api/ichiban-kuji?${params}`)
      const data = await res.json()
      if (data.ok) {
        setKujis(data.data || [])
        if (data.pagination) {
          setPagination(data.pagination)
        }
      }
    } catch (err) {
      console.error('Failed to fetch ichiban kuji:', err)
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    setExpandedRows(new Set()) // 換頁時收合所有展開的列
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
        fetchKujis(page)
      } else {
        alert(`刪除失敗：${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗')
    } finally {
      setDeleting(null)
    }
  }

  const handleToggleActive = async (kuji: IchibanKuji) => {
    const newActive = !kuji.is_active
    try {
      const res = await fetch(`/api/ichiban-kuji/${kuji.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newActive }),
      })
      const data = await res.json()
      if (data.ok) {
        fetchKujis(page)
      } else {
        alert(data.error || '操作失敗')
      }
    } catch (err) {
      alert('操作失敗')
    }
  }

  const handleMarkReceived = async (kuji: IchibanKuji) => {
    if (!confirm(`確定要將「${kuji.name}」標記為已收貨嗎？`)) return
    try {
      const res = await fetch(`/api/ichiban-kuji/${kuji.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_received: true }),
      })
      const data = await res.json()
      if (data.ok) {
        alert('已標記為收貨')
        fetchKujis(page)
      } else {
        alert(data.error || '操作失敗')
      }
    } catch (err) {
      alert('操作失敗')
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

        {/* 分類篩選 */}
        <div className="mb-4 flex gap-2">
          {([
            { key: 'all', label: '全部' },
            { key: 'custom', label: '自製' },
            { key: 'official', label: '官方' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTypeFilter(key); setPage(1) }}
              className={`rounded px-4 py-1.5 text-sm font-medium ${typeFilter === key
                ? key === 'official' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
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
            <div className="overflow-visible">
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
                        <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-center gap-1">
                            {/* 收貨狀態（僅官方套顯示） */}
                            {kuji.set_type === 'official' && (
                              <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${kuji.is_received === false
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400'
                                }`}>
                                {kuji.is_received === false ? '未收貨' : '已收貨'}
                              </span>
                            )}
                            {/* 啟用/停用切換按鈕 */}
                            <button
                              onClick={() => handleToggleActive(kuji)}
                              disabled={kuji.set_type === 'official' && kuji.is_received === false && !kuji.is_active}
                              title={kuji.set_type === 'official' && kuji.is_received === false && !kuji.is_active ? '尚未收貨，無法啟用' : ''}
                              className={`inline-block rounded px-2 py-1 text-xs font-medium transition-colors ${kuji.is_active
                                ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
                                : kuji.set_type === 'official' && kuji.is_received === false
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
                                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                                }`}
                            >
                              {kuji.is_active ? '啟用' : '停用'}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                          {formatDate(kuji.created_at)}
                        </td>
                        <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="relative flex items-center justify-center">
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
                                <div className="absolute right-0 top-8 z-20 w-36 rounded-lg bg-white dark:bg-gray-700 shadow-lg border border-gray-200 dark:border-gray-600 py-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      router.push(`/ichiban-kuji/${kuji.id}/edit`)
                                      setOpenMenuId(null)
                                    }}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600"
                                  >
                                    編輯
                                  </button>
                                  {/* 啟用/停用 */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleToggleActive(kuji)
                                      setOpenMenuId(null)
                                    }}
                                    disabled={kuji.set_type === 'official' && kuji.is_received === false && !kuji.is_active}
                                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                                      kuji.set_type === 'official' && kuji.is_received === false && !kuji.is_active
                                        ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                        : kuji.is_active
                                          ? 'text-yellow-600 dark:text-yellow-400'
                                          : 'text-green-600 dark:text-green-400'
                                    }`}
                                  >
                                    {kuji.is_active ? '停用' : '啟用'}
                                  </button>
                                  {/* 標記已收貨（僅官方套且未收貨時顯示） */}
                                  {kuji.set_type === 'official' && kuji.is_received === false && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleMarkReceived(kuji)
                                        setOpenMenuId(null)
                                      }}
                                      className="block w-full text-left px-4 py-2 text-sm text-teal-600 dark:text-teal-400 hover:bg-gray-100 dark:hover:bg-gray-600"
                                    >
                                      標記已收貨
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDelete(kuji.id, kuji.name)
                                      setOpenMenuId(null)
                                    }}
                                    disabled={deleting === kuji.id}
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
                                              ) + (kuji.last_prize_product?.cost || 0)
                                          )}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>

                                {/* 最後賞 */}
                                {(kuji.last_prize_name || kuji.last_prize_product) && (
                                  <div className="mt-3 rounded border-2 border-pink-300 dark:border-pink-600 bg-pink-50/50 dark:bg-pink-900/30 px-4 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold text-pink-700 dark:text-pink-300">最後賞</span>
                                      <span className="text-sm text-gray-900 dark:text-gray-100">
                                        {kuji.set_type === 'official'
                                          ? kuji.last_prize_name
                                          : kuji.last_prize_product?.name}
                                      </span>
                                      {userRole === 'admin' && kuji.set_type !== 'official' && kuji.last_prize_product && (
                                        <span className="ml-auto text-sm text-gray-600 dark:text-gray-400">
                                          成本: <span className="font-semibold text-pink-600 dark:text-pink-400">{formatCurrency(kuji.last_prize_product.cost)}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      顯示第 {((pagination.page - 1) * pagination.pageSize) + 1} - {Math.min(pagination.page * pagination.pageSize, pagination.total)} 筆，共 {pagination.total} 筆
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page === 1}
                        className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        上一頁
                      </button>

                      {/* Page numbers */}
                      <div className="flex gap-1">
                        {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                          .filter(p => {
                            return p === 1 ||
                              p === pagination.totalPages ||
                              (p >= page - 2 && p <= page + 2)
                          })
                          .map((p, idx, arr) => {
                            const showEllipsisBefore = idx > 0 && arr[idx - 1] !== p - 1
                            return (
                              <div key={p} className="flex items-center gap-1">
                                {showEllipsisBefore && <span className="px-2 text-gray-500 dark:text-gray-400">...</span>}
                                <button
                                  onClick={() => handlePageChange(p)}
                                  className={`min-w-[2rem] rounded px-3 py-1 text-sm ${p === page
                                    ? 'bg-blue-600 text-white'
                                    : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                    }`}
                                >
                                  {p}
                                </button>
                              </div>
                            )
                          })}
                      </div>

                      <button
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page === pagination.totalPages}
                        className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        下一頁
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
