'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { formatCurrency, formatDate } from '@/lib/utils'
import { formatDbUtcDate } from '@/lib/timezone'
import { fetchNextSetName } from '@/lib/kuji-set-name'

type OfficialKuji = {
  id: string
  name: string
  total_cost: number
  vendor_code: string
  vendor_name: string
  is_active: boolean
  created_at: string
  total_draws: number
}

export default function OfficialKujiPurchasesPage() {
  const { data: kujis = [], isLoading: loading, mutate } = useSWR<OfficialKuji[]>('/api/ichiban-kuji/official-purchases')
  const [reopening, setReopening] = useState<string | null>(null)

  const totalCost = kujis.reduce((sum, k) => sum + k.total_cost, 0)
  const active = kujis.filter(k => k.is_active).length

  /**
   * 開新套：同一款官方賞再進一套。
   *
   * 以舊套為範本複製賞項（官方套的賞項只有名稱，沒有對應商品），賞項全部歸回未抽，
   * 舊套與它的銷售紀錄完全不動。成本問一次 —— 官方套的成本沒有商品可以算，
   * 一向是人工輸入的，而且同一款再進貨時進價常常不一樣。
   */
  const handleReopen = async (kuji: OfficialKuji) => {
    const defaultName = await fetchNextSetName(kuji.name)
    const name = prompt(
      `以「${kuji.name}」為範本再開一套。\n\n`
      + `新套的賞項跟舊套相同、全部未抽，舊套的銷售紀錄不會被動到。\n`
      + `廠商沿用 ${kuji.vendor_name}。\n\n`
      + `新套名稱：`,
      defaultName
    )
    if (name === null) return
    if (!name.trim()) { alert('名稱不能空白'); return }

    const costInput = prompt(
      `「${name.trim()}」這一套的進貨成本（元）：`,
      String(kuji.total_cost || 0)
    )
    if (costInput === null) return
    const parsedCost = Number(costInput.replace(/[,\s]/g, ''))
    if (!Number.isFinite(parsedCost) || parsedCost < 0) { alert('成本請輸入 0 或正數'); return }

    setReopening(kuji.id)
    try {
      const res = await fetch(`/api/ichiban-kuji/${kuji.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), total_cost: parsedCost }),
      })
      const data = await res.json()
      if (data.ok) {
        alert(
          `已開新套：「${data.data.new_name}」，共 ${data.data.total_draws} 抽、成本 ${formatCurrency(data.data.total_cost || 0)}`
          + (data.warning ? `\n\n⚠️ ${data.warning}` : '')
        )
        mutate()
      } else {
        alert(data.error || '開新套失敗')
      }
    } catch {
      alert('開新套失敗')
    } finally {
      setReopening(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">官方賞進貨紀錄</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              所有官方一番賞的進貨紀錄
            </p>
          </div>
          <Link
            href="/purchases"
            className="rounded bg-gray-200 dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            返回進貨單
          </Link>
        </div>

        {/* 統計卡片 */}
        <div className="mb-6 grid gap-4 grid-cols-3">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">總套數</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kujis.length}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">總成本</div>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totalCost)}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">販售中</div>
            <div className="text-2xl font-bold text-green-600">{active}</div>
          </div>
        </div>

        {/* 表格 */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">載入中...</div>
          ) : kujis.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">沒有官方賞進貨紀錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">名稱</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">廠商</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">成本</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">抽數</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">狀態</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">建立日期</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {kujis.map((kuji) => (
                    <tr key={kuji.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 text-sm font-medium">
                        <Link
                          href={`/ichiban-kuji/${kuji.id}/edit`}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                        >
                          {kuji.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{kuji.vendor_name}</td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {formatCurrency(kuji.total_cost)}
                      </td>
                      <td className="px-6 py-4 text-center text-sm text-gray-900 dark:text-gray-100">{kuji.total_draws}</td>
                      <td className="px-6 py-4 text-center text-sm">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          kuji.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          {kuji.is_active ? '販售中' : '未啟用'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{formatDbUtcDate(kuji.created_at)}</td>
                      <td className="px-6 py-4 text-right text-sm">
                        <button
                          onClick={() => handleReopen(kuji)}
                          disabled={reopening === kuji.id}
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                        >
                          {reopening === kuji.id ? '開新套中…' : '開新套'}
                        </button>
                      </td>
                    </tr>
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
