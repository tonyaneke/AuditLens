"use client";

/* Marks a test whose exception has already been raised as an observation — green, so a test
   still waiting to be raised (the red ⚑ Raise button) stands out from one that is done. */

export default function RaisedPill({ count }: { count: number }) {
  return (
    <span className="pill c-Low" title={`${count} observation${count === 1 ? "" : "s"} raised from this test`}>
      ✓ Raised{count > 1 ? ` (${count})` : ""}
    </span>
  );
}
