/**
 * Creates the Better Auth identities of the members of the demo workspace
 * (Skylark Systems). Shared demo password: "demo-openincident" — development only.
 * Usage: pnpm db:seed:auth (after pnpm db:seed).
 */
import { DEMO_MEMBERS, DEMO_PASSWORD } from "@openincident/db";
import { auth } from "./index";

for (const member of DEMO_MEMBERS) {
  try {
    await auth.api.signUpEmail({
      body: { name: member.name, email: member.email, password: DEMO_PASSWORD },
    });
    console.log(`OK  ${member.email}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Better Auth answers 422 USER_ALREADY_EXISTS on a replay; anything else is a real error.
    if (/already exists/i.test(message)) {
      console.log(`already there  ${member.email}`);
    } else {
      throw err;
    }
  }
}

console.log(`\nDemo sign-in: <member>@skylark.dev / ${DEMO_PASSWORD}`);
process.exit(0);
