'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// 連線狀態放在 module scope，不放 component state：
// 換頁時 component 會 unmount，若狀態存在 component 裡連線就會跟著消失。
let port: SerialPort | null = null
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
let status: PrinterStatus = 'disconnected'
let restorePromise: Promise<void> | null = null
let listenersAttached = false

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): PrinterStatus {
  return status
}

function getServerSnapshot(): PrinterStatus {
  return 'disconnected'
}

function setStatus(next: PrinterStatus) {
  if (status === next) return
  status = next
  listeners.forEach(l => l())
}

function isSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** 釋放 writer / port，不理會關閉過程的錯誤（裝置可能已經拔掉） */
async function teardown() {
  const p = port
  const w = writer
  port = null
  writer = null
  try {
    w?.releaseLock()
  } catch {
    // writer 可能已因裝置斷線而 error
  }
  try {
    await p?.close()
  } catch {
    // port 可能已經關了
  }
}

async function openPort(target: SerialPort) {
  // Bluetooth virtual COM port: baud rate is negotiated by OS; 9600 is the most common default
  await target.open({ baudRate: 9600 })
  port = target
  writer = target.writable!.getWriter()
  setStatus('connected')
}

/**
 * 本系統一次只接一台印表機。清掉其他舊授權，
 * 讓 restore() 的 getPorts() 只會拿到使用者這次選的那台。
 */
async function forgetOthers(keep: SerialPort) {
  try {
    const granted = await navigator.serial.getPorts()
    await Promise.all(
      granted.filter(p => p !== keep).map(p => p.forget?.().catch(() => {}))
    )
  } catch {
    // forget() 較新的 Chrome 才有，失敗不影響連線
  }
}

/**
 * 監聽實體斷線（藍牙關閉、USB 拔除）。
 * 只掛一次，之後所有 component instance 共用。
 */
function attachListeners() {
  if (listenersAttached || !isSupported()) return
  listenersAttached = true

  navigator.serial.addEventListener('disconnect', (event: Event) => {
    if (port && event.target !== port) return
    void teardown()
    setStatus('disconnected')
  })

  navigator.serial.addEventListener('connect', () => {
    // 裝置重新上線（例如印表機重開）就自動接回去，不用使用者再按一次
    if (status === 'disconnected') void restore()
  })
}

/**
 * 用瀏覽器記住的授權自動接回印表機（getPorts 不會跳選擇視窗）。
 * 頁面重新整理後靠這個復原，使用者不需要重新授權。
 */
function restore(): Promise<void> {
  if (restorePromise) return restorePromise
  if (!isSupported() || writer) return Promise.resolve()

  restorePromise = (async () => {
    try {
      const granted = await navigator.serial.getPorts()
      if (granted.length === 0) return
      setStatus('connecting')
      await openPort(granted[0])
    } catch (err) {
      console.error('[SerialPrinter] restore error:', err)
      await teardown()
      setStatus('disconnected')
    } finally {
      restorePromise = null
    }
  })()

  return restorePromise
}

export function useSerialPrinter() {
  const currentStatus = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    attachListeners()
    void restore()
  }, [])

  const connect = useCallback(async () => {
    if (!isSupported()) {
      alert('此瀏覽器不支援 Web Serial API，請使用 Chrome 或 Edge（需 89+）')
      return
    }
    try {
      setStatus('connecting')
      const selected = await navigator.serial.requestPort()
      await teardown()
      await openPort(selected)
      await forgetOthers(selected)
    } catch (err: unknown) {
      const e = err as DOMException
      // NotFoundError = user closed the picker without selecting
      if (e.name !== 'NotFoundError') {
        console.error('[SerialPrinter] connect error:', err)
        setStatus('error')
      } else {
        setStatus(writer ? 'connected' : 'disconnected')
      }
    }
  }, [])

  const disconnect = useCallback(async () => {
    await teardown()
    setStatus('disconnected')
  }, [])

  const print = useCallback(async (data: Uint8Array): Promise<boolean> => {
    if (!writer) await restore()
    if (writer) {
      try {
        await writer.write(data)
        return true
      } catch (err) {
        // 藍牙閒置斷線常見：關掉舊 port 後重開一次再送
        console.warn('[SerialPrinter] write failed, reopening:', err)
        await teardown()
      }
    }

    await restore()
    if (!writer) {
      setStatus('disconnected')
      return false
    }
    try {
      await writer.write(data)
      return true
    } catch (err) {
      console.error('[SerialPrinter] write error:', err)
      await teardown()
      setStatus('error')
      return false
    }
  }, [])

  return { status: currentStatus, connect, disconnect, print }
}
