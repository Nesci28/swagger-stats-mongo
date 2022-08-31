import { SwsReqResStats } from "../swsReqResStats";
import { HTTPMethod } from "./http-method.interface";

export type CoreMethods = {
  [key in HTTPMethod]?: SwsReqResStats;
};
