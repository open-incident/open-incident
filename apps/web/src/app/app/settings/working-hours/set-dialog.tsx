"use client";

import { useT } from "@/i18n/client";
import {
  DialogField,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
} from "@/components/settings/dialog";
import { pageActionStyle } from "@/components/settings/template";
import { deleteWorkingHours, saveWorkingHours } from "./actions";

export type SetValues = {
  id: string;
  name: string;
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
};

const PRESETS: Array<{ key: string; days: number[]; label: string }> = [
  { key: "mon-fri", days: [1, 2, 3, 4, 5], label: "settingsV2.hours.monFri" },
  { key: "mon-sat", days: [1, 2, 3, 4, 5, 6], label: "settingsV2.hours.monSat" },
  { key: "every-day", days: [1, 2, 3, 4, 5, 6, 7], label: "settingsV2.hours.everyDay" },
  { key: "sat-sun", days: [6, 7], label: "settingsV2.hours.satSun" },
];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

/** "+ New set" and "Edit" — the same five fields; the days as a preset. */
export function SetDialog({
  set,
  timezones,
  defaultTimezone,
}: {
  set?: SetValues;
  timezones: string[];
  defaultTimezone: string;
}) {
  const t = useT();
  const same = (a: number[], b: number[]) =>
    a.length === b.length && [...a].sort().every((d, i) => d === [...b].sort()[i]);
  const preset = set ? PRESETS.find((p) => same(p.days, set.days)) : PRESETS[0];
  const keep = set && !preset ? `keep:${set.days.join(",")}` : null;
  const zones = timezones.includes(set?.timezone ?? defaultTimezone)
    ? timezones
    : [set?.timezone ?? defaultTimezone, ...timezones];
  const withValue = (list: string[], v?: string) =>
    v && !list.includes(v) ? [...list, v].sort() : list;
  return (
    <SettingsDialog
      testId={set ? "hours-edit-dialog" : "hours-new-dialog"}
      title={
        set ? t("settingsV2.hours.editTitle", { name: set.name }) : t("settingsV2.hours.newTitle")
      }
      primary={set ? t("settingsV2.save") : t("settingsV2.hours.create")}
      action={saveWorkingHours}
      trigger={(open) =>
        set ? (
          <button
            type="button"
            onClick={open}
            data-testid="hours-edit"
            className="oi-hover"
            style={{
              height: 28,
              padding: "0 11px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: "var(--panel)",
              color: "var(--ink)",
            }}
          >
            {t("settingsV2.edit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={open}
            data-testid="hours-new"
            className="oi-hover-brand-2"
            style={pageActionStyle(true)}
          >
            {t("settingsV2.hours.new")}
          </button>
        )
      }
    >
      <input type="hidden" name="id" value={set?.id ?? ""} />
      <DialogField label={t("settingsV2.hours.name")}>
        <input
          name="name"
          required
          minLength={2}
          maxLength={60}
          defaultValue={set?.name ?? ""}
          placeholder={t("settingsV2.hours.namePh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField label={t("settingsV2.hours.days")}>
        <select
          name="days"
          defaultValue={keep ?? preset?.key}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {t(p.label as "settingsV2.hours.monFri")}
            </option>
          ))}
          {keep && set && (
            <option value={keep}>
              {t("settingsV2.hours.custom", {
                days: set.days.map((d) => t(`settingsV2.hours.${DAY_KEYS[d - 1]!}`)).join(", "),
              })}
            </option>
          )}
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.hours.from")}>
        <select
          name="startTime"
          defaultValue={set?.startTime ?? "09:00"}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {withValue(TIMES, set?.startTime).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.hours.to")}>
        <select
          name="endTime"
          defaultValue={set?.endTime ?? "18:00"}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {withValue(TIMES, set?.endTime).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.hours.timezone")}>
        <select
          name="timezone"
          defaultValue={set?.timezone ?? defaultTimezone}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
      </DialogField>
    </SettingsDialog>
  );
}

/** Deleting a set nobody reads — confirmed in the same dialog template. */
export function DeleteSetDialog({ id, name }: { id: string; name: string }) {
  const t = useT();
  return (
    <SettingsDialog
      testId="hours-delete-dialog"
      title={`${t("settingsV2.hours.delete")} “${name}”`}
      primary={t("settingsV2.hours.delete")}
      danger
      action={deleteWorkingHours}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          data-testid="hours-delete"
          className="oi-hover-dang"
          style={{
            height: 28,
            padding: "0 11px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            background: "var(--panel)",
            color: "var(--dang)",
          }}
        >
          {t("settingsV2.hours.delete")}
        </button>
      )}
    >
      <input type="hidden" name="id" value={id} />
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("settingsV2.hours.readByNone")}
      </div>
    </SettingsDialog>
  );
}
