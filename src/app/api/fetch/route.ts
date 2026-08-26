import { handleFetchBatchRequest } from "@/server/fetch-boundary/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleFetchBatchRequest(request);
}
