"use client";

// Button that shows the legacy .btn-spin spinner and disables itself while its async
// onClick runs (React equivalent of btnBusy()).

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type BusyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick: () => void | Promise<void>;
  busyLabel?: ReactNode;
  children: ReactNode;
};

export default function BusyButton({
  onClick,
  busyLabel,
  children,
  disabled,
  ...rest
}: BusyButtonProps) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <>
          <span className="btn-spin" aria-hidden="true" />
          {busyLabel != null ? <> {busyLabel}</> : null}
        </>
      ) : (
        children
      )}
    </button>
  );
}
