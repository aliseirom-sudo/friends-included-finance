"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- API records are rendered as backend-owned row payloads. */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { EMPLOYEES, money } from "@/lib/domain";

type Row = Record<string, any>;
type AppSession = { slug: string; name: string; role: "manager" | "salesperson" | "expense_reporter" };
type Records = { sales: Row[]; expenses: Row[]; summary: any };
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1zrRbwyRXCRv7Rb5JGQERpKrJvFGm92S78DswHAtgaXQ/edit";
const BOT_URL = "https://t.me/friendsincludedfinancealicebot";
const GITHUB_URL = "https://github.com/aliseirom-sudo/friends-included-finance";
const dateTime = (value?: string) => value ? new Date(value).toLocaleString("en-GB", { dateStyle:"medium", timeStyle:"short" }) : "—";

export default function Dashboard() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [data, setData] = useState<Records>({ sales:[], expenses:[], summary:null });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [splits, setSplits] = useState<Record<string, number[]>>({});
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const request = useCallback(async (url: string, body?: unknown) => {
    const response = await fetch(url, { method:body === undefined ? "GET" : "POST", headers:body === undefined ? undefined : { "content-type":"application/json" }, body:body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
  }, []);
  const refresh = useCallback(async () => { if (session) setData(await request("/api/records") as Records); }, [request, session]);

  useEffect(() => {
    let active = true;
    fetch("/api/demo-role").then((r) => r.json()).then(async ({ session:saved }) => {
      if (!active || !saved) return;
      setSession(saved);
      const response = await fetch("/api/records");
      const result = await response.json();
      if (active && response.ok) setData(result);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const run = async (action: () => Promise<any>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { const result = await action(); setMessage(result?.notice ? String(result.notice) : result?.sync === "pending" ? "Saved in Supabase. Google Sheets sync is pending; Svetlana can retry it." : success); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong."); }
    finally { setBusy(false); }
  };
  const chooseRole = (slug: string) => run(async () => {
    await request("/api/demo-role", { slug });
    const person = EMPLOYEES.find((item) => item.slug === slug)!;
    setSession({ slug, name:person.name, role:person.role });
    setData(await request("/api/records") as Records);
  }, "Demonstration role selected.");

  const submitSale = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    return run(() => request("/api/sales", { reference:form.get("reference"), customer:form.get("customer"), project:form.get("project"), description:form.get("description"), amount:form.get("amount"), richard:form.get("richard"), anastasia:form.get("anastasia"), jeanClaude:form.get("jeanClaude") }), "Sale recorded as Pending approval.");
  };
  const submitExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    return run(() => request("/api/expenses", { reference:form.get("reference"), description:form.get("description"), category:form.get("category"), amount:form.get("amount"), allocation:form.get("allocation") }), "Expense recorded.");
  };

  const pendingSales = useMemo(() => data.sales.filter((row) => row.status === "pending_approval"), [data.sales]);
  const pendingExpenses = useMemo(() => data.expenses.filter((row) => row.status === "awaiting_allocation"), [data.expenses]);
  const failedNotifications: (Row & { kind:string })[] = [...data.sales.filter((row) => row.notification_status === "failed").map((row) => ({ ...row, kind:"sales" })), ...data.expenses.filter((row) => row.notification_status === "failed").map((row) => ({ ...row, kind:"expenses" }))];
  const unsynced = [...data.sales, ...data.expenses].some((row) => row.sheet_sync !== "synced");

  const approveSale = (sale: Row) => run(async () => {
    const values = splits[sale.reference] ?? [sale.proposed_richard, sale.proposed_anastasia, sale.proposed_jean_claude];
    const result = await request("/api/decisions/sale", { reference:sale.reference, shares:{ richard:values[0], anastasia:values[1], jeanClaude:values[2] } });
    if (result.sync === "pending") return result;
    if (result.notified === "failed") return { ...result, notice:`${sale.reference} approved. Telegram notification failed; use the retry control.` };
    if (result.notified === "No Telegram recipient linked") return { ...result, notice:`${sale.reference} approved. No Telegram recipient linked.` };
    return result;
  }, `${sale.reference} approved.`);
  const approveExpense = (row: Row) => run(async () => {
    const result = await request("/api/decisions/expense", { reference:row.reference, finalAllocation:allocations[row.reference] ?? row.proposed_allocation });
    if (result.notified === "failed") return { ...result, notice:`${row.reference} allocated. Telegram notification failed; use the retry control.` };
    if (result.notified === "No Telegram recipient linked") return { ...result, notice:`${row.reference} allocated. No Telegram recipient linked.` };
    return result;
  }, `${row.reference} allocation approved.`);
  const retrySheets = () => run(async () => {
    const result = await request("/api/sync/retry", {});
    if (result.failed) throw new Error(`${result.succeeded} synchronized; ${result.failed} still need attention.`);
    return result;
  }, "Google Sheets sync retry completed.");
  const retryNotification = (kind: string, reference: string) => run(() => request("/api/notifications/retry", { kind, reference }), `Telegram notification for ${reference} sent.`);
  const linkTelegram = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    return run(() => request("/api/telegram/link", { slug:form.get("employee"), userId:form.get("userId"), chatId:form.get("chatId") }), "Telegram account linked.");
  };
  const syncLabel = (row: Row) => row.sheet_sync === "synced" ? "Synced" : row.sheet_sync === "failed" ? "Sync failed" : "Sync pending";
  const telegramLabel = (row: Row) => row.notification_status === "failed" ? "Telegram failed" : row.notification_error === "No Telegram recipient linked" ? "No Telegram recipient linked" : row.notification_status === "sent" ? "Telegram sent" : "—";

  return <main className="app-shell">
    <header className="topbar"><a href="#top" className="brand"><span className="brand-mark">FI</span><span>Friends Included<small>Finance desk</small></span></a><nav className="top-links"><a href={BOT_URL} target="_blank" rel="noreferrer">Telegram bot ↗</a><a href={SHEET_URL} target="_blank" rel="noreferrer">Live Google Sheet ↗</a><a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub ↗</a></nav><div className="role-picker"><label htmlFor="role">Demonstration role</label><select id="role" value={session?.slug ?? ""} onChange={(event) => chooseRole(event.target.value)} disabled={busy}><option value="">Choose an employee</option>{EMPLOYEES.map((person) => <option key={person.slug} value={person.slug}>{person.name}</option>)}</select></div></header>

    <section className="hero" id="top"><div><p className="eyebrow">FRIENDS INCLUDED LTD · ALL FRIENDSHIPS EXPIRE AT CHECKOUT</p><h1>Finance, with the<br /><em>family drama</em> removed.</h1><p className="hero-copy">Sales, commissions and expenses in one tidy place. The manager decides; the numbers keep their receipts.</p><p className="hero-copy"><strong>Day 4 homework by Alice Romanowska.</strong></p></div><div className="hero-note"><span className="status-dot" /><span><strong>{session ? `Signed in as ${session.name}` : "Demonstration mode"}</strong><small>{session ? "Your role controls which actions are available." : "Choose one of the five fictional employees to begin."}</small></span></div></section>

    <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">INSTRUCTOR GUIDE</p><h2>How to use this demo</h2></div></div><p className="help-text">Choose a demonstration role above. Salespeople submit sales, Kevin submits expenses, and Svetlana reviews records, corrects decisions, and approves them. Use the Telegram bot for staff submissions after Svetlana links a Telegram account in Bot setup. The Google Sheet is a read-only review copy; GitHub contains the source code.</p></section>

    {message && <div role="status" className="notice success">{message}</div>}{error && <div role="alert" className="notice error">{error}</div>}
    {!session ? <section className="empty-state"><div className="empty-icon">✦</div><h2>Choose your seat at the table</h2><p>Salespeople submit sales, Kevin reports expenses, and Svetlana reviews decisions and the financial dashboard.</p><button className="button primary" onClick={() => document.getElementById("role")?.focus()}>Choose a role</button></section> : <>

      {session.role === "manager" && data.summary && <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">SVETLANA’S DESK</p><h2>Company at a glance</h2></div><button className="button quiet" onClick={() => refresh()} disabled={busy}>Refresh</button></div><div className="kpi-grid"><article className="kpi"><span>Approved income</span><strong>{money(data.summary.incomeCents)}</strong><small>Paid sales, after approval</small></article><article className="kpi"><span>Commission expense</span><strong>{money(data.summary.commissionCents)}</strong><small>10% pool across approved sales</small></article><article className="kpi accent"><span>Company result</span><strong>{money(data.summary.companyResultCents)}</strong><small>All recorded expenses included</small></article></div><div className="result-grid">{data.summary.projects.map((project: any) => <article className="result-card" key={project.project}><div className="result-top"><span className="project-badge">PROJECT {project.project}</span><strong>{money(project.resultCents)}</strong></div><h3>{project.project === "A" ? "Respectable Relatives" : "Drunk University Friends"}</h3><Metric label="Approved income" value={money(project.incomeCents)} /><Metric label="Commission expense" value={`−${money(project.commissionsCents)}`} /><Metric label="Allocated expenses" value={`−${money(project.expensesCents)}`} /></article>)}</div><div className="support-grid"><Support label="Company overhead" value={money(data.summary.overheadCents)} /><Support label="Awaiting allocation" value={money(data.summary.awaitingCents)} />{["Richard", "Anastasia", "Jean-Claude"].map((person, index) => <Support key={person} label={`${person} commission`} value={money(data.summary.commissionsByPersonCents[index])} />)}</div></section>}

      {session.role === "salesperson" && <section className="dashboard-section form-section"><div className="section-heading"><div><p className="eyebrow">NEW BUSINESS</p><h2>Record a sale</h2></div><p>Commission pool: 10% of the sale amount</p></div><form className="entry-form" onSubmit={submitSale}><label>Reference<input name="reference" required placeholder="S06" pattern="S[0-9]{2,}" /></label><label>Customer<input name="customer" required placeholder="Customer name" /></label><label>Project<select name="project"><option value="A">A · Respectable Relatives</option><option value="B">B · Drunk University Friends</option></select></label><label>Amount (€)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="1000.00" /></label><label className="wide">Description<input name="description" required placeholder="What was sold?" /></label><fieldset className="split-field"><legend>Proposed commission split (%)</legend><label>Richard<input name="richard" type="number" min="0" max="100" step="0.01" defaultValue="50" required /></label><label>Anastasia<input name="anastasia" type="number" min="0" max="100" step="0.01" defaultValue="30" required /></label><label>Jean-Claude<input name="jeanClaude" type="number" min="0" max="100" step="0.01" defaultValue="20" required /></label><small>The three shares must add up to exactly 100%.</small></fieldset><button className="button primary" disabled={busy}>Submit sale for approval</button></form></section>}

      {session.role === "expense_reporter" && <section className="dashboard-section form-section"><div className="section-heading"><div><p className="eyebrow">KEVIN’S EXPENSES</p><h2>Record an expense</h2></div><p>Every saved expense immediately reduces company result.</p></div><form className="entry-form" onSubmit={submitExpense}><label>Reference<input name="reference" required placeholder="E08" pattern="E[0-9]{2,}" /></label><label>Category<select name="category"><option>Materials</option><option>Travel</option><option>Other</option></select></label><label>Amount (€)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="120.00" /></label><label>Proposed allocation<select name="allocation"><option value="A">A · Respectable Relatives</option><option value="B">B · Drunk University Friends</option><option value="Company overhead">Company overhead (auto-allocated)</option></select></label><label className="wide">Description<input name="description" required placeholder="What was purchased or paid for?" /></label><button className="button primary" disabled={busy}>Submit expense</button></form></section>}

      {session.role === "manager" && <section className="dashboard-section approvals"><div className="section-heading"><div><p className="eyebrow">DECISIONS</p><h2>Waiting for your call</h2></div><div className="heading-actions"><span className="count-pill">{pendingSales.length + pendingExpenses.length} pending</span>{unsynced && <button className="button outline" onClick={retrySheets} disabled={busy}>Retry Sheets sync</button>}</div></div>{pendingSales.length + pendingExpenses.length === 0 ? <p className="quiet-empty">No decisions waiting right now.</p> : <div className="record-list">
        {pendingSales.map((sale) => <article className="record-card" key={sale.id}><div className="record-head"><span className="type-tag sale-tag">SALE · {sale.reference}</span><span className="status pending">Pending approval</span></div><h3>{sale.customer} <small>· Project {sale.project}</small></h3><p>{sale.description}</p><div className="record-summary"><strong>{money(sale.amount_cents)}</strong><span>Submitted by {sale.submitter_name}</span><span>{dateTime(sale.submitted_at)}</span></div><div className="decision-controls"><span>Final commission split</span>{["Richard", "Anastasia", "Jean-Claude"].map((person, index) => <label key={person}>{person}<input type="number" min="0" max="100" step="0.01" value={(splits[sale.reference] ?? [sale.proposed_richard,sale.proposed_anastasia,sale.proposed_jean_claude])[index]} onChange={(event) => { const value = [...(splits[sale.reference] ?? [sale.proposed_richard,sale.proposed_anastasia,sale.proposed_jean_claude])]; value[index] = Number(event.target.value); setSplits({ ...splits, [sale.reference]:value }); }} /></label>)}<button className="button primary" onClick={() => approveSale(sale)} disabled={busy}>Approve sale</button></div><RecordFoot row={sale} syncLabel={syncLabel} telegramLabel={telegramLabel} onRetry={() => retryNotification("sales",sale.reference)} /></article>)}
        {pendingExpenses.map((expense) => <article className="record-card" key={expense.id}><div className="record-head"><span className="type-tag expense-tag">EXPENSE · {expense.reference}</span><span className="status pending">Awaiting allocation</span></div><h3>{expense.description}</h3><p>{expense.category} · Submitted by {expense.submitter_name} · Proposed: {expense.proposed_allocation}</p><div className="record-summary"><strong>{money(expense.amount_cents)}</strong><span>{dateTime(expense.submitted_at)}</span></div><div className="decision-controls expense-decision"><label>Final allocation<select value={allocations[expense.reference] ?? expense.proposed_allocation} onChange={(event) => setAllocations({ ...allocations, [expense.reference]:event.target.value })}><option value="A">A · Respectable Relatives</option><option value="B">B · Drunk University Friends</option><option value="Company overhead">Company overhead</option></select></label><button className="button primary" onClick={() => approveExpense(expense)} disabled={busy}>Confirm allocation</button></div><RecordFoot row={expense} syncLabel={syncLabel} telegramLabel={telegramLabel} onRetry={() => retryNotification("expenses",expense.reference)} /></article>)}
      </div>}</section>}

      {session.role === "manager" && <section className="dashboard-section link-section"><div className="section-heading"><div><p className="eyebrow">BOT SETUP</p><h2>Link a staff Telegram account</h2></div><a href={BOT_URL} target="_blank" rel="noreferrer" className="button outline">Open bot ↗</a></div><p className="help-text">Ask the employee to start the bot and send <code>/id</code>. Link their numeric user ID and chat ID here. Earlier bot submissions keep their original notification destination.</p><form className="link-form" onSubmit={linkTelegram}><label>Employee<select name="employee">{EMPLOYEES.filter((person) => person.role !== "manager").map((person) => <option key={person.slug} value={person.slug}>{person.name}</option>)}</select></label><label>Telegram user ID<input name="userId" inputMode="numeric" required placeholder="123456789" /></label><label>Private chat ID<input name="chatId" inputMode="numeric" required placeholder="123456789" /></label><button className="button secondary" disabled={busy}>Link account</button></form><p className="setup-note">Bot submissions: <code>/sale S01 | Customer | A | Description | 1000 | 50,30,20</code> or <code>/expense E01 | Description | Materials | 120 | A</code>.</p></section>}

      {session.role === "manager" && failedNotifications.length > 0 && <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">DELIVERY ISSUES</p><h2>Telegram notifications to retry</h2></div></div><div className="retry-list">{failedNotifications.map((row) => <div className="retry-row" key={`${row.kind}-${row.reference}`}><span>{row.reference} · {row.notification_error || "Delivery failed"}</span><button className="button outline" onClick={() => retryNotification(row.kind,row.reference)} disabled={busy}>Retry notification</button></div>)}</div></section>}

      <section className="dashboard-section records"><div className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h2>{session.role === "manager" ? "All transactions" : "Your submissions"}</h2></div><span className="count-pill">{data.sales.length + data.expenses.length} records</span></div>{data.sales.length + data.expenses.length === 0 ? <p className="quiet-empty">No transactions yet. New entries will appear here after they are saved.</p> : <div className="table-scroll"><table><thead><tr><th>Ref</th><th>Type & details</th><th>Owner</th><th>Amount</th><th>Status</th><th>Sheet</th><th>Telegram</th><th>Submitted</th></tr></thead><tbody>{data.sales.map((sale) => <tr key={sale.id}><td className="ref">{sale.reference}</td><td><strong>Sale · Project {sale.project}</strong><small>{sale.customer} — {sale.description}</small>{sale.status === "approved" && <small>Split: Richard {sale.approved_richard}% / Anastasia {sale.approved_anastasia}% / Jean-Claude {sale.approved_jean_claude}%</small>}</td><td>{sale.submitter_name}</td><td>{money(sale.amount_cents)}</td><td><span className={`status ${sale.status === "approved" ? "approved" : "pending"}`}>{sale.status === "approved" ? "Approved" : "Pending approval"}</span></td><td><SyncBadge row={sale} label={syncLabel(sale)} /></td><td>{telegramLabel(sale)}</td><td>{dateTime(sale.submitted_at)}</td></tr>)}{data.expenses.map((expense) => <tr key={expense.id}><td className="ref">{expense.reference}</td><td><strong>Expense · {expense.category}</strong><small>{expense.description}</small><small>Proposed: {expense.proposed_allocation}{expense.final_allocation ? ` · Final: ${expense.final_allocation}` : ""}</small></td><td>{expense.submitter_name}</td><td>{money(expense.amount_cents)}</td><td><span className={`status ${expense.status === "allocated" ? "approved" : "pending"}`}>{expense.status === "allocated" ? "Allocated" : "Awaiting allocation"}</span></td><td><SyncBadge row={expense} label={syncLabel(expense)} /></td><td>{telegramLabel(expense)}</td><td>{dateTime(expense.submitted_at)}</td></tr>)}</tbody></table></div>}</section>
    </>}

    <footer className="footer"><div><strong>Friends Included</strong><span>Wedding guests, fictional finances, no actual cake incidents.</span></div><nav><a href={BOT_URL} target="_blank" rel="noreferrer">Telegram</a><a href={SHEET_URL} target="_blank" rel="noreferrer">Google Sheets</a><a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a></nav><p>Transactions save in Supabase. Google Sheets is a read-only copy.</p></footer>
  </main>;
}

function Metric({ label, value }: { label:string; value:string }) { return <div className="metric-line"><span>{label}</span><b>{value}</b></div>; }
function Support({ label, value }: { label:string; value:string }) { return <article className="support-card"><span>{label}</span><strong>{value}</strong></article>; }
function SyncBadge({ row, label }: { row:Row; label:string }) { return <span className={`sync-badge ${row.sheet_sync === "synced" ? "is-synced" : "is-pending"}`} title={row.sheet_sync_error || ""}>{label}</span>; }
function RecordFoot({ row, syncLabel, telegramLabel, onRetry }: { row:Row; syncLabel:(r:Row)=>string; telegramLabel:(r:Row)=>string; onRetry:()=>void }) { return <div className="record-foot"><SyncBadge row={row} label={syncLabel(row)} /><span>{telegramLabel(row)}</span>{row.sheet_sync_error && <span className="inline-error">{row.sheet_sync_error}</span>}{row.notification_status === "failed" && <button className="text-button" onClick={onRetry}>Retry Telegram</button>}</div>; }
