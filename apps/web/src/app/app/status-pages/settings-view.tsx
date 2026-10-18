import Link from "next/link";
import type { statusPageTemplates, statusPages } from "@openincident/db";
import { statusPageUrl } from "@openincident/statuspages";
import { getT } from "@/i18n/server";
import {
  deleteStatusPage,
  deleteTemplate,
  importSubscribers,
  saveCustomDomain,
  saveStatusPage,
  saveTemplate,
} from "./actions";

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 9,
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const label: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  outline: "none",
  fontSize: 12.5,
  background: "var(--panel)",
  width: "100%",
};
const saveBtn: React.CSSProperties = {
  height: 30,
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

/**
 * One page's settings, at `?tab=settings`: what it looks like and says
 * (brand, language, the wording of its updates), where it answers (domain),
 * who reads it (visibility, imported subscribers) — everything the status
 * screen itself keeps out of the way of the components and the incidents.
 */
export async function SettingsView({
  page,
  templates,
  manages,
  isOwner,
  notices,
}: {
  page: typeof statusPages.$inferSelect;
  templates: Array<typeof statusPageTemplates.$inferSelect>;
  manages: boolean;
  isOwner: boolean;
  notices: Record<string, string | undefined>;
}) {
  const t = await getT();
  const localeName = (l: string) => t(`statusPages.locale.${l as "en" | "fr" | "de"}`);
  const host = new URL(statusPageUrl(page)).host;
  const target = `status.${(process.env.BASE_DOMAIN ?? "localhost").split(":")[0]}`;
  const notice = (text: string, ok = true) => (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: ok ? "var(--ok-t)" : "var(--note)",
        border: `1px solid ${ok ? "var(--ok)" : "var(--note-b)"}`,
        borderRadius: "var(--radius-card)",
        padding: "10px 14px",
        fontSize: 12.5,
        color: "var(--ink-2)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: ok ? "var(--ok)" : "var(--note-ink)",
          flex: "none",
        }}
      />
      {text}
    </div>
  );
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "oi-rise .18s ease backwards",
      }}
    >
      <Link
        href={`/app/status-pages?page=${page.id}`}
        className="oi-link"
        style={{ fontSize: 12.5, color: "var(--ink-3)", width: "fit-content" }}
      >
        {t("alst.sp.back")}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {page.name}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("sp2.settings")}</span>
        <span style={{ flex: 1 }} />
        {notices.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {notices.error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {notices.error === "owner"
              ? t("statusPages.errorOwner")
              : t("settings.fields.errorInvalid")}
          </span>
        )}
      </div>
      {notices.imported !== undefined &&
        notice(t("statusPages.imported", { count: Number(notices.imported) }))}
      {notices.domain &&
        notice(
          notices.domain === "verified"
            ? t("statusPages.domainOk")
            : notices.domain === "pending"
              ? t("statusPages.domainNotYet", { target })
              : t("statusPages.domainCleared"),
          notices.domain === "verified" || notices.domain === "cleared",
        )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <form action={saveStatusPage} style={card} data-testid="brand-form">
            <input type="hidden" name="id" value={page.id} />
            <div style={eyebrow}>{t("statusPages.brand")}</div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={label}>{t("oncall.name")}</span>
              <input
                name="name"
                defaultValue={page.name}
                required
                className="oi-field"
                style={control}
                readOnly={!manages}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>{t("statusPages.accent")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 5,
                      background: page.accentColor,
                      flex: "none",
                    }}
                  />
                  <input
                    name="accentColor"
                    defaultValue={page.accentColor}
                    pattern="#[0-9a-fA-F]{6}"
                    className="oi-field"
                    style={{ ...control, fontFamily: "var(--mono)", fontSize: 12 }}
                    readOnly={!manages}
                  />
                </div>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>{t("statusPages.language")}</span>
                <select
                  name="locale"
                  defaultValue={page.locale}
                  className="oi-field"
                  style={control}
                  disabled={!manages}
                >
                  {(["en", "fr", "de"] as const).map((l) => (
                    <option key={l} value={l}>
                      {localeName(l)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={label}>{t("statusPages.threshold")}</span>
              <select
                name="minSeverityRank"
                defaultValue={String(page.minSeverityRank)}
                className="oi-field"
                style={control}
                disabled={!manages}
              >
                {[0, 1, 2, 3].map((r) => (
                  <option key={r} value={r}>
                    {t("statusPages.thresholdOption", { severity: `SEV${r + 1}` })}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("statusPages.visibility")}</span>
              <select
                name="visibility"
                defaultValue={page.visibility}
                disabled={!manages}
                data-testid="status-visibility"
                className="oi-field"
                style={control}
              >
                <option value="public">{t("statusPages.visibilityPublic")}</option>
                <option value="internal">{t("statusPages.visibilityInternal")}</option>
              </select>
              <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {t("statusPages.visibilityHint")}
              </span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--ink-2)",
              }}
            >
              <input
                type="checkbox"
                name="noindex"
                defaultChecked={page.noindex}
                disabled={!manages}
              />{" "}
              {t("statusPages.noindex")}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                name="privacyUrl"
                type="url"
                defaultValue={page.privacyUrl ?? ""}
                placeholder={t("statusPages.privacyUrl")}
                className="oi-field"
                style={{ ...control, fontSize: 11.5 }}
                readOnly={!manages}
              />
              <input
                name="legalUrl"
                type="url"
                defaultValue={page.legalUrl ?? ""}
                placeholder={t("statusPages.legalUrl")}
                className="oi-field"
                style={{ ...control, fontSize: 11.5 }}
                readOnly={!manages}
              />
            </div>
            <input
              name="replyTo"
              type="email"
              defaultValue={page.replyTo ?? ""}
              placeholder={t("statusPages.replyTo")}
              className="oi-field"
              style={{ ...control, fontSize: 11.5 }}
              readOnly={!manages}
            />
            {manages && (
              <button type="submit" className="oi-hover" style={saveBtn}>
                {t("common.save")}
              </button>
            )}
          </form>

          <form action={saveCustomDomain} style={card} data-testid="domain-form">
            <input type="hidden" name="id" value={page.id} />
            <div style={eyebrow}>{t("statusPages.domain")}</div>
            <Row k={t("statusPages.address")}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>{host}</span>
            </Row>
            <Row k={t("statusPages.customDomain")}>
              {page.customDomain ? (
                <span style={{ color: page.customDomainVerifiedAt ? "var(--ok)" : "var(--wait)" }}>
                  {page.customDomainVerifiedAt
                    ? t("statusPages.verifiedTls")
                    : t("statusPages.pendingDns")}
                </span>
              ) : (
                "—"
              )}
            </Row>
            <input
              name="customDomain"
              defaultValue={page.customDomain ?? ""}
              placeholder="status.example.com"
              className="oi-field"
              style={{ ...control, fontFamily: "var(--mono)", fontSize: 12 }}
              readOnly={!manages}
            />
            <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("statusPages.domainNote", { target })}
            </div>
            <Row k={t("statusPages.indexing")}>
              {page.noindex ? t("statusPages.noindexBefore") : t("statusPages.indexed")}
            </Row>
            {manages && (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="oi-hover" style={{ ...saveBtn, flex: 1 }}>
                  {t("statusPages.verifyDomain")}
                </button>
                <button
                  type="submit"
                  formAction={deleteStatusPage}
                  formNoValidate
                  data-testid="page-delete"
                  className="oi-hover-dang"
                  style={{ ...saveBtn, padding: "0 10px", color: "var(--dang)" }}
                >
                  {t("statusPages.deletePage")}
                </button>
              </div>
            )}
          </form>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={card}>
            <div style={eyebrow}>{t("statusPages.templates")}</div>
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                data-testid="template-row"
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    flex: "none",
                    background:
                      tpl.status === "resolved"
                        ? "var(--ok)"
                        : tpl.status === "monitoring"
                          ? "var(--wait)"
                          : tpl.status === "identified"
                            ? "var(--viol)"
                            : "var(--dang)",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={tpl.body}
                >
                  {tpl.name}
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {tpl.approved ? t("statusPages.approved") : t("statusPages.draft")}
                </span>
                {manages && (
                  <form action={deleteTemplate}>
                    <input type="hidden" name="id" value={tpl.id} />
                    <button
                      type="submit"
                      aria-label={t("common.delete")}
                      className="oi-hover-dang"
                      style={{
                        width: 22,
                        height: 22,
                        border: 0,
                        borderRadius: 6,
                        background: "transparent",
                        color: "var(--ink-3)",
                        cursor: "pointer",
                        fontSize: 11,
                      }}
                    >
                      ✕
                    </button>
                  </form>
                )}
              </div>
            ))}
            {manages && (
              <form
                action={saveTemplate}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  borderTop: "1px solid var(--line-2)",
                  paddingTop: 9,
                }}
              >
                <input type="hidden" name="pageId" value={page.id} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 6 }}>
                  <input
                    name="name"
                    required
                    placeholder={t("statusPages.templateName")}
                    className="oi-field"
                    style={control}
                  />
                  <select
                    name="status"
                    defaultValue="investigating"
                    className="oi-field"
                    style={control}
                  >
                    {(["investigating", "identified", "monitoring", "resolved"] as const).map(
                      (s) => (
                        <option key={s} value={s}>
                          {t(`statusPages.publicStatus.${s}`)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <textarea
                  name="body"
                  required
                  rows={2}
                  placeholder={t("statusPages.templateBody")}
                  className="oi-field"
                  style={{ ...control, height: "auto", padding: "8px 10px", resize: "vertical" }}
                />
                <button type="submit" className="oi-hover" style={saveBtn}>
                  {t("statusPages.addTemplate")}
                </button>
              </form>
            )}
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("statusPages.templatesNote")}
            </div>
          </section>

          {isOwner && page.visibility === "public" && (
            <form action={importSubscribers} style={card} data-testid="import-form">
              <input type="hidden" name="pageId" value={page.id} />
              <div style={eyebrow}>{t("statusPages.subscribers")}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {t("alst.sp.importHint")}
              </div>
              <input
                name="file"
                type="file"
                accept=".csv,text/csv,text/plain"
                className="oi-field"
                style={{ fontSize: 11.5 }}
              />
              <button type="submit" className="oi-hover" style={saveBtn}>
                {t("statusPages.importCsv")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
