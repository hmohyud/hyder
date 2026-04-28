import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./GithubContributions.css";

const cache = new Map();
function fetchContribs(username) {
  if (!cache.has(username)) {
    const p = fetch(
      `https://github-contributions-api.jogruber.de/v4/${username}?y=last`
    ).then((r) => {
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    });
    cache.set(username, p);
  }
  return cache.get(username);
}

function useContribData(username) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchContribs(username)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [username]);
  return { data, error };
}

function computeTotals(data) {
  if (!data?.contributions?.length) return { weeks: [], lastYearTotal: 0, ytdTotal: 0 };
  const all = data.contributions;
  const lyTotal = data.total?.lastYear ?? all.reduce((a, c) => a + c.count, 0);
  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const ytd = all
    .filter((c) => new Date(c.date) >= yearStart)
    .reduce((a, c) => a + c.count, 0);
  const firstDow = new Date(all[0].date).getDay();
  const cells = [...Array(firstDow).fill(null), ...all];
  const cols = [];
  for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
  return { weeks: cols, lastYearTotal: lyTotal, ytdTotal: ytd };
}

export function ContribLabel({ username = "hmohyud", className = "" }) {
  const { data, error } = useContribData(username);
  const { lastYearTotal, ytdTotal } = useMemo(() => computeTotals(data), [data]);
  const labelRef = useRef(null);
  const trackRef = useRef(null);

  // If the label text would exceed the available width on a tiny viewport,
  // measure the overflow and turn on a marquee that pongs back and forth.
  // The static font-size still does the heavy lifting on most screens.
  useLayoutEffect(() => {
    const label = labelRef.current;
    const track = trackRef.current;
    if (!label || !track) return;
    const measure = () => {
      // Briefly disable the marquee class so we measure intrinsic widths.
      label.classList.remove("gh-marquee");
      const overflow = track.scrollWidth - label.clientWidth;
      if (overflow > 1) {
        label.style.setProperty("--gh-overflow", overflow + "px");
        label.classList.add("gh-marquee");
      } else {
        label.style.removeProperty("--gh-overflow");
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(label);
    ro.observe(track);
    return () => ro.disconnect();
  }, [data, lastYearTotal, ytdTotal]);

  if (error) return null;
  return (
    <a
      ref={labelRef}
      className={`gh-contrib-label ${className}`}
      href={`https://github.com/${username}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${lastYearTotal} GitHub contributions in the last year — open profile`}
    >
      <span ref={trackRef} className="gh-contrib-label-track">
        <span className="gh-contrib-count">{data ? lastYearTotal.toLocaleString() : "—"}</span>
        <span className="gh-contrib-suffix">contributions in the last year</span>
        {data && ytdTotal > 0 && (
          <span className="gh-contrib-ytd">· {ytdTotal.toLocaleString()} this year</span>
        )}
      </span>
    </a>
  );
}

export function ContribGrid({ username = "hmohyud", className = "" }) {
  const { data, error } = useContribData(username);
  const { weeks } = useMemo(() => computeTotals(data), [data]);
  if (error) return null;
  return (
    <a
      className={`gh-contrib-grid-wrap ${className}`}
      href={`https://github.com/${username}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-hidden="true"
      tabIndex={-1}
    >
      <div className={`gh-contrib-grid${data ? "" : " gh-contrib-loading"}`} role="presentation">
        {(weeks.length ? weeks : Array.from({ length: 53 }, () => [])).map((col, ci) => (
          <div className="gh-col" key={ci}>
            {Array.from({ length: 7 }).map((_, ri) => {
              const cell = col[ri];
              const level = cell?.level ?? 0;
              const isEmpty = !cell;
              const delay = ci * 22 + ri * 8;
              return (
                <span
                  key={ri}
                  className={`gh-cell gh-l${level}${isEmpty ? " gh-empty" : ""}`}
                  style={{ animationDelay: `${delay}ms` }}
                  title={cell ? `${cell.count} on ${cell.date}` : ""}
                />
              );
            })}
          </div>
        ))}
      </div>
    </a>
  );
}

export default function GithubContributions({ username }) {
  return (
    <>
      <ContribLabel username={username} />
      <ContribGrid username={username} />
    </>
  );
}
