import { servicesOverview } from "../src/services";
async function main() {
  const rows = await servicesOverview(process.env.TENANT_ID!, 60);
  for (const r of rows.slice(0, 8))
    console.log(
      r.service.padEnd(24),
      r.rps.toFixed(2).padStart(7),
      (r.errorRate * 100).toFixed(1).padStart(5) + "%",
      r.p99Ms.toFixed(0).padStart(7) + "ms",
      r.latency.length + " pts",
    );
  console.log(rows.length, "services");
}
main().then(() => process.exit(0));
