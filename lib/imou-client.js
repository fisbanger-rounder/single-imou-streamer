import crypto from "node:crypto";

const KIT_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 30 * 60 * 1000;

export class ImouApiError extends Error {
  constructor(code, msg) {
    super(`Imou API error ${code}: ${msg}`);
    this.name = "ImouApiError";
    this.code = code;
  }
}

export class ImouConfigError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ImouConfigError";
  }
}

export class ImouClient {
  constructor({ appId, appSecret, baseUrl, accessToken = "" }) {
    if (!baseUrl) throw new ImouConfigError("IMOU_BASE_URL is required");
    this.appId = appId || "";
    this.appSecret = appSecret || "";
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.staticAccessToken = accessToken;
    this.accessTokenCache = null; // { value, expiresAt }
    this.kitTokenCache = new Map(); // key -> { value, expiresAt }
  }

  /**
   * Sign calculation per https://open.imoulife.com/book/http/develop.html:
   * password = LowerCase(Hex(SHA-256(appSecret)))
   * sign = Base64(HMAC-SHA256("time:{time},nonce:{nonce},appSecret:{appSecret}", password))
   */
  #sign(time, nonce) {
    const source = `time:${time},nonce:${nonce},appSecret:${this.appSecret}`;
    const password = crypto.createHash("sha256").update(this.appSecret, "utf8").digest("hex");
    return crypto.createHmac("sha256", password).update(source, "utf8").digest("base64");
  }

  async #call(apiName, params) {
    const time = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const body = {
      id: crypto.randomUUID(),
      system: {
        ver: "1.0",
        appId: this.appId,
        sign: this.#sign(time, nonce),
        time,
        nonce,
      },
      params,
    };

    let res;
    try {
      res = await fetch(`${this.baseUrl}/openapi/${apiName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new Error(`Failed to reach Imou Open Platform (${this.baseUrl}): ${err.message}`);
    }

    if (!res.ok) {
      throw new Error(`Imou Open Platform HTTP ${res.status} for ${apiName}`);
    }

    const payload = await res.json();
    const result = payload && payload.result;
    if (!result) {
      throw new Error(`Unexpected response from ${apiName}: ${JSON.stringify(payload).slice(0, 300)}`);
    }
    if (result.code !== "0") {
      throw new ImouApiError(result.code, result.msg || "unknown error");
    }
    return result.data || {};
  }

  /**
   * Admin accessToken. Uses the statically configured token when provided,
   * otherwise fetches one with appId/appSecret and caches it (valid ~3 days).
   */
  async getAccessToken() {
    if (this.staticAccessToken) return this.staticAccessToken;

    if (
      this.accessTokenCache &&
      Date.now() < this.accessTokenCache.expiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS
    ) {
      return this.accessTokenCache.value;
    }

    if (!this.appId || !this.appSecret) {
      throw new ImouConfigError(
        "Missing credentials: set IMOU_ACCESS_TOKEN or IMOU_APP_ID + IMOU_APP_SECRET in .env"
      );
    }

    const data = await this.#call("accessToken", {});
    if (!data.accessToken) {
      throw new ImouApiError("-1", "accessToken response did not contain a token");
    }
    this.accessTokenCache = {
      value: data.accessToken,
      expiresAt: Date.now() + Number(data.expireTime || 259200) * 1000,
    };
    return this.accessTokenCache.value;
  }

  /**
   * kitToken for the light-app player. Cached ~1h of its 2h TTL per README advice.
   * type: 0=all permissions (live + playback + PTZ + talk).
   */
  async getKitToken(deviceId, channelId, type = "0") {
    const key = `${deviceId}|${channelId}|${type}`;
    const cached = this.kitTokenCache.get(key);
    if (cached && Date.now() < cached.expiresAt - KIT_TOKEN_REFRESH_MARGIN_MS) {
      return { kitToken: cached.value, expireTime: Math.round((cached.expiresAt - Date.now()) / 1000), cached: true };
    }

    const token = await this.getAccessToken();
    const data = await this.#call("getKitToken", {
      token,
      deviceId,
      channelId: String(channelId),
      type: String(type),
    });
    if (!data.kitToken) {
      throw new ImouApiError("-1", "getKitToken response did not contain a kitToken");
    }
    const ttlSeconds = Number(data.expireTime || 7200);
    this.kitTokenCache.set(key, {
      value: data.kitToken,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return { kitToken: data.kitToken, expireTime: ttlSeconds, cached: false };
  }

  /** controlMovePTZ - pan/tilt/zoom. operation codes 0-10, duration in ms. */
  async ptzControl(deviceId, channelId, operation, duration = 500) {
    const token = await this.getAccessToken();
    await this.#call("controlMovePTZ", {
      token,
      deviceId,
      channelId: String(channelId),
      operation: String(operation),
      duration: String(Math.min(Math.max(Number(duration) || 500, 100), 10000)),
    });
    return { ok: true };
  }
}
