"use client";

// React modal system reusing the legacy markup/classes verbatim (.overlay.show > .modal >
// .mh/.mb/.mf) so app/globals.css needs no changes. Improvements over the legacy single
// #modal element: a small stack (confirm/success can layer over an open dialog and restore
// it), and Promise-based confirm() that reproduces the legacy uiConfirm contract — busy
// button, await the operation, flush the debounced workspace save, then close.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { pauseSync, resumeSync } from "@/lib/workspace/sync-pause";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type ModalEntry = { id: number; node: ReactNode; wide?: boolean };

type ConfirmOpts = {
  message: ReactNode;
  title?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  busyLabel?: string;
  /** Awaited while the confirm button shows a spinner; the pending save is flushed after. */
  onConfirm?: () => void | Promise<void>;
};

type ModalApi = {
  open: (node: ReactNode, opts?: { wide?: boolean }) => number;
  close: () => void;
  closeAll: () => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  success: (message: ReactNode, title?: string) => void;
  isOpen: boolean;
};

const ModalContext = createContext<ModalApi | null>(null);

let nextModalId = 1;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  const { saveNow } = useWorkspace();

  // Pause workspace polling while any modal is open (legacy pollData guard).
  useEffect(() => {
    if (stack.length) pauseSync("modal");
    else resumeSync("modal");
    return () => resumeSync("modal");
  }, [stack.length]);

  const open = useCallback((node: ReactNode, opts?: { wide?: boolean }) => {
    const id = nextModalId++;
    setStack((cur) => [...cur, { id, node, wide: opts?.wide }]);
    return id;
  }, []);

  const close = useCallback(() => setStack((cur) => cur.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        const id = nextModalId++;
        const done = (ok: boolean) => {
          setStack((cur) => cur.filter((e) => e.id !== id));
          resolve(ok);
        };
        setStack((cur) => [
          ...cur,
          {
            id,
            node: (
              <ConfirmDialog opts={opts} flush={saveNow} onDone={done} />
            ),
          },
        ]);
      }),
    [saveNow],
  );

  const success = useCallback(
    (message: ReactNode, title?: string) => {
      const id = nextModalId++;
      setStack((cur) => [
        ...cur,
        {
          id,
          node: (
            <ModalFrame
              title={title || "Success"}
              footer={
                <button
                  className="btn"
                  type="button"
                  onClick={() => setStack((c) => c.filter((e) => e.id !== id))}
                >
                  Done
                </button>
              }
              onClose={() => setStack((c) => c.filter((e) => e.id !== id))}
            >
              <div className="success-modal">
                <div className="success-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
                <div className="success-msg">{message}</div>
              </div>
            </ModalFrame>
          ),
        },
      ]);
    },
    [],
  );

  const api = useMemo<ModalApi>(
    () => ({ open, close, closeAll, confirm, success, isOpen: stack.length > 0 }),
    [open, close, closeAll, confirm, success, stack.length],
  );

  const top = stack[stack.length - 1];

  return (
    <ModalContext.Provider value={api}>
      {children}
      <div
        className={`overlay${top ? " show" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        {top ? (
          <div className={`modal${top.wide ? " wide" : ""}`}>{top.node}</div>
        ) : null}
      </div>
    </ModalContext.Provider>
  );
}

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used inside <ModalProvider>");
  return ctx;
}

/** Standard dialog frame — legacy .mh/.mb/.mf structure with the × close button. */
export function ModalFrame({
  title,
  footer,
  onClose,
  children,
}: {
  title: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
}) {
  const modal = useContext(ModalContext);
  const close = onClose || modal?.close;
  return (
    <>
      <div className="mh">
        <h3>{title}</h3>
        <button className="x" type="button" onClick={close} aria-label="Close">
          ×
        </button>
      </div>
      <div className="mb">{children}</div>
      {footer !== undefined ? <div className="mf">{footer}</div> : null}
    </>
  );
}

function ConfirmDialog({
  opts,
  flush,
  onDone,
}: {
  opts: ConfirmOpts;
  flush: () => Promise<void>;
  onDone: (ok: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <ModalFrame
      title={opts.title || "Please confirm"}
      onClose={() => !busy && onDone(false)}
      footer={
        <>
          <button
            className="btn sec"
            type="button"
            disabled={busy}
            onClick={() => onDone(false)}
          >
            {opts.cancelLabel || "Cancel"}
          </button>
          <button
            className={`btn ${opts.danger ? "danger" : ""}`}
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await opts.onConfirm?.();
                await flush();
              } catch {
                /* surfaced by the operation itself */
              }
              onDone(true);
            }}
          >
            {busy ? (
              <>
                <span className="btn-spin" aria-hidden="true" />{" "}
                {opts.busyLabel !== undefined ? opts.busyLabel : "Please wait…"}
              </>
            ) : (
              opts.confirmLabel || "Confirm"
            )}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.55 }}>{opts.message}</div>
    </ModalFrame>
  );
}
