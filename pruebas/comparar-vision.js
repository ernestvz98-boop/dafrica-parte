#!/usr/bin/env node
"use strict";
/*
 * Comparación de modelos de visión sobre los MISMOS recortes de manuscritos (prueba de la web:
 * casilla «Prueba: comparar otros modelos de visión»).
 *
 *   node pruebas/comparar-vision.js albaranes.json [carpeta-corpus]
 *
 * Para cada modelo (y el principal) y cada código manuscrito esperado (obra y STEL), cuenta:
 * aceptado y correcto, aceptado y ERRÓNEO (crítico), en revisión con la lectura correcta entre
 * sus alternativas, en revisión sin ella, y vacío. Coste estimado con los precios de lista de
 * PRECIOS (USD por millón de tokens; comprobar en la web del proveedor antes de decidir).
 */
const fs=require("fs"),path=require("path");
const PRECIOS={"gpt-4o":[2.5,10],"gpt-4.1":[2,8],"gpt-5":[1.25,10],"gpt-5.1":[1.25,10],"gpt-5-mini":[0.25,2],"o4-mini":[1.1,4.4],"o3":[2,8]};
const canon=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const precio=(modelo,uso)=>{const p=PRECIOS[String(modelo).replace(/-\d{4}-\d{2}-\d{2}$/,"")];return p&&uso?(uso.input_tokens*p[0]+uso.output_tokens*p[1])/1e6:null;};

function clasificar(m,esperado){
 const e=canon(esperado);
 if(!m||m.estado==="VACIO"&&!m.literal)return e?"vacio":"correcto";
 const ok=m.estado==="OK"&&(m.confianza??1)>=0.9;
 if(ok)return canon(m.valor)===e?"correcto":"critico";
 if(!e)return "revision_sin";
 const alt=[m.valor,...(m.resolucion?.alternativas||[])].map(canon);
 return alt.includes(e)?"revision_con":"revision_sin";
}

function compararVision(lectura,carpeta){
 const tabla={};
 const fila=n=>tabla[n]||(tabla[n]={correcto:0,critico:0,revision_con:0,revision_sin:0,vacio:0,errores:0,uso:null,criticos:[]});
 for(const archivo of [...new Set(lectura.documentos.map(d=>d.archivo))]){
  const ruta=path.join(carpeta,archivo.replace(/\.pdf$/i,"")+".esperado.json");
  if(!fs.existsSync(ruta))continue;
  const esperado=JSON.parse(fs.readFileSync(ruta,"utf8"));
  for(const e of esperado.documentos||[]){
   const d=lectura.documentos.find(x=>x.archivo===archivo&&x.paginas.join(",")===[].concat(e.pagina).join(","));
   const cmp=d?.resultado?.manuscritos?.comparacion;
   if(!cmp||!e.manuscritos)continue;
   const entradas=[["principal",cmp.principal],...Object.entries(cmp.modelos||{})];
   for(const [nombre,x] of entradas){
    const f=fila(nombre);
    if(x?.error){f.errores++;continue;}
    for(const k of ["obra","stel"]){
     const c=clasificar(x?.[k],e.manuscritos[k]);f[c]++;
     if(c==="critico")f.criticos.push(archivo+" pág. "+[].concat(e.pagina).join("-")+" "+k);
    }
   }
  }
 }
 // Consumo: el de cada modelo comparado está en sus documentos; el principal, en motores.vision.
 for(const d of lectura.documentos)for(const [n,x] of Object.entries(d.resultado?.manuscritos?.comparacion?.modelos||{})){
  const f=fila(n);if(!x.uso)continue;
  f.uso=f.uso||{input_tokens:0,output_tokens:0,llamadas:0};
  for(const k of Object.keys(f.uso))f.uso[k]+=x.uso[k]||0;
 }
 const up=lectura.motores?.vision?.uso;
 if(tabla.principal&&up)tabla.principal.uso={...up};
 return tabla;
}

if(require.main===module){
 const [json,carpeta=path.join(__dirname,"corpus-real")]=process.argv.slice(2);
 if(!json){console.error("Uso: node pruebas/comparar-vision.js albaranes.json [carpeta]");process.exit(2);}
 const lectura=JSON.parse(fs.readFileSync(json,"utf8"));
 const tabla=compararVision(lectura,carpeta);
 const modeloPrincipal=lectura.motores?.vision?.uso?.modelo||"gpt-4o";
 console.log("| Modelo | Aceptados correctos | ERRÓNEOS aceptados | Revisión (correcta entre alternativas) | Revisión (sin ella) | Vacío | Llamadas fallidas | Tokens entrada/salida | Coste estimado (USD) |");
 console.log("|---|---|---|---|---|---|---|---|---|");
 for(const [n,f] of Object.entries(tabla)){
  const modelo=n==="principal"?modeloPrincipal:n,coste=precio(modelo,f.uso);
  console.log("| "+(n==="principal"?"principal ("+modelo+", todas las consultas)":n)+" | "+f.correcto+" | "+f.critico+" | "+f.revision_con+" | "+f.revision_sin+" | "+f.vacio+" | "+f.errores+" | "+
   (f.uso?f.uso.input_tokens+" / "+f.uso.output_tokens:"—")+" | "+(coste==null?"—":coste.toFixed(3))+" |");
 }
 for(const [n,f] of Object.entries(tabla))if(f.criticos.length)console.log("Críticos de "+n+": "+f.criticos.length);
}
module.exports={compararVision,clasificar,PRECIOS};
