import { json } from "./worker/lib/response.mjs";
import { LEGACY_REDIRECTS } from "./worker/lib/legacy-routes.mjs";
import {
  handleHoldingsApi,
  handleRealizedPnlApi,
  handleSessionApi,
  handleTransactionsApi,
} from "./worker/routes/read-api.mjs";
import {
  handleNavSeriesApi,
  handleReviewMetricsApi,
} from "./worker/routes/review-api.mjs";
import {
  handleAuthEntryApi,
  handleAuthLoginApi,
  handleAuthLogoutApi,
  handleAuthRegisterApi,
} from "./worker/routes/auth-write-api.mjs";
import {
  handleCreateHoldingApi,
  handleDeleteHoldingApi,
  handleUpdateHoldingApi,
} from "./worker/routes/holdings-write-api.mjs";
import {
  handleCashTransferApi,
  handleFxExchangeApi,
  handleHoldingTradeApi,
  handleOptionExpireApi,
  handleOptionSettlementApi,
  handleRevertTransactionApi,
} from "./worker/routes/ledger-write-api.mjs";
import { handlePriceLookupApi, handleRefreshPricesApi } from "./worker/routes/prices-api.mjs";

function buildIndexFallbackUrl(url) {
  if (url.pathname === "/") {
    return new URL("/index.html", url);
  }

  if (url.pathname.endsWith("/")) {
    return new URL(`${url.pathname}index.html`, url);
  }

  return new URL(`${url.pathname}/index.html`, url);
}

function getPublicConfig(env) {
  const publicHost = env.PUBLIC_HOST || "";
  const publicPort = Number(env.PUBLIC_PORT || 0);

  return {
    inviteRequired: false,
    bootstrapInviteEnabled: false,
    host: publicHost,
    port: publicPort,
    lanAddresses: [],
    runtime: "cloudflare-worker",
  };
}

async function serveStatic(request, env) {
  let response = await env.ASSETS.fetch(request);
  if (response.status !== 404) {
    return response;
  }

  const url = new URL(request.url);
  const looksLikeFile = /\.[a-z0-9]+$/i.test(url.pathname);
  if (looksLikeFile) {
    return response;
  }

  const fallbackUrl = buildIndexFallbackUrl(url);
  return env.ASSETS.fetch(new Request(fallbackUrl.toString(), request));
}

async function proxyLegacyApi(request, env) {
  if (!env.LEGACY_API_ORIGIN) {
    return json(
      {
        error: "API is not migrated to Cloudflare Worker yet.",
        phase: "cloudflare-skeleton",
      },
      { status: 501 }
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, env.LEGACY_API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  return fetch(targetUrl.toString(), init);
}

function createLegacyFallback(request, env) {
  if (!env.LEGACY_API_ORIGIN) return null;
  return () => proxyLegacyApi(request, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const holdingMatch = url.pathname.match(/^\/api\/holdings\/([^/]+)$/);
    const holdingTradesMatch = url.pathname.match(/^\/api\/holdings\/([^/]+)\/trades$/);
    const holdingOptionSettlementMatch = url.pathname.match(/^\/api\/holdings\/([^/]+)\/option-settlement$/);
    const holdingOptionExpireMatch = url.pathname.match(/^\/api\/holdings\/([^/]+)\/option-expire$/);
    const holdingPriceRefreshMatch = url.pathname.match(/^\/api\/prices\/refresh\/([^/]+)$/);
    const transactionRevertMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/revert$/);

    if (LEGACY_REDIRECTS[url.pathname]) {
      return Response.redirect(new URL(LEGACY_REDIRECTS[url.pathname], url).toString(), 302);
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        runtime: "cloudflare-worker",
        mode: env.DB ? "d1-ready" : "static-skeleton",
      });
    }

    if (url.pathname === "/api/config/public") {
      return json(getPublicConfig(env));
    }

    if (url.pathname === "/api/auth/session") {
      return handleSessionApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/auth/entry" && request.method === "POST") {
      return handleAuthEntryApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      return handleAuthRegisterApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleAuthLoginApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return handleAuthLogoutApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/holdings" && request.method === "GET") {
      return handleHoldingsApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/holdings" && request.method === "POST") {
      return handleCreateHoldingApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (holdingMatch && request.method === "PUT") {
      return handleUpdateHoldingApi(request, env, {
        holdingId: decodeURIComponent(holdingMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (holdingMatch && request.method === "DELETE") {
      return handleDeleteHoldingApi(request, env, {
        holdingId: decodeURIComponent(holdingMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (holdingTradesMatch && request.method === "POST") {
      return handleHoldingTradeApi(request, env, {
        holdingId: decodeURIComponent(holdingTradesMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (url.pathname === "/api/cash/transfer" && request.method === "POST") {
      return handleCashTransferApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/fx/exchange" && request.method === "POST") {
      return handleFxExchangeApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (holdingOptionSettlementMatch && request.method === "POST") {
      return handleOptionSettlementApi(request, env, {
        holdingId: decodeURIComponent(holdingOptionSettlementMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (holdingOptionExpireMatch && request.method === "POST") {
      return handleOptionExpireApi(request, env, {
        holdingId: decodeURIComponent(holdingOptionExpireMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (url.pathname === "/api/transactions") {
      return handleTransactionsApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (transactionRevertMatch && request.method === "POST") {
      return handleRevertTransactionApi(request, env, {
        transactionId: decodeURIComponent(transactionRevertMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (url.pathname === "/api/realized-pnl") {
      return handleRealizedPnlApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/review-metrics") {
      return handleReviewMetricsApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/nav-series") {
      return handleNavSeriesApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/prices/lookup" && request.method === "POST") {
      return handlePriceLookupApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (url.pathname === "/api/prices/refresh" && request.method === "POST") {
      return handleRefreshPricesApi(request, env, { fallback: createLegacyFallback(request, env) });
    }

    if (holdingPriceRefreshMatch && request.method === "POST") {
      return handleRefreshPricesApi(request, env, {
        holdingId: decodeURIComponent(holdingPriceRefreshMatch[1]),
        fallback: createLegacyFallback(request, env),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyLegacyApi(request, env);
    }

    return serveStatic(request, env);
  },
};
