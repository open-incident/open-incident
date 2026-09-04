import { createAuth } from "@openincident/auth";
import { eeAuthPlugins } from "@openincident/ee-web/auth";

/**
 * The app's auth instance: the core, plus the enterprise plugins (single
 * sign-on). This is the licence seam — one import, the URLs do not change.
 */
export const auth = createAuth({ plugins: eeAuthPlugins() });
