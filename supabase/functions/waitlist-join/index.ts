// waitlist-join entrypoint. Logic lives in ./app.ts so the deployed function always
// serves and a test can import the pure helpers without binding a port.
//
// NOTE: this function is deployed with verify_jwt FALSE — the only one in the project.
// See the abuse model at the top of app.ts before changing anything here.
import { handler } from './app.ts';

Deno.serve(handler);
