/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Last Errors
 */

const swsUtil = require("./swsUtil.js");

class SwsLastErrors {
  constructor() {
    // Store Last 100 errors
    this.last_errors = [];
  }

  getStats() {
    return this.last_errors;
  }

  // Add information about last error
  addError(rrr) {
    this.last_errors.push(rrr);
    // Clean up if more than allowed
    if (this.last_errors.length > 100) {
      this.last_errors.shift();
    }
  }

  // Check if this qualifies as longest request, and store is yes
  processReqResData(rrr) {
    if (swsUtil.isError(rrr.http.response.code)) {
      this.addError(rrr);
    }
  }
}

module.exports = SwsLastErrors;
