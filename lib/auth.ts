import { cookies } from 'next/headers'
import { supabaseServer } from './supabase/server'
import { createSessionToken, verifySessionToken } from './session'
import bcrypt from 'bcryptjs'

export type UserRole = 'admin' | 'staff'

export type User = {
  id: string
  username: string
  role: UserRole
  full_name?: string
  is_active: boolean
}

const SESSION_COOKIE_NAME = 'session'
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION)
  const token = await createSessionToken(userId, expiresAt.getTime())

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  })

  // 清掉舊版的明文 cookie，避免殘留造成混淆
  cookieStore.delete(`${SESSION_COOKIE_NAME}_data`)

  return token
}

export async function getSession(): Promise<User | null> {
  const cookieStore = await cookies()
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value)

  if (!session) {
    return null
  }

  // Fetch user from database
  const { data: user, error } = await supabaseServer
    .from('users')
    .select('id, username, role, full_name, is_active')
    .eq('id', session.userId)
    .eq('is_active', true)
    .single()

  if (error || !user) {
    await deleteSession()
    return null
  }

  return user as User
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  cookieStore.delete(`${SESSION_COOKIE_NAME}_data`)
}

export async function requireAuth(): Promise<User> {
  const user = await getSession()
  if (!user) {
    throw new Error('Unauthorized')
  }
  return user
}

export async function requireRole(role: UserRole): Promise<User> {
  const user = await requireAuth()
  if (user.role !== role && user.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return user
}

// Check if user has permission to access a resource
export function hasPermission(user: User | null, resource: string): boolean {
  if (!user) return false

  // Admin has all permissions
  if (user.role === 'admin') return true

  // Staff permissions
  const staffPermissions = [
    '/pos',
    '/expenses',
    '/purchases',           // View purchases list
    '/purchases/staff',     // Staff quick purchase entry
    '/customers',           // Customer management
    '/api/sales',
    '/api/expenses',
    '/api/purchases',       // View purchases API
    '/api/purchases/staff', // Staff submit purchase API
    '/api/products',        // Search products
    '/api/products/quick',  // Quick create product API
    '/api/customers',       // Customer API
    '/api/sale-drafts',
    '/api/ichiban-kuji',
  ]

  return staffPermissions.some(perm => resource.startsWith(perm))
}

// Helper to get current user (for use in API routes)
export async function getCurrentUser(): Promise<User | null> {
  return getSession()
}
