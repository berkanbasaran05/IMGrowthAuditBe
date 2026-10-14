import { All, Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { publicMessage } from "../../infrastructure/http/http-hardening.js";
import { isAuthed } from "../growth/lib/auth.js";
import { CrmService } from "./crm.service.js";

@Controller("api/crm")
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private async run(req: Request, res: Response, work: () => Promise<any>) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Giriş gerekli" });
    try { return res.status(200).json(await work()); }
    catch (error: any) { return res.status(/bulunamadı/i.test(error.message) ? 404 : 400).json({ error: publicMessage(error) }); }
  }

  @Get()
  dashboard(@Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.dashboard()); }

  @Post("customers")
  customer(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.createCustomer(body)); }

  @Patch("customers/:id")
  updateCustomer(@Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.updateCustomer(id, body)); }

  @Post("customers/from-lead/:leadId")
  convert(@Param("leadId") leadId: string, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.convertLead(leadId)); }

  @Post("contracts")
  contract(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.createContract(body)); }

  @Post("payments")
  payment(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.createPayment(body)); }

  @Post("tasks")
  task(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.createTask(body)); }

  @Post("activities")
  activity(@Body() body: any, @Req() req: Request, @Res() res: Response) { return this.run(req, res, () => this.crm.createActivity(body)); }

  @Patch(":kind/:id")
  update(@Param("kind") kind: string, @Param("id") id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!["contracts", "payments", "tasks"].includes(kind)) return res.status(404).json({ error: "Bulunamadı" });
    return this.run(req, res, () => this.crm.updateRecord(kind as any, id, body));
  }
}
