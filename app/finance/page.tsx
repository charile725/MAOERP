'use client'

import CashFlowPanel from '@/components/CashFlowPanel'

export default function FinanceDashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">現金流</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            各帳戶當天的收入與支出
          </p>
        </div>

        <CashFlowPanel />
      </div>
    </div>
  )
}
