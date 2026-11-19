'use client'
// src/app/page.tsx — Trang đăng nhập HeheHR Portal
// Nhân viên nhập Mã NV và mật khẩu để truy cập hệ thống

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [maNV, setMaNV] = useState('')
  const [matKhau, setMatKhau] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!maNV.trim()) {
      setError('Vui lòng nhập Mã nhân viên.')
      return
    }
    if (!matKhau) {
      setError('Vui lòng nhập mật khẩu.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const email = `${maNV.trim().toLowerCase()}@hehehr.internal`

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: matKhau,
    })

    if (authError) {
      setLoading(false)
      if (authError.message.includes('Invalid login credentials')) {
        setError('Mã nhân viên hoặc mật khẩu không đúng. Vui lòng thử lại.')
      } else if (authError.message.includes('Email not confirmed')) {
        setError('Tài khoản chưa được xác nhận. Vui lòng liên hệ quản trị viên.')
      } else {
        setError('Đăng nhập thất bại. Vui lòng thử lại sau.')
      }
      return
    }

    // Kiểm tra đã đổi mật khẩu chưa
    const passwordChanged = data.user?.user_metadata?.password_changed
    if (!passwordChanged) {
      router.push('/change-password')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #d1fae5 100%)' }}>

      {/* Card đăng nhập */}
      <div className="w-full max-w-md">

        {/* Logo & tiêu đề */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-white rounded-2xl mb-4 shadow-md border border-emerald-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Logo"
              className="h-16 w-auto max-w-[200px] object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold" style={{ color: '#065f46' }}>
            HeheHR Portal
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Cổng tra cứu phiếu lương</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Đăng nhập</h2>

          {/* Thông báo lỗi */}
          {error && (
            <div className="mb-5 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Mã nhân viên */}
            <div>
              <label htmlFor="maNV" className="block text-sm font-medium text-gray-700 mb-1.5">
                Mã nhân viên
              </label>
              <input
                id="maNV"
                type="text"
                value={maNV}
                onChange={(e) => setMaNV(e.target.value)}
                placeholder="Ví dụ: NV001"
                autoComplete="username"
                autoFocus
                disabled={loading}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:border-transparent transition-all
                  disabled:bg-gray-50 disabled:text-gray-500"
                style={{ '--tw-ring-color': '#10B981' } as React.CSSProperties}
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)'}
                onBlur={(e) => e.target.style.boxShadow = 'none'}
              />
            </div>

            {/* Mật khẩu */}
            <div>
              <label htmlFor="matKhau" className="block text-sm font-medium text-gray-700 mb-1.5">
                Mật khẩu
              </label>
              <input
                id="matKhau"
                type="password"
                value={matKhau}
                onChange={(e) => setMatKhau(e.target.value)}
                placeholder="Nhập mật khẩu"
                autoComplete="current-password"
                disabled={loading}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:border-transparent transition-all
                  disabled:bg-gray-50 disabled:text-gray-500"
                onFocus={(e) => e.target.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)'}
                onBlur={(e) => e.target.style.boxShadow = 'none'}
              />
            </div>

            {/* Nút đăng nhập */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all
                disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
              style={{
                background: loading ? '#6b7280' : 'linear-gradient(135deg, #10B981, #059669)',
                boxShadow: loading ? 'none' : '0 4px 15px rgba(16, 185, 129, 0.4)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Đang đăng nhập...
                </span>
              ) : 'Đăng nhập'}
            </button>
          </form>

          {/* Ghi chú mật khẩu mặc định */}
          <div className="mt-6 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
            <p className="text-xs text-emerald-700 text-center flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Mật khẩu mặc định là Mã nhân viên của bạn
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} HeheHR. Bảo mật & riêng tư.
        </p>
      </div>
    </div>
  )
}
