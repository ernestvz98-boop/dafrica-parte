#!/usr/bin/env node
"use strict";
/*
 * Informe de precisión por campo del lector determinista.
 *
 *   node pruebas/evaluar.js --sinteticos
 *       Corpus sintético generado al vuelo. Informe en pruebas/informes/.
 *   node pruebas/evaluar.js [carpeta]
 *       Corpus real (por defecto pruebas/corpus-real/, excluida de git).
 *       Cada albaran.pdf necesita albaran.esperado.json con
 *       "revisado_por_persona": true. Informe en pruebas/informes-reales/.
 *       registro.json opcional en la carpeta: NIF de DAFRICA y proveedores.
 *       PDF escaneados: "escaneado": true y "documentos": [{pagina, …}] (un albarán
 *       por página). Se leen con OCR (pdftoppm + Tesseract nativo, ver motor-tesseract.js).
 *   --incluir-sin-revisar
 *       Evalúa también resultados esperados aún no confirmados por una persona; el
 *       informe lo advierte en la cabecera.
 *
 * Termina con código 1 si hay fallos críticos (valor erróneo aceptado).
 */
const fs=require("fs"),path=require("path");
const {extraerPdf,VERSION}=require("../albaranes/extraer.js");
const {REGISTRO}=require("../albaranes/proveedores.js");
const {comparar,agregar,CRITICAS,UMBRAL}=require("./comparar.js");

const cargarPdfjs=()=>import("pdfjs-dist/legacy/build/pdf.mjs");

async function evaluarSinteticos(){
 const {DOCUMENTOS,REGISTRO:registro,HOY}=require("./sinteticos.js");
 const pdfjs=await cargarPdfjs(),informes=[];
 for(const doc of DOCUMENTOS){
  const bytes=await doc.construir();
  const resultado=await extraerPdf(pdfjs,new Uint8Array(bytes),{registro,hoy:HOY});
  informes.push({id:doc.id,descripcion:doc.descripcion,resultado,comparacion:comparar(resultado,doc.esperado)});
 }
 return {corpus:"sintético",informes,pendientes:[]};
}

function registroReal(carpeta){
 const archivo=path.join(carpeta,"registro.json");
 if(!fs.existsSync(archivo))return REGISTRO;
 const extra=JSON.parse(fs.readFileSync(archivo,"utf8"));
 const proveedores=REGISTRO.proveedores.map(p=>{
  const r=(extra.proveedores||[]).find(x=>x.id===p.id);
  return r?{...p,...r}:p;
 });
 for(const r of extra.proveedores||[])if(!proveedores.some(p=>p.id===r.id))proveedores.push(r);
 return {empresa_propia:{...REGISTRO.empresa_propia,...(extra.empresa_propia||{})},proveedores};
}

async function evaluarEscaneado(ruta,base,esperado,registro){
 const {paginasEscaneadas}=require("./motor-tesseract.js");
 const {extraerEscaneado}=require("../albaranes/escaneado.js");
 const paginas=paginasEscaneadas(ruta),informes=[];
 for(const doc of esperado.documentos){
  const pags=paginas.filter(p=>[].concat(doc.pagina).includes(p.numero));
  const resultado=await extraerEscaneado(pags,{registro,hoy:esperado.fecha_proceso});
  informes.push({id:base+" · pág. "+[].concat(doc.pagina).join("-"),descripcion:doc.notas||"",resultado,comparacion:comparar(resultado,doc)});
 }
 return informes;
}

async function evaluarCarpeta(carpeta,{incluirSinRevisar=false}={}){
 if(!fs.existsSync(carpeta))throw Error("No existe la carpeta "+carpeta+". Coloca allí los PDF autorizados y sus .esperado.json");
 const pdfjs=await cargarPdfjs(),registro=registroReal(carpeta),informes=[],pendientes=[],sinRevisar=[];
 for(const nombre of fs.readdirSync(carpeta).filter(n=>/\.pdf$/i.test(n)).sort()){
  const base=nombre.replace(/\.pdf$/i,""),esperadoRuta=path.join(carpeta,base+".esperado.json");
  if(!fs.existsSync(esperadoRuta)){pendientes.push({id:base,motivo:"Falta "+base+".esperado.json"});continue;}
  const esperado=JSON.parse(fs.readFileSync(esperadoRuta,"utf8"));
  if(esperado.revisado_por_persona!==true){
   if(!incluirSinRevisar){pendientes.push({id:base,motivo:"Resultado esperado aún no revisado por una persona"});continue;}
   sinRevisar.push(base);
  }
  if(esperado.escaneado){informes.push(...await evaluarEscaneado(path.join(carpeta,nombre),base,esperado,registro));continue;}
  const bytes=new Uint8Array(fs.readFileSync(path.join(carpeta,nombre)));
  const resultado=await extraerPdf(pdfjs,bytes,{registro,hoy:esperado.fecha_proceso});
  informes.push({id:base,descripcion:esperado.descripcion||"",resultado,comparacion:comparar(resultado,esperado)});
 }
 return {corpus:"real ("+carpeta+")",informes,pendientes,sinRevisar};
}

const pct=(a,b)=>b?(100*a/b).toFixed(1)+" %":"—";
const fmt=v=>v===null||v===undefined?"—":Array.isArray(v)?v.map(fmt).join(" / "):typeof v==="number"?String(v).replace(".",","):String(v).replace(/\|/g,"¦");
function markdown({corpus,informes,pendientes,sinRevisar=[]}){
 const {porCampo,totales}=agregar(informes);
 const total=Object.values(totales).reduce((a,b)=>a+b,0);
 const criticos=Object.entries(totales).filter(([k])=>CRITICAS.has(k)).reduce((s,[,v])=>s+v,0);
 const auto=informes.filter(i=>i.resultado.estado==="AUTO_OK").length;
 const autoFalsos=informes.filter(i=>i.comparacion.auto_ok_falso).length;
 const estadosOK=informes.filter(i=>i.comparacion.estado_correcto).length;
 const L=[];
 L.push("# Informe de precisión · lector determinista de albaranes","");
 if(sinRevisar.length)L.push("> **Aviso:** los resultados esperados de "+sinRevisar.join(", ")+" aún no están confirmados por una persona.","");
 L.push("- Corpus: **"+corpus+"**");
 L.push("- Versión del extractor: `"+VERSION+"`");
 L.push("- Documentos evaluados: **"+informes.length+"**"+(pendientes.length?" · pendientes de resultado esperado: "+pendientes.length:""));
 L.push("- Confianza: cada campo lleva una confianza 0–1; por debajo de "+UMBRAL+" el campo cuenta como marcado para revisión.");
 L.push("- Documentos aceptados automáticamente (AUTO_OK): **"+auto+"** · AUTO_OK con algún error: **"+autoFalsos+"**");
 L.push("- Estado de documento igual al esperado: **"+estadosOK+"/"+informes.length+"**");
 L.push("- Campos evaluados: **"+total+"** · correctos y aceptados: **"+(totales.CORRECTO||0)+"** ("+pct(totales.CORRECTO||0,total)+")");
 L.push("- **Fallos críticos (valor erróneo aceptado como bueno): "+criticos+"**","");
 L.push("## Precisión por campo","");
 L.push("| Campo | Total | Correcto automático | Marcado (esperado) | Correcto a revisar | Sin valor, marcado | Erróneo, marcado | **Erróneo aceptado** | % automático correcto |");
 L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
 for(const [campo,c] of Object.entries(porCampo)){
  const t=Object.values(c).reduce((a,b)=>a+b,0);
  L.push("| "+campo+" | "+t+" | "+(c.CORRECTO||0)+" | "+(c.MARCADO_COMO_ESPERADO||0)+" | "+(c.CORRECTO_A_REVISAR||0)+" | "+
   (c.SIN_VALOR_MARCADO||0)+" | "+(c.INCORRECTO_MARCADO||0)+" | **"+((c.INCORRECTO_NO_MARCADO||0)+(c.FALTA_MARCA||0))+"** | "+pct(c.CORRECTO||0,t)+" |");
 }
 // Tabla campo a campo: lo que se esperaba, lo que se leyó y lo que avisó el lector.
 L.push("","## Comparación campo a campo","");
 L.push("Resultado: **correcto** (valor igual y aceptado), **correcto, a revisar** (igual pero el lector pide revisión), **sin valor, marcado** / **incorrecto, marcado** (el lector no da el valor o lo da mal, pero avisa), **INCORRECTO ACEPTADO** (fallo crítico).","");
 L.push("| Documento | Campo | Valor esperado | Valor extraído | Resultado | Confianza | Error detectado por el lector |");
 L.push("|---|---|---|---|---|---:|---|");
 const ETIQ={CORRECTO:"correcto",MARCADO_COMO_ESPERADO:"marcado (esperado)",CORRECTO_A_REVISAR:"correcto, a revisar",
  SIN_VALOR_MARCADO:"sin valor, marcado",INCORRECTO_MARCADO:"incorrecto, marcado",INCORRECTO_NO_MARCADO:"**INCORRECTO ACEPTADO**",FALTA_MARCA:"**FALTA MARCA**"};
 for(const i of informes){
  for(const c of i.comparacion.campos)
   L.push("| "+i.id+" | "+c.campo+" | "+fmt(c.esperado)+" | "+fmt(c.obtenido)+" | "+(ETIQ[c.categoria]||c.categoria)+" | "+
    (c.confianza===null||c.confianza===undefined?"—":c.confianza.toFixed(2))+" | "+fmt(c.aviso||"")+" |");
  for(const x of i.comparacion.lineas)L.push("| "+i.id+" | línea "+(x.fila_esperada||x.fila_obtenida)+" | | | "+x.categoria+" | | |");
 }
 L.push("","## Detalle por documento","");
 for(const i of informes){
  const r=i.resultado,c=i.comparacion;
  L.push("### "+i.id+(c.estado_correcto?"":" ⚠"));
  if(i.descripcion)L.push(i.descripcion,"");
  L.push("- Tipo de PDF: "+r.tipo_pdf+" · estado esperado **"+(c.estado_esperado||"—")+"**, obtenido **"+r.estado+"**");
  if(r.proveedor)L.push("- Proveedor: "+(r.proveedor.nombre||"—")+" · NIF "+(r.proveedor.nif||"—")+" ("+r.proveedor.estado+")"+(r.proveedor.nif_propio_detectado?" · NIF de DAFRICA descartado como emisor: "+r.proveedor.nif_propio_detectado:""));
  if(r.numero)L.push("- Número «"+(r.numero.literal||"")+"» ("+r.numero.estado+") · Fecha «"+(r.fecha?.literal||"")+"» → "+(r.fecha?.valor||"—")+" ("+r.fecha?.estado+")");
  L.push("- Líneas: "+r.lineas.length+(r.lineas_ignoradas?.length?" · ignoradas: "+r.lineas_ignoradas.map(x=>"«"+x.texto+"» ("+x.motivo+")").join("; "):""));
  for(const x of r.validaciones||[])if(x.estado!=="NO_APLICA")L.push("- Validación "+x.nombre+": "+x.estado+" · "+x.detalle);
  for(const x of r.incidencias||[])L.push("- Incidencia: "+x);
  const raros=c.campos.filter(x=>x.categoria!=="CORRECTO");
  for(const x of raros)L.push("  - `"+x.campo+"` "+x.categoria+" · esperado "+JSON.stringify(x.esperado)+" · obtenido "+JSON.stringify(x.obtenido)+" ("+x.estado+")");
  for(const x of c.lineas)L.push("  - "+x.categoria+" "+JSON.stringify(x));
  L.push("");
 }
 if(pendientes.length){L.push("## Documentos pendientes","");for(const p of pendientes)L.push("- "+p.id+": "+p.motivo);}
 return {texto:L.join("\n")+"\n",criticos,autoFalsos};
}

async function main(){
 const args=process.argv.slice(2);
 const sinteticos=args.includes("--sinteticos");
 const carpeta=args.find(a=>!a.startsWith("--"))||path.join(__dirname,"corpus-real");
 const datos=sinteticos?await evaluarSinteticos():await evaluarCarpeta(carpeta,{incluirSinRevisar:args.includes("--incluir-sin-revisar")});
 const salida=path.join(__dirname,sinteticos?"informes":"informes-reales");
 fs.mkdirSync(salida,{recursive:true});
 const nombre=sinteticos?"precision-sintetico":"precision-real";
 const {texto,criticos,autoFalsos}=markdown(datos);
 fs.writeFileSync(path.join(salida,nombre+".md"),texto);
 if(!sinteticos)fs.writeFileSync(path.join(salida,nombre+".json"),JSON.stringify(datos,null,1));
 process.stdout.write(texto);
 if(criticos||autoFalsos)process.exitCode=1;
}

if(require.main===module)main().catch(e=>{console.error(e.message||e);process.exitCode=2;});
module.exports={evaluarSinteticos,evaluarCarpeta,markdown};
