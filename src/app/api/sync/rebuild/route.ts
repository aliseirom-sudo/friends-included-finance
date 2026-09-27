import { NextResponse } from "next/server";
import { rebuildGoogleSheet, requireRole } from "@/lib/server";

/** Manager-only repair: the spreadsheet remains a review copy of Supabase. */
export async function POST() {
  try {
    await requireRole("manager");
    const result = await rebuildGoogleSheet();
    return NextResponse.json({ ok: true, ...result, notice: `Google Sheet rebuilt: ${result.sales} sales and ${result.expenses} expenses written from Supabase.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to rebuild the Google Sheet." }, { status: 403 });
  }
}
