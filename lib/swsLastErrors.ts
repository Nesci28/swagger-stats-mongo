/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Last Errors
 */

import { RequestResponseRecord } from "./interfaces/request-response-record.interface";
import { SwsUtil } from "./swsUtil";

export class SwsLastErrors {
  private last_errors: any[] = [];

  public getStats(): any[] {
    return this.last_errors;
  }

  // Add information about last error
  public addError(rrr: RequestResponseRecord): void {
    this.last_errors.push(rrr);
    // Clean up if more than allowed
    if (this.last_errors.length > 100) {
      this.last_errors.shift();
    }
  }

  // Check if this qualifies as longest request, and store is yes
  public processReqResData(rrr: RequestResponseRecord): void {
    if (SwsUtil.isError(+rrr.http.response.code)) {
      this.addError(rrr);
    }
  }
}
