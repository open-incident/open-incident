/**
 * Member auth — Better Auth: email + password and Google / Microsoft / GitHub
 * OAuth in the open-source core; SAML/SCIM land in /ee.
 *
 * Sessions are global (`auth` schema, not tenant-scoped): one identity can be
 * a member of several workspaces. Membership is checked on every request via
 * `app.members` (matched on email), on the apps/web side.
 */
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { brandedHtml, brandedText, sendInstanceEmail, type BrandedEmail } from "@openincident/mail";
import {
  authAccounts,
  authDb,
  authSessions,
  authSsoProviders,
  authUsers,
  authVerifications,
} from "@openincident/db";

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  socialProviders.microsoft = {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  };
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

/** Which social buttons a sign-in screen may show — the ones with credentials. */
export const SOCIAL_PROVIDERS = Object.keys(socialProviders) as Array<
  "google" | "microsoft" | "github"
>;

const baseDomain = process.env.BASE_DOMAIN ?? "localhost:3100";
const localDomain = /^localhost(:\d+)?$/.test(baseDomain);

/*
 * Control-plane options, inert when self-hosted:
 * - AUTH_COOKIE_DOMAIN sets the cookie on the parent domain (.BASE_DOMAIN).
 * - REQUIRE_EMAIL_VERIFICATION=true blocks password sign-in as long as the
 *   email is not verified (an OAuth sign-up is verified by default).
 *
 * Sending the confirmation and *gating* on it are two different decisions.
 * SEND_EMAIL_VERIFICATION=true asks for the mail without the gate;
 * REQUIRE_EMAIL_VERIFICATION=true implies it — a gate with no mail would lock
 * the account out for good. EMAIL_VERIFICATION_DEADLINE_DAYS, when set, is
 * named in the mail: a deadline nobody was told about is a trap.
 */
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN;
const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
const sendEmailVerification =
  requireEmailVerification || process.env.SEND_EMAIL_VERIFICATION === "true";
const verificationDeadlineDays = Number(process.env.EMAIL_VERIFICATION_DEADLINE_DAYS ?? "");

/** The workspace host the request came in on — where every link must land. */
function originOf(request: Request | undefined): string {
  const host = request?.headers.get("host") ?? baseDomain;
  const proto =
    request?.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.endsWith(".localhost") || /localhost:\d+$/.test(host)
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

/**
 * Builds the auth instance. `plugins` is the seam for the enterprise edition:
 * apps/web adds the SSO plugin there; this package's own `auth` (used by the
 * seed and the tests) carries the core only.
 *
 * `baseURL` is fixed only when BETTER_AUTH_URL says so. Left unset, Better Auth
 * derives it from each request, so an OAuth or SSO callback lands on the
 * workspace host that started the flow — with one cookie domain per workspace,
 * a fixed apex would set the session where nobody reads it.
 */
export function createAuth(extra: { plugins?: BetterAuthPlugin[] } = {}) {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
    baseURL: process.env.BETTER_AUTH_URL ?? {
      // Derived from each request, checked against the workspace hosts.
      allowedHosts: [baseDomain, `*.${baseDomain}`],
      protocol: localDomain ? "http" : "https",
      fallback: `${localDomain ? "http" : "https"}://${baseDomain}`,
    },
    plugins: extra.plugins ?? [],
    // Every workspace lives on its own subdomain: {slug}.BASE_DOMAIN.
    trustedOrigins: [
      `http://${baseDomain}`,
      `http://*.${baseDomain}`,
      `https://${baseDomain}`,
      `https://*.${baseDomain}`,
      // An identity provider on a private address (an internal Keycloak, the
      // smoke suite's mock): the SSO plugin refuses non-public hosts unless
      // their origin is trusted here. Comma-separated origins.
      ...(process.env.SSO_TRUSTED_IDP_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ],
    database: drizzleAdapter(authDb, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        ssoProvider: authSsoProviders,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      resetPasswordTokenExpiresIn: 3600,
      // A reset is the recovery move after a possible compromise: cut every other
      // session so a lurking one cannot outlive the new password.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }, request) => {
        // The link must land on the workspace that asked, not on the apex: the
        // token is the same value /reset-password consumes.
        const url = `${originOf(request)}/reset-password?token=${token}`;
        const mail: BrandedEmail = {
          title: "Reset your password",
          intro: [
            "Someone asked to reset the password of your Open Incident account.",
            "The link below expires in one hour. If you did not ask for this, ignore this email — your password stays unchanged.",
          ],
          button: { label: "Choose a new password", url },
          signature: "Open Incident",
        };
        await sendInstanceEmail({
          to: user.email,
          // Sent from a package: no access to the workspace dictionaries — English only.
          subject: "Reset your password",
          text: brandedText(mail),
          html: brandedHtml(mail),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: sendEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }, request) => {
        const deadline =
          Number.isFinite(verificationDeadlineDays) && verificationDeadlineDays > 0
            ? `Confirm within ${verificationDeadlineDays} days, or access will be suspended until you do.`
            : "";
        // Where the link LANDS once confirmed: the sign-in page of the workspace
        // the request came from, never Better Auth's default (the apex).
        const withCallback = (() => {
          try {
            const link = new URL(url);
            link.searchParams.set("callbackURL", `${originOf(request)}/login?verified=1`);
            return link.toString();
          } catch {
            return url;
          }
        })();
        const mail: BrandedEmail = {
          title: "Confirm your email address",
          intro: [
            "One click and your Open Incident account is confirmed — it tells us this mailbox is really yours, the one your pages and notifications will reach.",
            ...(deadline ? [deadline] : []),
          ],
          button: { label: "Confirm my address", url: withCallback },
          footnote:
            "If you did not create an Open Incident account, ignore this email — nothing will happen.",
          signature: "Open Incident",
        };
        await sendInstanceEmail({
          to: user.email,
          subject: "Confirm your email address",
          text: brandedText(mail),
          html: brandedHtml(mail),
        });
      },
    },
    user: {
      /*
       * Changing one's address and deleting one's account are part of a complete
       * sign-in story, not extras. Both are confirmed by a link sent to the
       * address on file: the new address is only trusted once the OLD one agreed,
       * and a deletion is only carried out once the mailbox that owns the account
       * clicked.
       */
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }, request) => {
          const withCallback = (() => {
            try {
              const link = new URL(url);
              link.searchParams.set("callbackURL", `${originOf(request)}/account?email=changed`);
              return link.toString();
            } catch {
              return url;
            }
          })();
          const mail: BrandedEmail = {
            title: "Confirm your new email address",
            intro: [
              `A request was made to change the email address of your Open Incident account to ${newEmail}.`,
              "Confirm it below, from this mailbox — the one currently attached to the account. If you did not ask for this, ignore this email and your address stays as it is.",
            ],
            button: { label: "Confirm the change", url: withCallback },
            signature: "Open Incident",
          };
          await sendInstanceEmail({
            to: user.email,
            subject: "Confirm your new email address",
            text: brandedText(mail),
            html: brandedHtml(mail),
          });
        },
      },
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }, request) => {
          const withCallback = (() => {
            try {
              const link = new URL(url);
              link.searchParams.set("callbackURL", `${originOf(request)}/login?deleted=1`);
              return link.toString();
            } catch {
              return url;
            }
          })();
          const mail: BrandedEmail = {
            title: "Confirm the deletion of your account",
            intro: [
              "You asked to delete your Open Incident account. This removes your sign-in identity; what you did in your workspaces stays attributed to your name in their timelines, as the audit trail requires.",
              "The link below expires in one hour. If you did not ask for this, ignore this email.",
            ],
            button: { label: "Delete my account", url: withCallback },
            signature: "Open Incident",
          };
          await sendInstanceEmail({
            to: user.email,
            subject: "Confirm the deletion of your account",
            text: brandedText(mail),
            html: brandedHtml(mail),
          });
        },
      },
    },
    ...(cookieDomain
      ? {
          advanced: {
            crossSubDomainCookies: { enabled: true, domain: cookieDomain },
          },
        }
      : {}),
    socialProviders,
  });
}

export const auth = createAuth();

export type AuthSession = typeof auth.$Infer.Session;
