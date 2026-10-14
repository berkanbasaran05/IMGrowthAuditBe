import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../infrastructure/database/database.service.js";
import { getOne, put } from "../growth/lib/redis.js";

const text = (value: unknown, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const money = (value: unknown) => Math.max(0, Number(value) || 0);
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
const allowed = (value: unknown, values: string[], fallback: string) => values.includes(String(value)) ? String(value) : fallback;

const CUSTOMER_FIELDS = `id::text, lead_id AS "leadId", name, contact_name AS "contactName", email, phone, sector, owner_name AS owner,
  status, notes, website, address, tax_office AS "taxOffice", tax_no AS "taxNo", social, contacts, accounts,
  service_start::text AS "serviceStart", ad_start::text AS "adStart", ad_budget::float8 AS "adBudget", billing_day AS "billingDay",
  next_payment_date::text AS "nextPaymentDate", services, package_name AS "packageName", site_fee::float8 AS "siteFee",
  ad_service_fee::float8 AS "adServiceFee", daily_ad_budget::float8 AS "dailyAdBudget", logo, first_month_note AS "firstMonthNote", created_at AS "createdAt", updated_at AS "updatedAt"`;
const CONTRACT_FIELDS = `id::text, customer_id::text AS "customerId", title, services, value::float8, monthly_value::float8 AS "monthlyValue",
  currency, billing, status, start_date::text AS "startDate", end_date::text AS "endDate", signed_at::text AS "signedAt", document_url AS "documentUrl", notes,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const PAYMENT_FIELDS = `id::text, customer_id::text AS "customerId", contract_id::text AS "contractId", amount::float8, currency, status,
  due_date::text AS "dueDate", paid_at::text AS "paidAt", invoice_no AS "invoiceNo", notes, created_at AS "createdAt", updated_at AS "updatedAt"`;
const TASK_FIELDS = `id::text, customer_id::text AS "customerId", title, assignee, due_date::text AS "dueDate", status, notes,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const ACTIVITY_FIELDS = `id::text, customer_id::text AS "customerId", type, summary, occurred_at AS at, created_by AS "createdBy"`;

const SOCIAL = ["instagram", "facebook", "tiktok", "youtube", "x", "linkedin", "google", "whatsapp"];
const social = (value: any) => Object.fromEntries(SOCIAL.map((key) => [key, text(value?.[key], 200)]).filter(([, v]) => v));
const list = (value: any, keys: string[], max = 20) => (Array.isArray(value) ? value : []).slice(0, max)
  .map((row: any) => Object.fromEntries(keys.map((key) => [key, text(row?.[key], key === "note" ? 500 : 200)])))
  .filter((row: any) => Object.values(row).some(Boolean));
const logo = (value: unknown) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value || "")) && String(value).length <= 200000 ? String(value) : null;
const svc = (value: any) => (Array.isArray(value) ? value : []).map((x: any) => text(x, 80)).filter(Boolean).slice(0, 20);
const optMoney = (value: unknown) => value === "" || value == null ? null : money(value);
const day = (value: unknown) => { const n = Math.floor(Number(value)); return n >= 1 && n <= 31 ? n : null; };

@Injectable()
export class CrmService {
  constructor(private readonly database: DatabaseService) {}

  async dashboard() {
    const [customers, contracts, payments, activities, tasks] = await Promise.all([
      this.database.query(`SELECT ${CUSTOMER_FIELDS} FROM customers ORDER BY updated_at DESC`),
      this.database.query(`SELECT ${CONTRACT_FIELDS} FROM contracts ORDER BY COALESCE(signed_at, created_at::date) DESC`),
      this.database.query(`SELECT ${PAYMENT_FIELDS} FROM payments ORDER BY COALESCE(paid_at, due_date, created_at::date) DESC`),
      this.database.query(`SELECT ${ACTIVITY_FIELDS} FROM activities ORDER BY occurred_at DESC`),
      this.database.query(`SELECT ${TASK_FIELDS} FROM tasks ORDER BY due_date ASC NULLS LAST, created_at DESC`),
    ]);
    const sum = (rows: any[], pick: (row: any) => unknown) => rows.reduce((total: number, row: any) => total + money(pick(row)), 0);
    const activeIds = new Set(customers.rows.filter((row: any) => row.status === "active").map((row: any) => row.id));
    const activeCustomers = customers.rows.filter((row: any) => activeIds.has(row.id));
    const monthly = activeCustomers.reduce((total: number, row: any) => {
      const own = money(row.adServiceFee);
      return total + (own || sum(contracts.rows.filter((c: any) => c.customerId === row.id && c.status === "active"), (c) => c.monthlyValue));
    }, 0);
    const siteTotal = sum(customers.rows, (row) => row.siteFee);
    const open = payments.rows.filter((row: any) => row.status === "planned" || row.status === "invoiced");
    const collected = sum(payments.rows.filter((row: any) => row.status === "paid"), (row) => row.amount);
    const pending = sum(open, (row) => row.amount);
    const today = new Date().toISOString().slice(0, 10);
    return {
      customers: customers.rows, contracts: contracts.rows, payments: payments.rows, activities: activities.rows, tasks: tasks.rows,
      summary: {
        customers: customers.rowCount,
        activeCustomers: activeCustomers.length,
        monthly, siteTotal, collected, pending, yearly: monthly * 12,
        openTasks: tasks.rows.filter((row: any) => row.status !== "done").length,
        overduePayments: open.filter((row: any) => row.dueDate && String(row.dueDate).slice(0, 10) < today).length,
      },
    };
  }

  async createCustomer(input: any) {
    const name = text(input?.name, 120);
    if (!name) throw new Error("Müşteri adı gerekli");
    const result = await this.database.query(`INSERT INTO customers
      (name, contact_name, email, phone, status, owner_name, sector, lead_id, notes,
       website, address, tax_office, tax_no, social, contacts, accounts, service_start, ad_start, ad_budget, billing_day, next_payment_date,
       services, package_name, site_fee, ad_service_fee, daily_ad_budget, logo, first_month_note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25,$26,$27,$28) RETURNING ${CUSTOMER_FIELDS}`,
      [name, text(input.contactName, 100) || null, text(input.email, 120).toLowerCase() || null, text(input.phone, 40) || null,
       allowed(input.status, ["onboarding", "active", "paused", "completed", "lost"], "onboarding"), text(input.owner, 80) || null,
       text(input.sector, 100) || null, text(input.leadId, 120) || null, text(input.notes, 2000) || null,
       text(input.website, 200) || null, text(input.address, 500) || null, text(input.taxOffice, 100) || null, text(input.taxNo, 40) || null,
       JSON.stringify(social(input.social)), JSON.stringify(list(input.contacts, ["label", "name", "email", "phone"])),
       JSON.stringify(list(input.accounts, ["platform", "username", "password", "note"])),
       date(input.serviceStart), date(input.adStart), input.adBudget ? money(input.adBudget) : null, day(input.billingDay), date(input.nextPaymentDate),
       JSON.stringify(svc(input.services)), text(input.packageName, 120) || null, optMoney(input.siteFee), optMoney(input.adServiceFee), optMoney(input.dailyAdBudget), logo(input.logo), text(input.firstMonthNote, 1000) || null]);
    await this.createActivity({ customerId: result.rows[0].id, type: "customer_created", summary: "Müşteri kaydı oluşturuldu" });
    return result.rows[0];
  }

  async updateCustomer(customerId: string, patch: any) {
    const c = await this.customer(customerId);
    const has = (key: string) => key in patch;
    const str = (key: string, max: number, cur: any, lower = false) => has(key) ? (lower ? text(patch[key], max).toLowerCase() : text(patch[key], max)) || null : cur;
    const result = await this.database.query(`UPDATE customers SET name=$2, contact_name=$3, email=$4, phone=$5, owner_name=$6,
      sector=$7, notes=$8, status=$9, website=$10, address=$11, tax_office=$12, tax_no=$13, social=$14::jsonb, contacts=$15::jsonb,
      accounts=$16::jsonb, service_start=$17, ad_start=$18, ad_budget=$19, billing_day=$20, next_payment_date=$21,
      services=$22::jsonb, package_name=$23, site_fee=$24, ad_service_fee=$25, daily_ad_budget=$26, logo=$27, first_month_note=$28, updated_at=now()
      WHERE id=$1 RETURNING ${CUSTOMER_FIELDS}`,
      [customerId, has("name") ? text(patch.name, 120) || c.name : c.name, str("contactName", 100, c.contactName), str("email", 120, c.email, true),
       str("phone", 40, c.phone), str("owner", 80, c.owner), str("sector", 100, c.sector), has("notes") ? text(patch.notes, 2000) || null : c.notes,
       patch.status ? allowed(patch.status, ["onboarding", "active", "paused", "completed", "lost"], c.status) : c.status,
       str("website", 200, c.website), str("address", 500, c.address), str("taxOffice", 100, c.taxOffice), str("taxNo", 40, c.taxNo),
       JSON.stringify(has("social") ? social(patch.social) : c.social), JSON.stringify(has("contacts") ? list(patch.contacts, ["label", "name", "email", "phone"]) : c.contacts),
       JSON.stringify(has("accounts") ? list(patch.accounts, ["platform", "username", "password", "note"]) : c.accounts),
       has("serviceStart") ? date(patch.serviceStart) : c.serviceStart, has("adStart") ? date(patch.adStart) : c.adStart,
       has("adBudget") ? (patch.adBudget ? money(patch.adBudget) : null) : c.adBudget, has("billingDay") ? day(patch.billingDay) : c.billingDay,
       has("nextPaymentDate") ? date(patch.nextPaymentDate) : c.nextPaymentDate,
       JSON.stringify(has("services") ? svc(patch.services) : c.services), str("packageName", 120, c.packageName),
       has("siteFee") ? optMoney(patch.siteFee) : c.siteFee, has("adServiceFee") ? optMoney(patch.adServiceFee) : c.adServiceFee,
       has("dailyAdBudget") ? optMoney(patch.dailyAdBudget) : c.dailyAdBudget, has("logo") ? logo(patch.logo) : c.logo, str("firstMonthNote", 1000, c.firstMonthNote)]);
    return result.rows[0];
  }

  async convertLead(leadId: string) {
    const existing = await this.database.query(`SELECT ${CUSTOMER_FIELDS} FROM customers WHERE lead_id=$1`, [leadId]);
    if (existing.rowCount) return existing.rows[0];
    const lead = await getOne("leads", leadId);
    if (!lead) throw new Error("Firma bulunamadı");
    const customer = await this.createCustomer({ name: lead.name, contactName: lead.contactName, email: lead.email, phone: lead.phone, sector: lead.sector, leadId, notes: lead.notes });
    await put("leads", leadId, { ...lead, status: "musteri", customerId: customer.id, statusAt: new Date().toISOString() });
    return customer;
  }

  async createContract(input: any) {
    await this.customer(input?.customerId);
    const title = text(input.title, 160); if (!title) throw new Error("Sözleşme adı gerekli");
    const result = await this.database.query(`INSERT INTO contracts
      (customer_id,title,services,value,monthly_value,currency,billing,status,start_date,end_date,signed_at,document_url,notes)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${CONTRACT_FIELDS}`,
      [input.customerId, title, JSON.stringify(Array.isArray(input.services) ? input.services.map((x: any) => text(x, 80)).filter(Boolean).slice(0, 12) : []),
       money(input.value), money(input.monthlyValue), allowed(input.currency, ["TRY","USD","EUR","GBP"], "TRY"),
       allowed(input.billing, ["one_time","monthly","quarterly","annual"], "one_time"),
       allowed(input.status, ["draft","sent","signed","active","completed","cancelled"], "draft"), date(input.startDate), date(input.endDate),
       date(input.signedAt), text(input.documentUrl, 500) || null, text(input.notes, 1500) || null]);
    await this.createActivity({ customerId: input.customerId, type: "contract", summary: `${title} sözleşmesi eklendi` });
    return result.rows[0];
  }

  async createPayment(input: any) {
    await this.customer(input?.customerId); const amount = money(input.amount); if (!amount) throw new Error("Ödeme tutarı gerekli");
    const result = await this.database.query(`INSERT INTO payments
      (customer_id,contract_id,amount,currency,status,due_date,paid_at,invoice_no,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${PAYMENT_FIELDS}`,
      [input.customerId, text(input.contractId, 120) || null, amount, allowed(input.currency, ["TRY","USD","EUR","GBP"], "TRY"),
       allowed(input.status, ["planned","invoiced","paid","cancelled"], "planned"), date(input.dueDate), date(input.paidAt),
       text(input.invoiceNo, 80) || null, text(input.notes, 1000) || null]);
    await this.createActivity({ customerId: input.customerId, type: "payment", summary: `${amount.toLocaleString("tr-TR")} ${result.rows[0].currency} ödeme kaydı eklendi` });
    return result.rows[0];
  }

  async createTask(input: any) {
    await this.customer(input?.customerId); const title = text(input.title, 180); if (!title) throw new Error("Görev adı gerekli");
    const result = await this.database.query(`INSERT INTO tasks (customer_id,title,due_date,assignee,status,notes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${TASK_FIELDS}`,
      [input.customerId, title, date(input.dueDate), text(input.assignee, 80) || null,
       allowed(input.status, ["todo","doing","done"], "todo"), text(input.notes, 1000) || null]);
    return result.rows[0];
  }

  async createActivity(input: any) {
    await this.customer(input?.customerId); const summary = text(input.summary, 1000); if (!summary) throw new Error("Aktivite açıklaması gerekli");
    const result = await this.database.query(`INSERT INTO activities (customer_id,type,summary,created_by)
      VALUES ($1,$2,$3,$4) RETURNING ${ACTIVITY_FIELDS}`,
      [input.customerId, text(input.type, 50) || "note", summary, text(input.createdBy, 80) || null]);
    return result.rows[0];
  }

  async updateRecord(kind: "contracts" | "payments" | "tasks", recordId: string, patch: any) {
    const values = kind === "contracts" ? ["draft","sent","signed","active","completed","cancelled"] : kind === "payments" ? ["planned","invoiced","paid","cancelled"] : ["todo","doing","done"];
    const current = await this.database.query(`SELECT *, to_char(due_date, 'YYYY-MM-DD') AS due_text, to_char(paid_at, 'YYYY-MM-DD') AS paid_text FROM ${kind} WHERE id=$1`, [recordId]);
    if (!current.rowCount) throw new Error("Kayıt bulunamadı");
    const row = current.rows[0];
    const status = allowed(patch?.status, values, row.status);
    const fields = kind === "contracts" ? CONTRACT_FIELDS : kind === "payments" ? PAYMENT_FIELDS : TASK_FIELDS;
    if (kind === "payments") {
      const amount = "amount" in patch ? money(patch.amount) : Number(row.amount);
      if (!amount) throw new Error("Ödeme tutarı gerekli");
      const paidAt = "paidAt" in patch ? date(patch.paidAt) : null;
      const result = await this.database.query(`UPDATE payments SET status=$2, amount=$3, currency=$4, due_date=$5, paid_at=$6, invoice_no=$7, notes=$8, updated_at=now()
        WHERE id=$1 RETURNING ${fields}`,
        [recordId, status, amount, "currency" in patch ? allowed(patch.currency, ["TRY","USD","EUR","GBP"], row.currency) : row.currency,
         "dueDate" in patch ? date(patch.dueDate) : row.due_text, status === "paid" ? paidAt || row.paid_text || new Date().toISOString().slice(0, 10) : paidAt,
         "invoiceNo" in patch ? text(patch.invoiceNo, 80) || null : row.invoice_no, "notes" in patch ? text(patch.notes, 1000) || null : row.notes]);
      return result.rows[0];
    }
    const result = await this.database.query(`UPDATE ${kind} SET status=$2, updated_at=now() WHERE id=$1 RETURNING ${fields}`, [recordId, status]);
    return result.rows[0];
  }

  private async customer(customerId: string) {
    const result = await this.database.query(`SELECT ${CUSTOMER_FIELDS} FROM customers WHERE id=$1`, [customerId]);
    if (!result.rowCount) throw new Error("Müşteri bulunamadı");
    return result.rows[0];
  }
}
