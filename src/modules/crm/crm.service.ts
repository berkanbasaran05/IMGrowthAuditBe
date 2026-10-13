import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { getAll, getOne, put } from "../growth/lib/redis.js";

const COL = {
  customers: "crm:customers",
  contracts: "crm:contracts",
  payments: "crm:payments",
  activities: "crm:activities",
  tasks: "crm:tasks",
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
const text = (value: unknown, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const money = (value: unknown) => Math.max(0, Number(value) || 0);
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
const allowed = (value: unknown, values: string[], fallback: string) => values.includes(String(value)) ? String(value) : fallback;

@Injectable()
export class CrmService {
  async dashboard() {
    const [customers, contracts, payments, activities, tasks] = await Promise.all([
      getAll(COL.customers), getAll(COL.contracts), getAll(COL.payments), getAll(COL.activities), getAll(COL.tasks),
    ]);
    customers.sort((a: any, b: any) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    contracts.sort((a: any, b: any) => String(b.signedAt || b.createdAt).localeCompare(String(a.signedAt || a.createdAt)));
    payments.sort((a: any, b: any) => String(b.paidAt || b.dueDate || b.createdAt).localeCompare(String(a.paidAt || a.dueDate || a.createdAt)));
    activities.sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
    tasks.sort((a: any, b: any) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));

    const liveContracts = contracts.filter((x: any) => ["signed", "active", "completed"].includes(x.status));
    const contracted = liveContracts.reduce((sum: number, x: any) => sum + money(x.value), 0);
    const collected = payments.filter((x: any) => x.status === "paid").reduce((sum: number, x: any) => sum + money(x.amount), 0);
    const monthly = contracts.filter((x: any) => x.status === "active").reduce((sum: number, x: any) => sum + money(x.monthlyValue), 0);
    const overdue = payments.filter((x: any) => x.status !== "paid" && x.dueDate && x.dueDate < new Date().toISOString().slice(0, 10));
    return {
      customers, contracts, payments, activities, tasks,
      summary: {
        customers: customers.length,
        activeCustomers: customers.filter((x: any) => x.status === "active").length,
        contracted,
        collected,
        outstanding: Math.max(0, contracted - collected),
        monthly,
        openTasks: tasks.filter((x: any) => x.status !== "done").length,
        overduePayments: overdue.length,
      },
    };
  }

  async createCustomer(input: any) {
    const name = text(input?.name, 120);
    if (!name) throw new Error("Müşteri adı gerekli");
    const record = {
      name,
      contactName: text(input.contactName, 100), email: text(input.email, 120).toLowerCase(), phone: text(input.phone, 40),
      status: allowed(input.status, ["onboarding", "active", "paused", "completed", "lost"], "onboarding"),
      owner: text(input.owner, 80), sector: text(input.sector, 100), leadId: text(input.leadId, 120), notes: text(input.notes, 2000),
      createdAt: now(), updatedAt: now(),
    };
    const customerId = id("cus");
    await put(COL.customers, customerId, record);
    await this.createActivity({ customerId, type: "customer_created", summary: "Müşteri kaydı oluşturuldu" });
    return { id: customerId, ...record };
  }

  async updateCustomer(customerId: string, patch: any) {
    const current = await getOne(COL.customers, customerId);
    if (!current) throw new Error("Müşteri bulunamadı");
    const next: any = { ...current, updatedAt: now() };
    for (const key of ["name", "contactName", "email", "phone", "owner", "sector", "notes"]) {
      if (key in (patch || {})) next[key] = text(patch[key], key === "notes" ? 2000 : 120);
    }
    if (patch?.status) next.status = allowed(patch.status, ["onboarding", "active", "paused", "completed", "lost"], current.status);
    await put(COL.customers, customerId, next);
    return { id: customerId, ...next };
  }

  async convertLead(leadId: string) {
    const existing = (await getAll(COL.customers)).find((x: any) => x.leadId === leadId);
    if (existing) return existing;
    const lead = await getOne("leads", leadId);
    if (!lead) throw new Error("Firma bulunamadı");
    const customer = await this.createCustomer({
      name: lead.name, contactName: lead.contactName, email: lead.email, phone: lead.phone,
      sector: lead.sector, leadId, notes: lead.notes, status: "onboarding",
    });
    await put("leads", leadId, { ...lead, status: "musteri", customerId: customer.id, statusAt: now() });
    return customer;
  }

  async createContract(input: any) {
    await this.requireCustomer(input?.customerId);
    const title = text(input.title, 160);
    if (!title) throw new Error("Sözleşme adı gerekli");
    const record = {
      customerId: input.customerId, title, services: Array.isArray(input.services) ? input.services.map((x: any) => text(x, 80)).filter(Boolean).slice(0, 12) : [],
      value: money(input.value), monthlyValue: money(input.monthlyValue), currency: allowed(input.currency, ["TRY", "USD", "EUR", "GBP"], "TRY"),
      billing: allowed(input.billing, ["one_time", "monthly", "quarterly", "annual"], "one_time"),
      status: allowed(input.status, ["draft", "sent", "signed", "active", "completed", "cancelled"], "draft"),
      startDate: date(input.startDate), endDate: date(input.endDate), signedAt: date(input.signedAt), documentUrl: text(input.documentUrl, 500), notes: text(input.notes, 1500), createdAt: now(),
    };
    const contractId = id("con");
    await put(COL.contracts, contractId, record);
    await this.createActivity({ customerId: input.customerId, type: "contract", summary: `${title} sözleşmesi eklendi` });
    return { id: contractId, ...record };
  }

  async createPayment(input: any) {
    await this.requireCustomer(input?.customerId);
    const amount = money(input.amount);
    if (!amount) throw new Error("Ödeme tutarı gerekli");
    const record = {
      customerId: input.customerId, contractId: text(input.contractId, 120), amount,
      currency: allowed(input.currency, ["TRY", "USD", "EUR", "GBP"], "TRY"),
      status: allowed(input.status, ["planned", "invoiced", "paid", "cancelled"], "planned"),
      dueDate: date(input.dueDate), paidAt: date(input.paidAt), invoiceNo: text(input.invoiceNo, 80), notes: text(input.notes, 1000), createdAt: now(),
    };
    const paymentId = id("pay");
    await put(COL.payments, paymentId, record);
    await this.createActivity({ customerId: input.customerId, type: "payment", summary: `${amount.toLocaleString("tr-TR")} ${record.currency} ödeme kaydı eklendi` });
    return { id: paymentId, ...record };
  }

  async createTask(input: any) {
    await this.requireCustomer(input?.customerId);
    const title = text(input.title, 180);
    if (!title) throw new Error("Görev adı gerekli");
    const record = { customerId: input.customerId, title, dueDate: date(input.dueDate), assignee: text(input.assignee, 80), status: allowed(input.status, ["todo", "doing", "done"], "todo"), notes: text(input.notes, 1000), createdAt: now() };
    const taskId = id("tsk");
    await put(COL.tasks, taskId, record);
    return { id: taskId, ...record };
  }

  async createActivity(input: any) {
    await this.requireCustomer(input?.customerId);
    const summary = text(input.summary, 1000);
    if (!summary) throw new Error("Aktivite açıklaması gerekli");
    const record = { customerId: input.customerId, type: text(input.type, 50) || "note", summary, at: now(), createdBy: text(input.createdBy, 80) };
    const activityId = id("act");
    await put(COL.activities, activityId, record);
    return { id: activityId, ...record };
  }

  async updateRecord(kind: "contracts" | "payments" | "tasks", recordId: string, patch: any) {
    const current = await getOne(COL[kind], recordId);
    if (!current) throw new Error("Kayıt bulunamadı");
    const statusValues = kind === "contracts" ? ["draft", "sent", "signed", "active", "completed", "cancelled"] : kind === "payments" ? ["planned", "invoiced", "paid", "cancelled"] : ["todo", "doing", "done"];
    const next = { ...current, status: allowed(patch?.status, statusValues, current.status), updatedAt: now() };
    if (kind === "payments" && next.status === "paid" && !next.paidAt) next.paidAt = new Date().toISOString().slice(0, 10);
    await put(COL[kind], recordId, next);
    return { id: recordId, ...next };
  }

  private async requireCustomer(customerId: string) {
    if (!customerId || !(await getOne(COL.customers, customerId))) throw new Error("Müşteri bulunamadı");
  }
}
