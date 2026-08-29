// Static SWR keys
export const SWR_KEYS = {
  AUTH_ME: '/api/auth/me',
  ACCOUNTS: '/api/accounts',
  ACCOUNTS_ACTIVE: '/api/accounts?active=true',
  CUSTOMERS_ACTIVE: '/api/customers?active=true',
  FIXED_ASSETS: '/api/fixed-assets',
  FIXED_ASSETS_SUMMARY: '/api/fixed-assets/summary',
  FINANCE_DASHBOARD: '/api/finance/dashboard',
  SHORTAGE_STATS: '/api/shortage-stats',
} as const

// Key builders with query params
export function productsKey(params?: Record<string, string>) {
  const base = '/api/products'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function customersKey(params?: Record<string, string>) {
  const base = '/api/customers'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function vendorsKey(params?: Record<string, string>) {
  const base = '/api/vendors'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function expensesKey(params?: Record<string, string>) {
  const base = '/api/expenses'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function deliveriesKey(params?: Record<string, string>) {
  const base = '/api/deliveries'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function arKey(params?: Record<string, string>) {
  const base = '/api/ar'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function ichibanKujiKey(params?: Record<string, string>) {
  const base = '/api/ichiban-kuji'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function salesKey(params?: Record<string, string>) {
  const base = '/api/sales'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function accountTransactionsKey(id: string, params?: Record<string, string>) {
  const base = `/api/accounts/${id}/transactions`
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function purchasesKey(params?: Record<string, string>) {
  const base = '/api/purchases'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}

export function dashboardKey(params?: Record<string, string>) {
  const base = '/api/dashboard'
  if (!params || Object.keys(params).length === 0) return base
  return `${base}?${new URLSearchParams(params)}`
}
