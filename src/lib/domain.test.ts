import test from "node:test";
import assert from "node:assert/strict";
import { calculateCommissions, calculateSummary, normalizeExpenseAllocation, validateSale, validateExpense } from "./domain";

test("commission pool is 10% and rounding difference follows share priority", () => {
  assert.deepEqual(calculateCommissions(100000, [50, 30, 20]), { poolCents: 10000, earnedCents: [5000, 3000, 2000] });
  assert.deepEqual(calculateCommissions(101, [34, 33, 33]), { poolCents: 10, earnedCents: [4, 3, 3] });
  assert.deepEqual(calculateCommissions(105, [25, 50, 25]), { poolCents: 11, earnedCents: [3, 5, 3] });
});

test("invalid entries are rejected before persistence", () => {
  assert.throws(() => validateSale({ reference:"S01", customer:"x", project:"A", description:"x", amount:1, richard:60, anastasia:30, jeanClaude:20 }), /total exactly 100/);
  assert.throws(() => validateSale({ reference:"S01", customer:"x", project:"A", description:"x", amount:0, richard:50, anastasia:30, jeanClaude:20 }), /at least €0.01/);
  assert.throws(() => validateSale({ reference:"S01", customer:"x", project:"A", description:"x", amount:0.004, richard:50, anastasia:30, jeanClaude:20 }), /at least €0.01/);
  assert.throws(() => validateExpense({ reference:"E01", description:"x", category:"Travel", amount:-1, allocation:"A" }), /at least €0.01/);
});

test("Telegram expense allocation accepts the documented overhead wording", () => {
  assert.equal(normalizeExpenseAllocation("overhead"), "Company overhead");
  assert.equal(normalizeExpenseAllocation("Company overhead"), "Company overhead");
  assert.equal(normalizeExpenseAllocation("COMPANY OVERHEAD"), "Company overhead");
});

test("pending sales and awaiting expenses follow project and company rules", () => {
  const sales = [
    { project:"A" as const, status:"approved", amount_cents:100000, commission_richard_cents:5000, commission_anastasia_cents:3000, commission_jean_claude_cents:2000 },
    { project:"B" as const, status:"approved", amount_cents:200000, commission_richard_cents:4000, commission_anastasia_cents:8000, commission_jean_claude_cents:8000 },
    { project:"B" as const, status:"pending_approval", amount_cents:60000, commission_richard_cents:0, commission_anastasia_cents:0, commission_jean_claude_cents:0 },
  ];
  const expenses = [
    { status:"allocated", final_allocation:"A" as const, amount_cents:20000 },
    { status:"allocated", final_allocation:"Company overhead" as const, amount_cents:10000 },
    { status:"awaiting_allocation", final_allocation:null, amount_cents:14000 },
  ];
  const summary = calculateSummary(sales, expenses);
  assert.deepEqual(summary.projects.map(({incomeCents,commissionsCents,expensesCents,resultCents}) => [incomeCents,commissionsCents,expensesCents,resultCents]), [[100000,10000,20000,70000],[200000,20000,0,180000]]);
  assert.equal(summary.companyResultCents, 226000);
  assert.equal(summary.overheadCents, 10000);
  assert.equal(summary.awaitingCents, 14000);
});
