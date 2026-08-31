'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewVendorPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const formData = new FormData(e.currentTarget)

    // 廠商編號由後端自動產生（進貨單靠它關聯，不讓使用者填）
    const data = {
      vendor_name: formData.get('vendor_name'),
      note: formData.get('note') || null,
    }

    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await res.json()

      if (result.ok) {
        router.push('/vendors')
      } else {
        setError(result.error || '建立失敗')
      }
    } catch (err) {
      setError('建立失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">新增廠商</h1>

        <form onSubmit={handleSubmit} className="rounded-lg bg-white p-4 shadow dark:bg-gray-800 md:p-6">
          {error && (
            <div className="mb-4 rounded bg-red-50 p-3 text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
              廠商名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="vendor_name"
              required
              autoFocus
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">備註</label>
            <textarea
              name="note"
              rows={3}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
              placeholder="選填，例如聯絡方式、出貨習慣"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {loading ? '建立中...' : '建立廠商'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
