import { SwsReqResStats } from "../swsReqResStats";
import { HTTPMethod } from "./http-method.interface";

export interface ApiStats {
  [key: string]: ApiStatsMethod;
}

export type ApiStatsMethod = {
  [key in HTTPMethod]: SwsReqResStats;
};
