// src/pages/Resume.js
import React, { useMemo, useEffect, useRef, useState } from 'react';
import './Resume.css';
import { Document, Page, pdfjs } from 'react-pdf';

// Match worker to the exact pdf.js version react-pdf uses (prevents API/worker mismatches)
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function Resume() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('doc') === 'diploma' ? 'diploma' : 'resume';

  const [doc, setDoc] = React.useState(initial);
  const [isPhone, setIsPhone] = useState(false);
  const [numPages, setNumPages] = useState(0);

  // Keep your links exactly as-is
  const files = useMemo(() => ({
    resume:  { label: 'Resume',  url: `${process.env.PUBLIC_URL}/HyderMohyuddin-Resume.pdf` },
    diploma: { label: 'Diploma', url: `${process.env.PUBLIC_URL}/HyderMohyuddin-Diploma.pdf` },
  }), []);
  const active = files[doc];

  // Phone-mode detection (width-based, no UA sniffing)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Measure container width (for phone mode only)
  const wrapRef = useRef(null);
  const [pageWidth, setPageWidth] = useState(800);
  useEffect(() => {
    if (!isPhone) return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      setPageWidth(Math.max(320, Math.min(1200, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isPhone]);

  // Reset pages when switching docs (phone mode viewer)
  useEffect(() => { setNumPages(0); }, [doc]);

  return (
    <div className="resume-pdf-wrapper">
      {/* Segmented control */}
      <div className="doc-toggle" role="tablist" aria-label="Document selector">
        {(['resume','diploma']).map(key => (
          <button
            key={key}
            role="tab"
            aria-selected={doc === key}
            aria-controls="pdf-viewer"
            className={`doc-toggle-btn ${doc === key ? 'active' : ''}`}
            onClick={() => setDoc(key)}
          >
            {files[key].label}
          </button>
        ))}
      </div>

      {/* Viewer */}
      {isPhone ? (
        // PHONE MODE: react-pdf (multi-page, mobile-safe)
        <div className="pdf-viewport">
          {/* Floating top-right actions for CURRENT doc */}
          <div className="pdf-actions" role="group" aria-label="Current document actions">
            <a
              className="icon-btn"
              href={active.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${active.label} in a new tab`}
              title={`Open ${active.label} in a new tab`}
            >
              {/* External-link icon (SVG, crisp on all screens) */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"></path>
                <path d="M19 21H5a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h7v2H5v14h14v-7h2v7a2 2 0 0 1-2 2z"></path>
              </svg>
              <span className="sr-only">Open</span>
            </a>
            <a
              className="icon-btn"
              href={active.url}
              download
              aria-label={`Download ${active.label} PDF`}
              title={`Download ${active.label} PDF`}
            >
              {/* Download icon */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v10.59l3.3-3.3 1.4 1.42-5 5-5-5 1.4-1.42 3.3 3.3V3h2z"></path>
                <path d="M5 19h14v2H5z"></path>
              </svg>
              <span className="sr-only">Download</span>
            </a>
          </div>

          <div id="pdf-viewer" className="pdf-scroll" ref={wrapRef}>
            <Document
              key={active.url} // reload when switching docs
              file={active.url}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              onLoadError={(e) => console.error('PDF load error:', e)}
              loading={<div className="pdf-loading">Loading…</div>}
              error={<div className="pdf-loading">Failed to load PDF.</div>}
              noData={<div className="pdf-loading">No PDF file specified.</div>}
            >
              {numPages > 0 &&
                Array.from({ length: numPages }, (_, i) => (
                  <Page
                    key={`p_${i+1}`}
                    pageNumber={i + 1}
                    width={pageWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                ))
              }
            </Document>
          </div>
        </div>
      ) : (
        // NORMAL MODE: your original <object> embed
        <object
          id="pdf-viewer"
          data={`${active.url}#toolbar=0&navpanes=0&scrollbar=1`}
          type="application/pdf"
          className="resume-pdf-frame"
          aria-label={`${active.label} PDF`}
        >
          <p className="resume-fallback">
            Your device can’t display the PDF inline.&nbsp;
            <a href={active.url} target="_blank" rel="noopener noreferrer">Open</a>&nbsp;or&nbsp;
            <a href={active.url} download>download</a> the {active.label}.
          </p>
        </object>
      )}
    </div>
  );
}
