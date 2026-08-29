'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR, { useSWRConfig } from 'swr'
import { SWR_KEYS, ichibanKujiKey } from '@/lib/swr/keys'
import { paginatedFetcher } from '@/lib/swr/fetcher'
import { formatCurrency, formatDate } from '@/lib/utils'

type Product = {
  id: string
  name: string
  item_code: string
  cost: number
  unit: string
}

type PrizeOption = {
  id: string
  product_id: string
  is_consumed: boolean
  products: Product | null
}

type Prize = {
  id: string
  prize_tier: string
  prize_name?: string | null
  product_id: string | null
  quantity: number
  remaining: number
  products: Product | null
  ichiban_kuji_prize_options?: PrizeOption[]
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
  vendor_code?: string | null
  set_type?: 'custom' | 'official'
  total_cost?: number
  created_at: string
  combo_prices?: ComboPrice[]
  opening_combo_prices?: ComboPrice[]
  ichiban_kuji_prizes: Prize[]
  // 已確認銷售的實際營收（已反映組合價/開套優惠），用於目前利潤估算
  actual_revenue?: number
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
  const { mutate: globalMutate } = useSWRConfig()
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'custom' | 'official'>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  // 廢套結算
  const [closeSetDialog, setCloseSetDialog] = useState<{
    kujiId: string
    kujiName: string
    hasLastPrize: boolean
  } | null>(null)
  const [closeSetPreview, setCloseSetPreview] = useState<any>(null)
  const [closeSetLoading, setCloseSetLoading] = useState(false)
  const [closeSetAccountId, setCloseSetAccountId] = useState<string>('')
  const [closeSetLastPrize, setCloseSetLastPrize] = useState(false)
  const [closeSetExecuting, setCloseSetExecuting] = useState(false)
  const [page, setPage] = useState(1)

  // SWR: auth/me
  const { data: authData } = useSWR<{ role: 'admin' | 'staff' }>(SWR_KEYS.AUTH_ME)
  const userRole = authData?.role ?? null

  // SWR: accounts (for close-set dialog)
  const { data: accounts = [] } = useSWR<{ id: string; account_name: string }[]>(SWR_KEYS.ACCOUNTS)

  // SWR: kuji list with pagination
  const kujiParams: Record<string, string> = { page: String(page) }
  if (typeFilter !== 'all') kujiParams.set_type = typeFilter
  if (activeFilter !== 'all') kujiParams.active = activeFilter === 'active' ? 'true' : 'false'

  const { data: kujiResult, isLoading: loading, mutate } = useSWR<{ data: IchibanKuji[]; pagination: any }>(
    ichibanKujiKey(kujiParams),
    paginatedFetcher
  )
  const kujis = kujiResult?.data ?? []
  const pagination = kujiResult?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0 }

  useEffect(() => { setPage(1) }, [typeFilter, activeFilter])

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
    if (profit > 0) return 'text-green-600 dark:text-green-400'
    if (profit === 0) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  const calcCurrentProfit = (kuji: IchibanKuji) => {
    const prizes = kuji.ichiban_kuji_prizes || []
    let drawsSold = 0
    let costConsumed = 0

    if (kuji.set_type === 'official') {
      // 官方套無法拆分各賞項成本，與銷售紀錄記成本方式一致：用平均成本/抽計算
      drawsSold = kuji.total_draws - prizes.reduce((sum, p) => sum + (p.remaining ?? 0), 0)
      costConsumed = (kuji.avg_cost || 0) * drawsSold
    } else {
      // 自製套：與廢套結算（close-set）邏輯一致，逐賞項計算已抽出的實際成本
      for (const prize of prizes) {
        const drawn = prize.quantity - (prize.remaining ?? 0)
        drawsSold += drawn

        const options = prize.ichiban_kuji_prize_options || []
        if (options.length > 0) {
          // 複選獎：成本取已實際消耗選項的商品成本加總（而非當作 0）
          costConsumed += options
            .filter((o) => o.is_consumed)
            .reduce((sum, o) => sum + (o.products?.cost ?? 0), 0)
        } else {
          costConsumed += drawn * (prize.products?.cost ?? 0)
        }
      }

      // 最後賞成本：套組全部抽完才視為已送出，未抽完前不計入（與廢套結算邏輯一致）
      if (kuji.total_draws > 0 && drawsSold >= kuji.total_draws && kuji.last_prize_product) {
        costConsumed += kuji.last_prize_product.cost ?? 0
      }
    }

    // 實際營收：取已確認銷售的實收金額（已反映組合價/開套優惠），而非用原價推估
    const revenue = kuji.actual_revenue ?? 0
    return { profit: revenue - costConsumed, drawsSold }
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
        mutate()
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
        mutate()
      } else {
        alert(data.error || '操作失敗')
      }
    } catch (err) {
      alert('操作失敗')
    }
  }

  const handleCloseSetPreview = async (kuji: IchibanKuji) => {
    setCloseSetDialog({
      kujiId: kuji.id,
      kujiName: kuji.name,
      hasLastPrize: !!kuji.last_prize_product_id,
    })
    setCloseSetPreview(null)
    setCloseSetAccountId('')
    setCloseSetLastPrize(false)
    setCloseSetLoading(true)
    try {
      const res = await fetch(`/api/ichiban-kuji/${kuji.id}/close-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, last_prize_delivered: false }),
      })
      const data = await res.json()
      if (data.ok) {
        setCloseSetPreview(data.data)
      } else {
        alert(data.error || '預覽失敗')
        setCloseSetDialog(null)
      }
    } catch {
      alert('預覽失敗')
      setCloseSetDialog(null)
    } finally {
      setCloseSetLoading(false)
    }
  }

  const handleCloseSetRefreshPreview = async (lastPrizeDelivered: boolean) => {
    if (!closeSetDialog) return
    setCloseSetLoading(true)
    try {
      const res = await fetch(`/api/ichiban-kuji/${closeSetDialog.kujiId}/close-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, last_prize_delivered: lastPrizeDelivered }),
      })
      const data = await res.json()
      if (data.ok) {
        setCloseSetPreview(data.data)
      }
    } catch {
      // ignore
    } finally {
      setCloseSetLoading(false)
    }
  }

  const handleCloseSetExecute = async () => {
    if (!closeSetDialog) return
    if (!confirm(`確定要廢套結算「${closeSetDialog.kujiName}」嗎？\n\n此操作會建立費用記錄並停用此一番賞。`)) return
    setCloseSetExecuting(true)
    try {
      const res = await fetch(`/api/ichiban-kuji/${closeSetDialog.kujiId}/close-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview: false,
          account_id: closeSetAccountId || null,
          last_prize_delivered: closeSetLastPrize,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        alert('廢套結算完成')
        setCloseSetDialog(null)
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS)
      } else {
        alert(data.error || '結算失敗')
      }
    } catch {
      alert('結算失敗')
    } finally {
      setCloseSetExecuting(false)
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

        {/* 篩選列 */}
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">狀態</span>
            <div className="flex gap-1">
              {([
                { key: 'all', label: '全部' },
                { key: 'active', label: '啟用' },
                { key: 'inactive', label: '停用' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setActiveFilter(key); setPage(1) }}
                  className={`rounded px-3 py-1 text-sm font-medium ${activeFilter === key
                    ? key === 'active' ? 'bg-green-600 text-white'
                      : key === 'inactive' ? 'bg-gray-500 text-white'
                      : 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">類型</span>
            <div className="flex gap-1">
              {([
                { key: 'all', label: '全部' },
                { key: 'custom', label: '自製' },
                { key: 'official', label: '官方' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setTypeFilter(key); setPage(1) }}
                  className={`rounded px-3 py-1 text-sm font-medium ${typeFilter === key
                    ? key === 'official' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
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
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">目前利潤</th>
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
                        {userRole === 'admin' && (() => {
                          const { profit, drawsSold } = calcCurrentProfit(kuji)
                          return (
                            <td className="px-6 py-4 text-right text-sm font-bold">
                              <span className={getProfitColor(profit)}>
                                {formatCurrency(profit)}
                              </span>
                              <div className="text-xs text-gray-400 font-normal">{drawsSold}/{kuji.total_draws} 抽</div>
                            </td>
                          )
                        })()}
                        <td className="px-6 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-center gap-1">
                            {/* 啟用/停用切換按鈕 */}
                            <button
                              onClick={() => handleToggleActive(kuji)}
                              className={`inline-block rounded px-2 py-1 text-xs font-medium transition-colors ${kuji.is_active
                                ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
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
                                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                                      kuji.is_active
                                        ? 'text-yellow-600 dark:text-yellow-400'
                                        : 'text-green-600 dark:text-green-400'
                                    }`}
                                  >
                                    {kuji.is_active ? '停用' : '啟用'}
                                  </button>
                                  {/* 廢套結算（僅自製套 + 啟用中） */}
                                  {kuji.set_type === 'custom' && kuji.is_active && userRole === 'admin' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleCloseSetPreview(kuji)
                                        setOpenMenuId(null)
                                      }}
                                      className="block w-full text-left px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-gray-100 dark:hover:bg-gray-600"
                                    >
                                      廢套結算
                                    </button>
                                  )}
                                  {/* 復活（僅自製套 + 已停用） */}
                                  {kuji.set_type === 'custom' && !kuji.is_active && userRole === 'admin' && (
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation()
                                        setOpenMenuId(null)
                                        if (!confirm(`確定要復活「${kuji.name}」嗎？\n\n將反轉廢套結算的費用記錄並重新啟用。`)) return
                                        try {
                                          const res = await fetch(`/api/ichiban-kuji/${kuji.id}/reactivate`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({}),
                                          })
                                          const data = await res.json()
                                          if (data.ok) {
                                            alert(`已復活「${kuji.name}」${data.data.expense_reversed ? `，已回補費用 $${data.data.amount_reversed}` : ''}`)
                                            mutate()
                                          } else {
                                            alert(data.error || '復活失敗')
                                          }
                                        } catch {
                                          alert('復活失敗')
                                        }
                                      }}
                                      className="block w-full text-left px-4 py-2 text-sm text-green-600 dark:text-green-400 hover:bg-gray-100 dark:hover:bg-gray-600"
                                    >
                                      復活
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
                                    {kuji.ichiban_kuji_prizes.map((prize) => {
                                      const options = prize.ichiban_kuji_prize_options || []
                                      const isSelection = options.length > 0
                                      const avgOptionCost = isSelection
                                        ? options.reduce((s, o) => s + (o.products?.cost || 0), 0) / options.length
                                        : 0
                                      return (
                                        <tr key={prize.id}>
                                          <td className="py-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                            <div className="flex items-center gap-1.5">
                                              {prize.prize_tier}
                                              {isSelection && (
                                                <span className="rounded bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                                                  {options.length}選1
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2 text-sm text-gray-900 dark:text-gray-100">
                                            {kuji.set_type === 'official'
                                              ? (prize.prize_name || '-')
                                              : isSelection
                                                ? (
                                                  <div className="flex flex-wrap gap-1">
                                                    {options.map(opt => (
                                                      <span key={opt.id} className={`inline-block rounded px-1.5 py-0.5 text-xs ${opt.is_consumed ? 'bg-gray-200 text-gray-400 line-through dark:bg-gray-700 dark:text-gray-500' : 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'}`}>
                                                        {opt.products?.name || '?'}
                                                      </span>
                                                    ))}
                                                  </div>
                                                )
                                                : (prize.products?.name || '-')}
                                          </td>
                                          {kuji.set_type !== 'official' && (
                                            <td className="py-2 text-sm text-gray-500 dark:text-gray-400">
                                              {isSelection ? '-' : (prize.products?.item_code || '-')}
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
                                                {isSelection
                                                  ? <span className="text-xs text-violet-600 dark:text-violet-400">平均 {formatCurrency(avgOptionCost)}</span>
                                                  : formatCurrency(prize.products?.cost || 0)}
                                              </td>
                                              <td className="py-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                {isSelection
                                                  ? formatCurrency(avgOptionCost * prize.quantity)
                                                  : formatCurrency((prize.products?.cost || 0) * prize.quantity)}
                                              </td>
                                            </>
                                          )}
                                        </tr>
                                      )
                                    })}
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
                                                (sum, prize) => {
                                                  const options = prize.ichiban_kuji_prize_options || []
                                                  if (options.length > 0) {
                                                    const avgCost = options.reduce((s, o) => s + (o.products?.cost || 0), 0) / options.length
                                                    return sum + avgCost * prize.quantity
                                                  }
                                                  return sum + (prize.products?.cost || 0) * prize.quantity
                                                },
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

      {/* 廢套結算彈窗 */}
      {closeSetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCloseSetDialog(null)}>
          <div
            className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white dark:bg-gray-800 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                廢套結算 - {closeSetDialog.kujiName}
              </h2>
            </div>

            <div className="px-6 py-4 space-y-4">
              {closeSetLoading && !closeSetPreview ? (
                <div className="py-8 text-center text-gray-500">計算中...</div>
              ) : closeSetPreview ? (
                <>
                  {/* 賞項明細 */}
                  <div className="rounded border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">賞別</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-900 dark:text-gray-100">商品</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">已抽/總數</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">已抽成本</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {closeSetPreview.prize_details.map((p: any, i: number) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-gray-100">{p.prize_tier}</td>
                            <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{p.product_name}</td>
                            <td className="px-3 py-1.5 text-right text-gray-900 dark:text-gray-100">
                              {p.drawn}/{p.quantity}
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium text-gray-900 dark:text-gray-100">
                              {formatCurrency(p.drawn_cost)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 最後賞勾選 */}
                  {closeSetDialog.hasLastPrize && (
                    <label className="flex items-center gap-2 rounded border border-pink-200 dark:border-pink-700 bg-pink-50 dark:bg-pink-900/30 px-4 py-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={closeSetLastPrize}
                        onChange={(e) => {
                          setCloseSetLastPrize(e.target.checked)
                          handleCloseSetRefreshPreview(e.target.checked)
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm font-medium text-pink-700 dark:text-pink-300">
                        最後賞已送出
                        {closeSetPreview.last_prize_product_name && (
                          <span className="ml-1 text-gray-600 dark:text-gray-400">
                            ({closeSetPreview.last_prize_product_name}, 成本 {formatCurrency(closeSetPreview.last_prize_cost)})
                          </span>
                        )}
                      </span>
                    </label>
                  )}

                  {/* 計算摘要 */}
                  <div className="space-y-2 rounded bg-gray-50 dark:bg-gray-900 p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">已售抽數</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {closeSetPreview.total_draws_sold} / {closeSetPreview.total_draws}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">被抽出商品總成本</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {formatCurrency(closeSetPreview.actual_cost_of_drawn)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        已記錄成本 ({formatCurrency(closeSetPreview.avg_cost)} x {closeSetPreview.total_draws_sold})
                      </span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {formatCurrency(closeSetPreview.recorded_cost)}
                      </span>
                    </div>
                    <div className="border-t border-gray-300 dark:border-gray-600 pt-2 flex justify-between">
                      <span className="font-bold text-gray-900 dark:text-gray-100">調整金額</span>
                      <span className={`text-lg font-bold ${
                        closeSetPreview.adjustment > 0
                          ? 'text-red-600 dark:text-red-400'
                          : closeSetPreview.adjustment < 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {closeSetPreview.adjustment >= 0 ? '+' : ''}{formatCurrency(closeSetPreview.adjustment)}
                      </span>
                    </div>
                    {closeSetPreview.adjustment > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        實際成本高於記錄，需補記費用
                      </p>
                    )}
                    {closeSetPreview.adjustment < 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        實際成本低於記錄，沖回費用
                      </p>
                    )}
                  </div>

                  {/* 帳戶選擇 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      扣款帳戶（選填）
                    </label>
                    <select
                      value={closeSetAccountId}
                      onChange={(e) => setCloseSetAccountId(e.target.value)}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                    >
                      <option value="">不扣帳戶（僅記費用）</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>{acc.account_name}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setCloseSetDialog(null)}
                className="rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handleCloseSetExecute}
                disabled={!closeSetPreview || closeSetExecuting || closeSetLoading}
                className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {closeSetExecuting ? '結算中...' : '確認結算'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
