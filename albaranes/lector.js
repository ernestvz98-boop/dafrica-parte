"use strict";
/*
 * DAFRICA · Lector de PDF de albaranes de cualquier tamaño.
 *
 * Recorre el PDF página a página (sin cargarlo entero en memoria), decide para cada página si
 * se lee por su capa de texto (DIGITAL) o por OCR (ESCANEADO / MIXTO), separa los albaranes
 * (un PDF puede traer muchos, y un albarán puede ocupar varias páginas) y devuelve un
 * resultado consolidado con el estado de cada albarán, los errores por página y un resumen.
 *
 * Fuente de páginas (inyectada; en la web: pdf.js + tesseract.js, en pruebas: pdftoppm + Tesseract):
 *   fuente = {numPaginas, texto(n) → página de texto-pdf.js, ocr(n) → página OCR de escaneado.js,
 *             liberar(n) (opcional)}
 * Nada se envía ni se guarda: el resultado solo existe en memoria.
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.lector=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const M=k=>req?req("./"+{extraer:"extraer.js",escaneado:"escaneado.js",normalizar:"normalizar.js",manuscritos:"manuscritos.js"}[k]):root.DafricaAlbaranes[k];

const RE_PAGINA=/\bP[AÁ]G(?:INA)?\.?\s*:?\s*(\d{1,3})\s*(?:DE|\/)\s*(\d{1,3})\b/i;
// «Página 2» sin «de N» (cabecera repetida en la continuación).
const RE_PAGINA_SOLA=/\bP[AÁ]G(?:INA)?\.?\s*:?\s*(\d{1,3})\b/i;
const RE_SIGUE=/\bSUMA\s+Y\s+SIGUE\b|\bCONTIN[UÚ]A\b/i;

/* Datos de una página que deciden si abre un albarán nuevo o continúa el anterior. */
function firmaPagina(resultado,pagina){
 const texto=(pagina?.lineas||[]).map(l=>l.texto).join("\n");
 const m=texto.match(RE_PAGINA);
 const num=resultado?.numero;
 return {
  nif:resultado?.proveedor?.nif||null,
  numero:num&&num.estado!=="VACIO"&&num.valor?M("normalizar").canon(num.valor):null,
  fecha:resultado?.fecha?.valor||null,
  pagina:m?{k:+m[1],n:+m[2]}:(m2=>m2?{k:+m2[1],n:null}:null)(texto.match(RE_PAGINA_SOLA)),
  sigue:RE_SIGUE.test(texto),
  totales:resultado?.totales?.total?.estado&&resultado.totales.total.estado!=="VACIO",
  vacia:!(pagina?.lineas||[]).length&&!(resultado?.lineas||[]).length
 };
}

/*
 * ¿Es la página otra factura? (2026-11-26) Solo leyendo facturas, con el número de factura leído con seguridad (OK o verificado) en la
 * primera página del grupo y en esta, y distintos: ni el uno empieza por el otro («9900012345» y «9900012345 / 15.03.2026» son el mismo).
 * Banco de facturas digitales de varias páginas (355): parte solo una, que lleva dos facturas.
 */
function otraFactura(opciones,primero,este){
 if(!opciones.numeroDeFactura)return false;
 const num=r=>{const n=r?.numero;return n&&["OK","VERIFICADO"].includes(n.estado)&&n.valor?M("normalizar").canon(n.valor):"";};
 const a=num(primero),b=num(este);
 return !!a&&!!b&&!a.startsWith(b)&&!b.startsWith(a);
}

/*
 * ¿La página `f` continúa el albarán cuyo primer y último firmas son `primera` y `ultima`?
 * Solo se une con pruebas: mismo proveedor y número, «Página k de n» con k > 1, o una página sin
 * cabecera propia tras otra que anuncia «suma y sigue» o que no tenía totales.
 */
function continua(primera,ultima,f){
 if(f.vacia)return true;
 // Números de albarán distintos: otro albarán, diga lo que diga «Página k». Y «Página k» solo
 // prueba la continuación si es la siguiente (la 2 si la anterior no se leyó). Fallo real
 // 2026-10-23: el OCR leyó «Pag:9» en «Pag: 1» (con un ABP a mano al lado) y unió dos albaranes.
 if(f.numero&&primera.numero&&f.numero!==primera.numero)return false;
 if(f.pagina&&f.pagina.k>1&&f.pagina.k===(ultima.pagina?ultima.pagina.k+1:2)&&(!f.nif||!primera.nif||f.nif===primera.nif))return true;
 if(f.pagina&&f.pagina.k===1)return false;
 if(f.nif&&primera.nif&&f.nif!==primera.nif)return false;
 if(f.numero&&primera.numero)return f.numero===primera.numero;
 // Sin número ni CIF leídos, solo continúa una página sin cabecera propia: con fecha impresa es otro albarán aunque no se
 // haya leído ni el número (fallo real 2026-10-30: dos albaranes del mismo proveedor, sin leer su total, unidos en uno).
 if(!f.numero&&!f.nif)return !f.fecha&&(ultima.sigue||!ultima.totales);
 // Misma cabecera de proveedor sin número propio tras «SUMA Y SIGUE»: continuación anunciada.
 if(!f.numero&&f.nif===primera.nif&&ultima.sigue)return true;
 return false;
}

/* Grupos de páginas consecutivas → albaranes. firmas: [{n, firma}] en orden. */
function agruparPaginas(firmas){
 const grupos=[];
 for(const x of firmas){
  const g=grupos.at(-1);
  if(g&&continua(g[0].firma,g.at(-1).firma,x.firma))g.push(x);
  else grupos.push([x]);
 }
 return grupos;
}

/*
 * ¿La página `b` es otra copia de la página `a` del mismo albarán (el mismo papel escaneado dos veces, o el ejemplar del
 * cliente y el del proveedor)? Fallo real 2026-11-24: un albarán de 9 líneas entró con 18 (cada línea dos veces) y la
 * persona quitó a mano las 9 repetidas. Solo con pruebas: mismo número de albarán leído en las dos, las mismas líneas en el
 * mismo orden (al menos 2), todas las cantidades iguales y al menos el 80 % de los códigos iguales (el OCR puede leer mal
 * alguno), con 2 códigos como mínimo; si las dos traen total, el mismo. Una continuación de verdad nunca repite sus líneas.
 */
function copiaDePagina(a,b){
 if(!a?.firma?.numero||a.firma.numero!==b?.firma?.numero)return false;
 const la=a.resultado?.lineas||[],lb=b.resultado?.lineas||[];
 if(la.length<2||la.length!==lb.length)return false;
 const val=c=>c&&typeof c==="object"&&"valor" in c?c.valor:c;
 const cant=l=>{const v=val(l.cantidad);return v==null||v===""?null:Number(String(v).replace(",","."));};
 const ref=l=>String(val(l.referencia)||"").toUpperCase().replace(/[^0-9A-Z]/g,"");
 if(!la.every((l,i)=>cant(l)!=null&&cant(l)===cant(lb[i])))return false;
 // Misma línea: el mismo código (o uno es el otro con texto pegado por el OCR, «1300000004 5-6»), o las dos sin código y con
 // la misma primera palabra en la descripción (ecotasas y similares).
 const palabra=l=>(String(val(l.descripcion)||"").toUpperCase().match(/[A-ZÁÉÍÓÚÑ0-9]{3,}/)||[""])[0];
 const codigos=la.filter((l,i)=>ref(l).length>=3&&ref(l)===ref(lb[i])).length;
 const iguales=la.filter((l,i)=>{const x=ref(l),y=ref(lb[i]);
  if(x.length>=3&&y.length>=3)return x===y||(Math.min(x.length,y.length)>=6&&(x.startsWith(y)||y.startsWith(x)));
  return !x&&!y&&!!palabra(l)&&palabra(l)===palabra(lb[i]);}).length;
 if(codigos<2||iguales<Math.ceil(0.8*la.length))return false;
 const tot=r=>{const v=val(r?.totales?.total);return v==null||v===""?null:Number(String(v).replace(",","."));};
 const ta=tot(a.resultado),tb=tot(b.resultado);
 return ta==null||tb==null||ta===tb;
}

const esOcr=p=>p.tipo!=="DIGITAL";
/*
 * Estado de cada albarán leído: AUTO_OK (todo verificado), REVISAR (algún campo para revisión) o
 * ERROR_DOCUMENTO (no se ha podido leer: página dañada, escaneo sin OCR o nada reconocible).
 */
/* ¿Página sin tinta? Digital: sin texto ni imagen. Escaneada: < 0,2 % de píxeles oscuros. */
async function enBlanco(texto,paginaOcr){
 if(!esOcr(texto))return !(texto.lineas||[]).length&&!(texto.fraccion_imagen>0.05);
 if(typeof paginaOcr?.gris!=="function")return false;
 const g=await paginaOcr.gris(4);let n=0;
 for(let i=0;i<g.datos.length;i++)if(g.datos[i]<128)n++;
 return n<0.002*g.datos.length;
}
function estadoDocumento(r){
 if(!r||r.estado==="NO_DIGITAL"||r.estado==="ERROR_SEPARACION")return "ERROR_DOCUMENTO";
 if(r.estado==="AUTO_OK")return "AUTO_OK";
 if(!(r.lineas||[]).length&&!r.numero?.valor&&!r.proveedor?.nif)return "ERROR_DOCUMENTO";
 return "REVISAR";
}
// Texto de un error cualquiera (algunos motores rechazan con valores que no son Error).
const textoError=e=>e?.message||(typeof e==="string"?e:(()=>{try{return JSON.stringify(e);}catch(_){return "";}})())||"Error desconocido al leer la página";

/*
 * opciones: {registro, hoy, tamLote (páginas por bloque de progreso), alProgresar(info),
 *            cancelado() → true para detener, vision (motor de manuscritos, opcional)}
 */
/*
 * Coherencia del lote (evidencia permitida: «coherencia del lote»). Proveedores con números correlativos en
 * el tiempo: un número aceptado que va contra el orden de las fechas de la MAYORÍA de sus otros albaranes del
 * lote (menor que uno de fecha anterior o mayor que uno de fecha posterior, más allá de la tolerancia de su
 * perfil) es una lectura dudosa. Prueba
 * real 2026-10-28: la primera cifra del número mal leída (cien mil menos), aceptada con tres lecturas OCR iguales. Solo marca para
 * revisión; nunca cambia el número.
 */
function numerosFueraDeSecuencia(documentos,registro){
 const perfiles=new Map((registro?.proveedores||[]).filter(p=>p.numeros_correlativos).map(p=>[p.id,p]));
 const n=v=>Number(String(v||"").replace(/\D/g,""));
 const datos=documentos.filter(d=>{const r=d.resultado;return r&&perfiles.has(r.proveedor?.id)&&r.numero?.estado==="OK"&&r.fecha?.estado==="OK"&&n(r.numero.valor)>0;})
  .map(d=>({d,prov:d.resultado.proveedor.id,num:n(d.resultado.numero.valor),fecha:String(d.resultado.fecha.valor)}));
 // Se quita cada vez el albarán con más cruces (el que rompe el orden de más albaranes); si los que quedan
 // con cruces se cruzan solo entre sí uno a uno, todos van a revisión (no se sabe cuál está mal).
 const tol=prov=>Number(perfiles.get(prov)?.numeros_correlativos?.tolerancia)||0;
 const choca=(x,y)=>x.prov===y.prov&&x.fecha!==y.fecha&&((y.fecha<x.fecha&&y.num-x.num>tol(x.prov))||(y.fecha>x.fecha&&x.num-y.num>tol(x.prov)));
 const fuera=[];let activos=datos.slice();
 for(;;){
  const cruces=activos.map(x=>({x,n:activos.filter(y=>y!==x&&choca(x,y)).length}));
  const max=Math.max(0,...cruces.map(c=>c.n));
  if(!max)break;
  const peores=cruces.filter(c=>c.n===max).map(c=>c.x);
  for(const x of max===1?cruces.filter(c=>c.n>0).map(c=>c.x):peores){
   const de=datos.filter(y=>y.prov===x.prov&&y.fecha!==x.fecha).length;
   x.d._secuencia="se cruza con "+activos.filter(y=>y!==x&&choca(x,y)).length+" de "+de+" albaranes de otras fechas";fuera.push(x.d);
  }
  if(max===1)break;
  activos=activos.filter(x=>!peores.includes(x));
 }
 return fuera;
}

async function leerPdf(fuente,opciones={}){
 const {alProgresar=null,cancelado=()=>false,tamLote=5}=opciones;
 const total=fuente.numPaginas;
 const documentos=[],errores=[];
 let grupo=[],lote=-1;
 const aviso=(fase,extra={})=>alProgresar?.({fase,total,documentos:documentos.length,errores:errores.length,...extra});

 async function cerrar(){
  if(!grupo.length)return;
  const g0=grupo;grupo=[];
  const paginas=g0.map(x=>x.n),blancas=g0.filter(x=>x.blanca&&x!==g0[0]).map(x=>x.n);
  // Copias del mismo papel: no se suman sus líneas (se informa con la página de la que son copia).
  const repetidas=[];
  for(const x of g0)if(x!==g0[0]&&!blancas.includes(x.n)){
   const de=g0.find(y=>y!==x&&y.n<x.n&&!blancas.includes(y.n)&&!repetidas.some(r=>r.n===y.n)&&copiaDePagina(y,x));
   if(de)repetidas.push({n:x.n,copia_de:de.n});
  }
  const g=g0.filter(x=>!blancas.includes(x.n)&&!repetidas.some(r=>r.n===x.n));
  // Un solo documento con las páginas escaneadas al revés (fallo real 2026-11-18: «Pág: 2» antes que «Pág: 1»): se leen en el
  // orden impreso, solo si cada página lleva su número y juntas son 1, 2, …, n.
  if(opciones.unSoloDocumento&&g.length>1){
   const ks=g.map(x=>x.firma?.pagina?.k);
   if(ks.every(Number.isInteger)&&[...ks].sort((a,b)=>a-b).every((k,i)=>k===i+1))g.sort((a,b)=>a.firma.pagina.k-b.firma.pagina.k);
  }
  try{
   let resultado;
   if(g.length===1)resultado=g[0].resultado;
   else if(g.every(x=>!esOcr(x.texto)))resultado=M("extraer").extraerDePaginas(g.map(x=>x.texto),opciones);
   else if(g.every(x=>esOcr(x.texto)))resultado=await M("escaneado").extraerEscaneado(await Promise.all(g.map(x=>fuente.ocr(x.n))),opciones);
   else{
    // Albarán con páginas digitales y escaneadas: se leen todas por OCR (misma vía para todo).
    resultado=await M("escaneado").extraerEscaneado(await Promise.all(g.map(x=>fuente.ocr(x.n))),opciones);
    resultado.incidencias=[...(resultado.incidencias||[]),"Albarán con páginas digitales y escaneadas: leído por OCR"];
   }
   const doc={indice:documentos.length+1,paginas,resultado,estado_documento:g0[0].blanca&&g0.length===blancas.length+1&&!(resultado?.lineas||[]).length?"ERROR_DOCUMENTO":estadoDocumento(resultado)};
   if(blancas.length)doc.paginas_en_blanco=blancas;
   if(repetidas.length&&resultado){
    doc.paginas_repetidas=repetidas;
    resultado.incidencias=[...(resultado.incidencias||[]),...repetidas.map(r=>"La página "+r.n+" es otra copia de la página "+r.copia_de+" (mismo número y mismas líneas): sus líneas no se suman")];
   }
   if(g0[0].blanca&&doc.estado_documento==="ERROR_DOCUMENTO")doc.error="Página en blanco";
   documentos.push(doc);
  }catch(e){
   errores.push({paginas,error:textoError(e)});
   documentos.push({indice:documentos.length+1,paginas,resultado:null,estado_documento:"ERROR_DOCUMENTO",error:textoError(e)});
  }finally{
   for(const x of g0)await fuente.liberar?.(x.n);
  }
 }

 let procesadas=0;
 for(let n=1;n<=total;n++){
  if(cancelado()){aviso("cancelado",{pagina:n});break;}
  procesadas=n;
  if(Math.floor((n-1)/tamLote)!==lote){lote=Math.floor((n-1)/tamLote);aviso("lote",{lote:lote+1,pagina:n});}
  aviso("pagina",{pagina:n});
  let texto=null,resultado=null;
  try{
   texto=await fuente.texto(n);
   resultado=esOcr(texto)?await M("escaneado").extraerEscaneado([await fuente.ocr(n)],opciones)
    :M("extraer").extraerDePaginas([texto],opciones);
  }catch(e){
   // Página que no se puede leer: se registra y se cierra el albarán en curso.
   await cerrar();
   errores.push({paginas:[n],error:textoError(e)});
   documentos.push({indice:documentos.length+1,paginas:[n],resultado:null,estado_documento:"ERROR_DOCUMENTO",error:textoError(e)});
   await fuente.liberar?.(n);
   continue;
  }
  const firma=firmaPagina(resultado,esOcr(texto)?{lineas:(resultado?._pags||[]).flatMap(p=>p.lineas)}:texto);
  // Página en blanco (sin tinta: p. ej. el reverso de un escaneo a doble cara): se adjunta al
  // albarán anterior y se informa. Una página CON tinta pero sin nada reconocible nunca se une a
  // otro albarán: queda como documento propio (ERROR_DOCUMENTO), en su posición.
  firma.vacia=await enBlanco(texto,esOcr(texto)?await fuente.ocr(n):null);
  const ilegible=!firma.vacia&&!(resultado?.lineas||[]).length&&!resultado?.numero?.valor&&!resultado?.proveedor?.nif;
  const x={n,texto,resultado,firma,blanca:firma.vacia};
  // Confirmación de pedido (opciones.unSoloDocumento, usuario 2026-11-17: «un pedido de dos páginas lo dividió en dos»; real: un
  // presupuesto escaneado con las páginas al revés y sin número de albarán): todas las páginas del archivo son el mismo documento.
  // Salvo en facturas, una página con OTRO número de factura leído con seguridad (fallo real 2026-11-26, usuario: «acabo de subir
  // varias facturas y lo que leyó fue un desastre»: un escaneo de 6 páginas, 6 facturas de un taller, leído como una sola).
  if(grupo.length&&!otraFactura(opciones,grupo[0].resultado,resultado)&&(opciones.unSoloDocumento||(!ilegible&&continua(grupo[0].firma,grupo.at(-1).firma,firma))))grupo.push(x);
  else{await cerrar();grupo=[x];}
 }
 await cerrar();
 // Anotaciones manuscritas: la coherencia del lote se aplica con todos los albaranes leídos.
 const conObra=documentos.filter(d=>d.resultado?.manuscritos);
 if(conObra.length)M("manuscritos").coherenciaLote(conObra.map(d=>d.resultado.manuscritos),{catalogoObras:opciones.catalogoObras||null});
 // Quién recoge: el mismo DNI con un nombre mal leído en un albarán del lote (el nombre con una letra de menos en uno, bien en cinco).
 if(conObra.length)M("manuscritos").coherenciaRecoge(conObra.map(d=>d.resultado.manuscritos));
 // Números correlativos de un proveedor (perfil numeros_correlativos): fuera del orden de las fechas del lote.
 for(const d of numerosFueraDeSecuencia(documentos,opciones.registro)){
  const r=d.resultado;
  r.numero={...r.numero,estado:"REVISAR",motivos:[...(r.numero.motivos||[]),"Número fuera de la secuencia del proveedor en este lote ("+d._secuencia+"): comprueba el papel"]};
  delete d._secuencia;
  if(r._ctx)M("extraer").finalizar(r);
  d.estado_documento=estadoDocumento(r);
 }
 // Cada página del PDF está en exactamente un documento (o queda sin procesar si se canceló).
 const vistas=documentos.flatMap(d=>d.paginas);
 const resumen={
  paginas:total,documentos:documentos.length,errores:errores.length,
  auto_ok:documentos.filter(d=>d.estado_documento==="AUTO_OK").length,
  revisar:documentos.filter(d=>d.estado_documento==="REVISAR").length,
  error_documento:documentos.filter(d=>d.estado_documento==="ERROR_DOCUMENTO").length,
  paginas_no_procesadas:Array.from({length:total-procesadas},(_,i)=>procesadas+i+1),
  paginas_completas:vistas.length===procesadas&&new Set(vistas).size===vistas.length&&vistas.every((p,i)=>p===i+1),
  paginas_en_blanco:documentos.flatMap(d=>d.paginas_en_blanco||[]),
  digitales:documentos.filter(d=>d.resultado?.tipo_pdf==="DIGITAL").length,
  escaneados:documentos.filter(d=>d.resultado?.tipo_pdf==="ESCANEADO_OCR").length
 };
 aviso("fin",{resumen});
 return {documentos,errores,resumen};
}

return {leerPdf,agruparPaginas,firmaPagina,continua,estadoDocumento,_numerosFueraDeSecuencia:numerosFueraDeSecuencia,_copiaDePagina:copiaDePagina};
});
