"use strict";
/*
 * Auxiliares de las pruebas OCR: palabras construidas a mano (72 ppp: píxeles = puntos PDF),
 * con empresas, NIF, códigos e importes FICTICIOS.
 */
const {extraerDePaginas}=require("../albaranes/extraer.js");
const {paginaDesdePalabras}=require("../albaranes/ocr.js");

const NIF="B24123457",NIF_PROPIO="B24000002",HOY="2026-10-20";
const registroCon=(perfil={})=>({empresa_propia:{nombres:["DAFRICA"],nifs:[NIF_PROPIO]},
 proveedores:[{id:"A",nombre:"PROVEEDOR FICTICIO, S.L.",nifs:[NIF],formato_numeros:"es",formato_confirmado:true,...perfil}]});

let lineaId=0;
const w=(texto,x0,y,conf=95,{ancho=null,linea=null,alto=8}={})=>({texto,x0,x1:x0+(ancho??texto.length*5),y0:y-alto,y1:y,conf,linea});
// fila(y, [texto, x, conf?, opciones?], …): palabras de un mismo renglón.
const fila=(y,...palabras)=>{const id="L"+(lineaId++);return palabras.map(([t,x,c,o])=>w(t,x,y,c??95,{...(o||{}),linea:id}));};
const cabeceraDoc=(nif=NIF)=>[...fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]),...fila(52,["CIF",60],[nif,80])];
const pagina=(palabras,{ancho=595,alto=842}={})=>paginaDesdePalabras(palabras,{numero:1,anchoPx:ancho,altoPx:alto,dpi:72});
const leer=(palabras,{registro=registroCon(),ancho,alto}={})=>extraerDePaginas([pagina(palabras,{ancho,alto})],{registro,hoy:HOY});

module.exports={NIF,NIF_PROPIO,HOY,registroCon,w,fila,cabeceraDoc,pagina,leer};
