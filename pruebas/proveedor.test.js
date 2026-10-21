"use strict";
/*
 * Identificación del proveedor sin NIF reales en el código (registro público con huellas):
 * casos reales reproducidos con datos ficticios.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {NIF,NIF_PROPIO,HOY,fila,leer}=require("./ayudas-ocr.js");
const {huella}=require("../albaranes/nif.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");

const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const linea=y=>fila(y,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]);
const membrete=(nif=NIF)=>[...fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]),...fila(52,["CIF",60],[nif,80])];
const cliente=()=>[...fila(60,["CLIENTES",330],["VARIOS",380]),...fila(110,["N.I.F:",330],[NIF_PROPIO,370])];
const etiquetas=()=>[...fila(120,["ALBARÁN",60],["Nº",105],["600.111",120]),...fila(120,["FECHA",200],["15/10/26",240])];
// Registro como el de la web: sin NIF en claro, solo huellas.
const publico=({conHuella=true,propio=true}={})=>({empresa_propia:{nombres:["DAFRICA"],nifs:[],huellas_nif:propio?[huella(NIF_PROPIO)]:[]},
 proveedores:[{id:"A",nombre:"PROVEEDOR FICTICIO, S.L.",nifs:[],huellas_nif:conHuella?[huella(NIF)]:[],formato_numeros:"es",formato_confirmado:true}]});

test("con solo la huella del NIF (sin NIF en claro) se reconoce al proveedor y al NIF propio",()=>{
 const r=leer([...membrete(),...cliente(),...etiquetas(),...titulos(),...linea(218)],{registro:publico()});
 assert.equal(r.proveedor.id,"A");assert.equal(r.proveedor.nif,NIF);assert.equal(r.proveedor.estado,"OK");
 assert.equal(r.proveedor.nif_propio_detectado,NIF_PROPIO);
});

test("sin NIF ni huella: el CIF junto al nombre se toma como leído pero sin verificar; el CIF del cliente nunca",()=>{
 const reg=publico({conHuella:false,propio:false});
 const r=leer([...membrete(),...cliente(),...etiquetas(),...titulos(),...linea(218)],{registro:reg});
 // Dos CIF en el encabezado: se elige el que está junto al nombre del proveedor, sin darlo por verificado.
 assert.equal(r.proveedor.nif,NIF);assert.equal(r.proveedor.estado,"NIF_NO_REGISTRADO");assert.ok(r.proveedor.confianza<0.9);
 // El CIF del proveedor no se lee: solo queda el de DAFRICA → nunca aceptado como emisor.
 const sinCif=leer([...fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]),...cliente(),...etiquetas(),...titulos(),...linea(218)],{registro:reg});
 assert.ok(!(sinCif.proveedor.confianza>=0.9&&sinCif.proveedor.nif===NIF_PROPIO));
});

test("NIF válido no registrado: se conserva pero queda en revisión (no se acepta solo)",()=>{
 const r=leer([...fila(40,["OTRA",60],["EMPRESA",100]),...fila(52,["CIF",60],[NIF,80]),...etiquetas(),...titulos(),...linea(218)],{registro:publico({conHuella:false})});
 assert.equal(r.proveedor.nif,NIF);assert.equal(r.proveedor.estado,"NIF_NO_REGISTRADO");
 assert.ok(r.proveedor.confianza<0.9);
});

test("CIF impreso ilegible y perfil solo con huella: proveedor identificado por nombre, NIF a revisar (no vacío aceptado)",()=>{
 const r=leer([...fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]),...etiquetas(),...titulos(),...linea(218)],{registro:publico()});
 assert.equal(r.proveedor.id,"A");assert.equal(r.proveedor.nif,null);
 assert.ok(!(r.proveedor.confianza>=0.9));
});

test("NIF de DAFRICA reconocido en una lectura OCR (junto a su nombre) se descarta en las demás lecturas",async()=>{
 // psm 4 ve «DAFRICA» junto al NIF; las demás lecturas no ven el nombre (solo el NIF del recuadro).
 const base=[...fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]),...etiquetas(),...titulos(),...linea(218)];
 const conNombre=[...base,...fila(100,["DAFRICA",330],["BIERZO",380]),...fila(110,["N.I.F:",330],[NIF_PROPIO,370])];
 const sinNombre=[...base,...fila(110,["N.I.F:",330],[NIF_PROPIO,370])];
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,async ocr({psm=4,region=null}={}){
  const ps=psm===4?conNombre:sinNombre;
  if(!region)return ps;
  const [x,y,ww,h]=region;
  return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
 }}];
 const reg={empresa_propia:{nombres:["DAFRICA"],nifs:[]},proveedores:[{id:"A",nombre:"PROVEEDOR FICTICIO, S.L.",nifs:[],formato_numeros:"es"}]};
 const r=await extraerEscaneado(motor,{registro:reg,hoy:HOY});
 assert.notEqual(r.proveedor.nif,NIF_PROPIO);
});
