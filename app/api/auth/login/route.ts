import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { createSession, verifyPassword } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: '請輸入帳號和密碼' },
        { status: 400 }
      )
    }

    // Fetch user from database
    const { data: user, error } = await supabaseServer
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('is_active', true)
      .single() as any

    if (error || !user) {
      return NextResponse.json(
        { ok: false, error: '帳號或密碼錯誤' },
        { status: 401 }
      )
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash)

    if (!isValid) {
      return NextResponse.json(
        { ok: false, error: '帳號或密碼錯誤' },
        { status: 401 }
      )
    }

    // Create session
    await createSession(user.id)

    // Return user data (without password hash) 並設置 no-cache header
    const response = NextResponse.json({
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { ok: false, error: '登入失敗' },
      { status: 500 }
    )
  }
}
