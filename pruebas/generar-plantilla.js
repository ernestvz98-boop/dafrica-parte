#!/usr/bin/env node
"use strict";
/*
 * Crea el BORRADOR del resultado esperado de albaranes reales:
 *   node pruebas/generar-plantilla.js pruebas/corpus-real/albaran1.pdf [...]
 * Escribe albaran1.esperado.json con la lectura automática y
 * "revisado_por_persona": false. Una persona debe comprobar cada valor contra
 * el documento, corregirlo y poner true; hasta entonces evaluar.js lo ignora
 * (así el lector nunca se evalúa contra sí mismo).
 * Los campos que el lector no pudo leer quedan en null y deben rellenarse.
 */
const fs=require("fs"),path=require("path");
const {extraerPdf}=require("../albaranes/extraer.js");
const {REGISTRO}=require("../albaranes/proveedores.js");

async function main(){
 const args=process.argv.slice(2),forzar=args.includes("--forzar");
 const archivos=args.filter(a=>!a.startsWith("--"));
 if(!archivos.length){console.error("Uso: node pruebas/generar-plantilla.js archivo.pdf [...] [--forzar]");process.exitCode=2;return;}
 const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
 for(const archivo of archivos){
  const destino=archivo.replace(/\.pdf$/i,"")+".esperado.json";
  if(fs.existsSync(destino)&&!forzar){console.log("Ya existe (usa --forzar): "+destino);continue;}
  const r=await extraerPdf(pdfjs,new Uint8Array(fs.readFileSync(archivo)),{registro:REGISTRO});
  const plantilla={
   revisado_por_persona:false,
   instrucciones:"Comprueba CADA valor contra el albarán impreso. Corrige los errores, rellena los null que sí figuren en el documento y lista en «marcados» los campos que el lector DEBE dejar para revisión humana (p. ej. un dato ilegible o realmente ambiguo). Después pon revisado_por_persona: true.",
   descripcion:path.basename(archivo),
   fecha_proceso:new Date().toISOString().slice(0,10),
   estado_documento:null,
   tipo_pdf:r.tipo_pdf,
   proveedor_nif:r.proveedor?.nif??null,
   numero:r.numero?.valor??null,
   fecha:r.fecha?.valor??null,
   lineas:r.lineas.map(l=>({
    referencia:l.referencia.valor,descripcion:l.descripcion.valor,cantidad:l.cantidad.valor,
    precio:l.precio.valor,descuento:l.descuento.valor===null?null:l.descuento.porcentajes,importe:l.importe.valor,
    _literal:{cantidad:l.cantidad.literal,precio:l.precio.literal,descuento:l.descuento.literal,importe:l.importe.literal},
    _estado_lectura:l.estado+(l.motivos.length?": "+l.motivos.join("; "):"")
   })),
   marcados:[],
   _lectura_automatica:{estado:r.estado,incidencias:r.incidencias}
  };
  fs.writeFileSync(destino,JSON.stringify(plantilla,null,1)+"\n");
  console.log("Borrador creado: "+destino+" ("+r.tipo_pdf+", "+r.lineas.length+" líneas, "+r.estado+")");
 }
}
main().catch(e=>{console.error(e.message||e);process.exitCode=2;});
