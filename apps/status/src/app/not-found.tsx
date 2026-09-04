/** An unknown host renders this, in English on purpose: the page that would set the language is what could not be found. */
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 10px", fontFamily: "var(--font-title)" }}>
          Status page not found
        </h1>
        <p style={{ color: "var(--ink-2)", margin: 0 }}>
          No status page answers on this address. Check the URL, or the custom domain configuration
          of the page.
        </p>
      </div>
    </main>
  );
}
