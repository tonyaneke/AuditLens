"use client";

// Global AI-busy overlay (React port of aiBusy()) — same markup/classes as the legacy shell.
// lib/client/ai.ts drives it through registerAiBusy(); polling is paused via sync-pause.

import { useEffect, useState } from "react";
import { registerAiBusy } from "@/lib/client/ai";

const AI_BUSY_MSGS = ["Generating…", "Please hold on…", "Almost done…", "Finishing up…"];

export default function AiBusyOverlay() {
  const [on, setOn] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    registerAiBusy(setOn);
    return () => registerAiBusy(null);
  }, []);

  useEffect(() => {
    if (!on) return;
    document.body.classList.add("ai-busy");
    const t0 = setTimeout(() => setMsgIdx(0), 0);
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % AI_BUSY_MSGS.length), 2800);
    return () => {
      document.body.classList.remove("ai-busy");
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [on]);

  return (
    <div className={`ai-busy-overlay${on ? " show" : ""}`} aria-hidden="true">
      <div className="ai-busy-card">
        <span className="ai-busy-spinner" aria-hidden="true" />
        <span>{AI_BUSY_MSGS[msgIdx]}</span>
      </div>
    </div>
  );
}
