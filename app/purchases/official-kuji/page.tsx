'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import useSWR, { useSWRConfig } from 'swr'
import { SWR_KEYS } from '@/lib/swr/keys'
import { formatCurrency, formatDate } from '@/lib/utils'

type OfficialKuji = {
  id: string
  name: string
  total_cost: number
  vendor_code: string
  vendor_name: string
  is_received: boolean
  is_active: boolean
  created_at: string
  total_draws: number
  ap_status?: 'unpaid' | 'partial' | 'paid'
  ap_id?: string
  ap_amount: number
  ap_paid: number
}

type Account = {
  id: string
  account_name: string
  account_type: string
  balance: number
}

export default function OfficialKujiPurchasesPage() {
  const { mutate: globalMutate } = useSWRConfig()
  const { data: kujis = [], isLoading: loading, mutate } = useSWR<OfficialKuji[]>('/api/ichiban-kuji/official-purchases')
  const { data: allAccounts = [] } = useSWR<Account[]>(SWR_KEYS.ACCOUNTS)
  const accounts = allAccounts.filter(a => a.account_type !== 'virtual')

  const [processing, setProcessing] = useState<string | null>(null)
  // 付款彈窗
  const [payingKuji, setPayingKuji] = useState<OfficialKuji | null>(null)
  const [payAccountId, setPayAccountId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')

  const handleReceive = async (kuji: OfficialKuji) => {
    if (!confirm(`確定要將「${kuji.name}」標記為已收貨嗎？`)) return

    setProcessing(kuji.id)
    try {
      const res = await fetch(`/api/ichiban-kuji/${kuji.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_received: true }),
      })
      const data = await res.json()
      if (data.ok) {
        mutate()
      } else {
        alert(data.error || '操作失敗')
      }
    } catch {
      alert('操作失敗')
    } finally {
      setProcessing(null)
    }
  }

  const openPayDialog = (kuji: OfficialKuji) => {
    const remaining = kuji.ap_amount - kuji.ap_paid
    setPayingKuji(kuji)
    setPayAmount(String(remaining))
    setPayAccountId('')
    setPayNote('')
  }

  const handlePay = async () => {
    if (!payingKuji || !payAccountId || !payAmount) return
    const amount = Number(payAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('請輸入正確金額')
      return
    }

    const acct = accounts.find(a => a.id === payAccountId)
    if (!confirm(`確定從「${acct?.account_name}」付款 ${formatCurrency(amount)} 給「${payingKuji.name}」？`)) return

    setProcessing(payingKuji.id)
    try {
      const res = await fetch('/api/ichiban-kuji/official-purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kuji_id: payingKuji.id,
          account_id: payAccountId,
          amount,
          note: payNote || undefined,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        alert(`付款成功！已付 ${formatCurrency(data.data.paid_amount)}`)
        setPayingKuji(null)
        mutate()
        globalMutate(SWR_KEYS.ACCOUNTS)
      } else {
        alert(`付款失敗：${data.error}`)
      }
    } catch {
      alert('付款失敗')
    } finally {
      setProcessing(null)
    }
  }

  const totalCost = kujis.reduce((sum, k) => sum + k.total_cost, 0)
  const unreceived = kujis.filter(k => !k.is_received).length
  const unpaid = kujis.filter(k => k.ap_status === 'unpaid' || k.ap_status === 'partial').length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">官方賞進貨紀錄</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              所有官方一番賞的進貨、收貨與付款狀態
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
        <div className="mb-6 grid gap-4 grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">總套數</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{kujis.length}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">總成本</div>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totalCost)}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">未收貨</div>
            <div className={`text-2xl font-bold ${unreceived > 0 ? 'text-amber-600' : 'text-green-600'}`}>
              {unreceived}
            </div>
          </div>
          <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow">
            <div className="text-sm text-gray-600 dark:text-gray-400">未付款</div>
            <div className={`text-2xl font-bold ${unpaid > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {unpaid}
            </div>
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
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">收貨</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">付款狀態</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">建立日期</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {kujis.map((kuji) => {
                    const remaining = kuji.ap_amount - kuji.ap_paid
                    return (
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
                            kuji.is_received
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}>
                            {kuji.is_received ? '已收貨' : '未收貨'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center text-sm">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                              kuji.ap_status === 'paid'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                                : kuji.ap_status === 'partial'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                                  : kuji.ap_status === 'unpaid'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            }`}>
                              {kuji.ap_status === 'paid' ? '已付清' :
                                kuji.ap_status === 'partial' ? `部分 ${formatCurrency(kuji.ap_paid)}/${formatCurrency(kuji.ap_amount)}` :
                                  kuji.ap_status === 'unpaid' ? `未付 ${formatCurrency(kuji.ap_amount)}` : '無AP'}
                            </span>
                            {remaining > 0 && kuji.ap_status && kuji.ap_status !== 'paid' && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                餘 {formatCurrency(remaining)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">{formatDate(kuji.created_at)}</td>
                        <td className="px-6 py-4 text-center text-sm">
                          <div className="flex gap-2 justify-center">
                            {!kuji.is_received && (
                              <button
                                onClick={() => handleReceive(kuji)}
                                disabled={processing === kuji.id}
                                className="rounded bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                              >
                                {processing === kuji.id ? '...' : '收貨'}
                              </button>
                            )}
                            {kuji.ap_status && kuji.ap_status !== 'paid' && (
                              <button
                                onClick={() => openPayDialog(kuji)}
                                disabled={processing === kuji.id}
                                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                              >
                                付款
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 付款彈窗 */}
      {payingKuji && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPayingKuji(null)}>
          <div
            className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              付款 - {payingKuji.name}
            </h3>

            <div className="mb-4 rounded bg-gray-50 dark:bg-gray-700 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">總金額</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(payingKuji.ap_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">已付</span>
                <span className="font-semibold text-green-600">{formatCurrency(payingKuji.ap_paid)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
                <span className="text-gray-600 dark:text-gray-400">未付餘額</span>
                <span className="font-bold text-red-600">{formatCurrency(payingKuji.ap_amount - payingKuji.ap_paid)}</span>
              </div>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">付款帳戶</label>
              <select
                value={payAccountId}
                onChange={(e) => setPayAccountId(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
              >
                <option value="">選擇帳戶</option>
                {accounts.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.account_name}（{formatCurrency(acct.balance)}）
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">付款金額</label>
              <input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
              />
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">備註（選填）</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="例如：匯款、現金等"
                className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPayingKuji(null)}
                className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handlePay}
                disabled={!payAccountId || !payAmount || processing === payingKuji.id}
                className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {processing === payingKuji.id ? '處理中...' : '確認付款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
