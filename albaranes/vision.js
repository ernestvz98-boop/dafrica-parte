"use strict";
/*
 * DAFRICA · Motor de visión para manuscritos (cliente). Envía SOLO recortes PNG de anotaciones
 * manuscritas a la función Edge `albaranes-manuscritos` y devuelve sus transcripciones para
 * albaranes/manuscritos.js. Sin la función desplegada, el lector funciona igual y deja los
 * códigos manuscritos sin resolver.
 */
(function(root,factory){
 const api=factory(root);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.vision=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
/* url: endpoint de la función; token(): JWT de la sesión; fetchImpl: para pruebas. */
// modo "manuscrito" (por defecto): anotaciones a mano → {indice, texto_literal, tachado, tipo, lecturas}.
// modo "impreso": texto impreso de una celda dudosa → {indice, texto} (se acepta solo si coincide con el OCR).
function motorSupabase({url,token,fetchImpl=null}){
 return async (recortes,{modo="manuscrito"}={})=>{
  const f=fetchImpl||root.fetch;
  const r=await f(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+await token()},body:JSON.stringify({recortes,modo})});
  if(!r.ok)throw Error("Visión de manuscritos no disponible (HTTP "+r.status+")");
  const x=await r.json();
  return Array.isArray(x.recortes)?x.recortes:[];
 };
}
return {motorSupabase};
});
