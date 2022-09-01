import { HTTPMethod } from "./http-method.interface";

export interface ApiDefs {
  [key: string]: ApiDefsMethod;
}

export type ApiDefsMethod = {
  [key in HTTPMethod]: ApiDef;
};

export interface ApiDef {
  swagger?: boolean;
  deprecated?: boolean;
  description?: string;
  operationId?: string;
  summary?: string;
  tags?: string;
}
