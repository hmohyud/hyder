// src/pages/Resume.js
import React, { useMemo } from 'react';
import './Resume.css';

export default function Resume() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('doc') === 'diploma' ? 'diploma' : 'resume';

  const [doc, setDoc] = React.useState(initial);

  const files = useMemo(() => ({
    resume: {
      label: 'Resume',
      url: `${process.env.PUBLIC_URL}/HyderMohyuddin-Resume.pdf`,
    },
    diploma: {
      label: 'Diploma',
      url: `${process.env.PUBLIC_URL}/HyderMohyuddin-Diploma.pdf`, // put file here
    },
  }), []);

  const active = files[doc];

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
        {/* <div className="doc-actions">
          <a href={active.url} target="_blank" rel="noopener noreferrer">Open</a>
          <a href={active.url} download>Download</a>
        </div> */}
      </div>

      {/* PDF viewer (object works on more mobiles than iframe) */}
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
    </div>
  );
}
