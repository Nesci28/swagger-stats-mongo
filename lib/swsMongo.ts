/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import monk, {
  FindOneResult,
  FindResult,
  ICollection,
  InsertResult,
} from "monk";

import { SwsOptions } from "./interfaces/options.interface";
import { Session } from "./interfaces/session.interface";

export class SwsMongo {
  private mongoUrl: string;

  private mongoUsername: string;

  private mongoPasswords: string;

  private swaggerStatsMongoDb: string;

  private sessionsDb: ICollection<Session>;

  private swaggerStatsDb: ICollection<any>;

  constructor(options: SwsOptions) {
    const { mongoUrl, mongoUsername, mongoPassword, swaggerStatsMongoDb } =
      options;
    if (!mongoUrl || !swaggerStatsMongoDb) {
      throw new Error("Missing Swagger-Stats variables");
    }
    this.mongoUrl = mongoUrl;
    this.mongoUsername = mongoUsername;
    this.mongoPasswords = mongoPassword;
    this.swaggerStatsMongoDb = swaggerStatsMongoDb;
  }

  public async init(): Promise<void> {
    const uri = this.mongoUsername
      ? `mongodb://${this.mongoUsername}:${this.mongoPasswords}@${this.mongoUrl}/${this.swaggerStatsMongoDb}`
      : `mongodb://${this.mongoUrl}/${this.swaggerStatsMongoDb}`;

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
