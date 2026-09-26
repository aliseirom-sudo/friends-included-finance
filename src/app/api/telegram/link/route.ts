import { NextResponse } from "next/server";
import { db, requireRole } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await requireRole("manager");
    const { slug, userId, chatId } = await request.json();
    if (!/^\d+$/.test(String(userId)) || !/^\d+$/.test(String(chatId))) return NextResponse.json({ error: "Enter the numeric Telegram user ID and chat ID from /id." }, { status: 400 });
    const { data, error } = await db().from("employees").update({ telegram_user_id: String(userId), telegram_chat_id: String(chatId) }).eq("slug", slug).select("id, display_name").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, message: `Telegram linked to ${data.display_name}.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to link Telegram." }, { status: 403 });
  }
}
