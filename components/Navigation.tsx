'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import ThemeToggle from './ThemeToggle'
import {
  BarChart2, ShoppingCart, Package, Gift, Sparkles,
  Users, Building2, User, Receipt, Truck, CreditCard,
  BookOpen, Building, ClipboardList, Landmark, Wallet,
  TrendingUp, Radio, ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'

type UserRole = 'admin' | 'staff'
type LucideIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>

type NavItem = {
  href?: string
  label: string
  icon: LucideIcon
  roles: UserRole[]
  submenu?: NavItem[]
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: '營收報表', icon: BarChart2, roles: ['admin'] },
  { href: '/pos', label: '店裡收銀', icon: ShoppingCart, roles: ['admin', 'staff'] },
  { href: '/pos-live', label: '直播收銀', icon: Radio, roles: ['admin', 'staff'] },
  {
    label: '庫存管理', icon: Package, roles: ['admin', 'staff'],
    submenu: [
      { href: '/products', label: '商品庫', icon: Gift, roles: ['admin', 'staff'] },
      { href: '/ichiban-kuji', label: '一番賞庫', icon: Sparkles, roles: ['admin', 'staff'] },
    ],
  },
  {
    label: '往來對象', icon: Users, roles: ['admin', 'staff'],
    submenu: [
      { href: '/vendors', label: '廠商管理', icon: Building2, roles: ['admin'] },
      { href: '/customers', label: '客戶管理', icon: User, roles: ['admin', 'staff'] },
    ],
  },
  { href: '/sales', label: '銷售記錄', icon: Receipt, roles: ['admin', 'staff'] },
  { href: '/purchases', label: '進貨管理', icon: Truck, roles: ['admin', 'staff'] },
  {
    label: '財務管理', icon: CreditCard, roles: ['admin', 'staff'],
    submenu: [
      { href: '/expenses', label: '會計記帳', icon: BookOpen, roles: ['admin', 'staff'] },
      { href: '/fixed-assets', label: '固定資產', icon: Building, roles: ['admin'] },
      { href: '/ar', label: '應收帳款', icon: ClipboardList, roles: ['admin'] },
    ],
  },
  {
    label: '金流管理', icon: Landmark, roles: ['admin'],
    submenu: [
      { href: '/accounts', label: '帳戶管理', icon: Wallet, roles: ['admin'] },
      { href: '/finance', label: '財務總覽', icon: TrendingUp, roles: ['admin'] },
    ],
  },
]

type Props = {
  collapsed: boolean
  onToggle: () => void
  mounted: boolean
}

export default function Navigation({ collapsed, onToggle, mounted }: Props) {
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
    if (!parent) return

    const frameId = requestAnimationFrame(() => setOpenSubmenu(parent.label))
    return () => cancelAnimationFrame(frameId)
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

  const avatarLetter = user?.username.charAt(0).toUpperCase() ?? '?'
  const roleLabel = user?.role === 'admin' ? '管理員' : '員工'

  return (
    <>
      {/* ===== DESKTOP SIDEBAR (lg+) ===== */}
      <aside className={[
        'hidden lg:flex flex-col fixed left-0 top-0 h-full z-40',
        'bg-white dark:bg-slate-900',
        'border-r border-slate-200 dark:border-slate-800',
        mounted ? 'transition-[width] duration-300 ease-in-out' : '',
        collapsed ? 'w-14' : 'w-56',
      ].join(' ')}>

        {/* Header */}
        <div className={[
          'flex items-center h-14 shrink-0 border-b border-slate-200 dark:border-slate-800',
          collapsed ? 'justify-center' : 'justify-between px-3',
        ].join(' ')}>
          {collapsed ? (
            <button
              onClick={onToggle}
              title="展開選單"
              aria-label="展開選單"
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-5 h-5" strokeWidth={1.75} />
            </button>
          ) : (
            <>
              <Link href="/" className="flex items-center gap-2.5 min-w-0">
                <Image src="/毛先生logo.jpg" alt="Logo" width={26} height={26} className="rounded-md shrink-0" />
                <span className="text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-500 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent truncate">
                  毛先生 ERP
                </span>
              </Link>
              <button
                onClick={onToggle}
                title="收起選單"
                aria-label="收起選單"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto sidebar-scroll py-3 px-2 space-y-0.5">
          {filteredNavItems.map(item =>
            item.submenu ? (
              <div key={item.label}>
                {/* Group button */}
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
                    'w-full flex items-center rounded-lg text-sm transition-colors duration-150 cursor-pointer',
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2.5',
                    isInSubmenu(item)
                      ? 'text-slate-900 dark:text-slate-100 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
                  ].join(' ')}
                >
                  <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${openSubmenu === item.label ? 'rotate-180' : ''}`}
                        strokeWidth={2}
                      />
                    </>
                  )}
                </button>

                {/* Submenu */}
                {!collapsed && openSubmenu === item.label && (
                  <div className="mt-0.5 ml-[22px] pl-3 border-l border-slate-200 dark:border-slate-700 space-y-0.5 pb-1">
                    {item.submenu
                      .filter(sub => user && sub.roles.includes(user.role))
                      .map(sub => (
                        <Link
                          key={sub.href}
                          href={sub.href!}
                          className={[
                            'flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer',
                            pathname === sub.href
                              ? 'bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 font-medium'
                              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
                          ].join(' ')}
                        >
                          <sub.icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
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
                  'flex items-center rounded-lg text-sm transition-colors duration-150 cursor-pointer',
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2.5',
                  pathname === item.href
                    ? 'bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
                ].join(' ')}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          )}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 p-2 space-y-1.5">
          {/* User info */}
          {user && (
            collapsed ? (
              <div
                title={`${user.username} · ${roleLabel}`}
                className="flex justify-center py-0.5"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
                  {avatarLetter}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                  {avatarLetter}
                </div>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate flex-1">
                  {user.username}
                </span>
                <span className={[
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0',
                  user.role === 'admin'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                ].join(' ')}>
                  {roleLabel}
                </span>
              </div>
            )
          )}

          {/* Logout + Theme */}
          <div className={`flex ${collapsed ? 'flex-col items-center' : 'items-center'} gap-1`}>
            {user && (
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                title={collapsed ? '登出' : undefined}
                aria-label="登出"
                className={[
                  'flex items-center justify-center gap-1.5 rounded-lg transition-colors duration-150 cursor-pointer',
                  'text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400',
                  'hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed',
                  collapsed ? 'p-2' : 'flex-1 py-1.5 text-xs font-medium',
                ].join(' ')}
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span>{loggingOut ? '登出中…' : '登出'}</span>}
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* ===== MOBILE TOP BAR (< lg) ===== */}
      <nav className="lg:hidden sticky top-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="mx-auto max-w-full px-3 sm:px-4">
          <div className="flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <Image
                src="/毛先生logo.jpg"
                alt="毛先生 ERP Logo"
                width={32}
                height={32}
                className="rounded-md"
              />
              <span className="hidden sm:inline text-base font-bold bg-gradient-to-r from-blue-600 to-indigo-500 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
                毛先生 ERP
              </span>
            </Link>

            <div className="flex items-center gap-1.5 shrink-0">
              <ThemeToggle />
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="切換選單"
              >
                {isMenuOpen ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Mobile Dropdown */}
          {isMenuOpen && (
            <div className="border-t border-slate-200 dark:border-slate-800 pb-4 pt-3">
              {/* Mobile user row */}
              {user && (
                <div className="flex items-center justify-between mx-3 mb-3 px-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {avatarLetter}
                    </div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{user.username}</span>
                    <span className={[
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                      user.role === 'admin'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                    ].join(' ')}>
                      {roleLabel}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 text-red-600 dark:text-red-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                    {loggingOut ? '登出中…' : '登出'}
                  </button>
                </div>
              )}

              {/* Mobile nav links */}
              <div className="flex flex-col gap-1 px-3">
                {filteredNavItems.map(item =>
                  item.submenu ? (
                    <div key={item.label}>
                      <button
                        onClick={() => setOpenSubmenu(openSubmenu === item.label ? null : item.label)}
                        className={[
                          'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors duration-150 cursor-pointer',
                          isInSubmenu(item)
                            ? 'bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
                        ].join(' ')}
                      >
                        <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${openSubmenu === item.label ? 'rotate-180' : ''}`}
                          strokeWidth={2}
                        />
                      </button>

                      {openSubmenu === item.label && (
                        <div className="mt-0.5 ml-[22px] pl-3 border-l border-slate-200 dark:border-slate-700 flex flex-col gap-0.5 pb-1">
                          {item.submenu
                            .filter(sub => user && sub.roles.includes(user.role))
                            .map(sub => (
                              <Link
                                key={sub.href}
                                href={sub.href!}
                                onClick={() => setIsMenuOpen(false)}
                                className={[
                                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 cursor-pointer',
                                  pathname === sub.href
                                    ? 'bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 font-medium'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
                                ].join(' ')}
                              >
                                <sub.icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
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
                      onClick={() => setIsMenuOpen(false)}
                      className={[
                        'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors duration-150 cursor-pointer',
                        pathname === item.href
                          ? 'bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
                      ].join(' ')}
                    >
                      <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                      <span>{item.label}</span>
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
