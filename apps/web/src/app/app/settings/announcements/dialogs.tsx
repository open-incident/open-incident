"use client";

import { useState, type ReactNode } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogReadOnly,
  DialogToggle,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
  dialogTextareaStyle,
} from "@/components/settings/dialog";
import { flash } from "@/components/settings/controls";
import { Chip, itemButtonStyle, pageActionStyle } from "@/components/settings/template";
import { DeleteIntent } from "../types/delete-intent";
import { saveRule, saveTemplate } from "./actions";

export type RuleValues = {
  id: string;
  n: number;
  sentence: string;
  sub: string;
  active: boolean;
  typeId: string | null;
  minSeverityRank: number | null;
  templateId: string;
};

type RuleChoices = {
  types: Array<{ id: string; name: string }>;
  /** "At severity": the value is the threshold's rank, the label its phrase. */
  severities: Array<{ rank: number; label: string }>;
  templates: Array<{ id: string; name: string }>;
  /** Where every rule posts, in words; null when no announcement channel is set. */
  where: string | null;
};

/** "+ Rule": the dialog on a new rule; a template must exist first. */
export function NewRuleButton(props: RuleChoices) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="rule-open"
        onClick={() =>
          props.templates.length ? setOpen(true) : flash(t("settingsV2.ann.needTemplate"))
        }
        className="oi-hover-brand-2"
        style={pageActionStyle(true)}
      >
        {t("settingsV2.ann.newRule")}
      </button>
      <RuleDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * A rule on the list template — its number, its sentence, where it posts —
 * the whole row opening its dialog, as the design draws it (no button).
 */
export function RuleRow({
  rule,
  canManage,
  ...choices
}: RuleChoices & {
  rule: RuleValues;
  canManage: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const body: ReactNode = (
    <>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          background: "var(--sunk)",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--ink-2)",
          flex: "none",
        }}
      >
        {rule.n}
      </span>
      <div style={{ flex: "1 1 240px", minWidth: 0, textAlign: "left" }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.45 }}>{rule.sentence}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.45 }}>
          {rule.sub}
        </div>
      </div>
      {!rule.active && <Chip>{t("settingsV2.ann.paused")}</Chip>}
    </>
  );
  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 18px",
    borderWidth: "1px 0 0 0",
    borderStyle: "solid",
    borderColor: "var(--line-2)",
    flexWrap: "wrap",
    width: "100%",
    background: "transparent",
    opacity: rule.active ? 1 : 0.6,
    color: "inherit",
    font: "inherit",
  };
  if (!canManage)
    return (
      <div data-testid="rule-row" data-rule={rule.sentence} style={style}>
        {body}
      </div>
    );
  return (
    <>
      <button
        type="button"
        data-testid="rule-row"
        data-rule={rule.sentence}
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{ ...style, cursor: "pointer" }}
      >
        {body}
      </button>
      <RuleDialog {...choices} rule={rule} open={open} onOpenChange={setOpen} />
    </>
  );
}

function RuleDialog({
  rule,
  types,
  severities,
  templates,
  where,
  open,
  onOpenChange,
}: RuleChoices & {
  rule?: RuleValues;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <SettingsDialog
      testId={rule ? "rule-edit-dialog" : "rule-form"}
      title={rule ? t("settingsV2.ann.ruleEdit", { n: rule.n }) : t("settingsV2.ann.ruleNew")}
      primary={rule ? t("settingsV2.save") : t("settingsV2.ann.ruleAdd")}
      action={saveRule}
      open={open}
      onOpenChange={onOpenChange}
    >
      <input type="hidden" name="id" value={rule?.id ?? ""} />
      <DialogReadOnly label={t("settingsV2.ann.when")}>
        {t("settingsV2.ann.whenValue")}
      </DialogReadOnly>
      <DialogField label={t("settingsV2.ann.type")}>
        <select
          name="typeId"
          defaultValue={rule?.typeId ?? ""}
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="">{t("settingsV2.ann.anyType")}</option>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {ty.name}
            </option>
          ))}
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.ann.atSeverity")} help={t("settingsV2.ann.whenHelp")}>
        <select
          name="minSeverityRank"
          defaultValue={
            rule
              ? rule.minSeverityRank === null
                ? ""
                : String(rule.minSeverityRank)
              : severities.some((s) => s.rank === 1)
                ? "1"
                : ""
          }
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="">{t("settingsV2.ann.anySeverity")}</option>
          {severities.map((s) => (
            <option key={s.rank} value={s.rank}>
              {s.label}
            </option>
          ))}
        </select>
      </DialogField>
      <DialogReadOnly label={t("settingsV2.ann.postInLabel")}>
        {where ?? t("settingsV2.ann.postInNone")}
      </DialogReadOnly>
      <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45, marginTop: -7 }}>
        {t("settingsV2.ann.postInHelp")}
      </span>
      <DialogField label={t("settingsV2.ann.template")}>
        <select
          name="templateId"
          required
          defaultValue={rule?.templateId ?? templates[0]?.id}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {templates.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </DialogField>
      {rule && (
        <>
          <DialogToggle
            name="active"
            label={t("settingsV2.ann.active")}
            help={t("settingsV2.ann.activeHelp")}
            defaultChecked={rule.active}
            testId="rule-active"
          />
          <DeleteIntent label={t("settingsV2.ann.ruleDelete")} testId="rule-delete" />
        </>
      )}
    </SettingsDialog>
  );
}

/** "+ Template" and "Edit" on a template: its name and its message. */
export function TemplateDialog({
  template,
  vars,
  usedBy = 0,
}: {
  template?: { id: string; name: string; body: string };
  /** The variables the engine fills, written as they are typed: "{number}, {title}…". */
  vars: string;
  usedBy?: number;
}) {
  const t = useT();
  return (
    <SettingsDialog
      testId={template ? "template-edit-dialog" : "template-form"}
      title={
        template ? t("settingsV2.ann.tplEdit", { name: template.name }) : t("settingsV2.ann.tplNew")
      }
      lead={t("settingsV2.ann.tplLead", { vars })}
      primary={template ? t("settingsV2.save") : t("settingsV2.ann.tplAdd")}
      action={saveTemplate}
      trigger={(open) =>
        template ? (
          <button
            type="button"
            onClick={open}
            data-testid="template-edit"
            className="oi-hover"
            style={itemButtonStyle()}
          >
            {t("settingsV2.edit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={open}
            data-testid="template-open"
            className="oi-hover"
            style={pageActionStyle(false)}
          >
            {t("settingsV2.ann.newTemplate")}
          </button>
        )
      }
    >
      <input type="hidden" name="id" value={template?.id ?? ""} />
      <DialogField label={t("settingsV2.ann.tplName")}>
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={template?.name ?? ""}
          placeholder={t("settingsV2.ann.tplNamePh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField label={t("settingsV2.ann.tplMessage")} help={t("settingsV2.ann.tplMessageHelp")}>
        <textarea
          name="body"
          required
          rows={3}
          maxLength={2000}
          defaultValue={template?.body ?? ""}
          placeholder="{number} — {title} · {severity}"
          className="oi-field"
          style={dialogTextareaStyle}
        />
      </DialogField>
      {template && (
        <DeleteIntent
          label={t("settingsV2.ann.tplDelete")}
          testId="template-delete"
          disabled={usedBy > 0}
          title={usedBy > 0 ? t("settingsV2.ann.tplInUse", { count: usedBy }) : undefined}
        />
      )}
    </SettingsDialog>
  );
}
