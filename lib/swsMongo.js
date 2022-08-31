/* eslint-disable @typescript-eslint/explicit-member-accessibility */

const monk = require("monk");

class SwsMongo {
  initStats = {
    requests: 0,
    responses: 0,
    errors: 0,
    info: 0,
    success: 0,
    redirect: 0,
    client_error: 0,
    server_error: 0,
    total_time: 0,
    max_time: 0,
    avg_time: 0,
    total_req_clength: 0,
    max_req_clength: 0,
    avg_req_clength: 0,
    total_res_clength: 0,
    max_res_clength: 0,
    avg_res_clength: 0,
    req_rate: 0,
    err_rate: 0,
    apdex_satisfied: 0,
    apdex_tolerated: 0,
    apdex_score: 0,
  };

  initDetails = {
    count: 0,
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };

  constructor(options) {
    const {
      MONGO_URL,
      MONGO_USERNAME,
      MONGO_PASSWORD,
      SWAGGER_STATS_MONGO_DB,
    } = options;
    if (!MONGO_URL || !SWAGGER_STATS_MONGO_DB) {
      throw new Error("Missing Swagger-Stats variables");
    }
    this.MONGO_URL = MONGO_URL;
    this.MONGO_USERNAME = MONGO_USERNAME;
    this.MONGO_PASSWORD = MONGO_PASSWORD;
    this.SWAGGER_STATS_MONGO_DB = SWAGGER_STATS_MONGO_DB;
  }

  async init() {
    const uri = this.MONGO_USERNAME
      ? `mongodb://${this.MONGO_USERNAME}:${this.MONGO_PASSWORD}@${this.MONGO_URL}/${this.SWAGGER_STATS_MONGO_DB}`
      : `mongodb://${this.MONGO_URL}/${this.SWAGGER_STATS_MONGO_DB}`;

    const db = monk(uri);
    this.sessionsDb = db.get("swagger-sessions");
    this.statsDb = db.get("swagger-stats");
    this.detailsDb = db.get("swagger-details");
    this.totalsDb = db.get("swagger-totals");

    await this.initTotals();
  }

  async initTotals() {
    // Find or Create the Document
    let document = await this.totalsDb.findOne({});
    if (!document) {
      document = this.totalsDb.insert({
        requests: 0,
        errors: 0,
      });
    }
    this.totalsId = document._id;
  }

  async getTotals() {
    try {
      const res = await this.totalsDb.findOne({ _id: this.totalsId });
      return res;
    } catch (err) {
      throw new Error(err);
    }
  }

  async setTotals(increases) {
    try {
      const { request, totalReqClength, avgReqClength, maxReqClength } =
        increases;

      const body = {
        requests: { $inc: request },
        total_req_clength: { $inc: totalReqClength },
        avg_req_clength: { $set: avgReqClength },
      };
      if (maxReqClength) {
        body.max_req_clength = { $set: maxReqClength };
      }

      const res = await this.totalsDb.updateOne({ _id: this.totalsId }, body);
      return res;
    } catch (err) {
      throw new Error(err);
    }
  }

  async findDetailsByPathMethod(path, method) {
    try {
      const res = await this.detailsDb.findOne({ path, method });
      return res;
    } catch (err) {
      throw new Error(err);
    }
  }

  async insertDetails(path, method) {
    try {
      const data = await this.detailsDb.insert({
        path,
        method,
        duration: this.initDetails,
        req_size: this.initDetails,
        res_size: this.initDetails,
        code: { 200: { count: 0 } },
      });
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async updateRates(path, method, elapsed) {
    try {
      const totals = await this.totalsDb.find({ _id: this.totalsId });
      const { requests, errors } = totals;

      const res = await this.statsDb.updateOne(
        { path, method },
        { $set: { req_rate: requests / elapsed, err_rate: errors / elapsed } },
      );
      return res;
    } catch (err) {
      throw new Error(err);
    }
  }

  async findStatsByPathMethod(path, method) {
    try {
      const res = await this.statsDb.findOne({ path, method });
      return res;
    } catch (err) {
      throw new Error(err);
    }
  }

  async insertStats(path, method, apdexThreshold) {
    try {
      const data = await this.statsDb.insert({
        path,
        method,
        apdexThreshold,
        ...this.initStats,
      });
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async insertSession(session) {
    try {
      const data = await this.sessionsDb.insert(session);
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async patchBySidSession(sessionSid, ms) {
    try {
      const data = await this.sessionsDb.update(
        { sid: sessionSid },
        { $set: { tsSec: ms } },
      );
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async findBySidSession(sessionSid) {
    try {
      const data = await this.sessionsDb.findOne({ sid: sessionSid });
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async archiveByIdSessions(sid) {
    try {
      const data = await this.sessionsDb.update(
        { sid },
        { $set: { archived: true } },
      );
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async getAllSessions() {
    try {
      const data = await this.sessionsDb.find({ archived: false });
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }
}

module.exports = SwsMongo;
