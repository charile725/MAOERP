'use client'

import React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { formatCurrency, formatDate } from '@/lib/utils'

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
  const { data: kujis = [], isLoading: loading } = useSWR<OfficialKuji[]>('/api/ichiban-kuji/official-purchases')

  const totalCost = kujis.reduce((sum, k) => sum + k.total_cost, 0)
  const active = kujis.filter(k => k.is_active).length

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
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{formatDate(kuji.created_at)}</td>
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
