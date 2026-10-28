"use strict";
/*
 * DAFRICA · Datos de referencia del lector, importados por una persona desde CSV o Excel:
 * - lista de obras (código PRY y nombre) → tabla lector_obras;
 * - tarifa o catálogo de un proveedor (código y descripción) → lector_referencias_confirmadas
 *   con origen «tarifa».
 * Solo se toman las columnas de código y nombre/descripción: precios, descuentos e importes de la
 * tarifa NUNCA se leen ni se envían.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.datosReferencia=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const norm=t=>String(t??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();

/* CSV con «;» o «,» y comillas. Devuelve filas (listas de celdas). */
function parseCsv(texto){
 const t=String(texto||"").replace(/^﻿/,"");
 const primera=t.split(/\r?\n/,1)[0]||"";
 const sep=(primera.match(/;/g)||[]).length>=(primera.match(/,/g)||[]).length?";":",";
 const filas=[];let fila=[],celda="",comillas=false;
 for(let i=0;i<t.length;i++){
  const c=t[i];
  if(comillas){if(c==='"'&&t[i+1]==='"'){celda+='"';i++;}else if(c==='"')comillas=false;else celda+=c;continue;}
  if(c==='"')comillas=true;
  else if(c===sep){fila.push(celda);celda="";}
  else if(c==="\n"||c==="\r"){if(c==="\r"&&t[i+1]==="\n")i++;fila.push(celda);filas.push(fila);fila=[];celda="";}
  else celda+=c;
 }
 if(celda!==""||fila.length){fila.push(celda);filas.push(fila);}
 return filas.filter(f=>f.some(x=>String(x).trim()!==""));
}

// Cabeceras reconocidas (sin acentos, en mayúsculas). Las de precio se excluyen expresamente.
const PRECIO=/\b(PRECIO|PVP|TARIFA|IMPORTE|COSTE|COSTO|DTO|DESCUENTO|NETO|IVA|EUR|EUROS)\b/;
const CAB={
 codigo:/^(CODIGO|COD|REFERENCIA|REF|ARTICULO|COD ARTICULO|CODIGO ARTICULO|REF ARTICULO|REFERENCIA ARTICULO|ITEM|SKU|PROYECTO|CODIGO PROYECTO|PRY|REFERENCIA PROYECTO)$/,
 nombre:/^(NOMBRE|DESCRIPCION|DESCRIPCION ARTICULO|DENOMINACION|TITULO|DESIGNACION|CONCEPTO|NOMBRE PROYECTO|OBRA|NOMBRE OBRA|PROYECTO NOMBRE)$/
};
/* Fila de cabecera (entre las 10 primeras) y columnas de código y nombre. */
function columnas(filas){
 for(let i=0;i<Math.min(10,filas.length);i++){
  const cab=filas[i].map(norm);
  const cod=cab.findIndex(h=>CAB.codigo.test(h)&&!PRECIO.test(h)),nom=cab.findIndex(h=>CAB.nombre.test(h)&&!PRECIO.test(h));
  if(cod>=0&&nom>=0&&cod!==nom)return {fila:i,codigo:cod,nombre:nom};
 }
 return null;
}
const limpio=v=>String(v??"").replace(/\s+/g," ").trim();

/* Obras: código PRY + 5 cifras (también «PRY 00123» o «pry-00123») o PRYMP + cifras (petición del usuario,
   2026-10-28: se importa tal cual, nunca se convierte en otro PRY), y nombre. */
const RE_OBRA=/^(PRY\d{5}|PRYMP\d{2,8})$/;
function filasObras(filas){
 const c=columnas(filas);if(!c)return {error:"No encuentro las columnas de código y nombre de la obra",filas:[]};
 const vistos=new Map(),descartadas=[];
 for(const f of filas.slice(c.fila+1)){
  const cod=String(f[c.codigo]??"").toUpperCase().replace(/[^A-Z0-9]/g,""),nombre=limpio(f[c.nombre]).slice(0,150);
  if(!RE_OBRA.test(cod)||nombre.length<2){descartadas.push(cod||"(vacío)");continue;}
  if(vistos.has(cod)&&vistos.get(cod)!==nombre){vistos.set(cod,null);continue;}
  vistos.set(cod,nombre);
 }
 // Un código con dos nombres distintos en la lista: no se importa (no se elige).
 const lista=[...vistos].filter(([,n])=>n).map(([codigo,nombre])=>({codigo,nombre}));
 return {filas:lista,descartadas:descartadas.length,repetidas:[...vistos.values()].filter(v=>v===null).length};
}

/* Tarifa de un proveedor: código y descripción (nada más). */
function filasTarifa(filas,proveedorClave){
 const c=columnas(filas);if(!c)return {error:"No encuentro las columnas de código y descripción",filas:[]};
 const vistos=new Map();let descartadas=0;
 for(const f of filas.slice(c.fila+1)){
  const referencia=limpio(f[c.codigo]).toUpperCase().replace(/\s/g,"").slice(0,60),descripcion=limpio(f[c.nombre]).slice(0,200);
  if(!referencia||!/[A-Z0-9]/.test(referencia)||!descripcion){descartadas++;continue;}
  if(vistos.has(referencia)&&vistos.get(referencia)!==descripcion){vistos.set(referencia,null);continue;}
  vistos.set(referencia,descripcion);
 }
 const lista=[...vistos].filter(([,d])=>d).map(([referencia,descripcion])=>({proveedor_clave:proveedorClave,referencia,descripcion,origen:"tarifa"}));
 return {filas:lista,descartadas,repetidas:[...vistos.values()].filter(v=>v===null).length};
}
return {parseCsv,columnas,filasObras,filasTarifa};
});
