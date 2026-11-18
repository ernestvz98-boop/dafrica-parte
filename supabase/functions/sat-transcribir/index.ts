import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DAFRICA SAT: transcripción del audio del técnico. Lógica y documentación en handler.mjs.
import {handler} from "./handler.mjs";
Deno.serve((req: Request) => handler(req, {env: (k: string) => Deno.env.get(k)}));
