'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import ThemeToggle from './ThemeToggle'

type UserRole = 'admin' | 'staff'

type NavItem = {
  href?: string
  label: string
  icon: string
  roles: UserRole[]
  submenu?: NavItem[]
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: '營收報表', icon: '📊', roles: ['admin'] },
  { href: '/pos', label: '店裡收銀', icon: '🏪', roles: ['admin', 'staff'] },
  {
    label: '庫存管理',
    icon: '📦',
    roles: ['admin', 'staff'],
    submenu: [
      { href: '/products', label: '商品庫', icon: '🎁', roles: ['admin', 'staff'] },
      { href: '/ichiban-kuji', label: '一番賞庫', icon: '🎰', roles: ['admin', 'staff'] },
    ],
  },
  {
    label: '往來對象',
    icon: '👥',
    roles: ['admin', 'staff'],
    submenu: [
      { href: '/vendors', label: '廠商管理', icon: '🏭', roles: ['admin'] },
      { href: '/customers', label: '客戶管理', icon: '👤', roles: ['admin', 'staff'] },
    ],
  },
  { href: '/sales', label: '銷售記錄', icon: '💰', roles: ['admin', 'staff'] },
  { href: '/purchases', label: '進貨管理', icon: '🚚', roles: ['admin', 'staff'] },
  {
    label: '財務管理',
    icon: '💳',
    roles: ['admin', 'staff'],
    submenu: [
      { href: '/expenses', label: '會計記帳', icon: '📝', roles: ['admin', 'staff'] },
      { href: '/fixed-assets', label: '固定資產', icon: '🏢', roles: ['admin'] },
      { href: '/ap', label: '應付帳款', icon: '📋', roles: ['admin'] },
    ],
  },
  {
    label: '金流管理',
    icon: '🏦',
    roles: ['admin'],
    submenu: [
      { href: '/accounts', label: '帳戶管理', icon: '💼', roles: ['admin'] },
      { href: '/finance', label: '財務總覽', icon: '📈', roles: ['admin'] },
    ],
  },
]

type Props = {
  collapsed: boolean
  onToggle: () => void
}

export default function Navigation({ collapsed, onToggle }: Props) {
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const [user, setUser] = useState<{ username: string; role: UserRole } | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => { if (data.ok) setUser(data.data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const parent = navItems.find(item => item.submenu?.some(sub => sub.href === pathname))
    if (parent) setOpenSubmenu(parent.label)
  }, [pathname])

  const handleLogout = async () => {
    if (!confirm('確定要登出嗎？')) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.href = '/login'
    } catch {
      alert('登出失敗')
      setLoggingOut(false)
    }
  }

  const filteredNavItems = user
    ? navItems.filter(item => item.roles.includes(user.role))
    : navItems

  const isInSubmenu = (item: NavItem) =>
    item.submenu?.some(sub => sub.href === pathname) ?? false

  return (
    <>
      {/* ===== DESKTOP SIDEBAR (lg+) ===== */}
      <aside className={[
        'hidden lg:flex flex-col fixed left-0 top-0 h-full z-40',
        'bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 shadow-lg',
        'transition-all duration-300 ease-in-out',
        collapsed ? 'w-14' : 'w-56',
      ].join(' ')}>

        {/* Header */}
        {collapsed ? (
          <button
            onClick={onToggle}
            title="展開選單"
            className="w-full h-14 flex items-center justify-center border-b border-gray-200 dark:border-gray-700 shrink-0 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center h-14 px-3 border-b border-gray-200 dark:border-gray-700 shrink-0 justify-between">
            <Link href="/" className="flex items-center gap-2 min-w-0">
              <Image src="/瘋玩logo.jpg" alt="Logo" width={28} height={28} className="rounded-md shrink-0" />
              <span className="text-sm font-bold bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-400 dark:to-blue-300 bg-clip-text text-transparent truncate">
                瘋玩 ERP
              </span>
            </Link>
            <button
              onClick={onToggle}
              title="收起選單"
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200 transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 5l-7 7 7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {filteredNavItems.map(item =>
            item.submenu ? (
              <div key={item.label}>
                <button
                  onClick={() => {
                    if (collapsed) {
                      onToggle()
                      setOpenSubmenu(item.label)
                    } else {
                      setOpenSubmenu(prev => prev === item.label ? null : item.label)
                    }
                  }}
                  title={collapsed ? item.label : undefined}
                  className={[
                    'w-full flex items-center rounded-lg px-2.5 py-2.5 text-sm font-semibold transition-all duration-200',
                    collapsed ? 'justify-center' : 'justify-between',
                    isInSubmenu(item)
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
                  ].join(' ')}
                >
                  <div className={`flex items-center ${collapsed ? '' : 'gap-2.5'}`}>
                    <span className="text-base leading-none">{item.icon}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </div>
                  {!collapsed && (
                    <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${openSubmenu === item.label ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {!collapsed && openSubmenu === item.label && (
                  <div className="ml-3 mt-0.5 pb-1 space-y-0.5">
                    {item.submenu
                      .filter(sub => user && sub.roles.includes(user.role))
                      .map(sub => (
                        <Link
                          key={sub.href}
                          href={sub.href!}
                          className={[
                            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
                            pathname === sub.href
                              ? 'bg-blue-500 text-white font-semibold shadow-sm'
                              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
                          ].join(' ')}
                        >
                          <span className="text-sm">{sub.icon}</span>
                          <span>{sub.label}</span>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={item.href}
                href={item.href!}
                title={collapsed ? item.label : undefined}
                className={[
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-semibold transition-all duration-200',
                  collapsed ? 'justify-center' : '',
                  pathname === item.href
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
                ].join(' ')}
              >
                <span className="text-base leading-none">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          )}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
          {user && !collapsed && (
            <div className="flex items-center gap-2 px-2.5 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate flex-1">
                {user.username}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded shrink-0">
                {user.role === 'admin' ? '管理員' : '員工'}
              </span>
            </div>
          )}
          {user && collapsed && (
            <div title={`${user.username} (${user.role === 'admin' ? '管理員' : '員工'})`} className="flex justify-center py-0.5">
              <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {user.username.charAt(0).toUpperCase()}
              </div>
            </div>
          )}
          <div className={`flex ${collapsed ? 'flex-col items-center' : 'items-center'} gap-1`}>
            {user && (
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                title={collapsed ? '登出' : undefined}
                className={[
                  'flex items-center justify-center gap-1 rounded-lg text-red-600 dark:text-red-400',
                  'hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50',
                  collapsed
                    ? 'p-2'
                    : 'flex-1 py-1.5 text-xs font-semibold border border-red-200 dark:border-red-800',
                ].join(' ')}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                {!collapsed && (loggingOut ? '登出中' : '登出')}
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* ===== MOBILE TOP BAR (< lg) ===== */}
      <nav className="lg:hidden sticky top-0 z-50 border-b bg-white shadow-md dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-full px-2 sm:px-4">
          <div className="flex min-h-[4rem] items-center justify-between gap-2 py-2">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <Image
                src="/瘋玩logo.jpg"
                alt="瘋玩 ERP Logo"
                width={40}
                height={40}
                className="rounded-lg shadow-sm"
              />
              <span className="hidden sm:inline text-xl font-bold bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-400 dark:to-blue-300 bg-clip-text text-transparent">
                瘋玩 ERP
              </span>
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              <ThemeToggle />
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="rounded-lg p-2 text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 transition-all duration-200 border border-gray-200 dark:border-gray-600"
                aria-label="切換選單"
              >
                <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Dropdown */}
          {isMenuOpen && (
            <div className="border-t pb-4 pt-3 dark:border-gray-700">
              {user && (
                <div className="flex items-center justify-between px-4 py-3 mb-3 bg-gray-100 dark:bg-gray-700 rounded-xl mx-3 border border-gray-200 dark:border-gray-600">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{user.username}</span>
                    <span className="text-xs font-medium px-2.5 py-1 rounded bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                      {user.role === 'admin' ? '管理員' : '員工'}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-red-600 dark:text-red-400 disabled:opacity-50 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-red-200 dark:border-red-800"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {loggingOut ? '登出中' : '登出'}
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-1.5 px-3">
                {filteredNavItems.map(item =>
                  item.submenu ? (
                    <div key={item.label}>
                      <button
                        onClick={() => setOpenSubmenu(openSubmenu === item.label ? null : item.label)}
                        className={[
                          'w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 shadow-sm flex items-center justify-between',
                          isInSubmenu(item)
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md'
                            : 'text-gray-700 bg-white hover:bg-gray-50 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-650 border border-gray-200 dark:border-gray-600',
                        ].join(' ')}
                      >
                        {item.label}
                        <svg className={`w-4 h-4 transition-transform ${openSubmenu === item.label ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openSubmenu === item.label && (
                        <div className="mt-1.5 ml-4 flex flex-col gap-1.5">
                          {item.submenu
                            .filter(sub => user && sub.roles.includes(user.role))
                            .map(sub => (
                              <Link
                                key={sub.href}
                                href={sub.href!}
                                onClick={() => setIsMenuOpen(false)}
                                className={[
                                  'rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
                                  pathname === sub.href
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                    : 'text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600',
                                ].join(' ')}
                              >
                                {sub.label}
                              </Link>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href!}
                      onClick={() => setIsMenuOpen(false)}
                      className={[
                        'rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 shadow-sm',
                        pathname === item.href
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md scale-[1.02]'
                          : 'text-gray-700 bg-white hover:bg-gray-50 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-650 border border-gray-200 dark:border-gray-600',
                      ].join(' ')}
                    >
                      {item.label}
                    </Link>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </nav>
    </>
  )
}
