'use client'

import { useEffect, useState } from 'react'
import SplashScreen from './SplashScreen'

type GlobalSplashScreenProps = {
  children: React.ReactNode
  showOnEveryVisit?: boolean // true = 每次都顯示，false = 只顯示一次
}

export default function GlobalSplashScreen({
  children,
  showOnEveryVisit = true // 預設每次都顯示（客戶覺得厲害）
}: GlobalSplashScreenProps) {
  const [showSplash, setShowSplash] = useState(showOnEveryVisit)
  const [isChecking, setIsChecking] = useState(!showOnEveryVisit)

  useEffect(() => {
    if (!showOnEveryVisit) {
      // Read session storage after hydration without forcing a synchronous
      // second render inside the effect.
      const frameId = requestAnimationFrame(() => {
        const hasVisited = sessionStorage.getItem('hasVisited')
        if (!hasVisited) {
          setShowSplash(true)
          sessionStorage.setItem('hasVisited', 'true')
        }
        setIsChecking(false)
      })

      return () => cancelAnimationFrame(frameId)
    }
  }, [showOnEveryVisit])

  const handleFinish = () => {
    setShowSplash(false)
  }

  // 等待檢查完成
  if (isChecking) {
    return null
  }

  return (
    <>
      {showSplash ? (
        <SplashScreen onFinish={handleFinish} />
      ) : (
        <div className="visible">{children}</div>
      )}
    </>
  )
}
