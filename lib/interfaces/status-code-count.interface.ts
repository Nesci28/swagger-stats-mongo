import { HTTPMethod } from "./http-method.interface";

export type StatusCodeCount = {
  [key in HTTPMethod]?: number;
};
