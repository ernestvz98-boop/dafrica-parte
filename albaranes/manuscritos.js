"use strict";
/*
 * DAFRICA · Anotaciones manuscritas de DAFRICA en los albaranes escaneados.
 *
 * En la oficina se escribe a mano sobre el albarán:
 *   - el número del albarán ya registrado en STEL: «ABP26 1234» (serie ABP + año + número);
 *   - el código de obra (proyecto STEL): «PRY00123» (PRY + 5 cifras).
 * Tesseract no lee cifras manuscritas. Este módulo:
 *   1. localiza en la imagen los trazos que no son texto impreso (detectarRegiones);
 *   2. pide a un motor de visión SOLO esos recortes (nunca la página, nunca precios ni cantidades);
 *   3. acepta un código únicamente si se valida por contexto (validarCodigos):
 *      formato, obra impresa, coherencia con otros albaranes del lote, catálogo de obras y
 *      albarán de compra de STEL (proveedor, número, fecha). Si quedan dos interpretaciones
 *      plausibles y ninguna se valida, el campo no se resuelve.
 * Cada código resuelto guarda valor, confianza, método y evidencias.
 * Funciones puras salvo leerManuscritos, que llama a los motores recibidos.
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.manuscritos=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

/* ------------------------------ Detección ------------------------------ */
/*
 * gris: {ancho, alto, datos} (un byte por píxel, 0 = negro) a baja resolución (`dpi`).
 * impresas: cajas [x0, y0, x1, y1] (en píxeles de `gris`) de palabras impresas leídas con
 * fiabilidad por el OCR: se borran antes de buscar trazos.
 * Devuelve las zonas con aspecto de una anotación escrita en una línea (ancho > alto, altura
 * de letra manuscrita), de mayor a menor, en píxeles de `gris`.
 */
function detectarRegiones(gris,impresas=[],{dpi=75,maximo=8,todas=false}={}){
 const {ancho:W,alto:H,datos}=gris;
 const tinta=new Uint8Array(W*H);
 // Umbral alto: el bolígrafo claro o el lápiz quedan entre 150 y 205 al reducir la imagen.
 for(let i=0;i<W*H;i++)tinta[i]=datos[i]<205?1:0;
 const base=tinta.slice();
 for(const [x0,y0,x1,y1] of impresas){
  for(let y=Math.max(0,Math.floor(y0)-1);y<=Math.min(H-1,Math.ceil(y1)+1);y++)
   for(let x=Math.max(0,Math.floor(x0)-1);x<=Math.min(W-1,Math.ceil(x1)+1);x++)tinta[y*W+x]=0;
 }
 const mm=dpi/25.4;
 // Rayas largas (tabla, subrayados a bolígrafo que cruzan la anotación): se borran los tramos
 // horizontales o verticales continuos de más de 12 mm; ningún trazo de letra es tan largo.
 const largo=Math.round(12*mm),borrar=[];
 for(let y=0;y<H;y++){let x=0;while(x<W){if(!tinta[y*W+x]){x++;continue;}let e=x;while(e<W&&tinta[y*W+e])e++;if(e-x>=largo)borrar.push([y*W+x,e-x,1]);x=e;}}
 for(let x=0;x<W;x++){let y=0;while(y<H){if(!tinta[y*W+x]){y++;continue;}let e=y;while(e<H&&tinta[e*W+x])e++;if(e-y>=largo)borrar.push([y*W+x,e-y,W]);y=e;}}
 // Donde la raya cruza un trazo (tinta justo encima y debajo, o a ambos lados) se conserva el
 // cruce: si no, las letras subrayadas quedarían partidas en dos.
 const orig=base.slice(),en=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&orig[y*W+x];
 for(const [i,n,paso] of borrar)for(let k=0;k<n;k++){
  const q=i+k*paso,x=q%W,y=(q-x)/W;
  const cruce=paso===1?(en(x,y-2)||en(x,y-3))&&(en(x,y+2)||en(x,y+3)):(en(x-2,y)||en(x-3,y))&&(en(x+2,y)||en(x+3,y));
  if(!cruce){tinta[q]=0;base[q]=0;}
 }
 // Componentes de la tinta completa (sin borrar el impreso): para completar cada anotación con
 // las letras que el OCR haya leído como texto (un «PRY» manuscrito leído con confianza media).
 const completa=componentes(base,W,H).filter(c=>c.n>=3);
 // Componentes conexos de la tinta restante.
 const comps=componentes(tinta,W,H);
 // Fuera: motas, rayas de tabla, recuadros y bloques demasiado grandes para ser escritura.
 const trazos=comps.filter(c=>{
  const w=c.x1-c.x0+1,h=c.y1-c.y0+1;
  if(c.n<3)return false;
  if(w>12*h&&h<1.2*mm)return false;
  if(h>12*w&&w<1.2*mm)return false;
  if(w>0.45*W||h>0.25*H)return false;
  return true;
 });
 // Trazos de una misma anotación: misma franja vertical y separados menos de ~6 mm.
 const hueco=6*mm;
 const grupos=agrupar(trazos,(a,b)=>{
  const solapeV=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);
  const altoMin=Math.min(a.y1-a.y0,b.y1-b.y0)+1;
  const dx=Math.max(0,Math.max(a.x0,b.x0)-Math.min(a.x1,b.x1));
  // Hueco entre letras: 6 mm, o más si la escritura es grande («P R Y  0 0 1 1 1» espaciado).
  // Solo trazos de altura parecida (una firma o un círculo al lado no se unen al código).
  const ha=a.y1-a.y0+1,hb=b.y1-b.y0+1;
  return solapeV>0.3*altoMin&&Math.max(ha,hb)<=2.5*Math.min(ha,hb)+2&&dx<=Math.max(hueco,1.3*Math.max(ha,hb));
 });
 const zonas=grupos.map(g=>({x0:Math.min(...g.map(c=>c.x0)),y0:Math.min(...g.map(c=>c.y0)),x1:Math.max(...g.map(c=>c.x1)),y1:Math.max(...g.map(c=>c.y1)),
  trazos:g.length,tinta:g.reduce((n,c)=>n+c.n,0)}));
 // Una línea manuscrita: 3–25 mm de alto, más ancha que alta, con varios trazos (letras).
 // Cada zona se completa con la tinta vecina de su misma franja (letras borradas como impresas).
 for(const z of zonas){
  // Franja vertical original: crecer en cadena no puede arrastrar firmas o anotaciones vecinas.
  const h=z.y1-z.y0+1,fy0=z.y0,fy1=z.y1;let cambio=true;
  while(cambio){
   cambio=false;
   for(const c of completa){
    if(c.x0>=z.x0&&c.x1<=z.x1&&c.y0>=z.y0&&c.y1<=z.y1)continue;
    const ch=c.y1-c.y0+1,cw=c.x1-c.x0+1;
    if(ch>1.6*h||cw>0.45*W)continue;
    const solape=Math.min(fy1,c.y1)-Math.max(fy0,c.y0);
    if(Math.max(z.y1,c.y1)-Math.min(z.y0,c.y0)>1.8*h)continue;
    const dx=Math.max(0,Math.max(z.x0,c.x0)-Math.min(z.x1,c.x1));
    if(solape>0.4*Math.min(h,ch)&&dx<=Math.max(hueco,1.3*h)&&Math.max(z.x1,c.x1)-Math.min(z.x0,c.x0)<=0.45*W){
     z.x0=Math.min(z.x0,c.x0);z.x1=Math.max(z.x1,c.x1);z.y0=Math.min(z.y0,c.y0);z.y1=Math.max(z.y1,c.y1);cambio=true;
    }
   }
  }
 }
 // Zonas solapadas tras crecer: una sola.
 for(let i=0;i<zonas.length;i++)for(let j=zonas.length-1;j>i;j--){
  const a=zonas[i],b=zonas[j];
  const ha=a.y1-a.y0+1,hb=b.y1-b.y0+1;
  // Solo zonas de la misma línea de escritura (una firma grande encima de un código no se une).
  if(Math.min(a.x1,b.x1)>=Math.max(a.x0,b.x0)&&Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)>0.5*Math.min(ha,hb)&&Math.max(ha,hb)<=2*Math.min(ha,hb)){
   a.x0=Math.min(a.x0,b.x0);a.x1=Math.max(a.x1,b.x1);a.y0=Math.min(a.y0,b.y0);a.y1=Math.max(a.y1,b.y1);a.trazos+=b.trazos;zonas.splice(j,1);
  }
 }
 // Densidad de tinta de la caja: la escritura a bolígrafo es un trazo fino (poca tinta); los
 // rótulos, logotipos y anuncios impresos son trazos gruesos (mucha tinta).
 for(const z of zonas){let n=0;for(let y=z.y0;y<=z.y1;y++)for(let x=z.x0;x<=z.x1;x++)if(base[y*W+x])n++;z.densidad=n/((z.x1-z.x0+1)*(z.y1-z.y0+1));}
 // Fuera también el texto impreso claro sobre bandas grises (fondo oscuro en la caja).
 const fondoOscuro=z=>{let n=0,t=0;for(let y=z.y0;y<=z.y1;y++)for(let x=z.x0;x<=z.x1;x++){t++;if(datos[y*W+x]<200)n++;}return n>0.45*t;};
 if(todas)return zonas;
 return zonas.filter(z=>{const w=z.x1-z.x0+1,h=z.y1-z.y0+1;return h>=4.5*mm&&h<=25*mm&&w>=1.8*h&&w>=15*mm&&(z.trazos>=3||(z.trazos>=2&&w>=3*h))&&z.densidad<=0.36&&!fondoOscuro(z);})
  // Primero lo más parecido a escritura a mano (trazo fino).
  .sort((a,b)=>a.densidad-b.densidad).slice(0,maximo);
}

function componentes(m,W,H){
 const vista=new Uint8Array(W*H),salida=[],pila=[];
 for(let i=0;i<W*H;i++){
  if(!m[i]||vista[i])continue;
  let x0=W,y0=H,x1=0,y1=0,n=0;
  pila.push(i);vista[i]=1;
  while(pila.length){
   const p=pila.pop(),x=p%W,y=(p-x)/W;n++;
   if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=W||yy>=H)continue;
    const q=yy*W+xx;if(m[q]&&!vista[q]){vista[q]=1;pila.push(q);}
   }
  }
  salida.push({x0,y0,x1,y1,n});
 }
 return salida;
}
// Grupos por cierre transitivo de la relación `unir` (unión-búsqueda).
function agrupar(items,unir){
 const padre=items.map((_,i)=>i);
 const raiz=i=>padre[i]===i?i:(padre[i]=raiz(padre[i]));
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(unir(items[i],items[j]))padre[raiz(i)]=raiz(j);
 const g=new Map();
 items.forEach((c,i)=>{const r=raiz(i);if(!g.has(r))g.set(r,[]);g.get(r).push(c);});
 const grupos=[...g.values()];
 return grupos;
}

/* ------------------------------ Validación ----------------------------- */
const FORMATOS={
 obra:/^PRY\d{5}$/,
 // Serie del año (ABP26) + número: «ABP261234» se guarda como «ABP26-1234».
 stel:/^ABP\d{2}\d{4}$/
};
const canon=t=>String(t||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const formatoStel=c=>c.slice(0,5)+"-"+c.slice(5);
const cifrasObra=t=>{const m=String(t||"").match(/\b(\d{5})\s*$/);return m?m[1]:null;};

/*
 * lecturas: [{indice, texto_literal, tachado, tipo, lecturas:[{codigo, confianza}]}] (motor de visión).
 * ctx: {obraImpresa, proveedorId, numero, fecha, anio, lote:[{obraImpresa, obra:{valor, estado}}],
 *       catalogoObras:[{codigo, nombre}] | null, albaranStel(codigo) → {proveedorId, numero, fecha} | null}
 * Devuelve {obra, stel}: cada uno {valor, literal, estado, confianza, resolucion{metodo, evidencias, alternativas}}.
 */
function validarCodigos(lecturas,ctx={}){
 const salida={};
 for(const [campo,tipo] of [["obra","PRY"],["stel","ABP"]]){
  const vistas=(lecturas||[]).filter(l=>l.tipo===tipo&&!l.tachado);
  const tachadas=(lecturas||[]).filter(l=>l.tipo===tipo&&l.tachado).map(l=>l.texto_literal);
  // Solo tachadas: no se usan como valor, pero la visión no es fiable decidiendo qué está tachado
  // (el mismo código, tachado en una lectura y no en otra): queda pendiente de revisión.
  if(!vistas.length){salida[campo]={...vacio(tachadas.length?["Solo hay anotaciones tachadas: "+tachadas.join(", ")]:[]),literal:tachadas.join(" | ")};continue;}
  // Interpretaciones con el formato conocido (varias anotaciones o varias lecturas de una).
  const cand=new Map();
  for(const v of vistas)for(const l of v.lecturas||[]){
   let c=canon(l.codigo);
   // Código de obra con el prefijo cortado o borroso («Y12345»): las 5 cifras son el dato; el
   // prefijo PRY es fijo. Solo si la anotación es de tipo PRY.
   const parcial=campo==="obra"&&c.match(/^(?:P?R?Y)(\d{5})$/);
   if(parcial)c="PRY"+parcial[1];
   if(!FORMATOS[campo].test(c))continue;
   const x=cand.get(c)||{codigo:c,confianza:0,literales:new Set(),anotaciones:0};
   x.confianza=Math.max(x.confianza,Number(l.confianza)||0);x.literales.add(v.texto_literal);x.anotaciones++;
   cand.set(c,x);
  }
  const literal=vistas.map(v=>v.texto_literal).join(" | ");
  if(!cand.size){salida[campo]={...vacio(["Anotación «"+literal+"» sin el formato "+(campo==="obra"?"PRY + 5 cifras":"ABP + año + 4 cifras")]),literal};continue;}
  const lista=[...cand.values()];
  for(const x of lista)x.evidencias=evidencias(campo,x.codigo,ctx);
  // Existir en el catálogo de obras solo decide entre VARIAS lecturas de la visión (1/7): los
  // códigos PRY son correlativos y una cifra mal leída suele dar otro código que también existe.
  // Solo con el catálogo COMPLETO (el de STEL): en una lista parcial la lectura correcta puede faltar.
  if(campo==="obra"&&lista.length>1&&ctx.catalogoObrasCompleto!==false){
   const enCatalogo=lista.filter(x=>(ctx.catalogoObras||[]).filter(o=>canon(o.codigo)===x.codigo).length===1);
   if(enCatalogo.length===1&&!enCatalogo[0].evidencias.length)
    enCatalogo[0].evidencias.push("De las lecturas "+lista.map(x=>x.codigo).join(" / ")+", solo esta existe en el catálogo de obras: «"+
     (ctx.catalogoObras.find(o=>canon(o.codigo)===enCatalogo[0].codigo).nombre)+"»");
  }
  const validadas=lista.filter(x=>x.evidencias.length);
  const alternativas=lista.map(x=>x.codigo);
  if(validadas.length===1){
   const x=validadas[0];
   salida[campo]={valor:campo==="stel"?formatoStel(x.codigo):x.codigo,literal,estado:"OK",confianza:0.95,
    resolucion:{metodo:"vision_recorte_validada",evidencias:["Visión: «"+literal+"»",...x.evidencias],alternativas}};
  }else if(validadas.length>1){
   salida[campo]={valor:null,literal,estado:"AMBIGUO",confianza:0,motivos:["Varias interpretaciones validadas: "+validadas.map(x=>x.codigo).join(" / ")],resolucion:{alternativas}};
  }else if(lista.length===1&&lista[0].confianza>=0.9){
   // Una sola lectura con el formato, pero nada externo la confirma: propuesta, no aceptada.
   const x=lista[0];
   salida[campo]={valor:campo==="stel"?formatoStel(x.codigo):x.codigo,literal,estado:"REVISAR",confianza:0.8,
    motivos:["Formato correcto pero sin validación por obra impresa, lote, catálogo ni STEL"],resolucion:{metodo:"vision_recorte",evidencias:["Visión: «"+literal+"»"],alternativas}};
  }else{
   salida[campo]={valor:null,literal,estado:"AMBIGUO",confianza:0,motivos:["Interpretaciones plausibles sin validar: "+alternativas.join(" / ")],resolucion:{alternativas}};
  }
 }
 return salida;
}
const vacio=motivos=>({valor:null,literal:"",estado:"VACIO",confianza:null,motivos});

function evidencias(campo,codigo,ctx){
 const ev=[];
 if(campo==="obra"){
  for(const t of [].concat(ctx.obraImpresa||[])){
   const num=cifrasObra(t);
   if(num&&codigo.slice(3)===num)ev.push("Coincide con el número de la obra impresa «"+t+"»");
  }
  // Catálogo de obras: el código existe (una vez) y su nombre comparte una palabra distintiva con
  // la obra impresa o escrita en el albarán.
  const cat=(ctx.catalogoObras||[]).filter(o=>canon(o.codigo)===codigo);
  if(cat.length===1){
   const delAlbaran=new Set([...[].concat(ctx.obraImpresa||[]),...[].concat(ctx.obraEscrita||[])].flatMap(t=>[...palabrasObra(t)]));
   const comunes=[...palabrasObra(cat[0].nombre)].filter(p=>delAlbaran.has(p));
   if(comunes.length)ev.push("Obra «"+cat[0].nombre+"» del catálogo de STEL, con «"+comunes.join(", ")+"» también en el albarán");
  }
 }else{
  const alb=typeof ctx.albaranStel==="function"?ctx.albaranStel(formatoStel(codigo)):null;
  if(alb){
   const mismoProv=ctx.proveedorId!=null&&String(alb.proveedorId)===String(ctx.proveedorId);
   const mismoNum=ctx.numero&&canon(alb.numero)===canon(ctx.numero);
   const mismaFecha=ctx.fecha&&alb.fecha===ctx.fecha;
   if(mismoProv&&(mismoNum||mismaFecha))ev.push("Albarán STEL "+formatoStel(codigo)+": mismo proveedor"+(mismoNum?", mismo número":"")+(mismaFecha?", misma fecha":""));
  }
 }
 return ev;
}

/*
 * Palabras que identifican una obra («MOLINO», «VEGAS», «NAVE», «PISCINAS»…), sin rótulos,
 * números ni palabras comunes a todos los albaranes (la comarca, la empresa, el almacén).
 */
const VACIAS=new Set(["OBRA","OBRAS","REF","REFERENCIA","DATOS","PEDIDO","SU","DE","DEL","LA","EL","LOS","LAS","Y","EN","SL","SLU","SA",
 "DAFRICA","BIERZO","LEON","PONFERRADA","CAMPONARAYA","ALMACEN","STOCK","TALLER","SUMINISTRO","MONTAJE","ENTREGA","CONTACTO","RETIRADO","POR"]);
function palabrasObra(t){
 return new Set(String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z ]/g," ")
  .split(/\s+/).filter(x=>x.length>=4&&!VACIAS.has(x)));
}
const claveObra=t=>{const p=[...palabrasObra(t)].sort();return p.length?p.join(" "):null;};
const palabrasDoc=d=>new Set([...[].concat(d.obraImpresa||[]),...[].concat(d.obraEscrita||[])].flatMap(t=>[...palabrasObra(t)]));

/*
 * Coherencia del lote. Un código de obra que la visión lee con el formato correcto se acepta
 * si en OTRO albarán del lote ese mismo código está VALIDADO con evidencia independiente de la
 * visión (número de obra impreso, catálogo de obras, STEL), ambos comparten una palabra distintiva
 * de obra (impresa o escrita) y ningún albarán del lote con esa palabra tiene un código distinto.
 * Dos lecturas de visión que coinciden NO bastan: es el mismo motor sobre la letra del mismo autor
 * y se equivoca igual (fallo real: un código de obra «…88» leído «…38» en dos albaranes, 2026-10-21).
 * Si el lote se contradice, no se acepta nada por esta vía.
 * docs: [{obraImpresa:[…], obraEscrita:[…], obra:{valor, estado, …}}] (se modifican).
 */
const VALIDADA_INDEPENDIENTE=new Set(["vision_recorte_validada","etiqueta_qr"]);
function coherenciaLote(docs){
 const leidos=docs.filter(d=>d.obra?.valor&&["OK","REVISAR"].includes(d.obra.estado));
 let cambios=0;
 for(const d of leidos){
  if(d.obra.estado!=="REVISAR")continue;
  const mias=palabrasDoc(d);
  if(!mias.size)continue;
  const afines=leidos.filter(o=>o!==d&&[...palabrasDoc(o)].some(p=>mias.has(p)));
  const iguales=afines.filter(o=>o.obra.valor===d.obra.valor);
  const distintos=afines.filter(o=>o.obra.valor!==d.obra.valor);
  const anclas=iguales.filter(o=>o.obra.estado==="OK"&&VALIDADA_INDEPENDIENTE.has(o.obra.resolucion?.metodo));
  if(anclas.length&&!distintos.length){
   const comunes=[...new Set(iguales.flatMap(o=>[...palabrasDoc(o)].filter(p=>mias.has(p))))];
   d.obra={...d.obra,estado:"OK",confianza:0.93,motivos:[],
    resolucion:{...d.obra.resolucion,metodo:"vision_recorte_coherencia_lote",
     evidencias:[...(d.obra.resolucion?.evidencias||[]),"Mismo código validado en "+anclas.length+" albarán(es) más del lote ("+
      anclas.flatMap(o=>(o.obra.resolucion?.evidencias||[]).slice(1,2)).join("; ")+") con la obra «"+comunes.join(", ")+"», sin códigos contradictorios"]}};
   cambios++;
  }
 }
 return cambios;
}

/* Textos de obra impresos: «OBRA: …», «Referencia: OBRA …», «OBRA/DATOS» con su casilla, «SU PEDIDO: …». */
const RE_OBRA=/^(?:.*\b(?:OBRA(?:\/DATOS)?|SU PEDIDO|S\/REF|REFERENCIA)\b\s*[:.]?)\s*(.+)$/i;
function obrasImpresas(lineas){
 const out=[];
 for(const l of lineas||[]){
  const t=String(l.texto||"").trim();
  const m=t.match(RE_OBRA);
  if(m&&m[1]&&/[A-Za-z]{4}/.test(m[1]))out.push(m[1].trim());
 }
 return [...new Set(out)];
}

/*
 * Flujo completo sobre un albarán escaneado ya leído (`resultado`, de escaneado.js).
 * paginas: páginas OCR con gris(factor) y recortePng([x, y, w, h]).
 * vision(recortes) → [{indice, texto_literal, tachado, tipo, lecturas}] (motor de visión SOLO de recortes).
 * Devuelve {obra, stel, obraImpresa, obraEscrita, recortes} o null si no hay motor o imagen.
 */
async function leerManuscritos(paginas,resultado,vision,ctx={}){
 if(typeof vision!=="function")return null;
 const lecturas=[],recortes=[];
 for(const p of paginas){
  if(typeof p.gris!=="function"||typeof p.recortePng!=="function")continue;
  const g=p.gris(4),k=g.dpi/72,f=p.anchoPx/g.ancho;
  // Texto impreso leído con fiabilidad (se borra antes de buscar trazos).
  // Solo con la altura del texto impreso de la página: un manuscrito leído por el OCR es más alto.
  const impresas=[],lineas=(resultado._pags||[]).filter(x=>x.numero===p.numero).flatMap(pg=>pg.lineas);
  const altos=lineas.map(l=>l.alto).sort((a,b)=>a-b),mediana=altos[Math.floor(altos.length/2)]||10;
  for(const l of lineas)for(const c of l.celdas)if((c.conf??100)>=60&&l.alto<=1.5*mediana)impresas.push([c.x0*k,(l.y-l.alto)*k,c.x1*k,l.y*k]);
  const zonas=detectarRegiones(g,impresas,{dpi:g.dpi});
  for(const z of zonas){
   // Margen: 0,35 alturas arriba y abajo; 2 alturas a los lados, porque los extremos de un
   // código escrito con trazo muy claro («PR…», «…03») pueden quedar fuera de la zona detectada.
   const h=(z.y1-z.y0+1)*f,m=0.35*h,mx=2*h;
   const x0=Math.max(0,Math.floor(z.x0*f-mx)),y0=Math.max(0,Math.floor(z.y0*f-m));
   const x1=Math.min(p.anchoPx,Math.ceil((z.x1+1)*f+mx)),y1=Math.min(p.altoPx,Math.ceil((z.y1+1)*f+m));
   recortes.push({pagina:p.numero,caja:[x0,y0,x1-x0,y1-y0],png:p.recortePng([x0,y0,x1-x0,y1-y0])});
  }
 }
 if(!recortes.length)return {obra:vacio([]),stel:vacio([]),obraImpresa:[],obraEscrita:[],recortes:[]};
 for(let i=0;i<recortes.length;i+=8){
  const r=await vision(recortes.slice(i,i+8).map(x=>x.png));
  for(const x of r||[])if(Number.isInteger(x.indice)&&recortes[i+x.indice])lecturas.push({...x,indice:i+x.indice});
 }
 const lineas=(resultado._pags||[]).flatMap(p=>p.lineas);
 const obraImpresa=[...obrasImpresas(lineas),...(resultado.lineas_ignoradas||[]).map(x=>String(x.texto||""))
  // Anotación corta impresa o escrita en la tabla («Vegas», «OBRA VEGAS»), no nombres ni cifras.
  .filter(t=>t.split(/\s+/).length<=3&&!/\d/.test(t)&&palabrasObra(t).size)];
 const obraEscrita=lecturas.filter(l=>l.tipo==="OTRO"&&!l.tachado&&palabrasObra(l.texto_literal).size).map(l=>l.texto_literal);
 const ctxValidar={...ctx,obraImpresa,obraEscrita,proveedorId:resultado.proveedor?.id,numero:resultado.numero?.valor,fecha:resultado.fecha?.valor};
 const v=validarCodigos(lecturas,ctxValidar);
 const salida={...v,obraImpresa,obraEscrita,recortes:recortes.map((x,i)=>({pagina:x.pagina,caja:x.caja,lectura:lecturas.find(l=>l.indice===i)||null}))};
 if(ctx.compararModelos)salida.comparacion=await compararModelos(recortes,v,ctxValidar,ctx.compararModelos);
 return salida;
}

/*
 * PRUEBA de otros modelos de visión sobre los MISMOS recortes (solo para medir; no cambia el
 * resultado). Cada modelo pasa por la misma validación (validarCodigos) que el principal; la
 * validación posterior con STEL y la coherencia del lote se aplican después en el navegador a
 * todos por igual. opciones: {modelos:[…], vision(pngs, modelo) → {recortes, uso}}.
 */
const copiaCodigo=m=>m?{valor:m.valor??null,literal:m.literal??null,estado:m.estado,confianza:m.confianza??null,
 resolucion:m.resolucion?{metodo:m.resolucion.metodo||null,alternativas:m.resolucion.alternativas||[]}:null}:null;
async function compararModelos(recortes,principal,ctxValidar,{modelos=[],vision}={}){
 const out={principal:{obra:copiaCodigo(principal.obra),stel:copiaCodigo(principal.stel)},modelos:{}};
 if(typeof vision!=="function")return out;
 await Promise.all(modelos.map(async modelo=>{
  const lecturas=[],uso={input_tokens:0,output_tokens:0,llamadas:0};
  try{
   for(let i=0;i<recortes.length;i+=8){
    const r=await vision(recortes.slice(i,i+8).map(x=>x.png),modelo);
    uso.llamadas++;uso.input_tokens+=r?.uso?.input_tokens||0;uso.output_tokens+=r?.uso?.output_tokens||0;
    for(const x of r?.recortes||[])if(Number.isInteger(x.indice)&&recortes[i+x.indice])lecturas.push({...x,indice:i+x.indice});
   }
   const v=validarCodigos(lecturas,ctxValidar);
   out.modelos[modelo]={obra:copiaCodigo(v.obra),stel:copiaCodigo(v.stel),uso,
    lecturas:lecturas.map(l=>({indice:l.indice,tipo:l.tipo,tachado:!!l.tachado,texto_literal:String(l.texto_literal||"").slice(0,60),lecturas:(l.lecturas||[]).slice(0,4)}))};
  }catch(e){out.modelos[modelo]={error:String(e?.message||e).slice(0,160),uso};}
 }));
 return out;
}

/*
 * Estado del albarán según sus manuscritos: un código de obra o de STEL leído pero sin validar
 * (REVISAR, AMBIGUO, o una anotación sin el formato) impide AUTO_OK. Tras una validación posterior
 * (catálogo, lote, STEL) se recalcula el estado base (extraer.finalizar) y se vuelve a aplicar.
 */
const PREFIJO_PENDIENTE="Código manuscrito sin validar";
function pendientes(m){
 return m?["obra","stel"].filter(k=>m[k]&&(["REVISAR","AMBIGUO"].includes(m[k].estado)||(m[k].estado==="VACIO"&&m[k].literal))):[];
}
// Ningún código detectado (ni leído): la anotación puede existir y no haberse visto (fallo real,
// 2026-10-22: un código de obra y un ABP escritos no detectados en albaranes dados por AUTO_OK).
const PREFIJO_FALTA="Código manuscrito no detectado";
function aplicarEstado(r){
 if(!r?.manuscritos)return r;
 r.incidencias=(r.incidencias||[]).filter(i=>!String(i).startsWith(PREFIJO_PENDIENTE)&&!String(i).startsWith(PREFIJO_FALTA));
 const p=pendientes(r.manuscritos);
 if(p.length){
  if(r.estado==="AUTO_OK")r.estado="REVISAR";
  r.incidencias.push(PREFIJO_PENDIENTE+": "+p.map(k=>(k==="obra"?"obra":"STEL")+" «"+(r.manuscritos[k].literal||r.manuscritos[k].valor)+"» ("+r.manuscritos[k].estado+")").join(", "));
 }
 const faltan=["obra","stel"].filter(k=>!r.manuscritos[k]||(r.manuscritos[k].estado==="VACIO"&&!r.manuscritos[k].literal));
 if(faltan.length){
  if(r.estado==="AUTO_OK")r.estado="REVISAR";
  r.incidencias.push(PREFIJO_FALTA+": "+faltan.map(k=>k==="obra"?"obra (PRY)":"STEL (ABP)").join(", ")+"; comprueba el papel");
 }
 return r;
}

/*
 * Código STEL manuscrito («ABP26 2702») contrastado con el albarán de compra de STEL de SOLO
 * LECTURA: se acepta una interpretación si STEL tiene exactamente un albarán con esa referencia,
 * del mismo proveedor (nombre de la cuenta) y con la misma fecha o con el número del proveedor
 * en su referencia externa. Si valida más de una interpretación, no se resuelve.
 * consultar(referencia) → [{fullReference, supplier, date, extraReference}] (función Edge).
 */
const canonNombre=t=>String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/(SLU|SAU|SL|SA)$/,"");
function fechaStel(v){
 if(v==null||v==="")return null;
 if(typeof v==="number"||/^\d{10,13}$/.test(String(v))){const n=Number(v);const d=new Date(n<1e12?n*1000:n);return isNaN(d)?null:d.toISOString().slice(0,10);}
 const m=String(v).match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];
 const d=new Date(v);return isNaN(d)?null:d.toISOString().slice(0,10);
}
async function validarStel(r,consultar,{proveedorNombre=null,diagnostico=null}={}){
 const m=r?.manuscritos?.stel;
 if(!m||!["REVISAR","AMBIGUO"].includes(m.estado)||typeof consultar!=="function")return false;
 const nombre=proveedorNombre||r.proveedor?.nombre;
 const cuenta=r.proveedor?.account_id;
 if(!nombre&&cuenta==null)return false;
 const alternativas=[...new Set((m.resolucion?.alternativas||[]).map(canon).filter(c=>FORMATOS.stel.test(c)))];
 const validas=[];
 for(const c of alternativas){
  const docs=(await consultar(formatoStel(c)))||[];
  const exactos=docs.filter(d=>canon(d.fullReference)===c);
  if(exactos.length!==1)continue;
  const d=exactos[0];
  // Proveedor: la cuenta de STEL (la misma que verificó el CIF en el catálogo) o, si no hay, el nombre.
  const mismoProv=cuenta!=null&&d.accountId!=null?String(d.accountId)===String(cuenta):
   canonNombre(d.supplier)!==""&&canonNombre(d.supplier)===canonNombre(nombre);
  const mismaFecha=r.fecha?.estado==="OK"&&!!r.fecha.valor&&fechaStel(d.date)===r.fecha.valor;
  const mismoNum=!!r.numero?.valor&&!!d.extraReference&&canon(d.extraReference)===canon(r.numero.valor);
  if(typeof diagnostico==="function")diagnostico({ref:d.fullReference,proveedor_stel:d.supplier,cuenta_stel:d.accountId??null,proveedor:nombre,cuenta:cuenta??null,
   fecha_stel:d.date,fecha_stel_normalizada:fechaStel(d.date),fecha:r.fecha?.valor??null,referencia_externa:d.extraReference||null,numero:r.numero?.valor??null,
   mismo_proveedor:mismoProv,misma_fecha:mismaFecha,mismo_numero:mismoNum});
  if(mismoProv&&(mismaFecha||mismoNum))validas.push({c,ev:"Albarán de compra STEL "+d.fullReference+" (solo lectura): proveedor «"+d.supplier+"»"+
   (mismaFecha?", misma fecha "+r.fecha.valor:"")+(mismoNum?", referencia del proveedor «"+d.extraReference+"»":"")});
 }
 if(validas.length!==1)return false;
 const x=validas[0];
 r.manuscritos.stel={...m,valor:formatoStel(x.c),estado:"OK",confianza:0.95,motivos:[],
  resolucion:{...m.resolucion,metodo:"vision_recorte_albaran_stel",evidencias:[...(m.resolucion?.evidencias||[]),x.ev]}};
 return true;
}

/*
 * Vuelve a validar el código de obra con más contexto (después de leer): el nombre de la obra
 * del albarán de compra de STEL (lo escribió la oficina) y el catálogo de obras disponible. Usa
 * las mismas lecturas de la visión y la misma regla (validarCodigos); solo cambia un código que
 * no estaba aceptado. Devuelve true si queda validado.
 */
function revalidarObra(r,{catalogoObras=null,catalogoObrasCompleto=false,obraStel=null}={}){
 const m=r?.manuscritos;
 if(!m||(m.obra?.estado==="OK")||!Array.isArray(m.recortes))return false;
 const lecturas=m.recortes.map(x=>x.lectura).filter(Boolean);
 if(!lecturas.some(l=>l.tipo==="PRY"))return false;
 const obraEscrita=[...(m.obraEscrita||[]),...(obraStel?[obraStel]:[])];
 const v=validarCodigos(lecturas,{catalogoObras,catalogoObrasCompleto,obraImpresa:m.obraImpresa||[],obraEscrita,
  proveedorId:r.proveedor?.id,numero:r.numero?.valor,fecha:r.fecha?.valor});
 if(v.obra?.estado!=="OK")return false;
 const usaStel=obraStel&&[...palabrasObra(obraStel)].some(p=>(v.obra.resolucion?.evidencias||[]).join(" ").toUpperCase().includes(p));
 m.obra={...v.obra,resolucion:{...v.obra.resolucion,evidencias:[...(v.obra.resolucion?.evidencias||[]),...(usaStel?["Obra del albarán de compra de STEL: «"+obraStel+"»"]:[])]}};
 return true;
}

return {revalidarObra,detectarRegiones,validarCodigos,coherenciaLote,claveObra,palabrasObra,obrasImpresas,leerManuscritos,aplicarEstado,pendientes,validarStel,fechaStel,FORMATOS};
});
