import { useEffect, useRef } from "react";

/*
 * Neon palette — most lines are very dim, a few are colored accents.
 * Matches the portal colors from Landing.css.
 */
const NEON_ACCENTS = [
  "rgba(255,107,157,0.6)",  // pink  (portal-p1)
  "rgba(163,107,255,0.55)", // purple (portal-p2)
  "rgba(107,207,255,0.55)", // cyan  (portal-p3)
  "rgba(107,255,157,0.45)", // green (portal-p4)
];
const DIM_STROKE = "rgba(160,180,220,0.035)";

export default function ColorWaveBackground() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    fetch(process.env.PUBLIC_URL + "/colorwave.svg")
      .then((r) => r.text())
      .then((svgText) => {
        if (cancelled) return;

        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, "image/svg+xml");
        const svg = doc.querySelector("svg");
        if (!svg) return;

        svg.style.cssText =
          "width:100%;height:100%;position:absolute;inset:0;opacity:0;";

        container.appendChild(svg);

        const xmlns = "http://www.w3.org/2000/svg";
        const paths = svg.querySelectorAll("path");
        const defs = svg.querySelector("defs");
        if (!defs) return;

        const pathCount = paths.length;

        // Pick ~8 random indices to be neon-colored, rest are dim
        const accentSet = new Set();
        while (accentSet.size < Math.min(8, pathCount)) {
          accentSet.add(Math.floor(Math.random() * pathCount));
        }

        // Build one big CSS string with all keyframes + per-path rules
        const rules = [];

        paths.forEach((p, i) => {
          const clone = p.cloneNode();
          clone.setAttribute("stroke-dasharray", "");

          const mask = document.createElementNS(xmlns, "mask");
          mask.setAttribute("id", `cw-m-${i}`);
          mask.appendChild(clone);
          defs.appendChild(mask);

          p.setAttribute("mask", `url(#cw-m-${i})`);

          const len = clone.getTotalLength();
          const delay = (i * 0.12).toFixed(2);

          // Recolor paths
          if (accentSet.has(i)) {
            p.setAttribute(
              "stroke",
              NEON_ACCENTS[i % NEON_ACCENTS.length]
            );
          } else {
            p.setAttribute("stroke", DIM_STROKE);
          }

          // Set initial dasharray on clone (mask) and path
          clone.setAttribute("stroke-dasharray", len);
          clone.setAttribute("stroke-dashoffset", len);
          p.style.strokeDashoffset = "0";

          // Keyframes for this mask clone (easeInOut reveal)
          rules.push(
            `@keyframes cw-c-${i}{` +
              `0%{stroke-dashoffset:${len}}` +
              `100%{stroke-dashoffset:${len * 3}}` +
            `}`
          );
          // Keyframes for the visible path (slow linear drift)
          rules.push(
            `@keyframes cw-p-${i}{` +
              `0%{stroke-dashoffset:0}` +
              `100%{stroke-dashoffset:${len * 0.4}}` +
            `}`
          );

          // Apply CSS animation to clone
          clone.style.animation =
            `cw-c-${i} 10s ${delay}s ease-in-out infinite`;
          // Apply CSS animation to path
          p.style.animation =
            `cw-p-${i} 10s linear infinite`;
        });

        // Inject one <style> with all keyframes + mask stroke rule
        const style = document.createElementNS(xmlns, "style");
        style.textContent =
          "defs path{stroke:white;stroke-width:2px;}" + rules.join("");
        svg.insertBefore(style, svg.firstChild);

        // Fade in (keep subdued so it doesn't overpower content)
        svg.style.transition = "opacity 0.6s ease";
        svg.style.opacity = "0.55";
      });

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, []);

  return <div ref={containerRef} className="shader-bg" />;
}
