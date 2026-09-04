import type { ReactNode } from "react";

/** Translation as the app hands it over: typed loosely here, the keys live in the app's dictionaries. */
export type Translate = ((key: string, params?: Record<string, string | number>) => string) & {
  fmt: { relative(date: Date): string };
};

/**
 * What an enterprise screen needs from the app — passed in by the thin shell
 * under apps/web, so this package never imports the app.
 */
export type ScreenDeps = {
  t: Translate;
  /** The workspace's public origin, for the URLs handed to the provider. */
  origin: string;
  tenantId: string;
  entitled: boolean;
  /** Rendered when the capability is not entitled on this instance. */
  unavailable: ReactNode;
};
