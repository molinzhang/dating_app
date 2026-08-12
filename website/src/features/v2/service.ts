import type { DatingService } from "./domain";
import { createApiDatingService } from "./api-service";
import { createDemoDatingService } from "./demo-service";

export type DatingServiceMode = "demo" | "api";

export const datingServiceMode: DatingServiceMode = import.meta.env.VITE_DATING_SERVICE_MODE === "api" ? "api" : "demo";
export const datingService: DatingService = datingServiceMode === "api" ? createApiDatingService() : createDemoDatingService();
