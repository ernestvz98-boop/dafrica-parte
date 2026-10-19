"use strict";
/*
 * DAFRICA · Albaranes escaneados: varias lecturas OCR y aceptación solo de lo que valida.
 *
 * Cada página se lee varias veces (segmentaciones distintas de la página entera y una
 * relectura de la banda de la tabla). Con cada lectura se ejecuta el mismo extractor que
 * con los PDF digitales y después se combinan:
 *  - se toma como principal la lectura con más campos validados;
 *  - cabecera (CIF, número, fecha): solo se acepta un valor si las lecturas válidas
 *    coinciden; dos lecturas válidas distintas → AMBIGUO;
 *  - líneas: si la principal no cuadra y otra lectura de la MISMA línea cuadra
 *    (cantidad × precio × descuento = importe), se toman sus cifras; si dos lecturas
 *    válidas discrepan en la cantidad o la referencia, la línea queda en revisión.
 * Ningún valor se inventa: solo se elige entre lo leído y lo que supera las validaciones.
 *
 * Motor independiente: páginas [{numero, anchoPx, altoPx, dpi, ocr: async ({psm, region}) => palabras}].
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.escaneado=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const M=k=>req?req("./"+{extraer:"extraer.js",ocr:"ocr.js",normalizar:"normalizar.js"}[k]):root.DafricaAlbaranes[k];
const LECTURAS=[{psm:4},{psm:6},{psm:3}];

function puntuar(r){
 let s=0;
 if(r.proveedor?.estado==="OK")s+=3;
 if(r.numero?.estado==="OK")s+=2;
 if(r.fecha?.estado==="OK")s+=2;
 for(const l of r.lineas||[])s+=l.cuadre?.estado==="VERIFICADO"?3:l.estado==="OK"?1:-1;
 for(const v of r.validaciones||[])if(v.estado==="FALLO")s-=2;
 if(r.totales?.validacion?.estado==="OK")s+=2;
 return s;
}
const claveLinea=l=>M("normalizar").canon(l.referencia?.literal||"")+"|"+M("normalizar").canon(l.descripcion?.literal||"").slice(0,24);
function similitud(a,b){
 const N=M("normalizar");
 let s=0;
 if(N.canon(a.referencia?.literal)&&N.canon(a.referencia?.literal)===N.canon(b.referencia?.literal))s+=2;
 const da=N.canon(a.descripcion?.literal).slice(0,20),db=N.canon(b.descripcion?.literal).slice(0,20);
 if(da&&db&&(da===db||da.slice(0,10)===db.slice(0,10)))s+=1;
 if(a.cantidad?.valor!=null&&a.cantidad.valor===b.cantidad?.valor)s+=0.5;
 return s;
}
// Para cada línea de la principal, la línea más parecida de otra lectura (si se parece).
function emparejar(principal,otra){
 const usadas=new Set();
 return principal.map(l=>{
  let mejor=null,ms=0;
  otra.forEach((o,i)=>{if(usadas.has(i))return;const s=similitud(l,o);if(s>ms){ms=s;mejor=i;}});
  if(mejor===null||ms<1)return null;
  usadas.add(mejor);return otra[mejor];
 });
}

function combinarCabecera(principal,lecturas){
 const N=M("normalizar");
 const campos=[
  ["numero",r=>r.numero?.estado==="OK"?N.canon(r.numero.valor):null],
  ["fecha",r=>r.fecha?.estado==="OK"?r.fecha.valor:null],
  ["proveedor",r=>["OK","NIF_NO_REGISTRADO"].includes(r.proveedor?.estado)?r.proveedor.nif:null]
 ];
 for(const [k,valor] of campos){
  const validos=lecturas.map(r=>({r,v:valor(r)})).filter(x=>x.v);
  const distintos=[...new Set(validos.map(x=>x.v))];
  if(distintos.length>1){
   principal[k]={...principal[k],valor:null,nif:k==="proveedor"?null:principal[k]?.nif,estado:"AMBIGUO",
    motivos:["Lecturas OCR válidas distintas: "+distintos.join(" | ")],lecturas:validos.length};
   continue;
  }
  if(distintos.length===1){
   const acuerdo=validos.length;
   if(valor(principal)!==distintos[0])principal[k]={...validos[0].r[k]}; // la principal no lo leyó: se toma de otra
   // Lecturas del mismo motor sobre la misma imagen: coincidir NO aumenta la confianza.
   principal[k].lecturas_coincidentes=acuerdo;
  }
 }
}

function combinarLineas(principal,lecturas){
 const otras=lecturas.filter(r=>r!==principal&&r.lineas?.length);
 const parejas=otras.map(r=>emparejar(principal.lineas,r.lineas));
 principal.lineas.forEach((l,i)=>{
  const alternativas=parejas.map(p=>p[i]).filter(Boolean);
  l.lecturas_coincidentes=1+alternativas.filter(o=>claveLinea(o)===claveLinea(l)&&o.cantidad?.valor===l.cantidad?.valor).length;
  // Cifras que cuadran en otra lectura de la misma línea.
  if(l.cuadre?.estado!=="VERIFICADO"){
   const verificada=alternativas.find(o=>o.cuadre?.estado==="VERIFICADO"&&
    (!M("normalizar").canon(l.referencia?.literal)||M("normalizar").canon(o.referencia?.literal)===M("normalizar").canon(l.referencia?.literal)));
   if(verificada){
    for(const k of ["cantidad","precio","descuento","subtotal","importe","cuadre"])l[k]=verificada[k];
    if(l.referencia?.estado==="VACIO"&&verificada.referencia?.estado!=="VACIO")l.referencia=verificada.referencia;
    l.motivos=l.motivos.filter(m=>!/^(Descuadre|Cuadre incompleto|Cantidad|precio|importe|descuento|Columnas separadas)/i.test(m));
    l.notas=[...(l.notas||[]),"Cifras tomadas de otra lectura OCR de la misma línea, confirmadas por el cuadre"];
   }
  }
  // Dos lecturas válidas que discrepan en cantidad o referencia: revisión.
  const conflicto=alternativas.find(o=>o.cantidad?.estado!=="AMBIGUO"&&o.cantidad?.valor!=null&&l.cantidad?.valor!=null&&
   o.cantidad.valor!==l.cantidad.valor&&o.cuadre?.estado!=="VERIFICADO"&&l.cuadre?.estado!=="VERIFICADO");
  if(conflicto&&!l.motivos.includes("Las lecturas OCR discrepan en la cantidad"))l.motivos.push("Las lecturas OCR discrepan en la cantidad");
  l.estado=l.motivos.length?"REVISAR":"OK";
 });
}

/*
 * paginas: [{numero, anchoPx, altoPx, dpi, ocr}] · opciones: las de extraerDePaginas.
 * Devuelve el resultado combinado con `lecturas_ocr` (resumen de cada lectura).
 */
async function extraerEscaneado(paginas,opciones={}){
 const {extraerDePaginas,finalizar}=M("extraer"),{paginaDesdePalabras}=M("ocr");
 const lecturas=[],resumen=[];
 for(const conf of LECTURAS){
  const pags=[];
  for(const p of paginas)pags.push(paginaDesdePalabras(await p.ocr({psm:conf.psm}),{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi}));
  const r=extraerDePaginas(pags,opciones);r._lectura="pagina_psm"+conf.psm;
  lecturas.push(r);
 }
 let principal=[...lecturas].sort((a,b)=>puntuar(b)-puntuar(a))[0];
 // Relectura de la banda de la tabla (la zona con más cifras) con la geometría de la principal.
 const geo=principal.tablas?.[0];
 if(geo&&geo.y_cabecera!=null){
  const p=paginas.find(x=>x.numero===geo.pagina);
  const k=p.dpi/72,margen=14;
  const y0=Math.max(0,Math.floor((geo.y_cabecera-margen)*k)),y1=Math.min(p.altoPx,Math.ceil((geo.y_fin+margen)*k));
  const region=[0,y0,p.anchoPx,y1-y0];
  const palabras=await p.ocr({psm:6,region});
  const banda=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,y0]});
  const r=extraerDePaginas([banda],opciones);r._lectura="banda_tabla_psm6";
  lecturas.push(r);
 }
 // Relecturas de cabecera (sobre la tabla) y pie (bajo la tabla): ahí están CIF, número y
 // fecha; leídos por zonas, el OCR no se mezcla con el resto de la página.
 if(geo&&geo.y_cabecera!=null){
  const p=paginas.find(x=>x.numero===geo.pagina),k=p.dpi/72;
  const zonas=[["cabecera",0,Math.ceil(geo.y_cabecera*k)],["pie",Math.floor(geo.y_fin*k),p.altoPx]];
  for(const [nombre,y0,y1] of zonas){
   if(y1-y0<40)continue;
   for(const psm of [6,11]){
    const palabras=await p.ocr({psm,region:[0,y0,p.anchoPx,y1-y0]});
    const pag=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,y0]});
    const r=extraerDePaginas([pag],opciones);r._lectura=nombre+"_psm"+psm;r._solo_cabecera=true;
    lecturas.push(r);
   }
  }
 }
 for(const r of lecturas)resumen.push({lectura:r._lectura,puntuacion:puntuar(r),lineas:r.lineas.length,
  proveedor:r.proveedor?.nif||null,numero:r.numero?.valor||null,fecha:r.fecha?.valor||null,
  lineas_cuadran:r.lineas.filter(l=>l.cuadre?.estado==="VERIFICADO").length});
 combinarCabecera(principal,lecturas.filter(r=>!r._lectura.startsWith("banda")));
 combinarLineas(principal,lecturas.filter(r=>!r._solo_cabecera));
 // Recuento de líneas: la banda de la tabla es la lectura más fiable de las filas.
 const banda=lecturas.find(r=>r._lectura.startsWith("banda"));
 principal.validaciones_extra=[];
 if(banda&&banda.lineas.length&&banda.lineas.length!==principal.lineas.length)
  principal.validaciones_extra.push({nombre:"recuento_lecturas",estado:"FALLO",
   detalle:"La lectura principal tiene "+principal.lineas.length+" líneas y la relectura de la tabla "+banda.lineas.length});
 finalizar(principal);
 principal.lecturas_ocr=resumen;
 principal.lectura_principal=principal._lectura;
 return principal;
}

return {extraerEscaneado,LECTURAS};
});
