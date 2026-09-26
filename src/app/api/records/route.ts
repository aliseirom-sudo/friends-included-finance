import { NextResponse } from "next/server";
import { calculateSummary } from "@/lib/domain";
import { currentEmployee, db, getSession } from "@/lib/server";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Select a demonstration role first." }, { status: 401 });
    const employee = await currentEmployee();
    if (!employee) return NextResponse.json({ error: "Employee setup is incomplete." }, { status: 503 });
    const client = db();
    let salesQuery = client.from("sales").select("*").order("submitted_at", { ascending: false });
    let expensesQuery = client.from("expenses").select("*").order("submitted_at", { ascending: false });
    if (session.role !== "manager") {
      salesQuery = salesQuery.eq("employee_id", employee.id);
      expensesQuery = expensesQuery.eq("employee_id", employee.id);
    }
    const [salesResult, expensesResult] = await Promise.all([salesQuery, expensesQuery]);
    if (salesResult.error) throw salesResult.error;
    if (expensesResult.error) throw expensesResult.error;
    const sales = salesResult.data ?? [];
    const expenses = expensesResult.data ?? [];
    return NextResponse.json({ sales, expenses, summary: session.role === "manager" ? calculateSummary(sales, expenses) : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load records." }, { status: 503 });
  }
}
