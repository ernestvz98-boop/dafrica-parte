"use strict";
/*
 * DAFRICA · Guardia de SOLO LECTURA del robot de STEL Order (aprobado por el usuario el 2026-10-22:
 * «solo para revisar; por ahora el robot no hace modificaciones»).
 *
 * Toda petición del navegador del robot pasa por aquí antes de salir:
 * - GET, HEAD y OPTIONS: permitidas (leer páginas, scripts e imágenes).
 * - Fase «entrada»: además, un POST a STEL cuya ruta sea de inicio de sesión (login, auth, signin,
 *   session, token). Nada más.
 * - Fase «lectura»: cualquier otra petición (POST, PUT, PATCH, DELETE…) se CANCELA antes de salir,
 *   aunque fuera solo para leer. Así es imposible guardar, borrar o cambiar nada en STEL.
 * Las canceladas se anotan (método y ruta, nunca su contenido) para decidir con el usuario.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.DafricaRobotGuardia=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const LECTURA=new Set(["GET","HEAD","OPTIONS"]);
const ENTRADA=/(^|\/)(login|log-in|auth|signin|sign-in|session|sessions|token|oauth)(\/|$|\?|\.)/i;
const esStel=host=>/(^|\.)stelorder\.com$/i.test(host);
function permitido(metodo,url,fase="lectura"){
 const m=String(metodo||"").toUpperCase();
 if(LECTURA.has(m))return true;
 let u;try{u=new URL(url);}catch{return false;}
 if(fase==="entrada"&&m==="POST"&&u.protocol==="https:"&&esStel(u.hostname)&&ENTRADA.test(u.pathname))return true;
 return false;
}
/* Ruta sin valores (para el informe): sin consulta ni identificadores largos. */
function rutaSinDatos(url){
 try{const u=new URL(url);return u.hostname+u.pathname.replace(/\/\d{3,}(?=\/|$)/g,"/:id");}catch{return "(url no válida)";}
}
return {permitido,rutaSinDatos};
});
