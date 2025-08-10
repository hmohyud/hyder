import React from "react";
import { Link } from "react-router-dom";
import "./Landing.css";

/* Minimal inline icons (no emojis) */
const IconGraph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 21V3" />
    <path d="M3 21h18" />
    <path d="M6 15l4-5 3 3 5-7" />
    <circle cx="6" cy="15" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="13" cy="13" r="1.4" />
    <circle cx="18" cy="6" r="1.4" />
  </svg>
);
const IconLayers = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4l8 4-8 4-8-4 8-4z" />
    <path d="M4 12l8 4 8-4" />
    <path d="M4 16l8 4 8-4" />
  </svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);
const IconDoc = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);

export default function Landing() {
  return (
    <div className="landing">
      <div className="wrap">
        <header className="hero">
          <h1 className="title">Hyder Mohyuddin</h1>
          <p className="subtitle">AI & Software • Systems • Interfaces</p>

          {/* Mission statement focused on your CV */}
          <p className="mission">
            I build dependable AI tools and interfaces. Recent work includes{" "}
            <strong>real-time tensor tooling for Stable Diffusion/ComfyUI</strong> (custom
            memory management and layer-targeted transforms), the{" "}
            <strong>SPIM interactive UI</strong> for research workflows, and{" "}
            <strong>large-scale data visualization</strong> at Booth—rendering ~200GB on a
            globe with 3D/JS. This site showcases those skills with live demos,
            write-ups, and an interactive skills graph.
          </p>

          {/* <ul className="chips" aria-label="Key technologies">
            {[
              "Python",
              "React",
              "D3 / Three.js",
              "Flask",
              "Selenium",
              "PyTorch / SD",
              "OpenAI API",
            ].map((t) => (
              <li key={t} className="chip">
                {t}
              </li>
            ))}
          </ul> */}
        </header>

        <section className="grid" aria-label="Site sections">
          {/* Skills */}
          <Link to="/skills" className="card card-1" aria-label="Go to Skills">
            <div className="card-head">
              <span className="icon">
                <IconGraph />
              </span>
              <h2>Skills</h2>
            </div>
            <p className="card-copy">
              Interactive skills graph.
            </p>
            <div className="peek">
              {/* Put image at public/previews/skills.jpg */}
              <img
                src={process.env.PUBLIC_URL + '/previews/skills.jpg'}
                alt="Preview of Skills page"
                loading="lazy"
              />
            </div>
          </Link>

          {/* Projects */}
          <Link to="/projects" className="card card-2" aria-label="Go to Projects">
            <div className="card-head">
              <span className="icon">
                <IconLayers />
              </span>
              <h2>Projects</h2>
            </div>
            <p className="card-copy">
              See my past projects.
            </p>
            <div className="peek">
              {/* Put image at public/previews/projects.jpg */}
              <img
                src={process.env.PUBLIC_URL + "/previews/projects.jpg"}
                alt="Preview of Projects page"
                loading="lazy"
              />
            </div>
          </Link>

          {/* About — now an image preview (not a list) */}
          <Link to="/about" className="card card-3" aria-label="Go to About">
            <div className="card-head">
              <span className="icon">
                <IconUser />
              </span>
              <h2>About</h2>
            </div>
            <p className="card-copy">
              Background, approach, and what I'm exploring now.
            </p>
            <div className="peek">
              {/* Put image at public/previews/about.jpg */}
              <img
                src={process.env.PUBLIC_URL + "/previews/about.jpg"}
                alt="Preview of About page"
                loading="lazy"
              />
            </div>
          </Link>

          {/* Résumé */}
          <Link to="/resume" className="card card-4" aria-label="Go to Résumé">
            <div className="card-head">
              <span className="icon">
                <IconDoc />
              </span>
              <h2>Resume</h2>
            </div>
            <p className="card-copy">
              Experience, education, and selected work.
            </p>
            <div className="peek">
              {/* Put image at public/previews/resume.jpg */}
              <img
                src={process.env.PUBLIC_URL + "/previews/resume.jpg"}
                alt="Preview of Resume page"
                loading="lazy"
              />
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}
