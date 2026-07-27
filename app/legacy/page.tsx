// The legacy audit-bot.js shell, kept alive during the strangler-fig migration. Unmigrated
// views deep-link here as /legacy?view=x&audit=…; the script seeds its state from the query
// string on boot. This page (and audit-bot.js itself) is deleted when the last view migrates.
import AuditApp from "@/components/AuditApp";

export default function LegacyPage() {
  return <AuditApp />;
}
