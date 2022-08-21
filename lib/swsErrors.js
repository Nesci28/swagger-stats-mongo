/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Created by sv2 on 2/18/17.
 * Errors stats
 */

const swsUtil = require("./swsUtil.js");

class SwsErrors {
  constructor() {
    // Store counts per each error code
    this.statuscode_count = {};

    // Store Top not found path
    this.top_not_found = {};

    // Store Top server error path
    this.top_server_error = {};
  }

  getStats() {
    return {
      statuscode: this.statuscode_count,
      topnotfound: this.top_not_found,
      topservererror: this.top_server_error,
    };
  }

  // Add information about error
  countResponse(res) {
    if (!swsUtil.isError(res.statusCode)) return;

    // Increase count by code
    if (!(res.statusCode in this.statuscode_count)) {
      this.statuscode_count[res.statusCode] = 0;
    }
    this.statuscode_count[res.statusCode] += 1;

    if (res.statusCode === 404) {
      this.countPathHit(res._swsReq.sws.originalUrl, this.top_not_found);
    } else if (res.statusCode === 500) {
      this.countPathHit(res._swsReq.sws.originalUrl, this.top_server_error);
    }
  }

  // Check if this qualifies as longest request, and store is yes
  countPathHit(path, store) {
    if (!(path in store)) {
      // eslint-disable-next-line no-param-reassign
      store[path] = 0;
    }
    // eslint-disable-next-line no-param-reassign
    store[path] += 1;
  }
}

module.exports = SwsErrors;
