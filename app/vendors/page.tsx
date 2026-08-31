'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import type { Vendor } from '@/types'
import { vendorsKey } from '@/lib/swr/keys'
import { MoreHorizontal, Edit, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export default function VendorsPage() {
  const [keyword, setKeyword] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')

  const swrKey = vendorsKey(searchKeyword ? { keyword: searchKeyword } : {})
  const { data: vendors = [], isLoading: loading, mutate } = useSWR<Vendor[]>(swrKey)

  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [editName, setEditName] = useState('')
  const [editNote, setEditNote] = useState('')
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)

  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1) // 搜尋時重置到第一頁
    setSearchKeyword(keyword)
  }

  // 分頁計算
  const totalPages = Math.ceil(vendors.length / pageSize)
  const paginatedVendors = vendors.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const openEditModal = (vendor: Vendor) => {
    setEditingVendor(vendor)
    setEditName(vendor.vendor_name)
    setEditNote(vendor.note || '')
    setError('')
  }

  const closeEditModal = () => {
    setEditingVendor(null)
    setError('')
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingVendor) return

    setProcessing(true)
    setError('')

    try {
      // 只送名稱與備註，其他欄位維持原樣（廠商編號是進貨單的關聯鍵，不能動）
      const res = await fetch(`/api/vendors?id=${editingVendor.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_name: editName.trim(),
          note: editNote.trim() || null,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        mutate()
        closeEditModal()
      } else {
        setError(data.error || '更新失敗')
      }
    } catch (err) {
      setError('更新失敗')
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (vendor: Vendor) => {
    if (!confirm(`確定要刪除廠商「${vendor.vendor_name}」嗎？\n\n此操作無法復原。`)) {
      return
    }

    try {
      const res = await fetch(`/api/vendors?id=${vendor.id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (data.ok) {
        mutate()
        alert('刪除成功')
      } else {
        alert(data.error || '刪除失敗')
      }
    } catch (err) {
      alert('刪除失敗')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">廠商管理</h1>
          <Link
            href="/vendors/new"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            + 新增廠商
          </Link>
        </div>

        {/* 搜尋 */}
        <form onSubmit={handleSearch} className="mb-6 flex gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋廠商名稱或備註"
            className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-400"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
          >
            搜尋
          </button>
        </form>

        {/* Vendors table */}
        <div className="rounded-lg bg-white dark:bg-gray-800 shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">載入中...</div>
          ) : vendors.length === 0 ? (
            <div className="p-8 text-center text-gray-900 dark:text-gray-100">沒有廠商資料</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">廠商名稱</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">備註</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900 dark:text-gray-100">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedVendors.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{vendor.vendor_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{vendor.note || '-'}</td>
                      <td className="px-6 py-4 text-center text-sm">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditModal(vendor)}>
                              <Edit className="mr-2 h-4 w-4" />
                              編輯
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(vendor)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              刪除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 分頁控制 */}
          {!loading && vendors.length > 0 && (
            <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-between">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                共 {vendors.length} 筆資料，顯示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, vendors.length)} 筆
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                >
                  <option value={10}>10 筆/頁</option>
                  <option value={20}>20 筆/頁</option>
                  <option value={50}>50 筆/頁</option>
                  <option value={100}>100 筆/頁</option>
                </select>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一頁
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded px-3 py-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">編輯廠商</h2>

            {error && (
              <div className="mb-4 rounded bg-red-50 dark:bg-red-900 p-3 text-red-700 dark:text-red-200">{error}</div>
            )}

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">
                  廠商名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">備註</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-gray-100 dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {processing ? '更新中...' : '確認更新'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
