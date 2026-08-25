import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionToken } from '@/lib/session'

// 不需要登入就能存取的路徑
const PUBLIC_PATHS = ['/login', '/api/auth/login']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path))
  const isApiPath = pathname.startsWith('/api/')

  // 驗證簽章與到期時間；偽造或過期都會得到 null
  const session = await verifySessionToken(request.cookies.get('session')?.value)

  if (!session) {
    if (isPublicPath) {
      return NextResponse.next()
    }

    // API 回 401 JSON，前端才不會拿到一整頁 HTML 而解析失敗
    if (isApiPath) {
      const response = NextResponse.json(
        { ok: false, error: '尚未登入或登入已過期' },
        { status: 401 }
      )
      response.cookies.delete('session')
      response.cookies.delete('session_data')
      return response
    }

    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.delete('session')
    response.cookies.delete('session_data')
    return response
  }

  // 已登入還去登入頁就導回首頁
  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - *.png, *.jpg, *.jpeg, *.gif, *.svg, *.ico (public images)
     * - manifest.webmanifest (PWA manifest)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.ico$|manifest.webmanifest).*)',
  ],
}
