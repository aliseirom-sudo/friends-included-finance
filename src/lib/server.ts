import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { Allocation, EmployeeRole } from "./domain";

export type Session = { slug: string; name: string; role: EmployeeRole };
export type Employee = { id: string; slug: string; display_name: string; role: EmployeeRole; telegram_user_id: string | null; telegram_chat_id: string | null };

const cookieName = "friends_included_demo";
const sessionSecret = () => process.env.DEMO_SESSION_SECRET || (process.env.NODE_ENV === "development" ? "local-only-friends-included-demo-secret-change-before-deploy" : "");

export function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured. Add the server-side project URL and service key.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const sign = (value: string) => createHmac("sha256", sessionSecret()).update(value).digest("base64url");

export async function getSession(): Promise<Session | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  const [slug, timestamp, signature] = value.split(".");
  if (!slug || !timestamp || !signature || Date.now() - Number(timestamp) > 1000 * 60 * 60 * 24 * 30) return null;
  const payload = `${slug}.${timestamp}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const employee = EMPLOYEE_ROLES[slug];
  return employee ? { slug, ...employee } : null;
}

const EMPLOYEE_ROLES: Record<string, { name: string; role: EmployeeRole }> = {
  svetlana: { name: "Svetlana de Monte Carlo", role: "manager" },
  richard: { name: "Richard “Call Me Dick” Darling", role: "salesperson" },
  anastasia: { name: "Anastasia Ferrari", role: "salesperson" },
  "jean-claude": { name: "Jean-Claude Bērziņš", role: "salesperson" },
  kevin: { name: "Kevin von Whatever", role: "expense_reporter" },
};

export async function setDemoSession(slug: string) {
  if (!EMPLOYEE_ROLES[slug]) throw new Error("Choose one of the five demonstration employees.");
  const secret = sessionSecret();
  if (!secret) throw new Error("DEMO_SESSION_SECRET must be set before the site can accept role changes.");
  const timestamp = String(Date.now());
  const payload = `${slug}.${timestamp}`;
  (await cookies()).set(cookieName, `${payload}.${sign(payload)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export async function currentEmployee() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await db().from("employees").select("id, slug, display_name, role, telegram_user_id, telegram_chat_id").eq("slug", session.slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Employee | null;
}

export async function requireRole(role: EmployeeRole) {
  const session = await getSession();
  if (!session || session.role !== role) throw new Error("You do not have permission to do that.");
  const employee = await currentEmployee();
  if (!employee) throw new Error("The selected employee is not set up in the database.");
  return { session, employee };
}

type SaleRow = { reference:string; submitted_at:string; submitter_name:string; customer:string; project:string; description:string; amount_cents:number; proposed_richard:number; proposed_anastasia:number; proposed_jean_claude:number; approved_richard:number|null; approved_anastasia:number|null; approved_jean_claude:number|null; commission_richard_cents:number; commission_anastasia_cents:number; commission_jean_claude_cents:number; status:string; sheet_row:number };
type ExpenseRow = { reference:string; submitted_at:string; submitter_name:string; description:string; category:string; amount_cents:number; proposed_allocation:Allocation; final_allocation:Allocation|null; status:string; sheet_row:number };

const timestamp = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Europe/Riga", hour12: false });

function sheetsClient() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!encoded || !spreadsheetId) throw new Error("Google Sheets sync is not configured.");
  const credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const auth = new google.auth.JWT({ email: credentials.client_email, key: credentials.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return { api: google.sheets({ version: "v4", auth }), spreadsheetId };
}

export async function syncSale(id: string) {
  const client = db();
  const { data, error } = await client.from("sales").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  const row = data as SaleRow;
  const values = [[
    row.reference, timestamp(row.submitted_at), row.submitter_name, row.customer, row.project, row.description, row.amount_cents / 100,
    row.proposed_richard, row.proposed_anastasia, row.proposed_jean_claude,
    row.approved_richard ?? "", row.approved_anastasia ?? "", row.approved_jean_claude ?? "",
    row.commission_richard_cents / 100, row.commission_anastasia_cents / 100, row.commission_jean_claude_cents / 100,
    row.status === "approved" ? "Approved" : "Pending approval",
  ]];
  const { api, spreadsheetId } = sheetsClient();
  await api.spreadsheets.values.update({ spreadsheetId, range: `'Sales'!A${row.sheet_row}:Q${row.sheet_row}`, valueInputOption: "RAW", requestBody: { values } });
  const update = await client.from("sales").update({ sheet_sync: "synced", sheet_sync_error: null }).eq("id", id);
  if (update.error) throw new Error(update.error.message);
}

export async function syncExpense(id: string) {
  const client = db();
  const { data, error } = await client.from("expenses").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  const row = data as ExpenseRow;
  const values = [[row.reference, timestamp(row.submitted_at), row.submitter_name, row.description, row.category, row.amount_cents / 100,
    row.proposed_allocation, row.final_allocation ?? "", row.status === "allocated" ? "Allocated" : "Awaiting allocation"]];
  const { api, spreadsheetId } = sheetsClient();
  await api.spreadsheets.values.update({ spreadsheetId, range: `'Expenses'!A${row.sheet_row}:I${row.sheet_row}`, valueInputOption: "RAW", requestBody: { values } });
  const update = await client.from("expenses").update({ sheet_sync: "synced", sheet_sync_error: null }).eq("id", id);
  if (update.error) throw new Error(update.error.message);
}

export async function recordSheetSyncFailure(table: "sales" | "expenses", id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown synchronization error";
  await db().from(table).update({ sheet_sync: "failed", sheet_sync_error: message.slice(0, 500) }).eq("id", id);
}

export async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram notifications are not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error("Telegram did not accept the notification.");
  const result = await response.json() as { ok?: boolean };
  if (!result.ok) throw new Error("Telegram did not accept the notification.");
}

export async function recordNotification(table: "sales" | "expenses", id: string, status: "sent" | "failed", error?: unknown) {
  const message = error instanceof Error ? error.message : "Notification delivery failed";
  await db().from(table).update({ notification_status: status, notification_error: status === "failed" ? message.slice(0, 500) : null }).eq("id", id);
}

export function allocation(value: unknown): Allocation {
  if (value === "A" || value === "B" || value === "Company overhead") return value;
  throw new Error("Choose project A, project B, or Company overhead.");
}
