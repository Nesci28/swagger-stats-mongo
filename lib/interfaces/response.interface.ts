import { Response } from "express";

export interface SwsResponse extends Response {
  _swsReq: any;
  statusCode: number;
  _contentLength: number;
  _header: string;
}
