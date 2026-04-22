'use client'

import { useState, useEffect } from 'react'
import Navigation from './Navigation'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    if (saved !== null) setCollapsed(saved === 'true')
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
      <Navigation collapsed={collapsed} onToggle={handleToggle} />

      <div className={`transition-[margin] duration-300 ease-in-out ${collapsed ? 'lg:ml-14' : 'lg:ml-56'}`}>
        {children}
      </div>
    </>
  )
}
