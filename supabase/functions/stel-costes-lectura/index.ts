import { handler } from './handler.mjs';
Deno.serve((req: Request) => handler(req, { env: (key: string) => Deno.env.get(key) }));
