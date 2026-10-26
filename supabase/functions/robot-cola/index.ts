import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Puerta del robot de STEL a la cola de albaranes: ver handler.mjs.
import {handler} from "./handler.mjs";
Deno.serve((req:Request)=>handler(req,{env:(k:string)=>Deno.env.get(k)}));
