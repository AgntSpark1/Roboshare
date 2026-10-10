"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** Accessible dialog: labelled by its title, closes on Escape or the scrim, returns focus to the opener. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="mhead">
          <h3 id={id}>{title}</h3>
          <button type="button" className="x" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
