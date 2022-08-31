import { HTTPMethod } from "./http-method.interface";

export interface ApiDefs {
  [key: string]: ApiDefsMethod;
}

export type ApiDefsMethod = {
  [key in HTTPMethod]: {
    swagger: boolean;
    deprecated: boolean;
    description?: string;
    operationId?: string;
    summary?: string;
    tags?: string;

    // Store in match index
    // this.apiMatchIndex[fullPath].methods[opMethod] = apiOpDef;
  };
};
