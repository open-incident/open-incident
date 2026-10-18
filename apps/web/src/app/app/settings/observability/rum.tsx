"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogToggle,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
  dialogTextareaStyle,
} from "@/components/settings/dialog";
import { flash } from "@/components/settings/controls";
import { itemButtonStyle, listActionStyle } from "@/components/settings/template";
import { ClickRow } from "../api/click-row";
import { createRumApp, deleteRumApp, saveRumApp } from "./actions";

const RATES = ["1", "0.5", "0.2", "0.1", "0.01"];

function pct(rate: number | string): string {
  return `${Math.round(Number(rate) * 100)} %`;
}

/** "+ Application": name, origins, sample rate — the snippet comes back once created. */
export function NewRumDialog() {
  const t = useT();
  return (
    <SettingsDialog
      testId="rum-dialog"
      title={t("settingsV2.tel.rumNew")}
      lead={t("settingsV2.tel.rumNewLead")}
      primary={t("settingsV2.tel.rumCreate")}
      action={createRumApp}
      trigger={(open) => (
        <button
          type="button"
          data-testid="rum-add"
          onClick={open}
          className="oi-hover"
          style={listActionStyle}
        >
          {t("settingsV2.tel.rumAdd")}
        </button>
      )}
    >
      <DialogField label={t("settingsV2.tel.rumName")}>
        <input
          name="name"
          required
          maxLength={120}
          autoFocus
          placeholder="storefront-web"
          className="oi-field"
          style={dialogInputStyle(true)}
        />
      </DialogField>
      <DialogField label={t("settingsV2.tel.rumOrigins")} help={t("settingsV2.tel.rumOriginsHelp")}>
        <input
          name="origins"
          required
          placeholder="https://shop.example.com, https://www.example.com"
          className="oi-field"
          style={dialogInputStyle(true)}
        />
      </DialogField>
      <DialogField label={t("settingsV2.tel.rumSample")}>
        <select name="sampleRate" defaultValue="1" className="oi-field" style={dialogSelectStyle}>
          {RATES.map((r) => (
            <option key={r} value={r}>
              {t("settingsV2.tel.rumRate", { pct: pct(r) })}
            </option>
          ))}
        </select>
      </DialogField>
    </SettingsDialog>
  );
}

export type RumRowData = {
  id: string;
  name: string;
  sub: string;
  right: string;
  origins: string;
  sampleRate: number;
  replayEnabled: boolean;
  replaySampleRate: number;
  replayUnmask: string;
  mobileEnabled: boolean;
};

/** A browser application; clicking it opens its switches, Delete among them. */
export function RumRow({ app, manages }: { app: RumRowData; manages: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const rates = RATES.includes(String(app.sampleRate)) ? RATES : [String(app.sampleRate), ...RATES];
  return (
    <>
      <ClickRow
        testId="rum-row"
        data={{ app: app.name }}
        title={app.name}
        titleMono
        sub={app.sub}
        right={app.right}
        onOpen={manages ? () => setOpen(true) : undefined}
      />
      {manages && (
        <SettingsDialog
          testId="rum-manage"
          open={open}
          onOpenChange={setOpen}
          title={app.name}
          primary={t("settingsV2.save")}
          action={saveRumApp}
        >
          <input type="hidden" name="id" value={app.id} />
          <DialogField
            label={t("settingsV2.tel.rumOrigins")}
            help={t("settingsV2.tel.rumOriginsHelp")}
          >
            <input
              name="origins"
              required
              defaultValue={app.origins}
              className="oi-field"
              style={dialogInputStyle(true)}
            />
          </DialogField>
          <DialogField label={t("settingsV2.tel.rumSample")}>
            <select
              name="sampleRate"
              defaultValue={String(app.sampleRate)}
              className="oi-field"
              style={dialogSelectStyle}
            >
              {rates.map((r) => (
                <option key={r} value={r}>
                  {t("settingsV2.tel.rumRate", { pct: pct(r) })}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogToggle
            name="replayEnabled"
            label={t("settingsV2.tel.rumReplay")}
            help={t("settingsV2.tel.rumReplayHelp")}
            defaultChecked={app.replayEnabled}
            testId="replay-enabled"
          />
          <DialogField label={t("settingsV2.tel.rumReplayRate")}>
            <select
              name="replaySampleRate"
              defaultValue={String(app.replaySampleRate)}
              className="oi-field"
              style={dialogSelectStyle}
            >
              {(["1", "0.5", "0.2", "0.1", "0.05", "0.01"].includes(String(app.replaySampleRate))
                ? ["1", "0.5", "0.2", "0.1", "0.05", "0.01"]
                : [String(app.replaySampleRate), "1", "0.5", "0.2", "0.1", "0.05", "0.01"]
              ).map((r) => (
                <option key={r} value={r}>
                  {t("settingsV2.tel.rumReplayOf", { pct: pct(r) })}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField
            label={t("settingsV2.tel.rumUnmask")}
            help={t("settingsV2.tel.rumUnmaskHelp")}
          >
            <textarea
              name="replayUnmask"
              rows={2}
              defaultValue={app.replayUnmask}
              placeholder=".order-total, [data-public]"
              style={{ ...dialogTextareaStyle, fontFamily: "var(--mono)", fontSize: 12 }}
            />
          </DialogField>
          <DialogToggle
            name="mobileEnabled"
            label={t("settingsV2.tel.rumMobile")}
            help={t("settingsV2.tel.rumMobileHelp")}
            defaultChecked={app.mobileEnabled}
            testId="mobile-enabled"
          />
          <div style={{ display: "flex" }}>
            <button
              type="button"
              data-testid="rum-delete"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteRumApp(app.id);
                  flash(r.message);
                  if (r.ok) setOpen(false);
                })
              }
              className="oi-hover"
              style={{ ...itemButtonStyle("dang"), opacity: pending ? 0.6 : 1 }}
            >
              {t("settingsV2.tel.rumDelete")}
            </button>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}
