/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import monk, {
  FindOneResult,
  FindResult,
  ICollection,
  InsertResult,
} from "monk";

import { Session } from "./interfaces/session.interface";

export class SwsMongo {
  private MONGO_URL: string;

  private MONGO_USERNAME: string;

  private MONGO_PASSWORD: string;

  private SWAGGER_STATS_MONGO_DB: string;

  private sessionsDb: ICollection<Session>;

  private swaggerStatsDb: ICollection<any>;

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

  public async init(): Promise<void> {
    const uri = this.MONGO_USERNAME
      ? `mongodb://${this.MONGO_USERNAME}:${this.MONGO_PASSWORD}@${this.MONGO_URL}/${this.SWAGGER_STATS_MONGO_DB}`
      : `mongodb://${this.MONGO_URL}/${this.SWAGGER_STATS_MONGO_DB}`;

    const db = monk(uri);
    this.sessionsDb = db.get<Session>("sessions");
    this.swaggerStatsDb = db.get<any>("swagger-stats");
  }

  public async insertSession(session: Session): Promise<InsertResult<Session>> {
    try {
      const data = await this.sessionsDb.insert(session);
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  public async patchBySidSession(
    sessionSid: string,
    ms: number,
  ): Promise<FindOneResult<Session>> {
    try {
      const data = await this.sessionsDb.findOneAndUpdate(
        { sid: sessionSid },
        { $set: { tsSec: ms } },
      );
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  public async findBySidSession(
    sessionId: string,
  ): Promise<FindOneResult<Session>> {
    try {
      const data = await this.sessionsDb.findOne({ sid: sessionId });
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  public async archiveByIdSessions(
    sessionId: string,
  ): Promise<FindOneResult<Session>> {
    try {
      const data = await this.sessionsDb.findOneAndUpdate(
        { sid: sessionId },
        { $set: { archived: true } },
      );
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }

  async getAllSessions(): Promise<FindResult<Session>> {
    try {
      const data = await this.sessionsDb.find({ archived: false });
      return data;
    } catch (err) {
      throw new Error(err);
    }
  }
}
