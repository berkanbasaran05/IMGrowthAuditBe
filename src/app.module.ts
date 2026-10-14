import { Module } from "@nestjs/common";
import { HealthController } from "./modules/health/health.controller.js";
import { GrowthController } from "./modules/growth/growth.controller.js";
import { CrmController } from "./modules/crm/crm.controller.js";
import { CrmService } from "./modules/crm/crm.service.js";
import { DatabaseService } from "./infrastructure/database/database.service.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";
import { AuditController } from "./modules/audit/audit.controller.js";
import { AuditQueue } from "./modules/audit/audit.queue.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { PublicAuditController } from "./modules/audit/public-audit.controller.js";
import { PublicAuditService } from "./modules/audit/public-audit.service.js";
import { PublicReportController, SalesController } from "./modules/sales/sales.controller.js";
import { SalesService } from "./modules/sales/sales.service.js";
import { GrowthManagerAdminController, OAuthController, PortalController } from "./modules/growth-manager/growth-manager.controller.js";
import { GrowthManagerScheduler } from "./modules/growth-manager/growth-manager.scheduler.js";
import { GrowthManagerService } from "./modules/growth-manager/growth-manager.service.js";
import { GeoController } from "./modules/geo/geo.controller.js";
import { GeoService } from "./modules/geo/geo.service.js";
import { OpsController, OpsService } from "./modules/ops/ops.controller.js";
import { RetentionService } from "./modules/ops/retention.service.js";
import { PaymentLinkController, PaymentsAdminController, PortalBillingController } from "./modules/payments/payments.controller.js";
import { InstagramController } from "./modules/instagram/instagram.controller.js";
import { InstagramService } from "./modules/instagram/instagram.service.js";
import { PaymentsService } from "./modules/payments/payments.service.js";

@Module({
  // AuditController, "api/:endpoint" yakalayıcısını içeren GrowthController'dan önce kaydedilir.
  controllers: [HealthController, CrmController, AuditController, PublicAuditController, SalesController, PublicReportController, GrowthManagerAdminController, PortalBillingController, PortalController, OAuthController, GeoController, OpsController, PaymentsAdminController, PaymentLinkController, InstagramController, GrowthController],
  providers: [PrismaService, DatabaseService, CrmService, AuditService, PublicAuditService, AuditQueue, SalesService, GrowthManagerService, GrowthManagerScheduler, GeoService, RetentionService, OpsService, PaymentsService, InstagramService],
})
export class AppModule {}
