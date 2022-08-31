import { ApiDefs } from "./api-defs.interface";
import { ApiDetails } from "./api-details.interface";
import { ApiStats } from "./api-stats.interface";
import { HTTPMethod } from "./http-method.interface";

export interface APIOperationStats {
  [key: string]: ApiOperationMethod;
}

export type ApiOperationMethod = {
  [key in HTTPMethod]: {
    defs: ApiDefs;
    stats: ApiStats;
    details: ApiDetails;
  };
};
