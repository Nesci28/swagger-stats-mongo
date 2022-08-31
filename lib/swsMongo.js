/* eslint-disable @typescript-eslint/explicit-member-accessibility */

const monk = require("monk");

class SwsMongo {
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
    this.sessionsDb = db.get("sessions");
    this.swaggerStatsDb = db.get("swagger-stats");
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
