// waitlist-invite entrypoint. All logic lives in ./app.ts so the deployed function
// ALWAYS serves (no dependency on import.meta.main, which the edge runtime may not set)
// while a test can import the pure helpers + handler from ./app.ts without binding a port.
import { handler } from './app.ts';

Deno.serve(handler);
