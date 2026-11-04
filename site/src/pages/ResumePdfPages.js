// src/pages/ResumePdfPages.js
/* The phone viewer's pages, drawn with react-pdf (pdf.js). This is its own
   chunk: pdf.js is ~450 KB of code that only phone-width screens (<= 900 px)
   use - wider screens show the PDF in the browser's own viewer - so
   Resume.js loads it only once it is in phone mode, and the Resume page
   itself stays small enough to open at once on any link. */
import { Document, Page, pdfjs } from 'react-pdf';

// Match worker to the exact pdf.js version react-pdf uses (prevents API/worker mismatches)
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function ResumePdfPages({ url, numPages, onPages, pageWidth }) {
  return (
    <Document
      key={url} // reload when switching docs
      file={url}
      onLoadSuccess={({ numPages: n }) => onPages(n)}
      onLoadError={(e) => console.error('PDF load error:', e)}
      loading={<div className="pdf-loading">Loading…</div>}
      error={<div className="pdf-loading">Failed to load PDF.</div>}
      noData={<div className="pdf-loading">No PDF file specified.</div>}
    >
      {numPages > 0 &&
        Array.from({ length: numPages }, (_, i) => (
          <Page
            key={`p_${i + 1}`}
            pageNumber={i + 1}
            width={pageWidth}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        ))}
    </Document>
  );
}
