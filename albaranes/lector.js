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
const RE_SIGUE=/\bSUMA\s+Y\s+SIGUE\b|\bCONTIN[UÚ]A\b/i;

/* Datos de una página que deciden si abre un albarán nuevo o continúa el anterior. */
function firmaPagina(resultado,pagina){
 const texto=(pagina?.lineas||[]).map(l=>l.texto).join("\n");
 const m=texto.match(RE_PAGINA);
 const num=resultado?.numero;
 return {
  nif:resultado?.proveedor?.nif||null,
  numero:num&&num.estado!=="VACIO"&&num.valor?M("normalizar").canon(num.valor):null,
  pagina:m?{k:+m[1],n:+m[2]}:null,
  sigue:RE_SIGUE.test(texto),
  totales:resultado?.totales?.total?.estado&&resultado.totales.total.estado!=="VACIO",
  vacia:!(pagina?.lineas||[]).length&&!(resultado?.lineas||[]).length
 };
}

/*
 * ¿La página `f` continúa el albarán cuyo primer y último firmas son `primera` y `ultima`?
 * Solo se une con pruebas: mismo proveedor y número, «Página k de n» con k > 1, o una página sin
 * cabecera propia tras otra que anuncia «suma y sigue» o que no tenía totales.
 */
function continua(primera,ultima,f){
 if(f.vacia)return true;
 if(f.pagina&&f.pagina.k>1&&(!ultima.pagina||f.pagina.k===ultima.pagina.k+1)&&(!f.nif||!primera.nif||f.nif===primera.nif))return true;
 if(f.pagina&&f.pagina.k===1)return false;
 if(f.nif&&primera.nif&&f.nif!==primera.nif)return false;
 if(f.numero&&primera.numero)return f.numero===primera.numero;
 if(!f.numero&&!f.nif)return ultima.sigue||!ultima.totales;
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

const esOcr=p=>p.tipo!=="DIGITAL";
// Texto de un error cualquiera (algunos motores rechazan con valores que no son Error).
const textoError=e=>e?.message||(typeof e==="string"?e:(()=>{try{return JSON.stringify(e);}catch(_){return "";}})())||"Error desconocido al leer la página";

/*
 * opciones: {registro, hoy, tamLote (páginas por bloque de progreso), alProgresar(info),
 *            cancelado() → true para detener, vision (motor de manuscritos, opcional)}
 */
async function leerPdf(fuente,opciones={}){
 const {alProgresar=null,cancelado=()=>false,tamLote=5}=opciones;
 const total=fuente.numPaginas;
 const documentos=[],errores=[];
 let grupo=[],lote=-1;
 const aviso=(fase,extra={})=>alProgresar?.({fase,total,documentos:documentos.length,errores:errores.length,...extra});

 async function cerrar(){
  if(!grupo.length)return;
  const g=grupo;grupo=[];
  const paginas=g.map(x=>x.n);
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
   documentos.push({indice:documentos.length+1,paginas,resultado});
  }catch(e){
   errores.push({paginas,error:textoError(e)});
  }finally{
   for(const x of g)await fuente.liberar?.(x.n);
  }
 }

 for(let n=1;n<=total;n++){
  if(cancelado()){aviso("cancelado",{pagina:n});break;}
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
   await fuente.liberar?.(n);
   continue;
  }
  const firma=firmaPagina(resultado,esOcr(texto)?{lineas:(resultado?._pags||[]).flatMap(p=>p.lineas)}:texto);
  const x={n,texto,resultado,firma};
  if(grupo.length&&continua(grupo[0].firma,grupo.at(-1).firma,firma))grupo.push(x);
  else{await cerrar();grupo=[x];}
 }
 await cerrar();
 // Anotaciones manuscritas: la coherencia del lote se aplica con todos los albaranes leídos.
 const conObra=documentos.filter(d=>d.resultado?.manuscritos);
 if(conObra.length)M("manuscritos").coherenciaLote(conObra.map(d=>d.resultado.manuscritos));
 const resumen={
  paginas:total,documentos:documentos.length,errores:errores.length,
  auto_ok:documentos.filter(d=>d.resultado?.estado==="AUTO_OK").length,
  revisar:documentos.filter(d=>d.resultado?.estado!=="AUTO_OK").length,
  digitales:documentos.filter(d=>d.resultado?.tipo_pdf==="DIGITAL").length,
  escaneados:documentos.filter(d=>d.resultado?.tipo_pdf==="ESCANEADO_OCR").length
 };
 aviso("fin",{resumen});
 return {documentos,errores,resumen};
}

return {leerPdf,agruparPaginas,firmaPagina,continua};
});
