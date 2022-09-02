import { IncomingHttpHeaders, OutgoingHttpHeaders } from "http";

export interface RequestResponseRecord {
  path: string;
  method: string;
  query: string;
  startts: number;
  endts: number;
  responsetime: number;
  node: {
    name: string;
    version: string;
    hostname: string;
    ip: string;
  };
  http: {
    request: {
      url: string;
      headers?: IncomingHttpHeaders | undefined;
      clength?: number | undefined;
      route_path?: string | undefined;
      params?: Record<string, any> | undefined;
      query?: Record<string, any> | undefined;
      body?: any;
    };
    response: {
      code: string;
      class: string;
      phrase: string;
      headers?: OutgoingHttpHeaders | undefined;
      clength?: number | undefined;
    };
  };
  ip: string;
  real_ip: string;
  port: string;
  "@timestamp": string;
  api: {
    path: string;
    query: string;
    swagger?: string | undefined;
    deprecated?: string | undefined;
    operationId?: string | undefined;
    tags?: string | undefined;
    params?: string | undefined;
  };
  attrs?: Record<string, string> | undefined;
  attrsint?: Record<string, number> | undefined;
  [field: string]: any;
}
