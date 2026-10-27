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
// ListarTipoUnidadFeMEX (2026-10-23, aprobado por el usuario): lista de tipos de unidad que pide el
// formulario de producto; sin ella se queda en «Cargando…». Solo lleva el campo `operacion`.
// isDocumentoComercialCerrado (2026-10-26, aprobado por el usuario): pregunta si un pedido está
// cerrado antes de generar un albarán desde él. Solo lleva `operacion` e `idDocumentoComercial`.
const OPERACIONES_LECTURA=new Set(["comprobarLogin","cargarPlanesSuscripcion","ListarProyectos","ListarTipoUnidadFeMEX","isDocumentoComercialCerrado"]);
const OPERACIONES_ENTRADA=new Set(["realizarLogin"]);
// Regla de lectura: nombres que EMPIEZAN por un verbo de consulta (y sin palabra de escritura en
// ninguna parte, ver ESCRITURA). «cargar» no entra: en español también es «subir».
const VERBO_LECTURA=/^(obtener|listar|buscar|consultar|comprobar|contar|leer|ver|mostrar|get|list|search|count|find|fetch)(?=[A-Z_]|$)/;
const AUTENTICACION=/(login|codigo|verific|autentic|doblefactor|2fa|otp)/i;
// Doble barrera: un nombre de escritura nunca pasa, aunque se añadiera por error a la lista.
const ESCRITURA=/(guardar|grabar|crear|nuev|insert|modific|editar|actualiz|borrar|elimin|anular|enviar|firmar|cerrar|duplic|convert|import|subir|asign|vincul|cambiar|marcar|desmarcar|aplicar|generar|registrar|alta|baja|bloque|lock|save|create|update|delete|remove|send|set[A-Z])/i;
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
 let u;try{u=new URL(url);}catch{return false;}
 // 2026-10-27 (fallo real): con la guardia cancelando el «Guardar» (POST), en STEL quedó creado el
 // albarán de ensayo. Un GET/HEAD a STEL que lleve una operación (en la dirección) pasa por las MISMAS
 // reglas que un POST; uno de escritura se cancela siempre, sea cual sea el método.
 if(LECTURA.has(m)){
  if(!esStel(u.hostname))return true;
  const opUrl=[...u.searchParams.entries()].filter(([k])=>/^operaci[oó]n$|^op$|^accion$|^action$/i.test(k)).map(([,v])=>v);
  // Canal de operaciones o servlet de ficheros por GET: solo con una operación de lectura explícita.
  if((CANAL.test(u.pathname)||/Servlet$|\.do$/i.test(u.pathname))&&(!opUrl.length||ESCRITURA.test(u.pathname)))return false;
  return opUrl.every(op=>!ESCRITURA.test(op)&&(OPERACIONES_LECTURA.has(op)||(VERBO_LECTURA.test(op)&&!AUTENTICACION.test(op))||(fase==="entrada"&&(OPERACIONES_ENTRADA.has(op)||AUTENTICACION.test(op)))));
 }
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
/*
 * Cómo se cancela (fallo real 2026-10-27): la web de STEL REENVÍA en bucle una petición que falla sin
 * respuesta («abort», estado 0), y al cerrar el navegador del robot un reenvío en vuelo llegó a STEL y
 * creó un albarán. Una petición cancelada hacia STEL recibe una respuesta local «204 sin contenido»
 * (nunca sale): la web no la reenvía y solo quita su aviso de «Guardando». Fuera de STEL, abort.
 */
async function cancelar(ruta){
 let stel=false;try{stel=esStel(new URL(ruta.request().url()).hostname);}catch{}
 if(stel)return ruta.fulfill({status:204,headers:{"Content-Type":"text/plain","Cache-Control":"no-store"},body:""});
 return ruta.abort("blockedbyclient");
}
/* Ruta sin valores (para el informe): sin consulta ni identificadores largos. */
function rutaSinDatos(url){
 try{const u=new URL(url);return u.hostname+u.pathname.replace(/\/\d{3,}(?=\/|$)/g,"/:id");}catch{return "(url no válida)";}
}
return {permitido,cancelar,rutaSinDatos,operacion,OPERACIONES_LECTURA,OPERACIONES_ENTRADA,ESCRITURA,VERBO_LECTURA};
});
