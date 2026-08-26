'use client'

import React, { useState, useRef, useMemo } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { formatCurrency, formatPaymentMethod } from '@/lib/utils'

type ParsedRow = {
  rowNumber: number
  customerName: string
  customerPhone: string
  itemList: string
  paymentMethod: string
  note?: string
  isPaid?: string
  discountType?: string
  discountValue?: string
}

type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

type OrderPreview = {
  rowNumber: number
  customerName: string
  customerPhone: string
  items: {
    identifier: string // 品號 or 一番賞名稱/賞項
    quantity: number
  }[]
  paymentMethod: string
  note: string
  isPaid: boolean
  discountType: 'none' | 'percent' | 'amount'
  discountValue: number
  validation: ValidationResult
}

type PaymentAccount = {
  id: string
  account_name: string
  display_name: string | null
  payment_method_code: string | null
}

export default function LiveImportPage() {
  // 付款方式一律以「帳戶管理」設定的為準，不要在這裡另外寫死清單
  const { data: rawAccounts = [] } = useSWR<PaymentAccount[]>('/api/accounts?active_only=true')
  const paymentOptions = useMemo(
    () => rawAccounts
      .filter(acc => acc.payment_method_code)
      .map(acc => ({
        code: acc.payment_method_code as string,
        label: acc.display_name || acc.account_name,
      })),
    [rawAccounts]
  )

  const [parsedData, setParsedData] = useState<ParsedRow[]>([])
  const [orderPreviews, setOrderPreviews] = useState<OrderPreview[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    success: number
    failed: number
    errors: { row: number; error: string }[]
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (file: File) => {
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.csv')) {
      // Parse CSV
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processData(results.data as any[])
        },
        error: (error) => {
          alert(`CSV 解析錯誤: ${error.message}`)
        }
      })
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Parse Excel
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: 'array' })
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

          // Convert to object array with headers
          if (jsonData.length > 0) {
            const headers = jsonData[0] as string[]
            const rows = jsonData.slice(1).map((row: any) => {
              const obj: any = {}
              headers.forEach((header, index) => {
                obj[header] = row[index]
              })
              return obj
            })
            processData(rows)
          }
        } catch (error) {
          alert(`Excel 解析錯誤: ${error}`)
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      alert('請上傳 .csv, .xlsx 或 .xls 檔案')
    }
  }

  const processData = (data: any[]) => {
    const parsed: ParsedRow[] = data.map((row, index) => ({
      rowNumber: index + 2, // +2 because row 1 is header, and we want 1-indexed
      customerName: row['客戶名稱'] || row['客户名称'] || '',
      customerPhone: row['客戶電話'] || row['客户电话'] || '',
      itemList: row['商品清單'] || row['商品清单'] || '',
      paymentMethod: row['付款方式'] || '',
      note: row['備註'] || row['备注'] || '',
      isPaid: row['已收款'] || row['已收款'] || '',
      discountType: row['折扣類型'] || row['折扣类型'] || '',
      discountValue: row['折扣值'] || row['折扣值'] || '',
    }))

    setParsedData(parsed)
    validateAndPreview(parsed)
  }

  const validateAndPreview = (data: ParsedRow[]) => {
    const previews: OrderPreview[] = data.map((row) => {
      const validation: ValidationResult = {
        valid: true,
        errors: [],
        warnings: []
      }

      // Parse items
      const items: { identifier: string; quantity: number }[] = []
      if (row.itemList && row.itemList.trim() !== '') {
        const itemParts = row.itemList.split(';').map(s => s.trim()).filter(s => s !== '')
        itemParts.forEach((part) => {
          const [identifier, qtyStr] = part.split(',').map(s => s.trim())
          const quantity = parseInt(qtyStr, 10)

          if (!identifier) {
            validation.errors.push('商品清單格式錯誤：缺少商品識別碼')
            validation.valid = false
          } else if (isNaN(quantity) || quantity <= 0) {
            validation.errors.push(`商品 "${identifier}" 的數量無效`)
            validation.valid = false
          } else {
            items.push({ identifier, quantity })
          }
        })
      } else {
        validation.errors.push('商品清單不能為空')
        validation.valid = false
      }

      // Validate payment method（以帳戶管理的設定為準）
      const validPaymentMethods = paymentOptions.map(opt => opt.code)
      if (!validPaymentMethods.includes(row.paymentMethod)) {
        validation.errors.push(`付款方式 "${row.paymentMethod}" 無效`)
        validation.valid = false
      }

      // Parse isPaid
      const isPaid = ['是', 'yes', 'true', '1', 'TRUE', 'YES'].includes(row.isPaid?.toString() || '')

      // Parse discount
      let discountType: 'none' | 'percent' | 'amount' = 'none'
      let discountValue = 0
      if (row.discountType) {
        if (['percent', 'amount'].includes(row.discountType)) {
          discountType = row.discountType as 'percent' | 'amount'
          discountValue = parseFloat(row.discountValue || '0')
          if (isNaN(discountValue) || discountValue < 0) {
            validation.warnings.push('折扣值無效，將設為 0')
            discountValue = 0
          }
        } else if (row.discountType !== 'none') {
          validation.warnings.push(`折扣類型 "${row.discountType}" 無效，將設為無折扣`)
        }
      }

      // Validate customer info
      if (!row.customerName && !row.customerPhone) {
        validation.warnings.push('未提供客戶資訊，將作為散客處理')
      }

      return {
        rowNumber: row.rowNumber,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        items,
        paymentMethod: row.paymentMethod,
        note: row.note || '',
        isPaid,
        discountType,
        discountValue,
        validation
      }
    })

    setOrderPreviews(previews)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const downloadTemplate = () => {
    const template = [
      ['客戶名稱', '客戶電話', '商品清單', '付款方式', '備註', '已收款', '折扣類型', '折扣值'],
      ['王小明', '0912345678', '4711234567890,2;4711234567891,1', paymentOptions[0]?.code || 'cash', '直播訂單範例（使用條碼）', '是', 'none', '0'],
      ['李大華', '0923456789', '鬼滅之刃一番賞/A賞,1;鬼滅之刃一番賞/B賞,2', 'cash', '一番賞範例', '是', 'percent', '10'],
      ['張三', '0934567890', '4711234567890,3;鬼滅之刃一番賞/C賞,1', 'card', '混合範例（條碼+一番賞）', '是', 'amount', '50'],
    ]

    const ws = XLSX.utils.aoa_to_sheet(template)

    // 設定欄寬
    ws['!cols'] = [
      { wch: 12 }, // 客戶名稱
      { wch: 15 }, // 客戶電話
      { wch: 40 }, // 商品清單
      { wch: 18 }, // 付款方式
      { wch: 20 }, // 備註
      { wch: 10 }, // 已收款
      { wch: 12 }, // 折扣類型
      { wch: 10 }, // 折扣值
    ]

    // 加入數據驗證（下拉選單）
    ws['!dataValidation'] = [
      // 付款方式下拉選單（D欄，從第2列開始）
      {
        type: 'list',
        sqref: 'D2:D1000',
        formulas: [`"${paymentOptions.map(opt => opt.code).join(',')}"`],
        showDropDown: true,
        promptTitle: '付款方式',
        prompt: '請選擇付款方式',
        errorTitle: '無效的付款方式',
        error: '請從下拉選單中選擇有效的付款方式'
      },
      // 已收款下拉選單（F欄，從第2列開始）
      {
        type: 'list',
        sqref: 'F2:F1000',
        formulas: ['"是,否"'],
        showDropDown: true,
        promptTitle: '已收款',
        prompt: '請選擇是否已收款',
        errorTitle: '無效的選項',
        error: '請選擇「是」或「否」'
      },
      // 折扣類型下拉選單（G欄，從第2列開始）
      {
        type: 'list',
        sqref: 'G2:G1000',
        formulas: ['"none,percent,amount"'],
        showDropDown: true,
        promptTitle: '折扣類型',
        prompt: '請選擇折扣類型',
        errorTitle: '無效的折扣類型',
        error: '請選擇有效的折扣類型：none（無折扣）、percent（百分比）、amount（金額）'
      }
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '直播訂單')

    // 建立說明工作表
    const instructionData = [
      ['直播訂單匯入範本 - 使用說明'],
      [],
      ['📦 商品清單格式（重要！）：'],
      ['類型', '格式', '範例'],
      ['一般商品（推薦）', '條碼,數量', '4711234567890,2'],
      ['一般商品（備用）', '品號,數量', 'TOY001,2'],
      ['一番賞商品', '一番賞名稱/賞項,數量', '鬼滅之刃一番賞/A賞,1'],
      ['多個商品', '用分號「;」分隔', '4711234567890,2;鬼滅之刃一番賞/A賞,1'],
      [],
      ['💡 為什麼推薦使用條碼？'],
      ['1. 條碼是唯一的，不會重複', ''],
      ['2. 可以直接用掃碼槍掃描，快速又準確', ''],
      ['3. 避免品號輸入錯誤或混淆', ''],
      [],
      ['付款方式代碼對照表：'],
      ['代碼', '說明'],
      ...paymentOptions.map(opt => [opt.code, opt.label]),
      [],
      ['折扣類型說明：'],
      ['代碼', '說明'],
      ['none', '無折扣'],
      ['percent', '百分比折扣（折扣值填寫百分比，例：10 表示打9折）'],
      ['amount', '金額折扣（折扣值填寫具體金額，例：100 表示減100元）'],
      [],
      ['注意事項：'],
      ['1. 商品清單強烈建議使用條碼，確保商品識別準確無誤'],
      ['2. 多個商品用分號「;」分隔，例：4711234567890,2;鬼滅之刃一番賞/A賞,1'],
      ['3. Excel 範本中「付款方式」、「已收款」、「折扣類型」欄位均有下拉選單，點擊儲存格即可選擇'],
      ['4. 客戶資料會自動根據電話或名稱進行匹配，找不到會自動建立新客戶'],
      ['5. 系統會在匯入前檢查商品庫存和一番賞庫存，不足時會提示錯誤'],
      ['6. 條碼可從 POS 系統或商品管理中查詢，或直接用掃碼槍掃描']
    ]

    const wsInstruction = XLSX.utils.aoa_to_sheet(instructionData)

    // 設定說明工作表欄寬
    wsInstruction['!cols'] = [
      { wch: 30 },
      { wch: 50 },
      { wch: 35 }
    ]

    // 設定第一列標題樣式（Excel 不支持直接設定樣式，但可以設定合併儲存格）
    wsInstruction['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } } // 合併第一列的三個儲存格
    ]

    XLSX.utils.book_append_sheet(wb, wsInstruction, '使用說明')

    XLSX.writeFile(wb, '直播訂單匯入範本.xlsx')
  }

  const handleImport = async () => {
    const validOrders = orderPreviews.filter(o => o.validation.valid)

    if (validOrders.length === 0) {
      alert('沒有有效的訂單可以匯入')
      return
    }

    if (!confirm(`確定要匯入 ${validOrders.length} 筆訂單嗎？`)) {
      return
    }

    setImporting(true)
    setImportResult(null)

    try {
      const res = await fetch('/api/live-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: validOrders })
      })

      const data = await res.json()

      if (data.ok) {
        setImportResult({
          success: data.result.success,
          failed: data.result.failed,
          errors: data.result.errors || []
        })

        if (data.result.failed === 0) {
          alert(`成功匯入 ${data.result.success} 筆訂單！`)
          // Reset
          setParsedData([])
          setOrderPreviews([])
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
        } else {
          alert(`匯入完成：成功 ${data.result.success} 筆，失敗 ${data.result.failed} 筆\n請查看詳細錯誤訊息`)
        }
      } else {
        alert(`匯入失敗：${data.error}`)
      }
    } catch (error) {
      alert(`匯入發生錯誤：${error}`)
    } finally {
      setImporting(false)
    }
  }

  const validCount = orderPreviews.filter(o => o.validation.valid).length
  const invalidCount = orderPreviews.filter(o => !o.validation.valid).length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">直播訂單批量匯入</h1>
          <p className="text-gray-600 dark:text-gray-400">上傳 Excel 或 CSV 檔案以批量建立直播訂單</p>
        </div>

        {/* Format Guide */}
        <div className="mb-6 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">檔案格式說明</h3>
          <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
            <div>
              <strong>必填欄位：</strong>客戶名稱、客戶電話、商品清單、付款方式
            </div>
            <div>
              <strong>商品清單格式：</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>一般商品：<code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">條碼,數量</code> 或 <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">品號,數量</code> <span className="text-green-600 font-semibold">（推薦使用條碼，更精準）</span></li>
                <li>一番賞：<code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">一番賞名稱/賞項,數量</code></li>
                <li>多個商品用分號分隔：<code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">4711234567890,2;鬼滅之刃一番賞/A賞,1</code></li>
              </ul>
            </div>
            <div className="bg-blue-100 dark:bg-blue-900/50 rounded px-3 py-2 border border-blue-300 dark:border-blue-700">
              <strong>💡 Excel 範本內建下拉選單：</strong>
              <ul className="list-disc ml-5 mt-1">
                <li><strong>付款方式</strong>：點擊儲存格即可從選單中選擇（現金、刷卡、LINE Pay 等）</li>
                <li><strong>已收款</strong>：選擇「是」或「否」</li>
                <li><strong>折扣類型</strong>：選擇 none（無折扣）、percent（百分比）或 amount（金額）</li>
              </ul>
            </div>
          </div>
          <button
            onClick={downloadTemplate}
            className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            下載範本檔案
          </button>
        </div>

        {/* File Upload */}
        <div className="mb-6 rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-gray-600 dark:text-gray-400">
              <div className="text-4xl mb-2">📁</div>
              <div className="text-lg font-medium mb-1">拖曳檔案到此處或點擊上傳</div>
              <div className="text-sm">支援 .xlsx, .xls, .csv 格式</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Preview Table */}
        {orderPreviews.length > 0 && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-gray-900 dark:text-gray-100">
                共 {orderPreviews.length} 筆訂單
                <span className="ml-4 text-green-600">✓ {validCount} 筆有效</span>
                {invalidCount > 0 && (
                  <span className="ml-2 text-red-600">✗ {invalidCount} 筆無效</span>
                )}
              </div>
              <button
                onClick={handleImport}
                disabled={validCount === 0 || importing}
                className="rounded bg-green-600 px-6 py-2 font-medium text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {importing ? '匯入中...' : `匯入 ${validCount} 筆訂單`}
              </button>
            </div>

            <div className="rounded-lg bg-white dark:bg-gray-800 shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">列</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">狀態</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">客戶</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">電話</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">商品數</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">付款</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {orderPreviews.map((order) => (
                      <tr key={order.rowNumber} className={!order.validation.valid ? 'bg-red-50 dark:bg-red-900/10' : ''}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{order.rowNumber}</td>
                        <td className="px-4 py-3 text-sm">
                          {order.validation.valid ? (
                            <span className="text-green-600 font-semibold">✓</span>
                          ) : (
                            <span className="text-red-600 font-semibold">✗</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                          {order.customerName || <span className="text-gray-400">散客</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{order.customerPhone}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                          {order.items.length} 項
                          {order.items.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1">
                              {order.items.map((item, idx) => (
                                <div key={idx}>{item.identifier} x{item.quantity}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                          {formatPaymentMethod(order.paymentMethod)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {order.note && <div className="text-gray-900 dark:text-gray-100 mb-1">{order.note}</div>}
                          {order.validation.errors.length > 0 && (
                            <div className="text-xs text-red-600 space-y-1">
                              {order.validation.errors.map((err, idx) => (
                                <div key={idx}>• {err}</div>
                              ))}
                            </div>
                          )}
                          {order.validation.warnings.length > 0 && (
                            <div className="text-xs text-yellow-600 space-y-1">
                              {order.validation.warnings.map((warn, idx) => (
                                <div key={idx}>⚠ {warn}</div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Import Result */}
        {importResult && (
          <div className="mt-6 rounded-lg bg-white dark:bg-gray-800 p-6 shadow">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">匯入結果</h3>
            <div className="space-y-2">
              <div className="text-green-600">成功：{importResult.success} 筆</div>
              <div className="text-red-600">失敗：{importResult.failed} 筆</div>
              {importResult.errors.length > 0 && (
                <div className="mt-4">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 mb-2">錯誤詳情：</div>
                  <div className="text-sm text-red-600 space-y-1">
                    {importResult.errors.map((err, idx) => (
                      <div key={idx}>列 {err.row}: {err.error}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
