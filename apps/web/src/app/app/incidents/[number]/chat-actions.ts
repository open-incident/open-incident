"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidents, withTenant } from "@openincident/db";
import { ensureIncidentChannels } from "@openincident/chat";
import { headers } from "next/headers";
import { requireResponder } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";

/** "Create the channel" — every connected chat tool; for workspaces in "none" mode, or an incident declared before the tool was connected. */
export async function createIncidentChannel(formData: FormData) {
  const current = await requireResponder();
  const number = z.coerce.number().int().positive().parse(formData.get("number"));
  const [inc] = await withTenant(current.tenant.id, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number))),
  );
  if (!inc) return;
  const h = await headers();
  const origin = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
  await ensureIncidentChannels(current.tenant.id, inc.id, origin, { force: true });
  revalidatePath(`/app/incidents/${number}`);
}
