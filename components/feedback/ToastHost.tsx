"use client";

// React toast system reusing the legacy CSS (.toast-host/.toast/.toast-*). A module-level
// toast() singleton lets non-component code (export helpers, client libs) raise toasts too.

import { useEffect, useState } from "react";

type ToastType = "info" | "success" | "error";
type ToastItem = { id: number; msg: string; type: ToastType; leaving: boolean };

let pushToast: ((msg: string, type?: ToastType) => void) | null = null;

export function toast(msg: string, type: ToastType = "info"): void {
  if (msg == null || msg === "") return;
  pushToast?.(String(msg), type);
}

let nextId = 1;

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    pushToast = (msg, type = "info") => {
      const id = nextId++;
      setItems((cur) => [...cur, { id, msg, type, leaving: false }]);
      const ttl = type === "error" ? 6000 : 4200;
      setTimeout(() => dismiss(id), ttl);
    };
    return () => {
      pushToast = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss(id: number) {
    setItems((cur) => cur.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 260);
  }

  if (!items.length) return null;
  return (
    <div className="toast-host" id="toastHostReact">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type} in${t.leaving ? " out" : ""}`}>
          <span className="toast-ico" aria-hidden="true">
            {t.type === "error" ? "!" : t.type === "success" ? "✓" : "i"}
          </span>
          <span className="toast-msg">{t.msg}</span>
          <button
            className="toast-x"
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
