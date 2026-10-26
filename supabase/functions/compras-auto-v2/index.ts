import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DAFRICA · compras-auto-v2 BLOQUEADA (2026-10-26, revisión de seguridad autorizada por el usuario).
// Era la carga antigua de documentos de compra: guardaba el PDF y creaba un registro en
// coste_documentos. La web ya no la usa. Responde siempre 410 y no lee, gasta ni escribe nada.
// Código anterior en respaldo-v4.ts.
const cors={"Access-Control-Allow-Origin":"https://ernestvz98-boop.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve((req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 return new Response(JSON.stringify({error:"Función retirada por seguridad (compras-auto-v2). Usa el lector de albaranes."}),
  {status:410,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
});
