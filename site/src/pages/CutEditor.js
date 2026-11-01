import React, { useEffect, useRef, useState } from "react";
import FloatingHead from "../components/FloatingHead";
import "./CutEditor.css";

/* LOCAL ONLY (/cut): the head alone on a plain page, with the neck-cut
   editor. Three handles in the head's own frame, each with an arrow per
   axis to drag; the plane through them is the cut, shown as a pane, and the
   cut applies live to the dots. The line shown is what goes into NECK_PLANE
   in FloatingHead.js. */

/* one fresh plane just under the cloud (cuts nothing) to drag into place.
   The planes already baked in stay applied underneath but are not shown;
   the block printed is the baked planes plus this one, ready to paste. */
const FRESH = [[-1, -1.3, 0.6], [1, -1.3, 0.6], [0, -1.3, -0.8]];
const fmt = (sets) =>
  "NECK_PLANES = [\n" + sets.map((set) => "  [" + set.map((p) => "[" + p.join(", ") + "]").join(", ") + "],").join("\n") + "\n];";

const VIEW_ONLY = typeof window !== "undefined" && /[?&]view(=|&|$)/.test(window.location.search);

export default function CutEditor() {
  const [line, setLine] = useState("waiting for the head…");
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const apiRef = useRef(null);

  useEffect(() => {
    let poll = 0;
    let gone = false;
    if (VIEW_ONLY) return undefined; // just the head, cut as baked
    const tryStart = () => {
      if (gone) return;
      if (!window.__fhCutEditor || !(window.__fhRestPoints && window.__fhRestPoints())) {
        poll = setTimeout(tryStart, 250);
        return;
      }
      const baked = window.__fhNeckDefault();
      window.__fhCutEditor([FRESH], (sets) => setLine(fmt([...baked, ...sets]))).then((api) => {
        if (gone) api.destroy();
        else {
          apiRef.current = api;
          window.__focusCut = api;
        }
      });
    };
    tryStart();
    return () => {
      gone = true;
      clearTimeout(poll);
      if (apiRef.current) apiRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (apiRef.current) apiRef.current.setView(yaw, pitch);
  }, [yaw, pitch]);

  return (
    <div className="cut-page">
      <div className="cut-stage">
        <FloatingHead big />
      </div>
      {!VIEW_ONLY && (
      <div className="cut-panel">
        <span>the cut already baked in is applied to the head; this one plane is new. Drag an arrow to move its handle along that axis; the pane is the cut. Right-button drag on the head turns it.</span>
        <label>
          <span>view (turn the head)</span>
          <input type="range" min="-1.2" max="1.2" step="0.01" value={yaw} onChange={(e) => setYaw(parseFloat(e.target.value))} />
        </label>
        <label>
          <span>view (nod the head)</span>
          <input type="range" min="-0.8" max="0.8" step="0.01" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} />
        </label>
        <pre>{line}</pre>
      </div>
      )}
    </div>
  );
}
