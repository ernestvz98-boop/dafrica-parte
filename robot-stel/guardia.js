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
 *
 * Canal único de la web de STEL (2026-10-22): la web hace TODO por `POST /app/ControladorMultiempresa`
 * con `operacion=<nombre>` (leer y escribir). Autorizado por el usuario «solo para lectura y extraer
 * datos; no modifiques ni crees nada». Por ese canal solo pasan las operaciones de la LISTA CERRADA
 * de lectura (revisadas una a una); en la entrada, además, las de inicio de sesión. Cualquier otra,
 * o cualquiera con nombre de escritura, se cancela.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.DafricaRobotGuardia=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const LECTURA=new Set(["GET","HEAD","OPTIONS"]);
const ENTRADA=/(^|\/)(login|log-in|auth|signin|sign-in|session|sessions|token|oauth)(\/|$|\?|\.)/i;
const esStel=host=>/(^|\.)stelorder\.com$/i.test(host);
const CANAL=/^\/app\/(ControladorMultiempresa|FrontController)$/;
// Lista cerrada: solo se añaden operaciones de LECTURA revisadas (nombre y efecto).
const OPERACIONES_LECTURA=new Set(["comprobarLogin","cargarPlanesSuscripcion"]);
const OPERACIONES_ENTRADA=new Set(["realizarLogin"]);
// Regla de lectura: nombres que EMPIEZAN por un verbo de consulta (y sin palabra de escritura en
// ninguna parte, ver ESCRITURA). «cargar» no entra: en español también es «subir».
const VERBO_LECTURA=/^(obtener|listar|buscar|consultar|comprobar|contar|leer|ver|mostrar|get|list|search|count|find|fetch)(?=[A-Z_]|$)/;
const AUTENTICACION=/(login|codigo|verific|autentic|doblefactor|2fa|otp)/i;
// Doble barrera: un nombre de escritura nunca pasa, aunque se añadiera por error a la lista.
const ESCRITURA=/(guardar|grabar|crear|nuev|insert|modific|editar|actualiz|borrar|elimin|anular|enviar|firmar|cerrar|duplic|convert|import|subir|asign|vincul|cambiar|marcar|desmarcar|aplicar|generar|registrar|alta|baja|save|create|update|delete|remove|send|set[A-Z])/i;
// Plantillas de pantalla: `POST /app/Html` con un único campo `id=<ruta>.html` (lectura pura).
const PLANTILLA=/^\/app\/Html$/;
function soloPlantilla(cuerpo){
 let p;try{p=new URLSearchParams(String(cuerpo||""));}catch{return false;}
 const claves=[...p.keys()];
 return claves.length===1&&claves[0]==="id"&&/^[A-Za-z0-9_\/.-]{1,120}\.html$/.test(p.get("id"))&&!p.get("id").includes("..");
}
function operacion(cuerpo){try{return new URLSearchParams(String(cuerpo||"")).get("operacion")||"";}catch{return "";}}
function permitido(metodo,url,fase="lectura",cuerpo=""){
 const m=String(metodo||"").toUpperCase();
 if(LECTURA.has(m))return true;
 let u;try{u=new URL(url);}catch{return false;}
 if(m==="POST"&&u.protocol==="https:"&&esStel(u.hostname)&&PLANTILLA.test(u.pathname))return soloPlantilla(cuerpo);
 if(m==="POST"&&u.protocol==="https:"&&esStel(u.hostname)&&CANAL.test(u.pathname)){
  // El nombre de la operación va en el cuerpo o, en las tablas paginadas, en la dirección.
  const op=operacion(cuerpo)||u.searchParams.get("operacion")||"";
  if(!op||ESCRITURA.test(op))return false;
  // Entrada con código de verificación por correo (doble factor): solo operaciones de autenticación.
  return OPERACIONES_LECTURA.has(op)||(VERBO_LECTURA.test(op)&&!AUTENTICACION.test(op))||(fase==="entrada"&&(OPERACIONES_ENTRADA.has(op)||AUTENTICACION.test(op)));
 }
 if(fase==="entrada"&&m==="POST"&&u.protocol==="https:"&&esStel(u.hostname)&&ENTRADA.test(u.pathname))return true;
 return false;
}
/* Ruta sin valores (para el informe): sin consulta ni identificadores largos. */
function rutaSinDatos(url){
 try{const u=new URL(url);return u.hostname+u.pathname.replace(/\/\d{3,}(?=\/|$)/g,"/:id");}catch{return "(url no válida)";}
}
return {permitido,rutaSinDatos,operacion,OPERACIONES_LECTURA,OPERACIONES_ENTRADA,ESCRITURA,VERBO_LECTURA};
});
