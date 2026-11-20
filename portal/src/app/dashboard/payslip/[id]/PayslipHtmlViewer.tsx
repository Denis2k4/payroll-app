'use client'

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'

interface PayslipHtmlViewerProps {
  html: string
  maNV: string
  periodLabel: string
  tenCongTy?: string
}

export function formatMaNV(code?: string | null): string {
  if (!code) return ''
  return String(code).trim().replace(/lsf/gi, 'LSF')
}

export default function PayslipHtmlViewer({
  html,
  maNV,
  periodLabel,
  tenCongTy,
}: PayslipHtmlViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [zoom, setZoom] = useState(1.0)
  const [isMobile, setIsMobile] = useState(false)
  const [iframeHeight, setIframeHeight] = useState(1100)

  // Nhận biết di động
  useEffect(() => {
    const checkMob = () => {
      setIsMobile(window.innerWidth < 768)
      if (window.innerWidth < 480) {
        setZoom(0.85)
      } else if (window.innerWidth < 768) {
        setZoom(0.95)
      }
    }
    checkMob()
    window.addEventListener('resize', checkMob)
    return () => window.removeEventListener('resize', checkMob)
  }, [])

  // Chuẩn bị HTML hoàn chỉnh với hỗ trợ in và responsive
  const enhancedHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=0.85, maximum-scale=5.0, user-scalable=yes">
        <style>
          body {
            margin: 0;
            padding: 16px;
            background: #ffffff;
            display: flex;
            justify-content: center;
          }
          .payslip-wrapper {
            width: 100%;
            max-width: 820px;
          }
          @media print {
            body { padding: 0; }
            .payslip-wrapper { max-width: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="payslip-wrapper">
          ${html}
        </div>
      </body>
    </html>
  `

  // Điều chỉnh chiều cao iframe tự động theo nội dung
  const handleIframeLoad = () => {
    try {
      const doc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document
      if (doc?.body) {
        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 1000)
        setIframeHeight(h + 60)
      }
    } catch {
      setIframeHeight(1200)
    }

    // Nếu có query param ?action=print thì tự mở hộp thoại in
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('action') === 'print') {
        setTimeout(handlePrint, 500)
      }
    }
  }

  // Xử lý in / lưu thành PDF
  const handlePrint = () => {
    if (!iframeRef.current?.contentWindow) return
    try {
      iframeRef.current.contentWindow.focus()
      iframeRef.current.contentWindow.print()
    } catch {
      window.print()
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Thanh công cụ Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          {/* Nút quay lại */}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-all flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Danh sách</span>
          </Link>

          {/* Tiêu đề & Thông tin */}
          <div className="text-center min-w-0 flex-1">
            <h1 className="text-sm sm:text-base font-bold text-gray-900 truncate">
              Phiếu lương {periodLabel}
            </h1>
            <p className="text-xs text-gray-500 truncate">
              Mã NV: <span className="font-semibold text-gray-700">{formatMaNV(maNV)}</span>
              {tenCongTy && <span className="hidden sm:inline"> · {tenCongTy}</span>}
            </p>
          </div>

          {/* Thanh tác vụ: Zoom & In */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Bộ điều khiển thu phóng */}
            <div className="hidden md:inline-flex items-center border border-gray-200 rounded-xl overflow-hidden bg-gray-50 text-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
                className="px-2.5 py-1.5 hover:bg-gray-100 text-gray-700 font-bold"
                title="Thu nhỏ"
              >
                −
              </button>
              <span className="px-2 py-1.5 font-semibold text-gray-600 min-w-[50px] text-center bg-white border-x border-gray-200">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.8, Math.round((z + 0.1) * 10) / 10))}
                className="px-2.5 py-1.5 hover:bg-gray-100 text-gray-700 font-bold"
                title="Phóng to"
              >
                +
              </button>
            </div>

            {/* Nút In phiếu lương */}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-sm active:scale-95 transition-all"
              title="In phiếu lương"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>In phiếu lương</span>
            </button>
          </div>
        </div>
      </header>

      {/* Vùng hiển thị phiếu lương */}
      <main className="flex-1 overflow-auto p-3 sm:p-6 flex justify-center items-start">
        <div
          className="bg-white rounded-2xl shadow-md border border-gray-200 transition-transform origin-top w-full max-w-[860px] overflow-hidden"
          style={{
            transform: zoom !== 1 ? `scale(${zoom})` : 'none',
            marginBottom: zoom > 1 ? `${(zoom - 1) * iframeHeight}px` : 0,
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={enhancedHtml}
            onLoad={handleIframeLoad}
            style={{
              width: '100%',
              height: `${iframeHeight}px`,
              border: 'none',
              display: 'block',
            }}
            title={`Phiếu lương ${maNV}`}
          />
        </div>
      </main>
    </div>
  )
}
