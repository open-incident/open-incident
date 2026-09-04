/**
 * Copy of the "no such workspace" answer, in one place.
 *
 * Two runtimes render it: the middleware builds a plain HTML string (edge, no
 * React) for a host whose *shape* is wrong, and app/not-found.tsx renders JSX
 * for a host whose shape is fine but whose workspace does not exist. Same
 * situation for whoever typed the address — hence the same words.
 *
 * English, deliberately: the language comes from the workspace, and the
 * workspace is exactly what could not be resolved.
 */
export const WORKSPACE_NOT_FOUND = {
  title: "This workspace does not exist",
  body: "Check the address — or create your own workspace in under a minute.",
  cta: "Create my workspace",
} as const;
