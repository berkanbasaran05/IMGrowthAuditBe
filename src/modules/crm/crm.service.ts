import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../infrastructure/database/database.service.js";
import { getOne, put } from "../growth/lib/redis.js";

const text = (value: unknown, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const money = (value: unknown) => Math.max(0, Number(value) || 0);
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
const allowed = (value: unknown, values: string[], fallback: string) => values.includes(String(value)) ? String(value) : fallback;

const CUSTOMER_FIELDS = `id::text, lead_id AS "leadId", name, contact_name AS "contactName", email, phone, sector, owner_name AS owner,
  status, notes, created_at AS "createdAt", updated_at AS "updatedAt"`;
const CONTRACT_FIELDS = `id::text, customer_id::text AS "customerId", title, services, value::float8, monthly_value::float8 AS "monthlyValue",
  currency, billing, status, start_date AS "startDate", end_date AS "endDate", signed_at AS "signedAt", document_url AS "documentUrl", notes,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const PAYMENT_FIELDS = `id::text, customer_id::text AS "customerId", contract_id::text AS "contractId", amount::float8, currency, status,
  due_date AS "dueDate", paid_at AS "paidAt", invoice_no AS "invoiceNo", notes, created_at AS "createdAt", updated_at AS "updatedAt"`;
const TASK_FIELDS = `id::text, customer_id::text AS "customerId", title, assignee, due_date AS "dueDate", status, notes,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const ACTIVITY_FIELDS = `id::text, customer_id::text AS "customerId", type, summary, occurred_at AS at, created_by AS "createdBy"`;

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
    const liveContracts = contracts.rows.filter((row: any) => ["signed", "active", "completed"].includes(row.status));
    const contracted = liveContracts.reduce((sum: number, row: any) => sum + money(row.value), 0);
    const collected = payments.rows.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + money(row.amount), 0);
    const monthly = contracts.rows.filter((row: any) => row.status === "active").reduce((sum: number, row: any) => sum + money(row.monthlyValue), 0);
    const today = new Date().toISOString().slice(0, 10);
    return {
      customers: customers.rows, contracts: contracts.rows, payments: payments.rows, activities: activities.rows, tasks: tasks.rows,
      summary: {
        customers: customers.rowCount,
        activeCustomers: customers.rows.filter((row: any) => row.status === "active").length,
        contracted, collected, outstanding: Math.max(0, contracted - collected), monthly,
        openTasks: tasks.rows.filter((row: any) => row.status !== "done").length,
        overduePayments: payments.rows.filter((row: any) => row.status !== "paid" && row.dueDate && String(row.dueDate).slice(0, 10) < today).length,
      },
    };
  }

  async createCustomer(input: any) {
    const name = text(input?.name, 120);
    if (!name) throw new Error("Müşteri adı gerekli");
    const result = await this.database.query(`INSERT INTO customers
      (name, contact_name, email, phone, status, owner_name, sector, lead_id, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${CUSTOMER_FIELDS}`,
      [name, text(input.contactName, 100) || null, text(input.email, 120).toLowerCase() || null, text(input.phone, 40) || null,
       allowed(input.status, ["onboarding", "active", "paused", "completed", "lost"], "onboarding"), text(input.owner, 80) || null,
       text(input.sector, 100) || null, text(input.leadId, 120) || null, text(input.notes, 2000) || null]);
    await this.createActivity({ customerId: result.rows[0].id, type: "customer_created", summary: "Müşteri kaydı oluşturuldu" });
    return result.rows[0];
  }

  async updateCustomer(customerId: string, patch: any) {
    const current = await this.customer(customerId);
    const result = await this.database.query(`UPDATE customers SET name=$2, contact_name=$3, email=$4, phone=$5, owner_name=$6,
      sector=$7, notes=$8, status=$9, updated_at=now() WHERE id=$1 RETURNING ${CUSTOMER_FIELDS}`,
      [customerId, "name" in patch ? text(patch.name, 120) : current.name, "contactName" in patch ? text(patch.contactName, 100) || null : current.contactName,
       "email" in patch ? text(patch.email, 120).toLowerCase() || null : current.email, "phone" in patch ? text(patch.phone, 40) || null : current.phone,
       "owner" in patch ? text(patch.owner, 80) || null : current.owner, "sector" in patch ? text(patch.sector, 100) || null : current.sector,
       "notes" in patch ? text(patch.notes, 2000) || null : current.notes,
       patch.status ? allowed(patch.status, ["onboarding", "active", "paused", "completed", "lost"], current.status) : current.status]);
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
    const current = await this.database.query(`SELECT status FROM ${kind} WHERE id=$1`, [recordId]);
    if (!current.rowCount) throw new Error("Kayıt bulunamadı");
    const status = allowed(patch?.status, values, current.rows[0].status);
    const fields = kind === "contracts" ? CONTRACT_FIELDS : kind === "payments" ? PAYMENT_FIELDS : TASK_FIELDS;
    const paid = kind === "payments" && status === "paid" ? ", paid_at=COALESCE(paid_at, CURRENT_DATE)" : "";
    const result = await this.database.query(`UPDATE ${kind} SET status=$2, updated_at=now()${paid} WHERE id=$1 RETURNING ${fields}`, [recordId, status]);
    return result.rows[0];
  }

  private async customer(customerId: string) {
    const result = await this.database.query(`SELECT ${CUSTOMER_FIELDS} FROM customers WHERE id=$1`, [customerId]);
    if (!result.rowCount) throw new Error("Müşteri bulunamadı");
    return result.rows[0];
  }
}
