// src/app/dashboard/payslip/[id]/page.tsx — Trang xem chi tiết phiếu lương PDF
// Tạo signed URL từ Supabase Storage và nhúng iframe xem trực tiếp

import { createClient } from '../../../../lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import PayslipViewer from './PayslipViewer'
import PayslipHtmlViewer from './PayslipHtmlViewer'

interface PageProps {
  params: { id: string }
}

const MONTHS_VI = [
  '', 'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'
]

export default async function PayslipDetailPage({ params }: PageProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/')
  }

  const maNV = user.email?.replace('@hehehr.internal', '') ?? ''

  // Lấy thông tin phiếu lương
  const { data: payslip, error } = await supabase
    .from('payslips')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !payslip) {
    notFound()
  }

  // Bảo đảm nhân viên chỉ xem được phiếu lương của chính mình và phiếu chưa bị thu hồi
  const payslipMaNV = payslip.ma_nv || payslip.employee_id || ''
  if (payslipMaNV && payslipMaNV.toLowerCase() !== maNV.toLowerCase()) {
    redirect('/dashboard')
  }
  if (payslip.status === 'revoked') {
    redirect('/dashboard')
  }

  const monthLabel = payslip.month ? MONTHS_VI[payslip.month] : ''
  const periodLabel = monthLabel ? `${monthLabel} ${payslip.year}` : (payslip.thang_nam || '')

  // 1. NẾU LÀ PHIẾU LƯƠNG DẠNG JSON: Hiển thị giao diện HTML siêu tốc không cần tải file PDF
  const payslipData = payslip.data
  const htmlContent = payslipData?.html || (typeof payslipData === 'string' && payslipData.includes('<') ? payslipData : null)

  if (htmlContent) {
    return (
      <PayslipHtmlViewer
        html={htmlContent}
        maNV={maNV}
        periodLabel={periodLabel}
        tenCongTy={payslip.ten_cong_ty}
      />
    )
  }

  // 2. NẾU LÀ PHIẾU LƯƠNG CŨ (PDF STORAGE): Tạo signed URL để xem qua PDF.js
  const rawPath = payslip.pdf_path || payslip.file_path || ''
  const cleanPath = rawPath.replace(/^payslips\//, '')
  const { data: signedData, error: signedError } = await supabase.storage
    .from('payslips')
    .createSignedUrl(cleanPath, 3600)

  const pdfUrl = signedData?.signedUrl || ''

  if (signedError || !pdfUrl) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3 text-xl">
            ✕
          </div>
          <p className="text-red-600 font-bold text-base mb-1">Không thể tải file PDF</p>
          <p className="text-xs text-gray-500 mb-6 leading-relaxed">
            Đường dẫn file không hợp lệ hoặc đã hết hạn truy cập. Vui lòng quay lại danh sách và thử lại.
          </p>
          <Link
            href="/dashboard"
            className="inline-block px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all"
          >
            ← Trở về danh sách phiếu lương
          </Link>
        </div>
      </div>
    )
  }

  return (
    <PayslipViewer
      pdfUrl={pdfUrl}
      maNV={maNV}
      periodLabel={periodLabel}
      tenCongTy={payslip.ten_cong_ty}
    />
  )
}
