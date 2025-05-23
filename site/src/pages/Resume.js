import React from 'react';
import './Resume.css';

export default function Resume() {
  return (
    <div className="resume-pdf-wrapper">
      {/* <h2 className="resume-pdf-title">My Resume</h2> */}
      <iframe
        src={`${process.env.PUBLIC_URL}/HyderMohyuddin-Resume.pdf`}
        className="resume-pdf-frame"
        title="Hyder Mohyuddin Resume"
      />
    </div>
  );
}
