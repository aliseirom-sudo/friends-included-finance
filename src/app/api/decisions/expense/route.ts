import { NextResponse } from "next/server";
import { allocation } from "@/lib/server";
import { db, recordNotification, recordSheetSyncFailure, requireRole, sendTelegram, syncExpense } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const { employee } = await requireRole("manager");
    const input = await request.json();
    const client = db();
    const { data: existing, error } = await client.from("expenses").select("*").eq("reference", String(input.reference)).single();
    if (error || !existing) return NextResponse.json({ error: "Expense not found." }, { status: 404 });
    if (existing.status === "allocated") return NextResponse.json({ ok: true, message: `${existing.reference} is already allocated; nothing was duplicated.` });
    const finalAllocation = allocation(input.finalAllocation ?? existing.proposed_allocation);
    if (finalAllocation === "Company overhead" || finalAllocation === "A" || finalAllocation === "B") {
      const changed = finalAllocation !== existing.proposed_allocation;
      const updated = await client.from("expenses").update({
        final_allocation: finalAllocation, status: "allocated", approved_by: employee.id, approved_at: new Date().toISOString(), allocation_changed: changed,
        notification_status: existing.telegram_chat_id ? "pending" : "not_required",
        notification_error: existing.telegram_chat_id ? null : "No Telegram recipient linked",
      }).eq("id", existing.id).eq("status", "awaiting_allocation").select("*").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return NextResponse.json({ ok: true, message: `${existing.reference} was already decided by another request.` });
      let sync = "synced";
      try { await syncExpense(existing.id); } catch (err) { sync = "pending"; await recordSheetSyncFailure("expenses", existing.id, err); }
      let notified = "No Telegram recipient linked";
      if (existing.telegram_chat_id) {
        const message = `Expense ${existing.reference}${changed ? " — allocation changed" : ""}. €${(existing.amount_cents / 100).toFixed(2)}: ${existing.description}. Proposed: ${existing.proposed_allocation}. Approved: ${finalAllocation}.`;
        try { await sendTelegram(existing.telegram_chat_id, message); await recordNotification("expenses", existing.id, "sent"); notified = "sent"; }
        catch (err) { await recordNotification("expenses", existing.id, "failed", err); notified = "failed"; }
      }
      return NextResponse.json({ ok: true, sync, notified, message: `${existing.reference} allocated to ${finalAllocation}.` });
    }
    throw new Error("Choose an allocation.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to approve expense." }, { status: 403 });
  }
}
