/**
 * The contract, served by the instance. The document itself lives in
 * @openincident/api-spec, which the developer site renders and a test checks
 * against the routes this app really exposes.
 */
import { openApiDocument } from "@openincident/api-spec";
import { requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = requestOrigin({ headers: request.headers, nextUrl: new URL(request.url) });
  return Response.json(openApiDocument(origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
