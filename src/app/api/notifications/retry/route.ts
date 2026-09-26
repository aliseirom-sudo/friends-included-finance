import { NextResponse } from "next/server";
import { db, recordNotification, requireRole, sendTelegram } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await requireRole("manager");
    const { kind, reference } = await request.json();
    if (kind !== "sales" && kind !== "expenses") return NextResponse.json({ error: "Choose a sale or expense." }, { status: 400 });
    const { data, error } = await db().from(kind).select("*").eq("reference", reference).single();
    if (error || !data) return NextResponse.json({ error: "Record not found." }, { status: 404 });
    if (!data.telegram_chat_id) return NextResponse.json({ error: "No Telegram recipient linked." }, { status: 400 });
    let message: string;
    if (kind === "sales") {
      if (data.status === "pending_approval") {
        message = `Sale ${data.reference} recorded. €${(data.amount_cents / 100).toFixed(2)}, project ${data.project}, status Pending approval.`;
      } else {
        const shares = [data.approved_richard, data.approved_anastasia, data.approved_jean_claude];
        const amounts = [data.commission_richard_cents, data.commission_anastasia_cents, data.commission_jean_claude_cents];
        message = `Sale ${data.reference} approved${data.split_changed ? " — commission split changed" : ""}. Sale €${(data.amount_cents / 100).toFixed(2)}; total commission €${(amounts.reduce((a: number, b: number) => a + b, 0) / 100).toFixed(2)}. ${["Richard", "Anastasia", "Jean-Claude"].map((name, i) => `${name}: ${shares[i]}% (€${(amounts[i] / 100).toFixed(2)})`).join("; ")}.`;
      }
    } else {
      if (data.status === "awaiting_allocation" || data.proposed_allocation === "Company overhead") {
        const status = data.status === "allocated" ? "Allocated to Company overhead" : "Awaiting allocation";
        message = `Expense ${data.reference} recorded. €${(data.amount_cents / 100).toFixed(2)}, proposed allocation ${data.proposed_allocation}, status ${status}.`;
      } else {
        message = `Expense ${data.reference}${data.allocation_changed ? " — allocation changed" : ""}. €${(data.amount_cents / 100).toFixed(2)}: ${data.description}. Proposed: ${data.proposed_allocation}. Approved: ${data.final_allocation}.`;
      }
    }
    try { await sendTelegram(data.telegram_chat_id, message); await recordNotification(kind, data.id, "sent"); return NextResponse.json({ ok: true }); }
    catch (sendError) { await recordNotification(kind, data.id, "failed", sendError); return NextResponse.json({ error: "Telegram delivery failed; the saved decision is unchanged." }, { status: 502 }); }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retry notification." }, { status: 403 });
  }
}
