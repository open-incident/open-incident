"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/dictionaries/en";
import {
  DialogField,
  DialogReadOnly,
  SettingsDialog,
  dialogInputStyle,
} from "@/components/settings/dialog";
import { flash } from "@/components/settings/controls";
import { itemButtonStyle } from "@/components/settings/template";
import {
  connectBridge,
  connectDocs,
  connectTracker,
  disconnectIntegration,
  syncTrackers,
  type RowResult,
} from "./connect-actions";

export type ConnectKind =
  "github" | "gitlab" | "jira" | "linear" | "confluence" | "notion" | "meet" | "zoom";

type Family = "tracker" | "docs" | "bridge";

const FAMILY: Record<ConnectKind, Family> = {
  github: "tracker",
  gitlab: "tracker",
  jira: "tracker",
  linear: "tracker",
  confluence: "docs",
  notion: "docs",
  meet: "bridge",
  zoom: "bridge",
};

/** The form testid the smoke suite and the deep links know each family by. */
const TEST_ID: Record<Family, string> = {
  tracker: "tracker-form",
  docs: "docs-form",
  bridge: "bridge-form",
};

/**
 * "Connect" and "Manage" on an integration row (design V2): the dialog of
 * the settings template with the tool's own fields. Connect tests the
 * credentials before storing them; Manage shows who connected it, lets the
 * settings change without retyping the secret, and carries the real
 * gestures of a connection — sync now, disconnect.
 */
const consumedLinks = new Set<string>();

export function ConnectButton({
  kind,
  name,
  connected,
  values,
  connectedAs,
  initialOpen,
}: {
  kind: ConnectKind;
  name: string;
  connected: boolean;
  /** The stored settings, never the secret. */
  values: Record<string, string>;
  connectedAs?: string;
  initialOpen?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  // A deep link opens the dialog once: after a connect, the row moves from
  // Available to Connected and mounts again while the address still carries
  // ?connect= — it must not open a second time.
  const [open, setOpen] = useState(Boolean(initialOpen) && !consumedLinks.has(kind));
  useEffect(() => {
    if (!initialOpen) consumedLinks.delete(kind);
    else if (open) consumedLinks.add(kind);
  }, [initialOpen, kind, open]);
  const [pending, start] = useTransition();
  const family = FAMILY[kind];
  const testId = TEST_ID[family];
  const action =
    family === "tracker" ? connectTracker : family === "docs" ? connectDocs : connectBridge;
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    // A deep link (?connect=github) opened it: closing leaves a clean address.
    if (!v && initialOpen) router.replace(pathname, { scroll: false });
  };
  const act = (run: () => Promise<RowResult>, close: boolean) =>
    start(async () => {
      try {
        const r = await run();
        flash(r.message);
        if (r.ok && close) onOpenChange(false);
      } catch {
        flash(t("settingsV2.error.generic"));
      }
    });

  const field = (
    fieldName: string,
    label: MessageKey,
    opts: {
      mono?: boolean;
      placeholder?: string;
      required?: boolean;
      type?: string;
      help?: string;
    } = {},
  ) => (
    <DialogField label={t(label)} help={opts.help}>
      <input
        name={fieldName}
        type={opts.type ?? "text"}
        required={opts.required ?? true}
        defaultValue={values[fieldName] ?? ""}
        placeholder={opts.placeholder}
        autoComplete="off"
        className="oi-field"
        style={dialogInputStyle(opts.mono ?? true)}
      />
    </DialogField>
  );
  const secret = (label: MessageKey, placeholder?: string) => (
    <DialogField
      label={t(label)}
      help={
        connected
          ? t("settingsV2.int.secretKeep")
          : family === "docs"
            ? t("settings.integrations.docsNote")
            : t("settings.integrations.trackerNote")
      }
    >
      <input
        name="secret"
        type="password"
        required={!connected}
        autoComplete="off"
        placeholder={connected ? "••••••••" : placeholder}
        className="oi-field"
        style={dialogInputStyle(true)}
      />
    </DialogField>
  );

  const fields = (() => {
    switch (kind) {
      case "github":
        return (
          <>
            {field("repo", "settings.integrations.tracker.repo", {
              placeholder: "owner/repository",
            })}
            {secret("settings.integrations.tracker.secret.github", "ghp_…")}
          </>
        );
      case "gitlab":
        return (
          <>
            {field("project", "settings.integrations.tracker.project", {
              placeholder: "group/project",
            })}
            {secret("settings.integrations.tracker.secret.gitlab", "glpat-…")}
          </>
        );
      case "jira":
        return (
          <>
            {field("site", "settings.integrations.tracker.site", {
              placeholder: "acme.atlassian.net",
            })}
            {field("projectKey", "settings.integrations.tracker.projectKey", {
              placeholder: "OPS",
            })}
            {field("email", "settings.integrations.tracker.email", { mono: false, type: "email" })}
            {field("issueType", "settings.integrations.tracker.issueType", {
              mono: false,
              required: false,
              placeholder: "Task",
            })}
            {secret("settings.integrations.tracker.secret.jira")}
          </>
        );
      case "linear":
        return (
          <>
            {field("teamKey", "settings.integrations.tracker.teamKey", { placeholder: "OPS" })}
            {secret("settings.integrations.tracker.secret.linear", "lin_api_…")}
          </>
        );
      case "confluence":
        return (
          <>
            {field("site", "settings.integrations.docs.site", {
              placeholder: "acme.atlassian.net",
            })}
            {field("spaceKey", "settings.integrations.docs.spaceKey", { placeholder: "OPS" })}
            {field("email", "settings.integrations.tracker.email", { mono: false, type: "email" })}
            {field("parentPageId", "settings.integrations.docs.parentPage", { required: false })}
            {secret("settings.integrations.docs.secret.confluence")}
          </>
        );
      case "notion":
        return (
          <>
            {field("parentPageId", "settings.integrations.docs.notionParent", {
              placeholder: "a1b2c3d4-…",
            })}
            {secret("settings.integrations.docs.secret.notion", "secret_…")}
          </>
        );
      case "meet":
      case "zoom":
        return (
          <DialogField
            label={t("settings.integrations.bridgeTemplate")}
            help={t("settings.integrations.bridgeNote")}
          >
            <input
              name="template"
              type="url"
              required
              defaultValue={
                values.template ??
                (kind === "meet" ? "https://meet.google.com/new" : "https://zoom.us/j/")
              }
              className="oi-field"
              style={dialogInputStyle(true)}
            />
          </DialogField>
        );
    }
  })();

  const lead =
    family === "tracker"
      ? t(`settings.integrations.trackerText.${kind}` as MessageKey)
      : family === "docs"
        ? t(`settings.integrations.docsText.${kind}` as MessageKey)
        : t("settings.integrations.bridgeText");

  return (
    <SettingsDialog
      testId={testId}
      submitTestId={family === "tracker" ? "tracker-save" : `${testId}-submit`}
      open={open}
      onOpenChange={onOpenChange}
      title={connected ? name : t("settingsV2.int.connectTitle", { name })}
      lead={connected ? undefined : lead}
      primary={connected ? t("settingsV2.save") : t("settingsV2.int.connect")}
      action={action}
      trigger={(openIt) => (
        <button
          type="button"
          data-testid={`integration-${connected ? "manage" : "connect"}-${kind}`}
          onClick={openIt}
          className="oi-hover"
          style={itemButtonStyle(connected ? "ink" : "brand")}
        >
          {connected ? t("settingsV2.int.manage") : t("settingsV2.int.connect")}
        </button>
      )}
    >
      <input type="hidden" name="kind" value={kind} />
      {connected && connectedAs && (
        <DialogReadOnly label={t("settingsV2.int.connectedAs")}>{connectedAs}</DialogReadOnly>
      )}
      {fields}
      {connected && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {family === "tracker" && (
            <button
              type="button"
              data-testid="tracker-sync"
              disabled={pending}
              onClick={() => act(syncTrackers, false)}
              className="oi-hover"
              style={{ ...itemButtonStyle("ink"), opacity: pending ? 0.6 : 1 }}
            >
              {t("settings.integrations.trackerSyncNow")}
            </button>
          )}
          <button
            type="button"
            data-testid="integration-disconnect"
            disabled={pending}
            onClick={() => act(() => disconnectIntegration(kind), true)}
            className="oi-hover"
            style={{ ...itemButtonStyle("dang"), opacity: pending ? 0.6 : 1 }}
          >
            {t("settingsV2.int.disconnect")}
          </button>
        </div>
      )}
    </SettingsDialog>
  );
}
