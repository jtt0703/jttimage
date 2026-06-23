import { getImageSearchConfig } from "./image-search/env.server";

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Content-Type, Accept";

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  return getImageSearchConfig().storefrontCorsOrigins.includes(origin) ? origin : null;
}

export function withStorefrontCors(request: Request, response: Response): Response {
  const origin = allowedOrigin(request);
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", CORS_METHODS);
  headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
  headers.append("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function storefrontCorsPreflight(request: Request): Response {
  const origin = allowedOrigin(request);
  if (!origin) return new Response(null, { status: 204 });

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
