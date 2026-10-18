import Link from "next/link";
import { getT } from "@/i18n/server";
import { firstName } from "@/i18n/format";
import { isManager, requireMember } from "@/lib/session";
import { ListCard, SettingsPage, type Tone } from "@/components/settings/template";
import { PREVIEW_LAST, loadRulesScreen } from "./data";
import { FlashOnMount } from "./flash-on-mount";
import { dialogValues, severityOptions, thenOptions, thenParts, whenSentence } from "./model";
import { PreviewButton } from "./preview-button";
import { RulesList, type RuleItem } from "./rules-list";
import { RuleDialog, type RuleDialogData } from "./rule-dialog";

/**
 * Settings › Rules (design V2): the exceptions to what each source already
 * does, in the order they are tried — each one a sentence, what it does under
 * it, how many alerts it decided this week. New and simple rules are written
 * in the design's dialog; a rule that says more opens its own page with the
 * full editor ("More options…").
 *
 * Only rules are listed — routes with a condition or a chosen source, the
 * pipeline's own test. The shared fallback every source's three choices are
 * laid over is not a rule; the card's foot leads to it.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManager(member);
  const data = await loadRulesScreen(tenant.id);
  const { refs } = data;

  const items: RuleItem[] = data.rules.map((r) => {
    const parts = thenParts(r, refs, t);
    const count = data.counts[r.id] ?? 0;
    const creator = data.creators[r.id];
    const chips: RuleItem["chips"] = [];
    if (!r.active) chips.push({ label: t("settingsV2.rules.off"), tone: "mute" as Tone });
    else if (r.testMode) chips.push({ label: t("settingsV2.rules.testMode"), tone: "mute" });
    return {
      id: r.id,
      name: r.name,
      title: whenSentence(r, refs, t),
      parts,
      right:
        count > 0
          ? t("settingsV2.rules.alerts7d", { count })
          : creator
            ? t("settingsV2.rules.addedBy", {
                name: firstName(creator.name),
                date: t.fmt.dayMonth(creator.at, t.timeZone),
              })
            : t("settingsV2.rules.none7d"),
      chips,
      muted: !r.active,
      dialog: dialogValues(r, refs),
      keepNote: parts.length > 1 ? parts.map((p) => p.text).join(" · ") : null,
    };
  });

  const dialog: RuleDialogData = {
    sources: refs.sources.map((s) => ({ value: s.id, label: s.name })),
    severities: severityOptions(refs, t),
    thens: thenOptions(refs, t),
  };

  const flashed = q.deleted
    ? t("settingsV2.rules.deleted")
    : q.saved
      ? t("settingsV2.saved")
      : null;

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.alerts")}
      title={t("settingsV2.entry.rules")}
      lead={t("settingsV2.rules.lead")}
      testId="settings-rules"
      actions={
        manages ? (
          <>
            <PreviewButton label={t("settingsV2.rules.preview", { count: PREVIEW_LAST })} />
            <RuleDialog data={dialog} />
          </>
        ) : undefined
      }
    >
      {flashed && <FlashOnMount message={flashed} />}
      <ListCard
        testId="rules-card"
        title={t("settingsV2.rules.listTitle", { count: items.length })}
        foot={
          <>
            {t("settingsV2.rules.foot")}
            {data.fallback && manages && (
              <>
                {" "}
                <Link
                  href={`/app/settings/rules/${data.fallback.id}`}
                  data-testid="rules-defaults"
                  className="oi-hover-edge-ink"
                  style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
                >
                  {t("settingsV2.rules.defaultsLink")} →
                </Link>
              </>
            )}
          </>
        }
      >
        {items.length === 0 ? (
          <div
            data-testid="rules-empty"
            style={{
              padding: "14px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            {t("settingsV2.rules.empty")}
          </div>
        ) : (
          <RulesList items={items} manages={manages} dialog={dialog} />
        )}
      </ListCard>
    </SettingsPage>
  );
}
