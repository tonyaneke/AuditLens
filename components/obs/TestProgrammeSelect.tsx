"use client";

// Test-programme picker for the raise flows: the tests in one audit's plan, so a new observation
// can be tied to the test it came from — the same link Raise exception stamps from the test side.

import { testTitle } from "@/lib/workspace/observations";
import type { AuditTest } from "@/lib/workspace/types";

function optionLabel(t: AuditTest): string {
  const name = (t.ref ? t.ref + " — " : "") + (testTitle(t) || "Untitled test");
  return t.result && t.result !== "Not Tested" ? `${name} · ${t.result}` : name;
}

export default function TestProgrammeSelect({
  tests,
  value,
  onChange,
  orphanLabel,
}: {
  tests: AuditTest[];
  value: string;
  onChange: (t: AuditTest | undefined) => void;
  /** Shown for a linked test that has since left the programme, so the link is visible rather
   *  than silently rendered as "not linked" while the observation still carries it. */
  orphanLabel?: string;
}) {
  const orphan = !!value && !tests.some((t) => t.id === value);
  if (!tests.length && !orphan)
    return (
      <select disabled value="">
        <option value="">No test programme on this audit yet</option>
      </select>
    );
  return (
    <select value={value} onChange={(e) => onChange(tests.find((t) => t.id === e.target.value))}>
      <option value="">— not linked to a test —</option>
      {tests.map((t) => (
        <option key={t.id} value={t.id}>
          {optionLabel(t)}
        </option>
      ))}
      {orphan ? <option value={value}>{`${orphanLabel || "Removed test"} (no longer in the programme)`}</option> : null}
    </select>
  );
}
