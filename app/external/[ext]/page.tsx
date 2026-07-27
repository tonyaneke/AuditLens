// Legacy-shell mount: this view still renders in audit-bot.js, now at its clean URL.
// The script seeds view + selection from location.pathname on boot (see initAuditBot).
import AuditApp from "@/components/AuditApp";

export default function Page() {
  return <AuditApp />;
}
