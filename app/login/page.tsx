'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (data.ok) {
        // 使用 window.location.href 強制完整刷新，清除所有前端狀態
        window.location.href = '/'
      } else {
        setError(data.error || '登入失敗')
      }
    } catch (err) {
      setError('登入失敗，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <img
            src="/瘋玩logo.jpg"
            alt="瘋玩"
            className="mx-auto w-24 h-24 rounded-2xl shadow-lg mb-4 object-cover"
          />
          <p className="text-gray-600 dark:text-gray-400">請登入您的帳號</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-500 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                帳號
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none transition-colors"
                placeholder="請輸入帳號"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                密碼
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none transition-colors"
                placeholder="請輸入密碼"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-colors shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
            >
              {loading ? '登入中...' : '登入'}
            </button>
          </form>

          {/* Demo Info */}
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              測試帳號：admin / staff
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
          © 2025 瘋玩ERP. All rights reserved.
        </p>
      </div>
    </div>
  )
}
