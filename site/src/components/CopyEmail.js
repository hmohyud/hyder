import React, { useRef, useState } from "react";

/* An email rendered as a link that COPIES the address on click instead of
   launching a mail app. mailto: assumes a configured desktop client, which
   most visitors do not have - it opens a broken compose prompt or nothing at
   all - while the clipboard works for everyone. The mailto href survives as
   the fallback: modified clicks (ctrl/cmd/shift) pass through untouched for
   people who genuinely want their mail app, and a clipboard failure falls
   back to navigating rather than silently doing nothing. */
export default function CopyEmail({ email, className }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  return (
    <a
      href={`mailto:${email}`}
      className={className}
      style={{ position: "relative", display: "inline-block" }}
      title="click to copy the address"
      aria-live="polite"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(email)
            .then(() => {
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1400);
            })
            .catch(() => {
              window.location.href = `mailto:${email}`;
            });
        } else {
          window.location.href = `mailto:${email}`;
        }
      }}
    >
      {/* The email stays in the layout at all times as the size-definer -
          merely hidden while the feedback shows - and the feedback overlays it
          absolutely, where it cannot change width or line height. Swapping the
          text directly shifted the row: the label is a different width, and
          the check glyph is taller than the monospace line box. */}
      <span style={{ visibility: copied ? "hidden" : "visible" }}>{email}</span>
      {copied && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            /* flex-centred, not text-aligned: an absolute span draws its text
               from its TOP edge, while the real email sits on the line-box
               baseline - so the feedback floated visibly higher. Centring on
               both axes lands it exactly where the email's own text sits. */
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            whiteSpace: "nowrap",
          }}
        >
          copied ✓
        </span>
      )}
    </a>
  );
}
