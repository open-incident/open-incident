import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@openincident/ee-web/auth-client";

/** Better Auth client — implicit baseURL: the current origin (the workspace's subdomain). */
export const authClient = createAuthClient({ plugins: [ssoClient()] });
