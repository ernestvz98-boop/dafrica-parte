#!/usr/bin/env node
"use strict";
/*
 * Precisión de una lectura hecha en la WEB (módulo «Lector de albaranes» de DAFRICA Control, con la sesión
 * del usuario: visión de recortes y catálogo STEL de solo lectura activos).
 *
 *   node pruebas/evaluar-web.js albaranes.json [carpeta-corpus]
 *
 * albaranes.json es el fichero que descarga la pantalla («Descargar resultado (JSON)»). Cada PDF
 * leído se empareja por nombre con su .esperado.json del corpus (pruebas/corpus-real/, fuera de
 * git) y cada albarán esperado con el documento leído en sus mismas páginas. Informe en
 * pruebas/informes-reales/precision-web.md (mismo formato que evaluar.js).
 */
const fs=require("fs"),path=require("path");
const {comparar}=require("./comparar.js");
const {markdown}=require("./evaluar.js");

function evaluarWeb(lectura,carpeta){
 const informes=[],pendientes=[],sinRevisar=[];
 for(const archivo of [...new Set(lectura.documentos.map(d=>d.archivo))]){
  const base=archivo.replace(/\.pdf$/i,""),ruta=path.join(carpeta,base+".esperado.json");
  if(!fs.existsSync(ruta)){pendientes.push({id:base,motivo:"Sin resultado esperado"});continue;}
  const esperado=JSON.parse(fs.readFileSync(ruta,"utf8"));
  if(esperado.revisado_por_persona!==true)sinRevisar.push(base);
  const docs=lectura.documentos.filter(d=>d.archivo===archivo);
  for(const e of esperado.documentos||[{...esperado,pagina:docs[0]?.paginas}]){
   const pags=[].concat(e.pagina),id=base+" · pág. "+pags.join("-");
   const d=docs.find(x=>x.paginas.join(",")===pags.join(","));
   const resultado=d?.resultado||{tipo_pdf:"ESCANEADO_OCR",estado:"ERROR_SEPARACION",lineas:[],incidencias:[d?d.error||"Documento ilegible":"Separación distinta de la esperada"]};
   informes.push({id,descripcion:e.notas||"",resultado,comparacion:comparar(resultado,e)});
  }
 }
 return {corpus:"lectura web ("+(lectura.archivos||[]).map(a=>a.nombre).join(", ")+")",informes,pendientes,sinRevisar};
}

if(require.main===module){
 const [json,carpeta=path.join(__dirname,"corpus-real")]=process.argv.slice(2);
 if(!json){console.error("Uso: node pruebas/evaluar-web.js albaranes.json [carpeta]");process.exit(2);}
 const datos=evaluarWeb(JSON.parse(fs.readFileSync(json,"utf8")),carpeta);
 const {texto,criticos,autoFalsos}=markdown(datos);
 const salida=path.join(__dirname,"informes-reales");fs.mkdirSync(salida,{recursive:true});
 fs.writeFileSync(path.join(salida,"precision-web.md"),texto);
 fs.writeFileSync(path.join(salida,"precision-web.json"),JSON.stringify(datos,null,1));
 process.stdout.write(texto.split("## Comparación campo a campo")[0]);
 if(criticos||autoFalsos)process.exitCode=1;
}
module.exports={evaluarWeb};
