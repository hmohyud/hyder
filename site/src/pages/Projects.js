import React, { useEffect, useMemo, useRef, useState } from "react";
import { noteAttention, clearAttention } from "../utils/chatContext";
import { Link, useLocation } from "react-router-dom";

import { projects, projectSlug, projectShortName } from "./projectsData";

const PU = process.env.PUBLIC_URL;

// ---------- Category filter ----------
const CATEGORIES = [
  { key: "all",      label: "All" },
  { key: "web",      label: "Web Dev" },
  { key: "software", label: "Software" },
  { key: "art",      label: "Art" },
  { key: "other",    label: "Other" },
];

// Build a QR image URL (no extra deps)
const qrSrc = (data, size = 520) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
    data
  )}`;

// Small webp preview for a full-res image URL, or null when none exists.
// /projects/<f>.<ext> -> /projects/thumbs/<f>.webp  (build-project-thumbs.mjs)
// /art/artworks/...   -> /art/thumbs/...webp        (build-art-assets.mjs)
const projThumbFor = (src) => {
  if (typeof src !== "string") return null;
  const m = src.match(/^(.*)\/projects\/([^/]+)\.(jpe?g|png|gif)$/i);
  if (m) return `${m[1]}/projects/thumbs/${m[2]}.webp`;
  if (src.includes("/art/artworks/"))
    return src
      .replace("/art/artworks/", "/art/thumbs/")
      .replace(/\.[^./]+$/, ".webp");
  return null;
};

/** Preload a list of URLs and return { ok, w, h } per src */
function usePreloaded(srcs) {
  const [meta, setMeta] = useState(() =>
    srcs.map(() => ({ ok: false, w: 0, h: 0 }))
  );

  // Key on the joined URLs, not array identity — inline arrays otherwise reset
  // the preload state (and reflash the spinner) on every parent re-render.
  const srcsKey = srcs.join("|");

  useEffect(() => {
    let alive = true;
    setMeta(srcs.map(() => ({ ok: false, w: 0, h: 0 })));

    srcs.forEach((src, i) => {
      if (!src) return;
      const img = new Image();

      const mark = () => {
        if (!alive) return;
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        setMeta((prev) => {
          const next = [...prev];
          next[i] = { ok: true, w, h };
          return next;
        });
      };

      img.onload = mark;
      img.onerror = () => {
        /* leave as not ok */
      };
      img.decoding = "async";
      img.src = src;

      if (img.complete && img.naturalWidth > 0) {
        Promise.resolve().then(mark);
      }
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcsKey]);

  return meta; // [{ ok, w, h }]
}

// --------- RotatingImage (no overflow; uses <img> + object-fit: contain) ---------
// Progressive loading: the tiny webp thumb renders immediately; the full-res
// file is fetched only for the active slide (and the one on deck), then
// swapped in silently. Entries may be URL strings or { src, thumb } objects.
function RotatingImage({
  images = [],
  width = 280,
  height = 180,
  borderColor = "#4af",
  altBase = "project image",
  intervalMs = 5000,
  onClick,
  isVisible = true,
  compact = false, // minor-tier thumbnails: stay small beside the text on mobile
}) {
  const imagesKey = JSON.stringify(images);
  const slides = useMemo(
    () =>
      images.map((e) =>
        typeof e === "object" && e !== null
          ? { full: e.src, thumb: e.thumb || projThumbFor(e.src) }
          : { full: e, thumb: projThumbFor(e) }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imagesKey]
  );

  // Probe the cheapest available rendition to decide which slides exist.
  const probeSrcs = useMemo(
    () => slides.map((s) => s.thumb || s.full),
    [slides]
  );
  const meta = usePreloaded(probeSrcs);
  const ok = meta.map((m) => m.ok);

  const visibleIdxs = useMemo(
    () => slides.map((_, i) => (ok[i] ? i : -1)).filter((i) => i >= 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imagesKey, ok.join(",")]
  );

  const [idx, setIdx] = useState(0);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);

  // Which thumb-backed slides have their full-res file ready.
  const [fullLoaded, setFullLoaded] = useState({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setFullLoaded({}), [imagesKey]);

  // Fetch full resolution only for the active slide and the one on deck;
  // everything else stays on its lightweight thumb until its turn comes.
  useEffect(() => {
    if (!isVisible || !visibleIdxs.length) return;
    const n = visibleIdxs.length;
    [visibleIdxs[idx % n], visibleIdxs[(idx + 1) % n]].forEach((real) => {
      const s = slides[real];
      if (!s?.thumb || fullLoaded[real]) return; // thumbless slides already render full
      const img = new Image();
      img.decoding = "async";
      img.onload = () =>
        setFullLoaded((f) => (f[real] ? f : { ...f, [real]: true }));
      img.src = s.full;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, visibleIdxs, isVisible, slides]);

  // Keep idx in range if visible images change
  useEffect(() => {
    if (idx >= visibleIdxs.length) setIdx(0);
  }, [visibleIdxs.length, idx]);

  const next = () => setIdx((i) => (i + 1) % Math.max(visibleIdxs.length, 1));

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (visibleIdxs.length > 1 && isVisible) {
      timerRef.current = setInterval(next, intervalMs);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, visibleIdxs.length, isVisible]);

  const usable = visibleIdxs.length > 0;
  const activeReal = visibleIdxs.length ? visibleIdxs[idx] : -1;

  return (
    <div
      role="img"
      aria-label={`${altBase} — slideshow`}
      onMouseEnter={() => {
        setHovered(true);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }}
      onMouseLeave={() => {
        setHovered(false);
        if (!timerRef.current && visibleIdxs.length > 1 && isVisible) {
          timerRef.current = setInterval(next, intervalMs);
        }
      }}
      onClick={() => {
        if (usable) onClick?.(idx);
      }}
      className={`rot-img${compact ? " rot-img-sm" : ""}`}
      style={{
        position: "relative",
        "--w": `${width}px`,
        "--h": `${height}px`,
        cursor: usable ? "zoom-in" : "default",
        overflow: "hidden",
        backgroundColor: "#1a1a1a",
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        boxShadow: "0 0 10px rgba(255,255,255,0.04)",
      }}
    >
      {/* Images — thumb first, silently upgraded to full-res when fetched */}
      {slides.map((s, i) => {
        if (!ok[i]) return null;
        return (
          <img
            key={s.full + i}
            src={fullLoaded[i] || !s.thumb ? s.full : s.thumb}
            alt={`${altBase} ${i + 1}`}
            aria-hidden={activeReal !== i}
            style={{
              position: "absolute",
              inset: 0,
              margin: "auto",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              transition: "opacity 600ms ease",
              opacity: activeReal === i ? 1 : 0,
              display: "block",
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        );
      })}

      {/* Loading spinner — visible until at least one image is ready */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          background: "#1a1a1a",
          opacity: usable ? 0 : 1,
          transition: "opacity 0.4s ease",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "2.5px solid #333",
            borderTopColor: borderColor,
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>

      {/* Dot indicators with blocking strip */}
      {visibleIdxs.length > 1 && (
        <div
          aria-hidden="true"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()} // clicking the strip never opens lightbox
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 6,
            padding: "6px 10px", // a bit bigger hit area
            borderRadius: 999,
            background: "rgba(0,0,0,0.3)",
            backdropFilter: "blur(4px)",
            opacity: hovered ? 0.9 : 0.4,
            transition: "opacity 180ms ease",
            cursor: "default", // not zoom-in over the strip
          }}
        >
          {visibleIdxs.map((realIdx, dotIndex) => {
            const isActive = dotIndex === idx;
            return (
              <button
                key={realIdx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation(); // extra safety
                  setIdx(dotIndex);
                }}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  background: isActive ? borderColor : "rgba(255,255,255,0.55)",
                  opacity: isActive ? 1 : 0.7,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// --------- emphasize: render **spans** in description strings ---------
// Card copy can wrap a phrase in ** ** to tint it with the project's accent.
function emphasize(text, color) {
  if (typeof text !== "string" || !text.includes("**")) return text;
  return text.split("**").map((seg, i) =>
    i % 2 ? (
      <span key={i} style={{ color, fontWeight: 600 }}>
        {seg}
      </span>
    ) : (
      seg
    )
  );
}

// --------- AspectRow: collapsible per-aspect detail ---------
// Collapsed: a one-line summary of the aspect. Expanded: the summary is
// replaced by the full details. Used for description entries shaped as
// { summary, details } — plain strings still render as ordinary <p>s.
function AspectRow({ summary, details, color, nested = false, style }) {
  const [open, setOpen] = useState(false);
  const paras = Array.isArray(details) ? details : [details];
  return (
    <div
      style={{
        border: "1px solid #2e2e2e",
        borderLeft: `${nested ? 2 : 3}px solid ${color}${nested ? "44" : "66"}`,
        borderRadius: 5,
        marginBottom: "0.35rem",
        background: open ? "rgba(255,255,255,0.02)" : "transparent",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 7,
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: "#ddd",
          fontFamily: "monospace",
          fontSize: "0.82rem",
          lineHeight: 1.4,
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color,
            flex: "0 0 auto",
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          ▸
        </span>
        {open ? (
          <span style={{ color: "#888", fontSize: "0.75rem", fontStyle: "italic" }}>
            hide details
          </span>
        ) : (
          <span>{summary}</span>
        )}
      </button>
      {open && (
        <div style={{ padding: "0 8px 6px 22px" }}>
          {paras.map((d, i) =>
            d && typeof d === "object" && d.quote ? (
              // attributed pull-quote inside an aspect's details
              <blockquote
                key={i}
                style={{
                  margin: i ? "0.45rem 0 0 0" : 0,
                  padding: "3px 10px",
                  borderLeft: `2px solid ${color}55`,
                  color: "#a9a9a9",
                  fontStyle: "italic",
                  fontSize: "0.8rem",
                  lineHeight: 1.5,
                }}
              >
                “{d.quote}”{" "}
                <span style={{ color: "#777", fontStyle: "normal" }}>
                  — {d.by}
                </span>
              </blockquote>
            ) : typeof d === "object" && d !== null ? (
              // nested accordion — a sub-aspect inside this aspect's details
              <AspectRow
                key={i}
                summary={d.summary}
                details={d.details}
                color={color}
                nested
                style={{ marginTop: i ? "0.4rem" : 0 }}
              />
            ) : (
              <p
                key={i}
                style={{
                  margin: i ? "0.4rem 0 0 0" : 0,
                  color: "#bbb",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                {d}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function Projects() {
  const [activeFilter, setActiveFilter] = useState("all");
  const [qrOpen, setQrOpen] = useState(null); // { title, data, color } | null
  const [lightbox, setLightbox] = useState(null); // { title, color, images, index }
  /* leaving the page forgets the card: "this one" means nothing elsewhere */
  useEffect(() => () => clearAttention(), []);

  /* Deep link from the chat: the head links project names to /projects#slug.
     Keyed on the location, not on mount, because clicking such a link while
     ALREADY on this page changes only the hash - the component never
     remounts, so a mount-only effect would do nothing (which is exactly what
     it did). location.key changes on every navigation, so re-clicking the
     same link re-runs it too.
     Cards carry lazy media, so the scroll repeats a few times while the
     layout settles rather than jumping once to a spot that is about to move,
     and the target flashes so it is obvious WHICH card was meant. */
  const location = useLocation();
  useEffect(() => {
    const id = decodeURIComponent((location.hash || "").replace("#", ""));
    if (!id) return undefined;
    /* a filter left on from earlier could be hiding the very card we were
       sent to - show everything so the target is definitely present */
    setActiveFilter("all");
    /* Two other things move this page: <ScrollToTop> on a route change (keyed
       on pathname, so a same-page hash click never triggers it) and the
       art-gallery restore below. An explicit deep link outranks a stale saved
       position, so drop it rather than letting the two fight - the gallery
       round-trip itself carries no hash and is untouched. */
    sessionStorage.removeItem("projects-scroll");

    let target = null;
    const timers = [0, 140, 420, 900].map((t) =>
      setTimeout(() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ block: "start", behavior: t ? "smooth" : "auto" });
        if (!target) {
          target = el;
          el.classList.remove("proj-flash");
          void el.offsetWidth; // restart the animation if it is still running
          el.classList.add("proj-flash");
        }
      }, t)
    );
    const done = setTimeout(() => {
      if (target) target.classList.remove("proj-flash");
    }, 2800);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
      if (target) target.classList.remove("proj-flash");
    };
  }, [location.hash, location.key]);

  // Restore scroll position when returning from art gallery
  useEffect(() => {
    const saved = sessionStorage.getItem("projects-scroll");
    if (saved) {
      sessionStorage.removeItem("projects-scroll");
      requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
    }
  }, []);

  // Lock background scroll when any overlay is open
  useEffect(() => {
    const anyOpen = Boolean(qrOpen || lightbox);
    const prev = document.body.style.overflow;
    if (anyOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [qrOpen, lightbox]);

  // Keyboard: Esc closes overlays, arrows navigate lightbox
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else if (qrOpen) setQrOpen(null);
      }
      if (lightbox) {
        if (e.key === "ArrowRight")
          setLightbox((lb) => ({
            ...lb,
            index: (lb.index + 1) % lb.images.length,
          }));
        if (e.key === "ArrowLeft")
          setLightbox((lb) => ({
            ...lb,
            index: (lb.index - 1 + lb.images.length) % lb.images.length,
          }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrOpen, lightbox]);

  const navButtonStyle = (color, side) => ({
    position: "absolute",
    [side]: 16,
    top: "50%",
    transform: "translateY(-50%)",
    width: 44,
    height: 44,
    padding: 0,
    display: "grid",
    placeItems: "center",
    borderRadius: "9999px",
    border: `1px solid ${color}`,
    background: "rgba(0,0,0,0.45)",
    color,
    cursor: "pointer",
    userSelect: "none",
    lineHeight: 1,
    fontSize: 22,
  });

  return (
    <div
      style={{
        padding: "0 2rem",
        maxWidth: "1000px",
        margin: "0 auto",
        fontFamily: "monospace",
        color: "#eaeaea",
        lineHeight: 1.6,
      }}
    >
      {/* image boxes: fixed width on desktop, full row width on small screens */}
      <style>{`
        .rot-img { width: var(--w); height: var(--h); flex: 0 0 var(--w); }
        @media (max-width: 640px) {
          .rot-img { width: 100%; flex: 1 1 100%; }
          /* minor-tier thumbs stay small and sit beside the text */
          .rot-img.rot-img-sm { width: 118px; flex: 0 0 118px; height: 80px; }
        }
        /* narrow screens centre the page: the heading, the filter pills, each
           project's row (its images and text block) and every project title;
           the body copy stays left-aligned inside its block, for reading */
        @media (max-width: 880px) {
          .proj-h1, .proj-section, .proj-title { text-align: center; }
          .proj-pills, .proj-row { justify-content: center; }
        }
        /* hover note on link pills (links with a note field) */
        .pill-tipwrap { position: relative; display: inline-block; }
        .pill-tip {
          position: absolute;
          bottom: calc(100% + 9px);
          left: 0;
          width: max-content;
          max-width: 270px;
          padding: 7px 10px;
          border: 1px solid #555;
          border-radius: 8px;
          background: rgba(12, 15, 21, 0.97);
          color: #cfd4e0;
          font-size: 0.72rem;
          line-height: 1.5;
          opacity: 0;
          transform: translateY(3px);
          pointer-events: none;
          transition: opacity 0.15s ease, transform 0.15s ease;
          z-index: 30;
        }
        .pill-tipwrap:hover .pill-tip,
        .pill-tipwrap:focus-within .pill-tip {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      <h1
        className="proj-h1"
        style={{
          fontSize: "2rem",
          marginBottom: "1.2rem",
          borderBottom: "1px solid #444",
          paddingBottom: "0.5rem",
        }}
      >
        Projects
      </h1>

      {/* Category filter pills */}
      <div
        className="proj-pills"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: "2rem",
        }}
      >
        {CATEGORIES.map(({ key, label }) => {
          const count =
            key === "all"
              ? projects.length
              : projects.filter((p) => p.tags?.includes(key)).length;
          const isActive = activeFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveFilter(key)}
              style={{
                fontFamily: "monospace",
                fontSize: "0.85rem",
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${isActive ? "#eaeaea" : "#444"}`,
                background: isActive ? "rgba(234,234,234,0.1)" : "transparent",
                color: isActive ? "#eaeaea" : "#999",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = "#ccc";
                  e.currentTarget.style.borderColor = "#666";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = "#999";
                  e.currentTarget.style.borderColor = "#444";
                }
              }}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {projects.filter((p) => !p.minor).map((proj, i) => {
        const images = proj.images || (proj.image ? [proj.image] : []);

        const isVisible =
          activeFilter === "all" || proj.tags?.includes(activeFilter);

        return (
          <div
            key={i}
            id={projectSlug(proj.title)}
            /* the chat's "tell me about this one": the card under the
               pointer, or last clicked, is what "this" means */
            onMouseEnter={() => noteAttention({ kind: "project", name: projectShortName(proj.title), slug: projectSlug(proj.title) })}
            onClickCapture={() => noteAttention({ kind: "project", name: projectShortName(proj.title), slug: projectSlug(proj.title) })}
            style={{
              scrollMarginTop: "84px",
              overflow: "hidden",
              opacity: isVisible ? 1 : 0,
              // generous cap — must exceed any card with every nested
              // accordion expanded (PokeCompare fully open passes 2400)
              maxHeight: isVisible ? 20000 : 0,
              marginBottom: isVisible ? "3rem" : 0,
              transform: isVisible ? "scale(1)" : "scale(0.97)",
              pointerEvents: isVisible ? "auto" : "none",
              transition: isVisible
                ? "opacity 0.35s ease 0.08s, transform 0.35s ease 0.08s, max-height 0.35s ease, margin-bottom 0.35s ease"
                : "opacity 0.2s ease, transform 0.2s ease, max-height 0.2s ease 0.15s, margin-bottom 0.2s ease 0.15s",
            }}
          >
          <div
            className="proj-row"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.5rem",
              alignItems: "flex-start",
            }}
          >
            {/* Image box */}
            <RotatingImage
              images={images}
              borderColor={proj.color}
              altBase={`${proj.title} preview`}
              isVisible={isVisible}
              fit="height"
              onClick={(index) => {
                if (!images.length) return;
                const start = Math.min(index, (images.length || 1) - 1);
                setLightbox({
                  title: proj.title,
                  color: proj.color,
                  // carousel shows thumbs; the lightbox opens full-res when available
                  images: proj.lightboxImages || images,
                  index: start,
                });
              }}
            />

            {/* Text/content */}
            <div className="proj-text" style={{ flex: "1 1 500px" }}>
              <h2
                className="proj-title"
                style={{
                  color: proj.color,
                  margin: "0 0 0.5rem 0",
                  fontSize: "1.3rem",
                }}
              >
                {proj.title}
              </h2>
              {proj.description?.map((line, j) =>
                typeof line === "object" && line !== null ? (
                  <AspectRow
                    key={j}
                    summary={line.summary}
                    details={line.details}
                    color={proj.color}
                  />
                ) : (
                  <p key={j} style={{ margin: "0 0 0.75rem 0" }}>
                    {emphasize(line, proj.color)}
                  </p>
                )
              )}

              {proj.links?.length ? (
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    marginTop: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  {proj.links.map((l, k) => {
                    const pillStyle = {
                      display: "inline-block",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: `1px solid ${proj.color}`,
                      color: proj.color,
                      textDecoration: "none",
                      fontSize: "0.9rem",
                      transition: "all .2s ease",
                    };
                    const hoverProps = {
                      onMouseEnter: (e) => {
                        e.currentTarget.style.backgroundColor = `${proj.color}22`;
                      },
                      onMouseLeave: (e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      },
                    };
                    // In-site pages navigate client-side, same tab
                    const pill = l.internal ? (
                      <Link to={l.href} style={pillStyle} {...hoverProps}>
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href}
                        {...(!/\/art\/?$/.test(l.href) && {
                          target: "_blank",
                          rel: "noopener noreferrer",
                        })}
                        {...(/\/art\/?$/.test(l.href) && {
                          onClick: () => {
                            sessionStorage.setItem("projects-scroll", window.scrollY);
                          },
                        })}
                        style={pillStyle}
                        {...hoverProps}
                      >
                        {l.label}
                      </a>
                    );
                    // links with a note get a hover/focus tooltip
                    return l.note ? (
                      <span key={k} className="pill-tipwrap">
                        <div
                          className="pill-tip"
                          role="tooltip"
                          style={{ borderColor: `${proj.color}66` }}
                        >
                          {l.note}
                        </div>
                        {pill}
                      </span>
                    ) : (
                      <React.Fragment key={k}>{pill}</React.Fragment>
                    );
                  })}

                  {/* Fullscreen QR overlay trigger (only for items with qrData) */}
                  {proj.qrData ? (
                    <button
                      type="button"
                      onClick={() =>
                        setQrOpen({
                          title: proj.title,
                          data: proj.qrData,
                          color: proj.color,
                        })
                      }
                      style={{
                        padding: "6px 12px",
                        borderRadius: "999px",
                        border: `1px solid ${proj.color}`,
                        background: "transparent",
                        color: proj.color,
                        fontSize: "0.9rem",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = `${proj.color}22`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={qrOpen ? true : false}
                    >
                      {typeof proj.qrData === "string" &&
                        proj.qrData.toLowerCase().includes("expo.dev")
                        ? "Show QR (scan in Expo Go)"
                        : "Show QR"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          </div>
        );
      })}

      {/* ---- Smaller Pieces: compact tier for minor works ---- */}
      {(() => {
        const minors = projects.filter((p) => p.minor);
        const anyVisible = minors.some(
          (p) => activeFilter === "all" || p.tags?.includes(activeFilter)
        );
        if (!minors.length) return null;
        return (
          <div
            style={{
              overflow: "hidden",
              opacity: anyVisible ? 1 : 0,
              maxHeight: anyVisible ? 900 : 0,
              transition: "opacity 0.35s ease, max-height 0.35s ease",
            }}
          >
            <h2
              className="proj-section"
              style={{
                fontSize: "1.15rem",
                color: "#9aa3ad",
                borderBottom: "1px solid #333",
                paddingBottom: "0.4rem",
                margin: "0 0 1.4rem 0",
              }}
            >
              Smaller Pieces
            </h2>
            {minors.map((proj) => {
              const images = proj.images || (proj.image ? [proj.image] : []);
              const isVisible =
                activeFilter === "all" || proj.tags?.includes(activeFilter);
              if (!isVisible) return null;
              return (
                <div
                  key={proj.title}
                  id={projectSlug(proj.title)}
                  onMouseEnter={() => noteAttention({ kind: "project", name: projectShortName(proj.title), slug: projectSlug(proj.title) })}
                  onClickCapture={() => noteAttention({ kind: "project", name: projectShortName(proj.title), slug: projectSlug(proj.title) })}
                  className="proj-row proj-row-sm"
                  style={{
                    scrollMarginTop: "84px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "1rem",
                    alignItems: "flex-start",
                    marginBottom: "1.6rem",
                  }}
                >
                  <RotatingImage
                    images={images}
                    width={170}
                    height={110}
                    compact
                    borderColor={proj.color}
                    altBase={`${proj.title} preview`}
                    isVisible={isVisible}
                    onClick={(index) => {
                      if (!images.length) return;
                      setLightbox({
                        title: proj.title,
                        color: proj.color,
                        images: proj.lightboxImages || images,
                        index: Math.min(index, images.length - 1),
                      });
                    }}
                  />
                  <div className="proj-text" style={{ flex: "1 1 150px" }}>
                    <h3
                      className="proj-title"
                      style={{
                        color: proj.color,
                        margin: "0 0 0.35rem 0",
                        fontSize: "1.02rem",
                      }}
                    >
                      {proj.title}
                    </h3>
                    {proj.description?.map((line, j) => (
                      <p
                        key={j}
                        style={{
                          margin: "0 0 0.5rem 0",
                          fontSize: "0.85rem",
                          lineHeight: 1.55,
                          color: "#c9c9c9",
                        }}
                      >
                        {line}
                      </p>
                    ))}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {proj.links?.map((l, k) => {
                        const pillStyle = {
                          padding: "4px 9px",
                          borderRadius: 999,
                          border: `1px solid ${proj.color}`,
                          color: proj.color,
                          textDecoration: "none",
                          fontSize: "0.8rem",
                        };
                        return l.internal ? (
                          <Link key={k} to={l.href} style={pillStyle}>
                            {l.label}
                          </Link>
                        ) : (
                          <a
                            key={k}
                            href={l.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={pillStyle}
                          >
                            {l.label}
                          </a>
                        );
                      })}
                      {proj.qrData ? (
                        <button
                          type="button"
                          onClick={() =>
                            setQrOpen({
                              title: proj.title,
                              data: proj.qrData,
                              color: proj.color,
                            })
                          }
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: `1px solid ${proj.color}`,
                            background: "transparent",
                            color: proj.color,
                            fontSize: "0.8rem",
                            cursor: "pointer",
                          }}
                        >
                          Show QR
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <p style={{ fontStyle: "italic", marginTop: "2rem" }}>
        More is always in the works — visual experiments, creative tools, and
        exploratory AI included.
      </p>

      {/* Fullscreen QR overlay */}
      {qrOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR code overlay"
          onClick={() => {
            if (lightbox) setLightbox(null);
            else if (qrOpen) setQrOpen(null);
          }}
          // onClick={(e) => { if (e.target === e.currentTarget) setQrOpen(null); }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "grid",
            placeItems: "center",
            padding: 24,
          }}
        >
          {(() => {
            const dataStr = String(qrOpen.data || "");
            const isExpo = dataStr.toLowerCase().includes("expo.dev");
            // const isInternal = dataStr.startsWith('/');

            const tipText = isExpo ? (
              <>
                Tip: Install <b>Expo Go</b> on iOS/Android, then scan this QR to
                open the preview.
              </>
            ) : (
              <>
                Tip: Open your phone's camera (or any QR app) and scan to open
                the page.
              </>
            );

            const imgAlt = isExpo
              ? "QR code for Expo preview"
              : "QR code for site link";
            const linkLabel = isExpo
              ? "Open preview in browser"
              : "Open site in new tab";
            // const copiedMsg = isExpo ? 'Preview URL copied to clipboard' : 'Link copied to clipboard';
            const imgLoc = isExpo
              ? qrOpen.data
              : `${PU}/projects/Echoes_of_the_Colorful_Shadows_5x7.pdf`;

            return (
              <div
                style={{
                  width: "min(92vw, 720px)",
                  borderRadius: 16,
                  border: `1px solid ${qrOpen.color || "#4af"}`,
                  background: "#0b0f14",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                  padding: 20,
                  display: "grid",
                  gap: 14,
                  animation: "zoomIn .15s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <h3 style={{ margin: 0, color: "#eaeaea", fontSize: 18 }}>
                    Scan to open:{" "}
                    <span style={{ color: qrOpen.color }}>{qrOpen.title}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setQrOpen(null)}
                    style={{
                      border: "1px solid #2a2f3a",
                      background: "transparent",
                      color: "#bfc6d6",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#151a21";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    Close (Esc)
                  </button>
                </div>

                <p style={{ margin: 0, color: "#bfc6d6", fontSize: 14 }}>
                  {tipText}
                </p>

                <div
                  style={{
                    display: "grid",
                    placeItems: "center",
                    padding: "8px 0 2px",
                  }}
                >
                  <img
                    src={isExpo ? qrSrc(qrOpen.data, 720) : qrOpen.data}
                    alt={imgAlt}
                    style={{
                      width: "min(80vw, 70vh)",
                      height: "auto",
                      maxWidth: 560,
                      borderRadius: 12,
                      border: "1px solid #2a2f3a",
                      background: "#313944ff",
                      padding: 12,
                    }}
                  />
                  {/* {imgAlt} */}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <a
                    href={
                      isExpo
                        ? qrOpen.data
                        : `${PU}/projects/Echoes_of_the_Colorful_Shadows_5x7.pdf`
                    }
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: `1px solid ${qrOpen.color}`,
                      color: qrOpen.color,
                      textDecoration: "none",
                      background: "transparent",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = `${qrOpen.color}22`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    {linkLabel}
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(imgLoc);
                        // alert(copiedMsg);
                      } catch {
                        prompt("Copy this URL:", imgLoc);
                      }
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #2a2f3a",
                      background: "transparent",
                      color: "#eaeaea",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#151a21";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    Copy link
                  </button>
                </div>
              </div>
            );
          })()}

          <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes zoomIn { from { transform: scale(0.98); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        * { transition-duration: 0s !important; animation-duration: 0s !important; }
      }
    `}</style>
        </div>
      )}

      {/* Lightbox overlay for image previews */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.title} image viewer`}
          // onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}
          onClick={() => {
            if (lightbox) setLightbox(null);
            else if (qrOpen) setQrOpen(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 10000,
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <h3 style={{ margin: 0, color: "#eaeaea", fontSize: 18 }}>
              {lightbox.title}
            </h3>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              style={{
                border: "1px solid #2a2f3a",
                background: "transparent",
                color: "#bfc6d6",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#151a21";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              Close (Esc)
            </button>
          </div>

          <div
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
            }}
          >
            <img
              src={lightbox.images[lightbox.index]}
              alt={`${lightbox.title} ${lightbox.index + 1}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "min(92vw, 1400px)",
                maxHeight: "min(80vh, 90vh)",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                // borderRadius: 12,
                border: `1px solid ${lightbox.color}`,
                boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              }}
              onError={() => {
                // If a lightbox image fails, advance to the next (avoid broken icon in overlay)
                setLightbox((lb) => {
                  const n = lb.images.length || 1;
                  return { ...lb, index: (lb.index + 1) % n };
                });
              }}
            />
            {lightbox.images.length > 1 && (
              <>
                <button
                  aria-label="Previous image"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox((lb) => ({
                      ...lb,
                      index:
                        (lb.index - 1 + lb.images.length) % lb.images.length,
                    }));
                  }}
                  style={navButtonStyle(lightbox.color, "left")}
                >
                  ‹
                </button>
                <button
                  aria-label="Next image"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox((lb) => ({
                      ...lb,
                      index: (lb.index + 1) % lb.images.length,
                    }));
                  }}
                  style={navButtonStyle(lightbox.color, "right")}
                >
                  ›
                </button>
              </>
            )}
          </div>

          <div style={{ textAlign: "center", color: "#bfc6d6", fontSize: 14 }}>
            {lightbox.images.length > 1
              ? `${lightbox.index + 1} / ${lightbox.images.length}`
              : ""}
          </div>
        </div>
      )}
    </div>
  );
}
