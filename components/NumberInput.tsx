'use client'

import { useState, type InputHTMLAttributes } from 'react'

type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> & {
  value: number
  /** 使用者打字期間，只要解析得出數字就會呼叫 */
  onChange: (value: number) => void
  /** 離開輸入框時呼叫，帶入使用者最後打的值（清空或無效時為 null）。只有實際編輯過才會觸發 */
  onCommit?: (value: number | null) => void
  /** 清空後離開輸入框要回填的值。不給就還原成原本的 value */
  emptyValue?: number
  /** 是否允許小數，預設 true */
  decimal?: boolean
  /** 聚焦時是否全選內容，預設 true */
  selectOnFocus?: boolean
  /**
   * 按 Enter 是否順便離開輸入框，預設 false。
   * 表單裡不要開：Enter 原本是送出表單，先 blur 掉會讓某些瀏覽器不再觸發送出。
   */
  blurOnEnter?: boolean
}

/**
 * 數字輸入框。
 *
 * 為什麼需要這個：把數字直接綁進受控 input，使用者按倒退鍵清空時 parseInt('') 是 NaN，
 * onChange 就不更新 state，React 隨即把舊值塞回去 —— 結果是預設的 1 永遠刪不掉，
 * 想改成 21 只會變成 121。
 *
 * 作法是編輯期間先把使用者打的原始字串留在 draft，畫面顯示 draft（可以是空的），
 * 只有解析得出數字才往上送；離開輸入框（blur / Enter）才收斂。
 */
export default function NumberInput({
  value,
  onChange,
  onCommit,
  emptyValue,
  decimal = true,
  selectOnFocus = true,
  blurOnEnter = false,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const parse = (raw: string) => (decimal ? parseFloat(raw) : parseInt(raw, 10))

  // 收斂草稿：空的或無效就套用 emptyValue（沒給就還原成原本的 value）
  const commit = () => {
    if (draft === null) return
    const parsed = parse(draft)
    const committed = isNaN(parsed) ? null : parsed
    if (committed === null && emptyValue !== undefined) onChange(emptyValue)
    onCommit?.(committed)
    setDraft(null)
  }

  return (
    <input
      {...rest}
      type="number"
      value={draft ?? value}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const parsed = parse(raw)
        if (!isNaN(parsed)) onChange(parsed)
      }}
      onFocus={(e) => {
        if (selectOnFocus) e.currentTarget.select()
        onFocus?.(e)
      }}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // 只收斂，不主動 blur，才不會擋掉表單的 Enter 送出
          commit()
          if (blurOnEnter) e.currentTarget.blur()
        }
        onKeyDown?.(e)
      }}
    />
  )
}
