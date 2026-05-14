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
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};

function routeAssetPath(pathname) {
  if (pathname === "/" || pathname === "/admin") return "/admin.html";
  if (pathname === "/login") return "/login.html";
  if (pathname.startsWith("/vote/")) return "/vote.html";
  if (/^\/group[1-6]$/.test(pathname)) return `${pathname}.html`;
  return pathname;
}
