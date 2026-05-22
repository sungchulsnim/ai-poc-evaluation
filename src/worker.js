import { onRequest as handleApi } from "../functions/api/[[path]].js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi({ request, env, ctx });
    }

    const assetPath = routeAssetPath(url.pathname);
    if (assetPath !== url.pathname) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetPath;
      return serveAsset(new Request(assetUrl, request), env, assetPath);
    }

    return serveAsset(request, env, assetPath);
  }
};

async function serveAsset(request, env, assetPath) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControlFor(assetPath));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function cacheControlFor(assetPath) {
  if (/\.(html|js|css)$/.test(assetPath)) {
    return "no-store, max-age=0";
  }
  return "public, max-age=3600";
}

function routeAssetPath(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname === "/admin") return "/admin.html";
  if (pathname === "/login") return "/login.html";
  if (isGroupVotePath(pathname)) return "/vote.html";
  if (pathname.startsWith("/vote/")) return "/vote.html";
  return pathname;
}

function isGroupVotePath(pathname) {
  return /^\/(?:vote\/)?group[1-6](?:\.html)?\/?$/i.test(pathname);
}
