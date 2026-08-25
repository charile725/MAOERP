'use client'

import { useEffect, useState } from 'react'

type SplashScreenProps = {
  onFinish: () => void
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    // Stage 0 (0-800ms): Logo 出現
    const timer1 = setTimeout(() => setStage(1), 800)

    // Stage 1 (800-2000ms): 文字 + 進度條
    const timer2 = setTimeout(() => setStage(2), 2000)

    // Stage 2 (2000-3200ms): 淡出
    const timer3 = setTimeout(() => onFinish(), 3200)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [onFinish])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900">
      {/* 背景粒子效果 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="splash-blob splash-blob-1" />
        <div className="splash-blob splash-blob-2" />
        <div className="splash-blob splash-blob-3" />
      </div>

      {/* 主要內容 */}
      <div
        className={`relative z-10 text-center transition-all duration-1000 ${
          stage >= 2 ? 'scale-110 opacity-0' : 'scale-100 opacity-100'
        }`}
      >
        {/* Logo 容器 */}
        <div
          className={`mb-8 flex justify-center transition-all duration-1000 ${
            stage >= 0 ? 'scale-100 opacity-100 rotate-0' : 'scale-0 opacity-0 -rotate-12'
          }`}
        >
          <div className="relative w-[360px] h-[360px] flex items-center justify-center">
            {/* Logo 外發光 - 最底層 - 超強光暈 */}
            <div className="absolute -inset-12 z-0 animate-pulse rounded-full bg-gradient-to-r from-yellow-300/50 via-orange-400/50 to-yellow-300/50 blur-[100px]" />
            <div className="absolute -inset-8 z-0 animate-pulse rounded-full bg-gradient-to-r from-yellow-400/40 via-amber-300/40 to-yellow-400/40 blur-3xl" style={{ animationDelay: '0.5s' }} />

            {/* Logo 圖片 - 第二層 - 白色/漸變背景 */}
            <div className="relative z-10 w-[320px] h-[320px] rounded-full bg-gradient-to-br from-white via-yellow-50 to-orange-50 p-6 shadow-2xl ring-2 ring-yellow-400/30 flex items-center justify-center">
              <img
                src="/毛先生logo.jpg"
                alt="毛先生"
                width={308}
                height={308}
                className="rounded-full drop-shadow-lg object-cover"
              />
            </div>

            {/* 脈衝光環（3層）- 第三層 */}
            <div className="absolute inset-0 z-20">
              <div className="absolute inset-0 rounded-full border-2 border-yellow-400/30" style={{ animation: 'pulse-ring 2s ease-in-out infinite' }} />
              <div className="absolute inset-4 rounded-full border-2 border-cyan-400/30" style={{ animation: 'pulse-ring 2s ease-in-out infinite 0.3s' }} />
              <div className="absolute inset-8 rounded-full border-2 border-orange-400/30" style={{ animation: 'pulse-ring 2s ease-in-out infinite 0.6s' }} />
            </div>

            {/* 旋轉六角形框架 - 第四層 */}
            <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ animation: 'rotate-hexagon 20s linear infinite' }}>
              <div className="w-64 h-64 relative">
                <svg viewBox="0 0 100 100" className="w-full h-full opacity-20">
                  <polygon
                    points="50,5 90,25 90,75 50,95 10,75 10,25"
                    fill="none"
                    stroke="url(#grad1)"
                    strokeWidth="0.5"
                  />
                  <defs>
                    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{ stopColor: 'rgb(250, 204, 21)', stopOpacity: 1 }} />
                      <stop offset="100%" style={{ stopColor: 'rgb(249, 115, 22)', stopOpacity: 1 }} />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>

            {/* 內層旋轉光環 - 逆時針 - 第五層 */}
            <div className="absolute inset-0 z-40 flex items-center justify-center">
              {[0, 90, 180, 270].map((angle, i) => (
                <div
                  key={`inner-${i}`}
                  className="absolute"
                  style={{
                    animation: `orbit-reverse ${2.5 + i * 0.1}s linear infinite`,
                    animationDelay: `${i * 0.15}s`
                  }}
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-cyan-500/50" />
                </div>
              ))}
            </div>

            {/* 外層旋轉光環 - 順時針 - 最上層 */}
            <div className="absolute inset-0 z-50 flex items-center justify-center">
              {[0, 60, 120, 180, 240, 300].map((angle, i) => (
                <div
                  key={`outer-${i}`}
                  className="absolute"
                  style={{
                    animation: `orbit ${3 + i * 0.1}s linear infinite`,
                    animationDelay: `${i * 0.1}s`
                  }}
                >
                  <div className="w-3 h-3 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg shadow-yellow-500/50" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 文字動畫 */}
        <div
          className={`mb-8 transition-all duration-1000 delay-300 ${
            stage >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          }`}
        >
          <h1 className="mb-2 bg-gradient-to-r from-yellow-200 via-white to-yellow-200 bg-clip-text text-5xl font-bold text-transparent drop-shadow-lg">
            毛先生ERP
          </h1>
          <p className="text-xl font-medium text-yellow-100 drop-shadow-md">GK · 盲盒 · 一番賞 · ERP 系統</p>
        </div>

        {/* 進度條 */}
        <div
          className={`mx-auto w-64 transition-all duration-500 delay-500 ${
            stage >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20 backdrop-blur-sm">
            <div
              className={`h-full bg-gradient-to-r from-yellow-400 via-yellow-200 to-yellow-400 transition-all duration-[2800ms] ease-out ${
                stage >= 1 ? 'w-full' : 'w-0'
              }`}
              style={{ boxShadow: '0 0 20px rgba(250, 204, 21, 0.6)' }}
            />
          </div>
        </div>

        {/* 裝飾光點 - 改成旋轉粒子效果 */}
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute top-1/2 left-1/2 w-1 h-1 bg-yellow-400 rounded-full"
              style={{
                animation: `orbit ${4 + i * 0.3}s linear infinite`,
                animationDelay: `${i * 0.2}s`,
                opacity: 0.6
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
