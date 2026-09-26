export type EmployeeRole = "manager" | "salesperson" | "expense_reporter";
export type Allocation = "A" | "B" | "Company overhead";
export type Share = { richard: number; anastasia: number; jeanClaude: number };

export const EMPLOYEES: { slug: string; name: string; role: EmployeeRole }[] = [
  { slug: "svetlana", name: "Svetlana de Monte Carlo", role: "manager" },
  { slug: "richard", name: "Richard “Call Me Dick” Darling", role: "salesperson" },
  { slug: "anastasia", name: "Anastasia Ferrari", role: "salesperson" },
  { slug: "jean-claude", name: "Jean-Claude Bērziņš", role: "salesperson" },
  { slug: "kevin", name: "Kevin von Whatever", role: "expense_reporter" },
];

export const money = (cents: number) => new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2,
}).format((Number(cents) || 0) / 100);

export function validateSale(input: Record<string, unknown>) {
  const required = ["reference", "customer", "project", "description"];
  for (const key of required) if (!String(input[key] ?? "").trim()) throw new Error(`${key} is required.`);
  if (!/^S\d{2,}$/.test(String(input.reference).trim())) throw new Error("Use a reference such as S01.");
  if (!["A", "B"].includes(String(input.project))) throw new Error("Project must be A or B.");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  const shares = [Number(input.richard), Number(input.anastasia), Number(input.jeanClaude)];
  if (shares.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) throw new Error("Each commission share must be between 0% and 100%.");
  if (shares.reduce((a, b) => a + b, 0) !== 100) throw new Error("Commission shares must total exactly 100%.");
  return { amountCents: Math.round(amount * 100), shares };
}

export function validateExpense(input: Record<string, unknown>) {
  for (const key of ["reference", "description", "category", "allocation"]) if (!String(input[key] ?? "").trim()) throw new Error(`${key} is required.`);
  if (!/^E\d{2,}$/.test(String(input.reference).trim())) throw new Error("Use a reference such as E01.");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  if (!["Materials", "Travel", "Other"].includes(String(input.category))) throw new Error("Choose Materials, Travel, or Other.");
  if (!["A", "B", "Company overhead"].includes(String(input.allocation))) throw new Error("Choose project A, project B, or Company overhead.");
  return { amountCents: Math.round(amount * 100) };
}

export function calculateCommissions(amountCents: number, shares: number[]) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Sale amount must be positive cents.");
  if (shares.length !== 3 || shares.some((n) => !Number.isFinite(n) || n < 0 || n > 100) || shares.reduce((a, b) => a + b, 0) !== 100) {
    throw new Error("Commission shares must be 0–100% and total 100%.");
  }
  const poolCents = Math.round(amountCents / 10);
  const earnedCents = shares.map((share) => Math.round(poolCents * share / 100));
  const priorityIndex = shares.findIndex((share) => share === Math.max(...shares));
  earnedCents[priorityIndex] += poolCents - earnedCents.reduce((a, b) => a + b, 0);
  return { poolCents, earnedCents };
}

export type SaleRecord = {
  project: "A" | "B";
  status: string;
  amount_cents: number;
  commission_richard_cents: number;
  commission_anastasia_cents: number;
  commission_jean_claude_cents: number;
};
export type ExpenseRecord = { status: string; final_allocation: Allocation | null; amount_cents: number };

export function calculateSummary(sales: SaleRecord[], expenses: ExpenseRecord[]) {
  const projects = (["A", "B"] as const).map((project) => {
    const approved = sales.filter((sale) => sale.status === "approved" && sale.project === project);
    const allocated = expenses.filter((expense) => expense.status === "allocated" && expense.final_allocation === project);
    const incomeCents = approved.reduce((sum, sale) => sum + sale.amount_cents, 0);
    const commissionsCents = approved.reduce((sum, sale) => sum + sale.commission_richard_cents + sale.commission_anastasia_cents + sale.commission_jean_claude_cents, 0);
    const expensesCents = allocated.reduce((sum, expense) => sum + expense.amount_cents, 0);
    return { project, incomeCents, commissionsCents, expensesCents, resultCents: incomeCents - commissionsCents - expensesCents };
  });
  const approvedSales = sales.filter((sale) => sale.status === "approved");
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount_cents, 0);
  const overheadCents = expenses.filter((expense) => expense.status === "allocated" && expense.final_allocation === "Company overhead").reduce((sum, expense) => sum + expense.amount_cents, 0);
  const awaitingCents = expenses.filter((expense) => expense.status === "awaiting_allocation").reduce((sum, expense) => sum + expense.amount_cents, 0);
  const commissionsByPersonCents = ["richard", "anastasia", "jean_claude"].map((key) => approvedSales.reduce((sum, sale) => sum + Number(sale[`commission_${key}_cents` as keyof SaleRecord]), 0));
  const incomeCents = approvedSales.reduce((sum, sale) => sum + sale.amount_cents, 0);
  const commissionCents = commissionsByPersonCents.reduce((sum, cents) => sum + cents, 0);
  return { projects, incomeCents, commissionCents, commissionsByPersonCents, overheadCents, awaitingCents, companyResultCents: incomeCents - commissionCents - totalExpenses };
}
