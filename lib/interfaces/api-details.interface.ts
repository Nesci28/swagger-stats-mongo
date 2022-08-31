import { StatusCodes } from "http-status-codes";

import { SwsBucketStats } from "../swsBucketStats";
import { HTTPMethod } from "./http-method.interface";

export interface ApiDetails {
  [key: string]: ApiDetailsMethod;
}

export type ApiDetailsMethod = {
  [key in HTTPMethod]: ApiDetail;
};

export interface ApiDetail {
  duration: SwsBucketStats;
  req_size: SwsBucketStats;
  res_size: SwsBucketStats;
  code: ApiDetailsStatusCode;
}

export type ApiDetailsStatusCode = {
  [key in StatusCodes]?: {
    count: number;
  };
};
