/* eslint-disable @typescript-eslint/explicit-member-accessibility */
const { v1: uuidv1 } = require("uuid");
const Cookies = require("cookies");
const basicAuth = require("basic-auth");
const debug = require("debug")("sws:auth");
const swsSettings = require("./swssettings.js");

/* Authentication */
class SwsAuth {
  constructor() {
    this.sessionIDs = {};
    this.expireIntervalId = null;
  }

  storeSessionID(sid) {
    const tsSec = Date.now() + swsSettings.sessionMaxAge * 1000;
    this.sessionIDs[sid] = tsSec;
    // debug('Session ID updated: %s=%d', sid,tssec);
    if (!this.expireIntervalId) {
      this.expireIntervalId = setInterval(() => {
        this.expireSessionIDs();
      }, 500);
    }
  }

  removeSessionID(sid) {
    delete this.sessionIDs[sid];
  }

  // If authentication is enabled, executed periodically and expires old session IDs
  expireSessionIDs() {
    const tssec = Date.now();
    const expired = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const sid of Object.keys(this.sessionIDs)) {
      if (this.sessionIDs[sid] < tssec + 500) {
        expired.push(sid);
      }
    }
    for (let i = 0; i < expired.length; i += 1) {
      delete this.sessionIDs[expired[i]];
      debug("Session ID expired: %s", expired[i]);
    }
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
    const sessionIdCookie = cookies.get("sws-session-id");
    if (sessionIdCookie !== undefined && sessionIdCookie !== null) {
      if (sessionIdCookie in this.sessionIDs) {
        // renew it
        // sessionIDs[sessionIdCookie] = Date.now();
        this.storeSessionID(sessionIdCookie);
        cookies.set("sws-session-id", sessionIdCookie, {
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
            this.storeSessionID(sessid);
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

  processLogout(req, res) {
    const cookies = new Cookies(req, res);
    const sessionIdCookie = cookies.get("sws-session-id");
    if (sessionIdCookie !== undefined && sessionIdCookie !== null) {
      if (sessionIdCookie in this.sessionIDs) {
        this.removeSessionID(sessionIdCookie);
        cookies.set("sws-session-id"); // deletes cookie
      }
    }
    res.statusCode = 200;
    res.end("Logged out");
  }
}

const swsAuth = new SwsAuth();
module.exports = swsAuth;
