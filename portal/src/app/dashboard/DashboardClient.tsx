'use client'
// src/app/dashboard/DashboardClient.tsx — Client Component cho trang dashboard
// Xử lý đăng xuất và render UI danh sách phiếu lương

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase/client'
import type { Payslip } from '../../lib/types'

const MONTHS_VI = [
  '', 'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'
]

interface Props {
  payslips: Payslip[]
  maNV: string
  tenNV: string
  tenCongTy: string
  fetchError: string | null
}

export default function DashboardClient({ payslips, maNV, tenNV, tenCongTy, fetchError }: Props) {
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  async function handleDownload(payslip: Payslip) {
    setDownloadingId(payslip.id)
    try {
      const supabase = createClient()
      const rawPath = payslip.pdf_path || payslip.file_path || ''
      const cleanPath = rawPath.replace(/^payslips\//, '')
      const { data, error } = await supabase.storage
        .from('payslips')
        .createSignedUrl(cleanPath, 3600) // 1 giờ

      if (error || !data?.signedUrl) {
        alert('Không thể tải file. Vui lòng thử lại.')
        return
      }

      // Tạo thẻ a ẩn để download
      const a = document.createElement('a')
      a.href = data.signedUrl
      const label = payslip.thang_nam ? payslip.thang_nam.replace('/', '-') : `${payslip.month || ''}_${payslip.year || ''}`
      a.download = `PhieuLuong_${maNV}_${label}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      alert('Lỗi kết nối. Vui lòng thử lại.')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #d1fae5 100%)' }}>

      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">

          {/* Logo + Info NV */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 px-2 bg-white rounded-xl flex items-center justify-center flex-shrink-0 border border-emerald-100 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="Logo"
                className="h-8 w-auto max-w-[120px] object-contain"
              />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 truncate" style={{ color: '#065f46' }}>
                {tenNV}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                Mã NV: <span className="font-medium text-gray-700">{maNV}</span>
                {tenCongTy && <span className="ml-2 text-gray-400">· {tenCongTy}</span>}
              </p>
            </div>
          </div>

          {/* Nút đăng xuất */}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all
              border border-gray-200 hover:border-red-300 hover:bg-red-50 hover:text-red-600
              text-gray-600 disabled:opacity-60 flex-shrink-0"
          >
            {loggingOut ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            )}
            <span className="hidden sm:inline">{loggingOut ? 'Đang xuất...' : 'Đăng xuất'}</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Phiếu lương của tôi</h2>
          <p className="text-gray-500 text-sm mt-1">
            {payslips.length > 0
              ? `Tổng cộng ${payslips.length} phiếu lương`
              : 'Chưa có phiếu lương nào'}
          </p>
        </div>

        {/* Lỗi fetch */}
        {fetchError && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-700 text-sm">{fetchError}</p>
          </div>
        )}

        {/* Empty state */}
        {!fetchError && payslips.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-50 mb-4">
              <svg className="w-10 h-10 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-1">Chưa có phiếu lương</h3>
            <p className="text-gray-400 text-sm max-w-xs mx-auto">
              Phiếu lương của bạn sẽ xuất hiện ở đây sau khi được phòng kế toán phát hành.
            </p>
          </div>
        )}

        {/* Grid phiếu lương */}
        {payslips.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {payslips.map((payslip) => (
              <PayslipCard
                key={payslip.id}
                payslip={payslip}
                isDownloading={downloadingId === payslip.id}
                onDownload={() => handleDownload(payslip)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// Component card phiếu lương
function PayslipCard({
  payslip,
  isDownloading,
  onDownload,
}: {
  payslip: Payslip
  isDownloading: boolean
  onDownload: () => void
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
      {/* Header card */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #d1fae5, #a7f3d0)' }}>
          <svg className="w-5 h-5" style={{ color: '#10B981' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
          PDF
        </span>
      </div>

      {/* Thông tin */}
      <h3 className="font-bold text-gray-900 text-lg">
        {payslip.thang_nam ? `Tháng ${payslip.thang_nam}` : (payslip.month ? `${MONTHS_VI[payslip.month]} ${payslip.year}` : 'Phiếu lương')}
      </h3>
      <p className="text-sm text-gray-500 mt-0.5">
        {payslip.ten_cong_ty || payslip.company_name || 'HeheHR'}
      </p>
      {payslip.uploaded_at && (
        <p className="text-[11px] text-gray-400 mt-1 mb-4">
          Cập nhật: {new Date(payslip.uploaded_at).toLocaleDateString('vi-VN')}
        </p>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <Link
          href={`/dashboard/payslip/${payslip.id}`}
          className="flex-1 py-2.5 text-center rounded-xl text-sm font-medium transition-all
            text-white hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
        >
          Xem
        </Link>
        <button
          onClick={onDownload}
          disabled={isDownloading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all
            border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50
            text-gray-600 hover:text-emerald-700 disabled:opacity-60"
        >
          {isDownloading ? (
            <span className="flex items-center justify-center gap-1">
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Đang tải...
            </span>
          ) : 'Tải về'}
        </button>
      </div>
    </div>
  )
}
