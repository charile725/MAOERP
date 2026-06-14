'use client'

import { useState, useRef, useCallback } from 'react'

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export function useSerialPrinter() {
  const [status, setStatus] = useState<PrinterStatus>('disconnected')
  const portRef = useRef<SerialPort | null>(null)
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null)

  const connect = useCallback(async () => {
    if (!('serial' in navigator)) {
      alert('此瀏覽器不支援 Web Serial API，請使用 Chrome 或 Edge（需 89+）')
      return
    }
    try {
      setStatus('connecting')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const port: SerialPort = await (navigator as any).serial.requestPort()
      // Bluetooth virtual COM port: baud rate is negotiated by OS; 9600 is the most common default
      await port.open({ baudRate: 9600 })
      portRef.current = port
      writerRef.current = port.writable!.getWriter()
      setStatus('connected')
    } catch (err: unknown) {
      const e = err as DOMException
      // NotFoundError = user closed the picker without selecting
      if (e.name !== 'NotFoundError') {
        console.error('[SerialPrinter] connect error:', err)
        setStatus('error')
      } else {
        setStatus('disconnected')
      }
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      if (writerRef.current) {
        writerRef.current.releaseLock()
        writerRef.current = null
      }
      if (portRef.current) {
        await portRef.current.close()
        portRef.current = null
      }
    } catch (err) {
      console.error('[SerialPrinter] disconnect error:', err)
    }
    setStatus('disconnected')
  }, [])

  const print = useCallback(async (data: Uint8Array): Promise<boolean> => {
    if (!writerRef.current) return false
    try {
      await writerRef.current.write(data)
      return true
    } catch (err) {
      console.error('[SerialPrinter] write error:', err)
      setStatus('error')
      return false
    }
  }, [])

  return { status, connect, disconnect, print }
}
