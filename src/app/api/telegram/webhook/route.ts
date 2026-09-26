import { NextResponse } from "next/server";
import { validateExpense, validateSale } from "@/lib/domain";
import { db, recordNotification, recordSheetSyncFailure, sendTelegram, syncExpense, syncSale } from "@/lib/server";

type TelegramUpdate = {
  message?: { text?: string; chat?: { id?: number }; from?: { id?: number } };
};

async function reply(chatId: string, text: string) {
  try { await sendTelegram(chatId, text); return true; } catch { return false; }
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const update = await request.json() as TelegramUpdate;
    const message = update.message;
    const text = message?.text?.trim();
    const userId = message?.from?.id;
    const chatId = message?.chat?.id;
    if (!text || !userId || !chatId) return NextResponse.json({ ok: true });
    const destination = String(chatId);
    if (text === "/id" || text.startsWith("/id@")) {
      await reply(destination, `Telegram user ID: ${userId}\nChat ID: ${chatId}\nGive both IDs to Svetlana to link your staff role.`);
      return NextResponse.json({ ok: true });
    }
    const { data: employee } = await db().from("employees").select("*").eq("telegram_user_id", String(userId)).maybeSingle();
    if (!employee) {
      await reply(destination, "This Telegram account is not linked to a staff role yet. Send /id and ask Svetlana to link your account.");
      return NextResponse.json({ ok: true });
    }
    if (text === "/start" || text === "/help" || text.startsWith("/start ")) {
      const help = employee.role === "salesperson"
        ? "Send a sale like this:\n/sale S01 | Customer | A | Description | 1000 | 50,30,20"
        : employee.role === "expense_reporter"
          ? "Send an expense like this:\n/expense E01 | Description | Materials | 120 | A\nAllocation may be A, B, or Company overhead."
          : "Submissions are handled by your staff. Use the website manager area to approve or correct decisions.";
      await reply(destination, `Hello ${employee.display_name}. ${help}`);
      return NextResponse.json({ ok: true });
    }
    if (text.startsWith("/sale")) {
      if (employee.role !== "salesperson") { await reply(destination, "Only a salesperson can submit sales."); return NextResponse.json({ ok: true }); }
      const fields = text.replace(/^\/sale(?:@\w+)?\s*/i, "").split("|").map((part) => part.trim());
      if (fields.length !== 6) { await reply(destination, "Format: /sale S01 | Customer | A or B | Description | Amount | Richard,Anastasia,Jean-Claude percentages"); return NextResponse.json({ ok: true }); }
      const [reference, customer, project, description, amount, split] = fields;
      const [richard, anastasia, jeanClaude] = split.split(",").map(Number);
      let amountCents: number;
      try { ({ amountCents } = validateSale({ reference, customer, project: project.toUpperCase(), description, amount, richard, anastasia, jeanClaude })); }
      catch (error) { await reply(destination, error instanceof Error ? error.message : "Check the sale details."); return NextResponse.json({ ok: true }); }
      const inserted = await db().from("sales").insert({ reference: reference.toUpperCase(), employee_id: employee.id, submitter_name: employee.display_name, telegram_chat_id: destination, customer, project: project.toUpperCase(), description, amount_cents: amountCents, proposed_richard: richard, proposed_anastasia: anastasia, proposed_jean_claude: jeanClaude, status: "pending_approval", notification_status: "pending" }).select("id, reference, amount_cents, project").single();
      if (inserted.error) { await reply(destination, inserted.error.code === "23505" ? `Reference ${reference} already exists.` : "Sale could not be saved. Check the details and try again."); return NextResponse.json({ ok: true }); }
      let sync = true;
      try { await syncSale(inserted.data.id); } catch (error) { sync = false; await recordSheetSyncFailure("sales", inserted.data.id, error); }
      const confirmed = await reply(destination, `Sale ${reference.toUpperCase()} recorded. €${(amountCents / 100).toFixed(2)}, project ${project.toUpperCase()}, status Pending approval.${sync ? "" : " Google Sheets sync pending; the record is saved."}`);
      await recordNotification("sales", inserted.data.id, confirmed ? "sent" : "failed", confirmed ? undefined : new Error("Submission confirmation was not delivered"));
      return NextResponse.json({ ok: true });
    }
    if (text.startsWith("/expense")) {
      if (employee.role !== "expense_reporter") { await reply(destination, "Only Kevin can submit expenses."); return NextResponse.json({ ok: true }); }
      const fields = text.replace(/^\/expense(?:@\w+)?\s*/i, "").split("|").map((part) => part.trim());
      if (fields.length !== 5) { await reply(destination, "Format: /expense E01 | Description | Materials, Travel, or Other | Amount | A, B, or Company overhead"); return NextResponse.json({ ok: true }); }
      const [reference, description, category, amount, proposedAllocation] = fields;
      const allocation = proposedAllocation.toLowerCase() === "overhead" ? "Company overhead" : proposedAllocation.toUpperCase();
      let amountCents: number;
      try { ({ amountCents } = validateExpense({ reference, description, category, amount, allocation })); }
      catch (error) { await reply(destination, error instanceof Error ? error.message : "Check the expense details."); return NextResponse.json({ ok: true }); }
      const overhead = allocation === "Company overhead";
      const manager = overhead ? await db().from("employees").select("id").eq("slug", "svetlana").single() : { data: null, error: null };
      if (manager.error) throw manager.error;
      const managerId = manager.data?.id ?? null;
      if (overhead && !managerId) throw new Error("Manager record is missing from setup.");
      const inserted = await db().from("expenses").insert({ reference: reference.toUpperCase(), employee_id: employee.id, submitter_name: employee.display_name, telegram_chat_id: destination, description, category, amount_cents: amountCents, proposed_allocation: allocation, final_allocation: overhead ? allocation : null, status: overhead ? "allocated" : "awaiting_allocation", approved_by: managerId, approved_at: overhead ? new Date().toISOString() : null, notification_status: "pending" }).select("id, reference").single();
      if (inserted.error) { await reply(destination, inserted.error.code === "23505" ? `Reference ${reference} already exists.` : "Expense could not be saved. Check the details and try again."); return NextResponse.json({ ok: true }); }
      let sync = true;
      try { await syncExpense(inserted.data.id); } catch (error) { sync = false; await recordSheetSyncFailure("expenses", inserted.data.id, error); }
      const status = overhead ? "Allocated to Company overhead" : "Awaiting allocation";
      const confirmed = await reply(destination, `Expense ${reference.toUpperCase()} recorded. €${(amountCents / 100).toFixed(2)}, proposed allocation ${allocation}, status ${status}.${sync ? "" : " Google Sheets sync pending; the record is saved."}`);
      await recordNotification("expenses", inserted.data.id, confirmed ? "sent" : "failed", confirmed ? undefined : new Error("Submission confirmation was not delivered"));
      return NextResponse.json({ ok: true });
    }
    await reply(destination, "Use /help for the submission formats.");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
