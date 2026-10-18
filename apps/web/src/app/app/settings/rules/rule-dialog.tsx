"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
} from "@/components/settings/dialog";
import { itemButtonStyle, pageActionStyle } from "@/components/settings/template";
import { saveRuleFromDialog } from "./actions";
import type { DialogValues, Option } from "./model";

export type RuleDialogData = {
  sources: Option[];
  severities: Option[];
  thens: Option[];
};

/**
 * The design's "New rule" / "Edit rule n": if source is, and severity is, and
 * label, then. What the four fields cannot say waits behind "More options…",
 * the rule's own page with the full editor.
 */
export function RuleDialog({
  data,
  edit,
}: {
  data: RuleDialogData;
  /** Absent for a new rule. */
  edit?: { id: string; n: number; values: DialogValues; keepNote: string | null };
}) {
  const t = useT();
  const v = edit?.values;
  // A stored value the generic lists do not offer still opens selected.
  const withValue = (opts: Option[], value: string | undefined, label: string): Option[] =>
    value && !opts.some((o) => o.value === value) ? [...opts, { value, label }] : opts;
  const severities = withValue(data.severities, v?.severity, v?.severity.replace(/^in:/, "") ?? "");
  return (
    <SettingsDialog
      testId={edit ? "rule-edit-dialog" : "rule-new-dialog"}
      title={edit ? t("settingsV2.rules.editTitle", { n: edit.n }) : t("settingsV2.rules.newTitle")}
      lead={t("settingsV2.rules.dialogLead")}
      primary={edit ? t("settingsV2.save") : t("settingsV2.rules.addAtEnd")}
      action={saveRuleFromDialog}
      trigger={(open) =>
        edit ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            data-testid="rule-edit"
            className="oi-hover"
            style={itemButtonStyle()}
          >
            {t("settingsV2.edit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={open}
            data-testid="rule-new"
            className="oi-hover-brand-2"
            style={pageActionStyle(true)}
          >
            {t("settingsV2.rules.new")}
          </button>
        )
      }
    >
      <input type="hidden" name="id" value={edit?.id ?? ""} />
      <input type="hidden" name="thenWas" value={v?.then ?? ""} />
      <DialogField label={t("settingsV2.rules.f.source")}>
        <select
          name="source"
          defaultValue={v?.source ?? ""}
          data-testid="rule-source"
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="">{t("settingsV2.rules.o.anySource")}</option>
          {data.sources.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.rules.f.severity")}>
        <select
          name="severity"
          defaultValue={v?.severity ?? "any"}
          data-testid="rule-severity"
          className="oi-field"
          style={dialogSelectStyle}
        >
          {severities.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.rules.f.label")} help={t("settingsV2.rules.f.labelHelp")}>
        <input
          name="label"
          defaultValue={v?.label ?? ""}
          placeholder={t("settingsV2.rules.f.labelPh")}
          maxLength={400}
          data-testid="rule-label"
          className="oi-field"
          style={dialogInputStyle(true)}
        />
      </DialogField>
      <DialogField
        label={t("settingsV2.rules.f.then")}
        help={edit?.keepNote ? t("settingsV2.rules.f.thenKeep", { now: edit.keepNote }) : undefined}
      >
        <select
          name="then"
          defaultValue={v?.then ?? data.thens[0]?.value}
          data-testid="rule-then"
          className="oi-field"
          style={dialogSelectStyle}
        >
          {data.thens.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </DialogField>
      <MoreOptions href={edit ? `/app/settings/rules/${edit.id}` : "/app/settings/rules/new"}>
        {t("settingsV2.rules.moreOptions")}
      </MoreOptions>
    </SettingsDialog>
  );
}

function MoreOptions({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      data-testid="rule-more"
      className="oi-hover-edge-ink"
      style={{
        alignSelf: "flex-start",
        fontSize: 12.5,
        fontWeight: 600,
        color: "var(--brand)",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}
