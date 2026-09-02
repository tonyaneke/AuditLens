"use client";

// React modal system reusing the legacy markup/classes verbatim (.overlay.show > .modal >
// .mh/.mb/.mf) so app/globals.css needs no changes. Improvements over the legacy single
// #modal element: a small stack (confirm/success can layer over an open dialog and restore
// it), and Promise-based confirm() that reproduces the legacy uiConfirm contract — busy
// button, await the operation, flush the debounced workspace save, then close.
//
// Clicking the overlay or × no longer discards in-progress forms: modals that register a
// guard via useModalGuard() get a top-right prompt to save a draft or exit without saving.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { pauseSync, resumeSync } from "@/lib/workspace/sync-pause";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type ModalEntry = { id: number; node: ReactNode; wide?: boolean };

export type ModalGuard = {
  dirty: boolean;
  saveDraft?: () => void | Promise<void>;
  message?: string;
};

type ModalGuardHandle = { read: () => ModalGuard | null };

type ModalEntryApi = {
  registerGuard: (handle: ModalGuardHandle | null) => void;
  requestClose: () => void;
};

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
const ModalEntryContext = createContext<ModalEntryApi | null>(null);

let nextModalId = 1;

function ModalExitPrompt({
  message,
  canSave,
  onKeep,
  onSave,
  onDiscard,
}: {
  message?: string;
  canSave: boolean;
  onKeep: () => void;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-exit-prompt in" role="dialog" aria-labelledby="modal-exit-title">
      <div className="modal-exit-title" id="modal-exit-title">
        Leave this screen?
      </div>
      <p className="modal-exit-msg">
        {message || "You have unsaved changes. Save a draft to continue later, or exit without saving."}
      </p>
      <div className="modal-exit-actions">
        <button className="btn sec sm" type="button" disabled={busy} onClick={onKeep}>
          Keep editing
        </button>
        {canSave ? (
          <button
            className="btn sm"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save draft"}
          </button>
        ) : null}
        <button className="btn ghost sm" type="button" disabled={busy} onClick={onDiscard}>
          Exit without saving
        </button>
      </div>
    </div>
  );
}

function ModalEntryProvider({
  children,
  onClose,
  onReady,
}: {
  children: ReactNode;
  onClose: () => void;
  onReady: (api: ModalEntryApi) => void;
}) {
  const guardHandleRef = useRef<ModalGuardHandle | null>(null);
  const [exitOpen, setExitOpen] = useState(false);

  const registerGuard = useCallback((handle: ModalGuardHandle | null) => {
    guardHandleRef.current = handle;
  }, []);

  const requestClose = useCallback(() => {
    const g = guardHandleRef.current?.read();
    if (g?.dirty) {
      setExitOpen(true);
      return;
    }
    onClose();
  }, [onClose]);

  const api = useMemo<ModalEntryApi>(
    () => ({ registerGuard, requestClose }),
    [registerGuard, requestClose],
  );

  useEffect(() => {
    onReady(api);
    return () => onReady({ registerGuard: () => {}, requestClose: onClose });
  }, [api, onReady, onClose, registerGuard]);

  return (
    <ModalEntryContext.Provider value={api}>
      {children}
      {exitOpen ? (
        <ModalExitPrompt
          message={guardHandleRef.current?.read()?.message}
          canSave={!!guardHandleRef.current?.read()?.saveDraft}
          onKeep={() => setExitOpen(false)}
          onDiscard={() => {
            setExitOpen(false);
            onClose();
          }}
          onSave={async () => {
            await guardHandleRef.current?.read()?.saveDraft?.();
            setExitOpen(false);
            onClose();
          }}
        />
      ) : null}
    </ModalEntryContext.Provider>
  );
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  const { saveNow } = useWorkspace();
  const topApiRef = useRef<ModalEntryApi | null>(null);

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

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      topApiRef.current?.requestClose() ?? close();
    },
    [close],
  );

  return (
    <ModalContext.Provider value={api}>
      {children}
      <div className={`overlay${top ? " show" : ""}`} onClick={handleOverlayClick}>
        {top ? (
          <ModalEntryProvider
            onClose={close}
            onReady={(entryApi) => {
              topApiRef.current = entryApi;
            }}
          >
            <div className={`modal${top.wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
              {top.node}
            </div>
          </ModalEntryProvider>
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

/** Prefer this over modal.close() for Cancel buttons — respects unsaved-work guard. */
export function useModalClose(): () => void {
  const entry = useContext(ModalEntryContext);
  const modal = useContext(ModalContext);
  return entry?.requestClose ?? modal?.close ?? (() => {});
}

/** Register dirty-state + optional draft save for the current modal. */
export function useModalGuard(guard: ModalGuard) {
  const entry = useContext(ModalEntryContext);
  const ref = useRef(guard);
  ref.current = guard;

  useEffect(() => {
    if (!entry) return;
    entry.registerGuard({ read: () => ref.current });
    return () => entry.registerGuard(null);
  }, [entry]);
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
  const entry = useContext(ModalEntryContext);
  const modal = useContext(ModalContext);
  const close = onClose || entry?.requestClose || modal?.close;
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
