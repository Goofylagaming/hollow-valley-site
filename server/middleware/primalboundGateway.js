"use strict";
/**
 * Isolated Primalbound game gateway. Never forwards Hollow Valley authentication
 * cookies, Steam session state, database connections, or privileged API headers.
 *
 * Production path: https://hollowvalleyisle.com/primalbound/
 * Static upstream: independently deployed Render Primalbound browser game.
 * Account API disabled until PRIMALBOUND_CLOUD_API_URL is intentionally configured.
 */
const express = require("express");

const STATIC_ORIGIN = "https://primalbound-web-preview.onrender.com";
const MAX_API_BODY = 270_000;
const ALLOWED_API_METHODS = new Set(["GET", "POST", "PUT", "HEAD"]);
const STATIC_METHODS = new Set(["GET", "HEAD"]);
const ACCOUNT_COOKIE = "__Host-primalbound_session";

function cleanApiOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^[-a-z0-9]+\.onrender\.com$/i.test(url.hostname) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}
function destinationFor(subpath, apiOrigin = null) {
  if (typeof subpath !== "string" || !subpath.startsWith("/") || subpath.startsWith("//") || subpath.includes("\\") || subpath.includes("\u0000")) return null;
  const url = new URL(subpath, STATIC_ORIGIN);
  if (url.origin !== STATIC_ORIGIN) return null;
  if (url.pathname.startsWith("/api/")) {
    if (!apiOrigin) return { type: "disabled-api", path: url.pathname };
    return { type: "api", url: apiOrigin + url.pathname + url.search };
  }
  return { type: "static", url: url.href };
}
function primalboundCookie(raw) {
  if (typeof raw !== "string") return null;
  const candidate = raw.split(";").map(s => s.trim()).find(s => s.startsWith(ACCOUNT_COOKIE + "="));
  return candidate && /^__Host-primalbound_session=[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
}
function sameOriginRequest(req) {
  const expected = "https://" + String(req.headers.host || "").toLowerCase();
  return req.headers.origin === expected;
}
async function readLimitedBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_API_BODY) {
      const err = new Error("Primalbound account request is too large.");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function respondJson(res, status, body) {
  res.set("Cache-Control", "no-store");
  res.status(status).json(body);
}

function createPrimalboundRouter(options = {}) {
  const router = express.Router();
  const apiOrigin = options.apiOrigin === undefined ? cleanApiOrigin(process.env.PRIMALBOUND_CLOUD_API_URL) : cleanApiOrigin(options.apiOrigin);
  const staticOrigin = STATIC_ORIGIN;
  let capabilitiesPending = null;
  const readCapabilities = require('../services/resilientRead').createResilientRead();

  router.use(async (req, res) => {
    // A relative asset base must resolve from /primalbound/, not /primalbound.
    if (req.originalUrl.split("?")[0] === "/primalbound") {
      return res.redirect(308, "/primalbound/" + (req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : ""));
    }
    const target = destinationFor(req.url, apiOrigin);
    if (!target) return respondJson(res, 400, { error: "Invalid Primalbound resource." });

    if (target.type === "disabled-api") {
      if (target.path === "/api/capabilities" && req.method === "GET") {
        return respondJson(res, 200, {
          accounts: false, cloudSaves: false, pendingDatabaseConnection: true,
          warning: "Cloud accounts are not enabled at the Hollow Valley game address yet."
        });
      }
      return respondJson(res, 503, { error: "Primalbound cloud accounts are not enabled at this address yet." });
    }
    if (!(target.type === "api" ? ALLOWED_API_METHODS : STATIC_METHODS).has(req.method)) {
      return respondJson(res, 405, { error: "Method not allowed." });
    }
    if (target.type === "api" && (req.method === "POST" || req.method === "PUT") && !sameOriginRequest(req)) {
      return respondJson(res, 403, { error: "Invalid request origin." });
    }

    if (target.type === 'api' && req.method === 'GET' && new URL(target.url).pathname === '/api/capabilities') {
      try {
        // This public endpoint contains no account state. Coalesce cold-start
        // requests; never share authenticated responses or replay save writes.
        if (!capabilitiesPending) {
          const signal = AbortSignal.timeout(60000);
          capabilitiesPending = readCapabilities(async () => {
            const response = await fetch(apiOrigin + '/api/capabilities', {
              headers: { Accept: 'application/json' }, redirect: 'manual', signal,
            });
            if (!response.ok) {
              await response.body?.cancel();
              throw Object.assign(new Error('Capabilities unavailable'), { status: response.status });
            }
            const body = await response.json();
            if (typeof body.accounts !== 'boolean' || typeof body.cloudSaves !== 'boolean') {
              throw Object.assign(new Error('Invalid capabilities'), { status: 502 });
            }
            return body;
          }, signal).finally(() => { capabilitiesPending = null; });
        }
        return respondJson(res, 200, await capabilitiesPending);
      } catch {
        res.set('Retry-After', '15');
        return respondJson(res, 503, { accounts: false, cloudSaves: false,
          temporarilyUnavailable: true, error: 'Primalbound cloud service is starting or temporarily unavailable. Please retry shortly.' });
      }
    }

    try {
      const headers = {
        Accept: req.headers.accept || "*/*",
        "Accept-Language": req.headers["accept-language"] || "en",
        "User-Agent": "HollowValley-Primalbound-Gateway/1.0"
      };
      if (target.type === "api") {
        const cookie = primalboundCookie(req.headers.cookie);
        if (cookie) headers.Cookie = cookie;
        if (req.headers["content-type"]) headers["Content-Type"] = String(req.headers["content-type"]);
        if (req.method === "POST" || req.method === "PUT") headers.Origin = apiOrigin;
      }

      const upstream = await fetch(target.url, {
        method: req.method,
        headers,
        body: target.type === "api" && (req.method === "POST" || req.method === "PUT") ? await readLimitedBody(req) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(12000)
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        return respondJson(res, 502, { error: "Game upstream redirected unexpectedly." });
      }
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      res.status(upstream.status);
      res.set({
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        "Cache-Control": target.type === "api" ? "no-store" :
          contentType.includes("text/html") ? "no-cache" : "public, max-age=300"
      });
      if (target.type === "static" && contentType.includes("text/html")) {
        res.set("Content-Security-Policy",
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; form-action 'self'");
      }
      if (target.type === "api" && upstream.headers.getSetCookie) {
        const upstreamCookies = upstream.headers.getSetCookie().filter(cookie =>
          cookie.startsWith(ACCOUNT_COOKIE + "=") && /;\s*Secure(?:;|$)/i.test(cookie) &&
          /;\s*HttpOnly(?:;|$)/i.test(cookie) && /;\s*SameSite=Lax(?:;|$)/i.test(cookie));
        if (upstreamCookies.length) res.set("Set-Cookie", upstreamCookies);
      }
      if (req.method === "HEAD") return res.end();
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length > 8_000_000) return respondJson(res, 502, { error: "Unexpected game resource size." });
      return res.end(body);
    } catch (error) {
      // Never leak upstream connection metadata, cookie values or secrets.
      const status = error.status || 502;
      return respondJson(res, status, { error: status === 413 ? error.message : "Primalbound is temporarily unreachable. Please try again." });
    }
  });
  return router;
}
module.exports = { createPrimalboundRouter, cleanApiOrigin, destinationFor, primalboundCookie, sameOriginRequest };
