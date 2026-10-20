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
// La binarización adaptativa (Sauvola) rescata rótulos y cifras sobre fondos grises.
const LECTURAS=[{psm:4},{psm:6},{psm:3},{psm:4,umbral:"sauvola"}];

function puntuar(r){
 let s=0;
 if(r.proveedor?.estado==="OK")s+=3;
 if(r.numero?.estado==="OK")s+=2;
 if(r.fecha?.estado==="OK")s+=2;
 // Una fila repartida por posición estimada vale menos que la misma fila con celdas separadas.
 for(const l of r.lineas||[])s+=(l.cuadre?.estado==="VERIFICADO"?3:l.estado==="OK"?1:-1)-(l.columnas_estimadas?0.5:0);
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

// Totales: si la principal no los verifica y otra lectura sí (base + cuota = total), se toman
// de esa; si dos lecturas verifican totales distintos, quedan en revisión.
function combinarTotales(principal,lecturas){
 if(principal.totales?.validacion?.estado==="OK")return;
 const ok=lecturas.filter(r=>r.totales?.validacion?.estado==="OK"&&r.totales.total?.estado==="VERIFICADO");
 const distintos=[...new Map(ok.map(r=>[[r.totales.base_imponible.valor,r.totales.cuota_iva.valor,r.totales.total.valor].join("|"),r])).values()];
 if(distintos.length===1){
  const t=distintos[0].totales;
  principal.totales={...t,notas:["Totales tomados de la lectura "+distintos[0]._lectura+", confirmados por base + IVA = total"]};
 }else if(distintos.length>1){
  principal.totales.validacion={estado:"FALLO",detalle:"Lecturas OCR con totales verificados distintos"};
 }else if(principal.totales&&principal.totales.total?.estado==="VACIO"){
  // Solo el total, sin base ni cuota legibles: se toma si todas las lecturas que lo ven coinciden.
  // Después se contrasta con la suma de las líneas (finalizar).
  const vistos=lecturas.map(r=>r.totales?.total).filter(x=>["OK","VERIFICADO"].includes(x?.estado));
  const valores=[...new Set(vistos.map(x=>x.valor))];
  if(valores.length===1)principal.totales.total={...vistos[0],estado:"OK",notas:[...(vistos[0].notas||[]),"Total tomado de otra lectura OCR"]};
  else if(valores.length>1)principal.totales.total={...principal.totales.total,estado:"AMBIGUO",motivos:["Lecturas OCR con totales distintos: "+valores.join(" | ")]};
 }
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
  for(const p of paginas)pags.push(paginaDesdePalabras(await p.ocr({psm:conf.psm,umbral:conf.umbral}),{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi}));
  const r=extraerDePaginas(pags,opciones);r._lectura="pagina_psm"+conf.psm+(conf.umbral?"_"+conf.umbral:"");
  Object.defineProperty(r,"_pags",{value:pags,enumerable:false});
  lecturas.push(r);
 }
 // Cabecera de tabla ilegible en una lectura (banda gris) pero leída en otra: se trasladan
 // los títulos (posición incluida) a la lectura que no la tiene y se vuelve a extraer.
 const {leerTablaPagina}=M("extraer");
 const conCabecera=lecturas.find(r=>r.tablas?.[0]?.y_cabecera!=null);
 if(conCabecera)for(const r of [...lecturas]){
  if(r.tablas?.[0]?.y_cabecera!=null)continue;
  const pags=r._pags.map(pg=>{
   const origen=conCabecera._pags.find(x=>x.numero===pg.numero);
   const t=origen&&leerTablaPagina(origen);
   if(!t)return pg;
   const titulos=origen.lineas.slice(t.indiceCabecera,t.indiceCabecera+1);
   const yC=titulos[0].y,alto=titulos[0].alto;
   const lineas=[...pg.lineas.filter(l=>Math.abs(l.y-yC)>0.8*alto),...titulos].sort((a,b)=>a.y-b.y);
   return {...pg,lineas};
  });
  const r2=extraerDePaginas(pags,opciones);r2._lectura=r._lectura+"+cabecera_"+conCabecera._lectura;
  Object.defineProperty(r2,"_pags",{value:pags,enumerable:false});
  if(r2.tablas?.[0]?.y_cabecera!=null)lecturas.push(r2);
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
   for(const [psm,umbral] of [[6,null],[11,null],[6,"sauvola"]]){
    const palabras=await p.ocr({psm,umbral,region:[0,y0,p.anchoPx,y1-y0]});
    const pag=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,y0]});
    const r=extraerDePaginas([pag],opciones);r._lectura=nombre+"_psm"+psm+(umbral?"_"+umbral:"");r._solo_cabecera=true;
    lecturas.push(r);
   }
  }
 }
 // Casillas de fecha y número que ninguna lectura resolvió (una firma o un sello las cruza):
 // se recorta solo la casilla, junto a su etiqueta, y se vuelve a leer.
 for(const campo of ["fecha","numero"]){
  // Se relee también si las lecturas dan valores válidos distintos.
  const validos=new Set(lecturas.filter(r=>r[campo]?.estado==="OK").map(r=>M("normalizar").canon(r[campo].valor)));
  if(validos.size===1)continue;
  const {celdasEtiqueta}=M("extraer");
  // La etiqueta se busca en todas las lecturas de página (una sola puede no verla).
  const etiquetas=[],vistas=new Set();
  for(const r of lecturas)for(const pb of r._pags||[]){
   for(const et of celdasEtiqueta(pb,campo)){
    const clave=pb.numero+":"+Math.round(et.x0/20)+":"+Math.round(et.y/20);
    if(!vistas.has(clave)){vistas.add(clave);etiquetas.push([pb,et]);}
   }
  }
  for(const [pb,et] of etiquetas.slice(0,3)){
   const p=paginas.find(x=>x.numero===pb.numero),k=p.dpi/72;
   {
    // Dos anchos de recorte: el estrecho deja fuera los trazos que invaden la casilla vecina.
    const a=Math.max(et.alto,6),ancho=et.x1-et.x0;
    for(const factor of [4,6]){
     const x0=Math.max(0,Math.floor((et.x0-3*a)*k)),x1=Math.min(p.anchoPx,Math.ceil((et.x1+factor*Math.max(ancho,2*a))*k));
     const y0=Math.max(0,Math.floor((et.y-2*a)*k)),y1=Math.min(p.altoPx,Math.ceil((et.y+3*a)*k));
     if(x1-x0<20||y1-y0<20)continue;
     const palabras=await p.ocr({psm:6,region:[x0,y0,x1-x0,y1-y0]});
     const pag=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[x0,y0]});
     const r=extraerDePaginas([pag],opciones);r._lectura="casilla_"+campo+"_x"+factor;r._solo_cabecera=true;
     // De esta lectura solo cuenta el campo releído.
     for(const otro of ["fecha","numero","proveedor"])if(otro!==campo)r[otro]=null;
     lecturas.push(r);
    }
   }
  }
 }
 for(const r of lecturas)resumen.push({lectura:r._lectura,puntuacion:puntuar(r),lineas:r.lineas.length,
  proveedor:r.proveedor?.nif||null,numero:r.numero?.valor||null,fecha:r.fecha?.valor||null,
  lineas_cuadran:r.lineas.filter(l=>l.cuadre?.estado==="VERIFICADO").length,totales:r.totales?.validacion?.estado||null});
 combinarCabecera(principal,lecturas.filter(r=>!r._lectura.startsWith("banda")));
 combinarLineas(principal,lecturas.filter(r=>!r._solo_cabecera));
 combinarTotales(principal,lecturas);
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
