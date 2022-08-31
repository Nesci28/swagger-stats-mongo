/* eslint-disable @typescript-eslint/explicit-member-accessibility */
const { v1: uuidv1 } = require("uuid");
const Cookies = require("cookies");
const basicAuth = require("basic-auth");
const swsSettings = require("./swsSettings.js");

/* Authentication */
class SwsAuth {
  constructor(swsMongo) {
    this.swsMongo = swsMongo;
    this.sessionIDs = {};
    this.expireIntervalId = null;
  }

  async storeSessionID(sid) {
    const tsSec = Date.now() + swsSettings.sessionMaxAge * 1000;
    await this.swsMongo.insertSession({
      sid,
      tsSec,
      archived: false,
    });

    // debug('Session ID updated: %s=%d', sid,tssec);
    if (!this.expireIntervalId) {
      this.expireIntervalId = setInterval(async () => {
        await this.expireSessionIDs();
      }, 500);
    }
  }

  async patchSessionId(sid, ms) {
    const res = await this.swsMongo.patchBySidSession(sid, ms);
    return res;
  }

  async removeSessionID(sid) {
    const res = await this.swsMongo.archiveByIdSessions(sid);
    return res;
  }

  // If authentication is enabled, executed periodically and expires old session IDs
  async expireSessionIDs() {
    const tsSec = Date.now();
    const archiveByIdSessionPromises = [];
    const sessions = await this.swsMongo.getAllSessions();
    // eslint-disable-next-line no-restricted-syntax
    for (const session of sessions) {
      const isExpired = session.tsSec < tsSec + 500;
      if (isExpired) {
        archiveByIdSessionPromises.push(
          this.swsMongo.archiveByIdSessions(session.sid),
        );
      }
    }

    await Promise.all(archiveByIdSessionPromises);
  }

  async processAuth(req, res) {
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
        await this.patchSessionId(sId, Date.now());
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
        let onAuthResult = null;
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
            const sessid = uuidv1();
            await this.storeSessionID(sessid);
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

  async processLogout(req, res) {
    const cookies = new Cookies(req, res);
    const sessionIdCookie = cookies.get("sws-session-id");
    if (sessionIdCookie !== undefined && sessionIdCookie !== null) {
      await this.removeSessionID(sessionIdCookie);
      cookies.set("sws-session-id"); // deletes cookie
    }
    res.statusCode = 200;
    res.end("Logged out");
  }
}

module.exports = SwsAuth;
