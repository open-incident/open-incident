import { getTenantFromHeaders } from "@/lib/tenant";
import { WORKSPACE_NOT_FOUND } from "@/lib/workspace-not-found";

/**
 * The 404 of the product, for the two things a 404 can mean here: a subdomain
 * that matches no workspace (through `requireTenant()`), and a page missing
 * inside a real workspace. Styles are literal rather than themed on purpose —
 * the workspace is precisely what may be missing, so there is no branding to
 * honour, and no language either.
 */
export default async function NotFound() {
  const tenant = await getTenantFromHeaders().catch(() => null);
  const signupUrl = process.env.SIGNUP_URL;

  return (
    <main
      style={{
        margin: 0,
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#F3F5F6",
        color: "#0D161C",
      }}
    >
      <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>
          {tenant ? "Page not found" : WORKSPACE_NOT_FOUND.title}
        </h1>
        <p style={{ fontSize: 14, color: "#515F66", margin: "0 0 18px" }}>
          {tenant
            ? "The address is correct, but there is nothing at it any more."
            : WORKSPACE_NOT_FOUND.body}
        </p>
        {!tenant && signupUrl && (
          <a
            href={signupUrl}
            style={{
              display: "inline-block",
              background: "#0B4A6F",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
              padding: "10px 18px",
              borderRadius: 9,
            }}
          >
            {WORKSPACE_NOT_FOUND.cta}
          </a>
        )}
      </div>
    </main>
  );
}
