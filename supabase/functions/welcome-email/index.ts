// welcome-email entrypoint. All logic lives in ./app.ts so the deployed function ALWAYS
// serves (no dependency on import.meta.main, which the edge runtime may not set) while
// index.test.ts imports the pure helpers and `handler` from ./app.ts without binding a
// port.
//
// Deployed with verify_jwt TRUE (the default, and what send-push and waitlist-invite
// use). The caller IS the recipient — read the contract at the top of app.ts before
// changing that.
import { handler } from './app.ts';

Deno.serve(handler);
