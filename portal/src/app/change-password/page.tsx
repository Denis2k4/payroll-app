'use client'
// src/app/change-password/page.tsx — Trang đổi mật khẩu cho nhân viên
// Bắt buộc thực hiện ở lần đăng nhập đầu tiên hoặc khi người dùng muốn đổi mật khẩu

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.')
      return
    }

    setLoading(true)
    const supabase = createClient()

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const maNV = user?.email?.replace('@hehehr.internal', '') || ''

      if (maNV && newPassword.toLowerCase() === maNV.toLowerCase()) {
        setError('Mật khẩu mới không được trùng với Mã nhân viên.')
        setLoading(false)
        return
      }

      // Cập nhật mật khẩu và đánh dấu password_changed = true
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        data: {
          password_changed: true,
        },
      })

      if (updateError) {
        setError(updateError.message || 'Không thể đổi mật khẩu. Vui lòng thử lại.')
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1500)
    } catch {
      setError('Đã xảy ra lỗi kết nối. Vui lòng thử lại.')
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #d1fae5 100%)',
      }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-emerald-100">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-2.5 bg-white rounded-xl mx-auto mb-3 shadow-md border border-emerald-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Logo"
              className="h-12 w-auto max-w-[160px] object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Đổi mật khẩu</h1>
          <p className="text-sm text-gray-500 mt-1">
            Vui lòng đặt mật khẩu mới để bảo mật thông tin phiếu lương của bạn
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
            ✓ Đổi mật khẩu thành công! Đang chuyển hướng...
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Mật khẩu mới
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">
              Xác nhận mật khẩu mới
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading || success}
            className="w-full py-3.5 rounded-xl text-white font-semibold shadow-md hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-60 text-sm"
            style={{ background: 'linear-gradient(135deg, #10B981, #065f46)' }}
          >
            {loading ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
          </button>
        </form>
      </div>
    </div>
  )
}
