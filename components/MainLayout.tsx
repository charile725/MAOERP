'use client'

import { useState, useEffect } from 'react'
import Navigation from './Navigation'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    if (saved !== null) setCollapsed(saved === 'true')
    // 用雙 rAF 確保 collapsed 已繪製後才開啟 transition，避免 hydration 閃爍
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setMounted(true))
    })
  }, [])

  const handleToggle = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebarCollapsed', String(next))
      return next
    })
  }

  return (
    <>
      <Navigation collapsed={collapsed} onToggle={handleToggle} mounted={mounted} />
      <div className={[
        collapsed ? 'lg:ml-14' : 'lg:ml-56',
        mounted ? 'transition-[margin-left] duration-300 ease-in-out' : '',
      ].join(' ')}>
        {children}
      </div>
    </>
  )
}
