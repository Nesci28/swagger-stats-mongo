import basicAuth from "basic-auth";
import Cookies from "cookies";
import { FindOneResult } from "monk";
import { v1 } from "uuid";

import { SwsRequest } from "./interfaces/request.interface";
import { SwsResponse } from "./interfaces/response.interface";
import { Session } from "./interfaces/session.interface";
import { SwsMongo } from "./swsMongo";
import swsSettings from "./swsSettings";

export class SwsAuth {
  private expireIntervalId: any;

  constructor(private readonly swsMongo: SwsMongo) {}

  public async storeSession(sid: string): Promise<void> {
    const tsSec = Date.now() + swsSettings.sessionMaxAge * 1000;
    await this.swsMongo.insertSession({
      sid,
      tsSec,
      archived: false,
    });

    // debug('Session ID updated: %s=%d', sid,tssec);
    if (!this.expireIntervalId) {
      this.expireIntervalId = setInterval(async () => {
        await this.expireSessions();
      }, 500);
    }
  }

  public async patchSession(
    sid: string,
    ms: number,
  ): Promise<FindOneResult<Session>> {
    const res = await this.swsMongo.patchBySidSession(sid, ms);
    return res;
  }

  public async removeSession(sid: string): Promise<FindOneResult<Session>> {
    const res = await this.swsMongo.archiveByIdSessions(sid);
    return res;
  }

  // If authentication is enabled, executed periodically and expires old session IDs
  public async expireSessions(): Promise<void> {
    const tsSec = Date.now();
    const archiveByIdSessionPromises: Promise<any>[] = [];
    const sessions = await this.swsMongo.getAllSessions();
    // eslint-disable-next-line no-restricted-syntax
    for (const session of sessions) {
      const isExpired = session.tsSec < tsSec + 5000;
      if (isExpired) {
        archiveByIdSessionPromises.push(
          this.swsMongo.archiveByIdSessions(session.sid),
        );
      }
    }

    await Promise.all(archiveByIdSessionPromises);
  }

  public async processAuth(
    req: SwsRequest,
    res: SwsResponse,
  ): Promise<boolean> {
    if (!swsSettings.authentication) {
      return true;
    }

    if (swsSettings.customAuth) {
      return swsSettings.customAuth(req);
    }

    const cookies = new Cookies(req, res);

    // Check session cookie
    const sId = cookies.get("sws-session-id");
    if (sId !== undefined && sId !== null) {
      const session = await this.swsMongo.findBySidSession(sId);
      if (session && !session.archived) {
        // renew it
        // sessionIDs[sId] = Date.now();
        await this.patchSession(sId, Date.now());
        cookies.set("sws-session-id", sId, {
          path: swsSettings.basePath + swsSettings.uriPath,
          maxAge: swsSettings.sessionMaxAge * 1000,
        });
        // Ok
        req["sws-auth"] = true;
        return true;
      }
    }

    const authInfo = basicAuth(req);

    let msg = "Authentication required";

    if (
      authInfo !== undefined &&
      authInfo !== null &&
      "name" in authInfo &&
      "pass" in authInfo
    ) {
      if (typeof swsSettings.onAuthenticate === "function") {
        let onAuthResult;
        try {
          onAuthResult = await swsSettings.onAuthenticate(
            req,
            authInfo.name,
            authInfo.pass,
          );
        } catch (e) {
          msg = `Authentication error: ${e.message}`;
          res.statusCode = 403;
          res.end(msg);
          return false;
        }
        if (onAuthResult) {
          // Session is only for stats requests
          if (req.url.startsWith(swsSettings.pathStats)) {
            // Generate session id
            const sessid = v1();
            await this.storeSession(sessid);
            // Set session cookie with expiration in 15 min
            cookies.set("sws-session-id", sessid, {
              path: swsSettings.basePath + swsSettings.uriPath,
              maxAge: swsSettings.sessionMaxAge * 1000,
            });
          }
          req["sws-auth"] = true;
          return true;
        }
        res.statusCode = 403;
        res.end(msg);
        return false;
      }
      res.statusCode = 403;
      res.end(msg);
      return false;
    }
    res.statusCode = 403;
    res.end(msg);
    return false;
  }

  public async processLogout(req: SwsRequest, res: SwsResponse): Promise<void> {
    const cookies = new Cookies(req, res);
    const sessionIdCookie = cookies.get("sws-session-id");
    if (sessionIdCookie !== undefined && sessionIdCookie !== null) {
      await this.removeSession(sessionIdCookie);
      cookies.set("sws-session-id"); // deletes cookie
    }
    res.statusCode = 200;
    res.end("Logged out");
  }
}
