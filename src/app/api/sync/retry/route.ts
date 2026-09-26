import { NextResponse } from "next/server";
import { db, recordSheetSyncFailure, requireRole, syncExpense, syncSale } from "@/lib/server";

export async function POST() {
  try {
    await requireRole("manager");
    const client = db();
    const [{ data: sales, error: salesError }, { data: expenses, error: expensesError }] = await Promise.all([
      client.from("sales").select("id").neq("sheet_sync", "synced"),
      client.from("expenses").select("id").neq("sheet_sync", "synced"),
    ]);
    if (salesError) throw salesError;
    if (expensesError) throw expensesError;
    let succeeded = 0; let failed = 0;
    for (const item of sales ?? []) { try { await syncSale(item.id); succeeded++; } catch (error) { failed++; await recordSheetSyncFailure("sales", item.id, error); } }
    for (const item of expenses ?? []) { try { await syncExpense(item.id); succeeded++; } catch (error) { failed++; await recordSheetSyncFailure("expenses", item.id, error); } }
    return NextResponse.json({ ok: failed === 0, succeeded, failed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retry synchronization." }, { status: 403 });
  }
}
