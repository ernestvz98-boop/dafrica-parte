"use strict";
/*
 * DAFRICA · Catálogo STEL de SOLO LECTURA para el lector (cliente). STEL limita el número de
 * consultas: el catálogo completo (proveedores y artículos, sin precios) se guarda en el
 * navegador 24 horas y, si una descarga se corta, la siguiente lectura la reanuda donde quedó.
 *
 * Empalme seguro: la reanudación vuelve a pedir la última página ya guardada y exige que traiga
 * exactamente los mismos artículos; si no (el catálogo ha cambiado), se descarta todo y se
 * empieza de cero. Las partes deben ser de las últimas 6 horas. Así nunca se anuncia completo
 * un catálogo con huecos (la validación de códigos exige coincidencia única en todo el catálogo).
 */
(function(root,factory){
 const api=factory(root);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.catalogo=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const VIGENCIA_COMPLETO=24*3600e3,VIGENCIA_PARTES=6*3600e3;

/*
 * consultar(cuerpo) → respuesta de `compras-catalogo-lectura` ({} o {desde}).
 * almacen: {leer() → objeto | null, guardar(objeto)} (localStorage; puede fallar sin romper nada).
 * Devuelve el catálogo para verificacion.verificar con `origen` (cache | descarga | reanudado).
 */
async function obtenerCatalogo({consultar,almacen=null,ahora=Date.now()}){
 let guardado=null;
 try{guardado=almacen?.leer()||null;}catch{guardado=null;}
 if(guardado?.articulos_completo&&guardado.proveedores_completo&&ahora-guardado.creado<VIGENCIA_COMPLETO)
  return {...guardado,origen:"cache"};
 const parcial=guardado&&!guardado.articulos_completo&&ahora-guardado.creado<VIGENCIA_PARTES&&
  Array.isArray(guardado.articulos_ids_final)&&guardado.articulos_ids_final.length&&Number.isInteger(guardado.articulos_siguiente)?guardado:null;
 let resultado=null;
 if(parcial){
  const r=await consultar({desde:parcial.articulos_siguiente-parcial.articulos_ids_final.length});
  const empalma=r&&Array.isArray(r.articulos_ids_inicio)&&r.articulos_ids_inicio.join(",")===parcial.articulos_ids_final.join(",");
  if(empalma){
   const vistos=new Set(parcial.articulos.map(a=>String(a.id)));
   resultado={...r,creado:parcial.creado,origen:"reanudado",
    articulos:[...parcial.articulos,...(r.articulos||[]).filter(a=>!vistos.has(String(a.id)))],
    proveedores:r.proveedores_completo?r.proveedores:parcial.proveedores,
    proveedores_completo:r.proveedores_completo||parcial.proveedores_completo};
  }else if(!r||!(r.articulos_ids_inicio||[]).length){
   // STEL no ha devuelto nada (cupo agotado, error): se conserva lo guardado sin gastar más consultas.
   return {...parcial,diagnostico:r?.diagnostico||parcial.diagnostico,origen:"parcial_sin_avance"};
  }
 }
 if(!resultado){
  const r=await consultar({});
  if(!r)return null;
  resultado={...r,creado:ahora,origen:"descarga"};
 }
 try{almacen?.guardar({...resultado,origen:undefined});}catch{}
 return resultado;
}

/* Almacén en localStorage (si el navegador lo permite). */
function almacenLocal(clave="dafrica_catalogo_stel_v1",ls=typeof localStorage!=="undefined"?localStorage:null){
 return {leer:()=>{const t=ls?.getItem(clave);return t?JSON.parse(t):null;},guardar:o=>ls?.setItem(clave,JSON.stringify(o))};
}
return {obtenerCatalogo,almacenLocal,VIGENCIA_COMPLETO,VIGENCIA_PARTES};
});
