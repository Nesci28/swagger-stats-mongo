import { Request } from "express";

export interface SwsRequest extends Request {
  sws: any;
  serverName: string;
}
