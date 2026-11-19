'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

interface PayslipViewerProps {
  pdfUrl: string
  maNV: string
  periodLabel: string
  tenCongTy?: string
}

declare global {
  interface Window {
    pdfjsLib?: any
  }
}

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

export default function PayslipViewer({
  pdfUrl,
  maNV,
  periodLabel,
  tenCongTy,
}: PayslipViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const renderTasksRef = useRef<any[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [zoom, setZoom] = useState(1.0)
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [viewMode, setViewMode] = useState<'canvas' | 'iframe'>('canvas')

  // Nhận biết thiết bị di động (Android / iOS)
  useEffect(() => {
    const checkMobile = () => {
      const ua = navigator.userAgent || ''
      const isMob = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || window.innerWidth < 768
      setIsMobile(isMob)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Nạp thư viện PDF.js từ CDN nếu chưa có
  const loadPdfJs = useCallback((): Promise<any> => {
    if (window.pdfjsLib) {
      return Promise.resolve(window.pdfjsLib)
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${PDFJS_CDN}"]`)
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.pdfjsLib))
        existingScript.addEventListener('error', () => reject(new Error('Lỗi nạp script PDF.js')))
        return
      }

      const script = document.createElement('script')
      script.src = PDFJS_CDN
      script.async = true
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
          resolve(window.pdfjsLib)
        } else {
          reject(new Error('pdfjsLib không tồn tại sau khi nạp'))
        }
      }
      script.onerror = () => reject(new Error('Không thể tải bộ đọc PDF từ CDN.'))
      document.head.appendChild(script)
    })
  }, [])

  // Nạp tài liệu PDF
  useEffect(() => {
    let active = true

    async function initPdf() {
      try {
        setLoading(true)
        setError(null)

        const pdfjs = await loadPdfJs()
        if (!active) return

        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER

        const loadingTask = pdfjs.getDocument({
          url: pdfUrl,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
        })

        const pdf = await loadingTask.promise
        if (!active) return

        setPdfDoc(pdf)
        setNumPages(pdf.numPages)
        setLoading(false)
      } catch (err: any) {
        if (!active) return
        console.error('Lỗi nạp tài liệu PDF:', err)
        setError(err.message || 'Không thể hiển thị phiếu lương trực tuyến.')
        setLoading(false)
      }
    }

    initPdf()

    return () => {
      active = false
    }
  }, [pdfUrl, loadPdfJs])

  // Vẽ từng trang PDF lên Canvas tương ứng
  const renderPages = useCallback(async () => {
    if (!pdfDoc || !containerRef.current) return

    // Hủy các tác vụ render đang dang dở nếu người dùng zoom nhanh
    renderTasksRef.current.forEach((t) => {
      try {
        t?.cancel?.()
      } catch {}
    })
    renderTasksRef.current = []

    const containerWidth = containerRef.current.clientWidth || window.innerWidth - 32
    const dpr = Math.min(window.devicePixelRatio || 1, 3) // Tối ưu màn hình Retina / AMOLED

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum)
        const canvas = canvasRefs.current[pageNum - 1]
        if (!canvas) continue

        // Tính toán tỷ lệ vừa vặn với chiều rộng màn hình điện thoại
        const unscaledViewport = page.getViewport({ scale: 1 })
        // Để lề hai bên nhẹ nhàng 16px trên mobile
        const availableWidth = Math.max(containerWidth - (isMobile ? 8 : 32), 280)
        const fitScale = availableWidth / unscaledViewport.width
        const finalScale = fitScale * zoom

        const viewport = page.getViewport({ scale: finalScale })

        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)

        const renderContext = {
          canvasContext: ctx,
          viewport,
        }

        const renderTask = page.render(renderContext)
        renderTasksRef.current.push(renderTask)
        await renderTask.promise
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn(`Lỗi render trang ${pageNum}:`, err)
        }
      }
    }
  }, [pdfDoc, zoom, isMobile])

  // Kích hoạt render lại khi pdfDoc, zoom hoặc kích thước màn hình thay đổi
  useEffect(() => {
    if (viewMode === 'canvas') {
      renderPages()
    }
  }, [renderPages, viewMode])

  // Lắng nghe resize màn hình (xoay ngang/dọc điện thoại)
  useEffect(() => {
    let timer: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        renderPages()
      }, 150)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', handleResize)
    }
  }, [renderPages])

  const handleZoomIn = () => setZoom((z) => Math.min(parseFloat((z + 0.2).toFixed(1)), 3.0))
  const handleZoomOut = () => setZoom((z) => Math.max(parseFloat((z - 0.2).toFixed(1)), 0.6))
  const handleZoomReset = () => setZoom(1.0)

  const downloadFileName = `PhieuLuong_${maNV}_${periodLabel.replace(/[\/\s]/g, '_')}.pdf`

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* Header bar điều hướng trên cùng */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 px-3 py-2.5 sm:px-6 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          {/* Nút quay lại & Tiêu đề */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 rounded-xl text-gray-700 bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 transition-all flex-shrink-0"
              title="Quay lại danh sách"
            >
              <span className="text-base sm:mr-1">←</span>
              <span className="hidden sm:inline text-xs font-semibold">Danh sách</span>
            </Link>

            <div className="h-5 w-px bg-gray-200 hidden sm:block" />

            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-gray-900 truncate">
                Phiếu lương {periodLabel}
              </h1>
              {tenCongTy && (
                <p className="text-[11px] text-gray-500 truncate hidden sm:block">
                  {tenCongTy} · Mã NV: {maNV}
                </p>
              )}
            </div>
          </div>

          {/* Các nút hành động chính */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* Nút mở tab mới / Xem chế độ toàn màn hình (Rất hữu ích cho Safari iOS) */}
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
              title="Mở toàn màn hình hoặc xem bằng ứng dụng PDF của điện thoại"
            >
              <span>↗</span>
              <span className="hidden md:inline">Toàn màn hình</span>
            </a>

            {/* Nút tải file PDF về máy */}
            <a
              href={pdfUrl}
              download={downloadFileName}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm hover:opacity-95 active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, #10B981, #065f46)' }}
            >
              <span>⬇</span>
              <span>Tải về</span>
            </a>
          </div>
        </div>

        {/* Thanh công cụ thu phóng và điều khiển hiển thị (Zoom bar) */}
        {!error && !loading && viewMode === 'canvas' && (
          <div className="max-w-5xl mx-auto pt-2 mt-1 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
            <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.6}
                className="w-7 h-7 flex items-center justify-center font-bold text-base rounded hover:bg-white disabled:opacity-40 transition-colors"
                title="Thu nhỏ"
              >
                −
              </button>
              <button
                type="button"
                onClick={handleZoomReset}
                className="px-2 h-7 flex items-center justify-center font-medium rounded hover:bg-white text-[11px] transition-colors"
                title="Vừa màn hình"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 3.0}
                className="w-7 h-7 flex items-center justify-center font-bold text-base rounded hover:bg-white disabled:opacity-40 transition-colors"
                title="Phóng to"
              >
                +
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              {numPages > 0 && (
                <span className="bg-emerald-50 text-emerald-800 font-semibold px-2 py-0.5 rounded">
                  {numPages} trang
                </span>
              )}
              {/* Nút chuyển đổi iframe cho desktop nếu muốn */}
              {!isMobile && (
                <button
                  type="button"
                  onClick={() => setViewMode(viewMode === 'canvas' ? 'iframe' : 'canvas')}
                  className="text-gray-500 hover:text-emerald-700 underline ml-1"
                >
                  {viewMode === 'canvas' ? 'Dùng trình đọc gốc' : 'Dùng Canvas'}
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Khu vực hiển thị nội dung chính */}
      <main
        ref={containerRef}
        className="flex-1 max-w-5xl w-full mx-auto p-2 sm:p-6 flex flex-col items-center justify-start overflow-x-auto"
      >
        {/* Loading state */}
        {loading && (
          <div className="w-full max-w-lg my-12 p-8 bg-white rounded-2xl shadow-sm border border-gray-200 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mb-4" />
            <h3 className="font-bold text-gray-800 text-base mb-1">Đang chuẩn bị phiếu lương...</h3>
            <p className="text-xs text-gray-500">Đang tối ưu hiển thị sắc nét cho điện thoại Android &amp; iOS</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="w-full max-w-md my-8 p-6 bg-white rounded-2xl shadow-sm border border-red-200 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3 text-xl">
              ✕
            </div>
            <h3 className="font-bold text-gray-900 text-base mb-1">Không thể hiển thị bộ xem Canvas</h3>
            <p className="text-xs text-gray-600 mb-5 leading-relaxed">
              Bạn vẫn có thể tải về file PDF hoặc mở trực tiếp bằng trình xem mặc định của điện thoại:
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all"
              >
                Mở trong tab mới
              </a>
              <a
                href={pdfUrl}
                download={downloadFileName}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-gray-100 text-gray-800 hover:bg-gray-200 active:scale-95 transition-all"
              >
                Tải file PDF
              </a>
            </div>
          </div>
        )}

        {/* Chế độ Canvas Mobile-First (Mặc định cho Android và iOS) */}
        {!loading && !error && viewMode === 'canvas' && (
          <div className="w-full flex flex-col items-center gap-4 py-2">
            {Array.from({ length: numPages }).map((_, index) => (
              <div
                key={index}
                className="flex flex-col items-center bg-white rounded-xl shadow-md border border-gray-200 p-1 sm:p-2 overflow-hidden transition-transform duration-150"
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[index] = el
                  }}
                  className="block max-w-full rounded bg-white"
                />
                {numPages > 1 && (
                  <div className="w-full text-center py-1.5 text-[11px] font-semibold text-gray-400 border-t border-gray-100 mt-1">
                    Trang {index + 1} / {numPages}
                  </div>
                )}
              </div>
            ))}

            {/* Mẹo sử dụng trên điện thoại */}
            <div className="text-center my-4 text-[11.5px] text-gray-400">
              💡 <em>Bạn có thể dùng hai ngón tay để phóng to/thu nhỏ hoặc dùng các nút <strong>+ / −</strong> ở trên.</em>
            </div>
          </div>
        )}

        {/* Chế độ iframe fallback (chỉ khi người dùng desktop chủ động bấm chuyển) */}
        {!loading && !error && viewMode === 'iframe' && (
          <div className="w-full flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden min-h-[700px] flex flex-col">
            <iframe
              src={`${pdfUrl}#toolbar=1&navpanes=0`}
              title="Xem phiếu lương"
              className="w-full flex-1 border-0 min-h-[700px]"
            />
          </div>
        )}
      </main>
    </div>
  )
}
