import { NextResponse } from "next/server";
import { validateSale } from "@/lib/domain";
import { currentEmployee, db, getSession, recordSheetSyncFailure, syncSale } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "salesperson") return NextResponse.json({ error: "Only a salesperson can submit a sale." }, { status: 403 });
    const employee = await currentEmployee();
    if (!employee) return NextResponse.json({ error: "Selected employee is not configured." }, { status: 503 });
    const input = await request.json();
    const { amountCents } = validateSale(input);
    const shares = [Number(input.richard), Number(input.anastasia), Number(input.jeanClaude)];
    const inserted = await db().from("sales").insert({
      reference: String(input.reference).trim(), employee_id: employee.id, submitter_name: employee.display_name,
      telegram_chat_id: employee.telegram_chat_id, customer: String(input.customer).trim(), project: input.project,
      description: String(input.description).trim(), amount_cents: amountCents,
      proposed_richard: shares[0], proposed_anastasia: shares[1], proposed_jean_claude: shares[2],
      status: "pending_approval", notification_status: employee.telegram_chat_id ? "pending" : "not_required",
      notification_error: employee.telegram_chat_id ? null : "No Telegram recipient linked",
    }).select("*").single();
    if (inserted.error) {
      if (inserted.error.code === "23505") return NextResponse.json({ error: `Reference ${input.reference} already exists.` }, { status: 409 });
      throw inserted.error;
    }
    let sync = "synced";
    try { await syncSale(inserted.data.id); } catch (error) { sync = "pending"; await recordSheetSyncFailure("sales", inserted.data.id, error); }
    return NextResponse.json({ ok: true, record: inserted.data, sync, message: `Sale ${inserted.data.reference} recorded as Pending approval.` }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record sale." }, { status: 400 });
  }
}
