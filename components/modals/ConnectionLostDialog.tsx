"use client";

// The "we never reached the server" dialog. Shown when an action that needs the network could not
// complete because the round trip failed — not because the operation was rejected.
//
// It is a modal rather than the inline error the closure gate used to show for two reasons: the
// owner has usually just spent 20 seconds watching a spinner, so the outcome has to be
// unmissable; and the fix is theirs to make (reconnect, then retry), which is a decision, not a
// footnote under a text box.

import { useModal, ModalFrame } from "@/components/modals/ModalProvider";
import type { AiFailureKind } from "@/lib/client/ai";

const COPY: Record<AiFailureKind, { title: string; lead: string }> = {
  offline: {
    title: "No internet connection",
    lead: "Your device is offline, so we couldn’t reach AuditLens.",
  },
  timeout: {
    title: "The connection timed out",
    lead: "AuditLens took too long to respond — usually a slow or unstable connection.",
  },
  connection: {
    title: "Network not available",
    lead: "We couldn’t reach AuditLens just now.",
  },
};

export function ConnectionLostDialog({
  kind = "connection",
  /** What the user was in the middle of, e.g. "Your response has not been submitted". */
  detail,
  /** Re-runs the action. The dialog closes first, so the underlying form is live again. */
  onRetry,
}: {
  kind?: AiFailureKind;
  detail?: string;
  onRetry?: () => void;
}) {
  const modal = useModal();
  const copy = COPY[kind] || COPY.connection;

  return (
    <ModalFrame
      title={copy.title}
      footer={
        <>
          <button className="btn sec" type="button" onClick={() => modal.close()}>
            Close
          </button>
          {onRetry ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                modal.close();
                onRetry();
              }}
            >
              Try again
            </button>
          ) : null}
        </>
      }
    >
      <div className="conn-modal">
        <div className="conn-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <path d="M12 20h.01" />
            <path d="M2 2l20 20" />
          </svg>
        </div>
        <div className="conn-msg">
          {copy.lead}
          {/* Said plainly, because the thing an owner most needs to know after a failed submit is
              whether it half-went-through. Nothing was sent. */}
          {detail ? <div className="conn-detail">{detail}</div> : null}
          <div className="conn-hint">Check your connection and try again.</div>
        </div>
      </div>
    </ModalFrame>
  );
}
