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

  public init(): void {
    const uri = this.mongoUsername
      ? `mongodb://${this.mongoUsername}:${this.mongoPasswords}@${this.mongoUrl}/${this.swaggerStatsMongoDb}`
      : `mongodb://${this.mongoUrl}/${this.swaggerStatsMongoDb}`;

    const db = monk(uri, { authSource: "admin" });
    this.sessionsDb = db.get<Session>("sessions");
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
      await this.sessionsDb.update(
        { sid: sessionSid },
        { $set: { tsSec: ms } },
      );
      const data = await this.sessionsDb.findOne({ sid: sessionSid });
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
      await this.sessionsDb.update(
        { sid: sessionId },
        { $set: { archived: true } },
      );
      const data = await this.sessionsDb.findOne({ sid: sessionId });
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
