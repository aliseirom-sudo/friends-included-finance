import { NextResponse } from "next/server";
import { EMPLOYEES } from "@/lib/domain";
import { getSession, setDemoSession } from "@/lib/server";

export async function GET() {
  return NextResponse.json({ session: await getSession() });
}

export async function POST(request: Request) {
  try {
    const { slug } = await request.json();
    if (!EMPLOYEES.some((person) => person.slug === slug)) return NextResponse.json({ error: "Choose one of the five demonstration employees." }, { status: 400 });
    await setDemoSession(slug);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to select a role." }, { status: 400 });
  }
}
