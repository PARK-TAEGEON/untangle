import type { ButtonHTMLAttributes } from "react";

export type LineIconName = "clock" | "close" | "external" | "edit" | "copy" | "preview" | "star" | "more" | "sun" | "moon" | "settings";

export function LineIcon({ name }: { name: LineIconName }) {
  return <svg className="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "settings" && <><path d="m9 3-.5 3-2 .9L4 6l-2 3 2.3 2v2L2 15l2 3 2.5-.9 2 .9.5 3h4l.5-3 2-.9 2.5.9 2-3-2.3-2v-2L20 9l-2-3-2.5.9-2-.9-.5-3Z" /><circle cx="11" cy="12" r="3" /></>}
    {name === "clock" && <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>}
    {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
    {name === "external" && <><path d="M14 4h6v6M20 4l-9 9" /><path d="M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5" /></>}
    {name === "edit" && <><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" /></>}
    {name === "copy" && <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M15 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /></>}
    {name === "preview" && <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
    {name === "star" && <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.8 9.7l6.4-.9L12 3Z" />}
    {name === "more" && <><path d="M5 12h.01M12 12h.01M19 12h.01" /></>}
    {name === "sun" && <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}
    {name === "moon" && <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />}
  </svg>;
}

export function IconButton({ icon, label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LineIconName; label: string }) {
  return <button {...props} type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} data-tooltip={label}><LineIcon name={icon} /></button>;
}
