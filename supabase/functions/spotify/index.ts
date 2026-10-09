// spotify entrypoint. All logic lives in ./app.ts so the deployed function ALWAYS serves
// (no dependency on import.meta.main, which the edge runtime may not set) while
// index.test.ts imports the handler and helpers from ./app.ts without binding a port.
import { handler } from './app.ts';

Deno.serve(handler);
