import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DAFRICA SAT: única puerta de la aplicación de partes a STEL Order. Lógica y documentación en handler.mjs.
import {handler} from "./handler.mjs";
Deno.serve((req: Request) => handler(req, {env: (k: string) => Deno.env.get(k)}));
