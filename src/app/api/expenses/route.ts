import { NextResponse } from "next/server";
import { validateExpense } from "@/lib/domain";
import { currentEmployee, db, getSession, recordSheetSyncFailure, syncExpense } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "expense_reporter") return NextResponse.json({ error: "Only Kevin can submit an expense." }, { status: 403 });
    const employee = await currentEmployee();
    if (!employee) return NextResponse.json({ error: "Selected employee is not configured." }, { status: 503 });
    const input = await request.json();
    const { amountCents } = validateExpense(input);
    const overhead = input.allocation === "Company overhead";
    const manager = overhead ? await db().from("employees").select("id").eq("slug", "svetlana").single() : { data: null, error: null };
    if (manager.error) throw manager.error;
    const managerId = manager.data?.id ?? null;
    if (overhead && !managerId) throw new Error("Manager record is missing from setup.");
    const inserted = await db().from("expenses").insert({
      reference: String(input.reference).trim(), employee_id: employee.id, submitter_name: employee.display_name,
      telegram_chat_id: employee.telegram_chat_id, description: String(input.description).trim(), category: input.category,
      amount_cents: amountCents, proposed_allocation: input.allocation,
      final_allocation: overhead ? "Company overhead" : null,
      status: overhead ? "allocated" : "awaiting_allocation",
      approved_by: managerId, approved_at: overhead ? new Date().toISOString() : null,
      notification_status: employee.telegram_chat_id ? "pending" : "not_required",
      notification_error: employee.telegram_chat_id ? null : "No Telegram recipient linked",
    }).select("*").single();
    if (inserted.error) {
      if (inserted.error.code === "23505") return NextResponse.json({ error: `Reference ${input.reference} already exists.` }, { status: 409 });
      throw inserted.error;
    }
    let sync = "synced";
    try { await syncExpense(inserted.data.id); } catch (error) { sync = "pending"; await recordSheetSyncFailure("expenses", inserted.data.id, error); }
    return NextResponse.json({ ok: true, record: inserted.data, sync, message: `Expense ${inserted.data.reference} recorded as ${overhead ? "Allocated to Company overhead" : "Awaiting allocation"}.` }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record expense." }, { status: 400 });
  }
}
