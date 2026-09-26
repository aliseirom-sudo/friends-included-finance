import { NextResponse } from "next/server";
import { calculateCommissions } from "@/lib/domain";
import { db, recordNotification, recordSheetSyncFailure, requireRole, sendTelegram, syncSale } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const { employee } = await requireRole("manager");
    const input = await request.json();
    const client = db();
    const { data: existing, error } = await client.from("sales").select("*").eq("reference", String(input.reference)).single();
    if (error || !existing) return NextResponse.json({ error: "Sale not found." }, { status: 404 });
    if (existing.status === "approved") return NextResponse.json({ ok: true, message: `${existing.reference} is already approved; nothing was duplicated.` });
    const shares = input.shares ? [Number(input.shares.richard), Number(input.shares.anastasia), Number(input.shares.jeanClaude)] : [existing.proposed_richard, existing.proposed_anastasia, existing.proposed_jean_claude];
    const { earnedCents } = calculateCommissions(existing.amount_cents, shares);
    const changed = shares[0] !== Number(existing.proposed_richard) || shares[1] !== Number(existing.proposed_anastasia) || shares[2] !== Number(existing.proposed_jean_claude);
    const updated = await client.from("sales").update({
      approved_richard: shares[0], approved_anastasia: shares[1], approved_jean_claude: shares[2],
      commission_richard_cents: earnedCents[0], commission_anastasia_cents: earnedCents[1], commission_jean_claude_cents: earnedCents[2],
      status: "approved", approved_by: employee.id, approved_at: new Date().toISOString(), split_changed: changed,
      notification_status: existing.telegram_chat_id ? "pending" : "not_required",
      notification_error: existing.telegram_chat_id ? null : "No Telegram recipient linked",
    }).eq("id", existing.id).eq("status", "pending_approval").select("*").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ ok: true, message: `${existing.reference} was already decided by another request.` });
    let sync = "synced";
    try { await syncSale(existing.id); } catch (err) { sync = "pending"; await recordSheetSyncFailure("sales", existing.id, err); }
    let notified = "No Telegram recipient linked";
    if (existing.telegram_chat_id) {
      const total = earnedCents.reduce((a, b) => a + b, 0) / 100;
      const names = ["Richard", "Anastasia", "Jean-Claude"];
      const message = `Sale ${existing.reference} approved${changed ? " — commission split changed" : ""}. Sale €${(existing.amount_cents / 100).toFixed(2)}; total commission €${total.toFixed(2)}. ${names.map((name, index) => `${name}: ${shares[index]}% (€${(earnedCents[index] / 100).toFixed(2)})`).join("; ")}.`;
      try { await sendTelegram(existing.telegram_chat_id, message); await recordNotification("sales", existing.id, "sent"); notified = "sent"; }
      catch (err) { await recordNotification("sales", existing.id, "failed", err); notified = "failed"; }
    }
    return NextResponse.json({ ok: true, sync, notified, message: `${existing.reference} approved.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to approve sale." }, { status: 403 });
  }
}
