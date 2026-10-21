import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Consulta de SOLO LECTURA de albaranes de compra de STEL: ver handler.mjs.
import {handler} from "./handler.mjs";
Deno.serve((req:Request)=>handler(req,{env:(k:string)=>Deno.env.get(k)}));
