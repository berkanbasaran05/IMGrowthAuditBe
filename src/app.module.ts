import { Module } from "@nestjs/common";
import { HealthController } from "./modules/health/health.controller.js";
import { GrowthController } from "./modules/growth/growth.controller.js";
import { CrmController } from "./modules/crm/crm.controller.js";
import { CrmService } from "./modules/crm/crm.service.js";

@Module({ controllers: [HealthController, CrmController, GrowthController], providers: [CrmService] })
export class AppModule {}
