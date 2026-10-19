"use strict";
/* Pruebas unitarias de la tabla sobre páginas construidas a mano (sin PDF). */
const test=require("node:test"),assert=require("node:assert/strict");
const {extraerDePaginas}=require("../albaranes/extraer.js");

const NIF_A="B24123457";
const registro={empresa_propia:{nombres:["DAFRICA"],nifs:[]},
 proveedores:[{id:"A",nombre:"PROVEEDOR A",nifs:[NIF_A],formato_numeros:"es",formato_confirmado:true}]};
const celda=(texto,x0,x1)=>({texto,x0,x1,alto:9});
let n=0;
const linea=(y,...celdas)=>({indice:n++,y,alto:9,celdas,texto:celdas.map(c=>c.texto).join(" ")});
function pagina(filas){
 n=0;
 const lineas=[
  linea(50,celda("PROVEEDOR A, S.L.",40,140)),linea(64,celda("CIF: "+NIF_A,40,106)),
  linea(120,celda("Nº Albarán: 123456",40,130),celda("Fecha: 15/10/2026",250,330)),
  linea(170,celda("REFERENCIA",40,90),celda("DESCRIPCIÓN",115,170),celda("CANTIDAD",305,345),celda("PRECIO",400,430),celda("IMPORTE",515,550)),
  ...filas.map((f,i)=>linea(188+16*i,...f))
 ];
 return [{numero:1,ancho:595,alto:842,tipo:"DIGITAL",caracteres:500,fraccion_imagen:0,avisos:[],lineas}];
}

test("una celda que cruza columnas se reparte y se acepta solo si cuadra",()=>{
 const r=extraerDePaginas(pagina([
  [celda("R-1",40,55),celda("TUBO",115,140),celda("8,00 3,4500",325,430),celda("27,60",525,550)],
  [celda("R-2",40,55),celda("CODO",115,140),celda("2,00 1,0000",325,430),celda("9,99",525,550)]
 ]),{registro,hoy:"2026-10-19"});
 const [a,b]=r.lineas;
 assert.equal(a.cantidad.valor,8);assert.equal(a.precio.valor,3.45);
 assert.equal(a.cuadre.estado,"VERIFICADO");assert.equal(a.estado,"OK");
 // Reparto estimado que no cuadra: todos sus campos quedan para revisión.
 assert.equal(b.estado,"REVISAR");
 for(const k of ["referencia","descripcion","cantidad","precio","importe"])assert.ok(!["OK","VERIFICADO"].includes(b[k].estado),k);
 assert.equal(r.estado,"REVISAR");
});

test("un texto que invade la columna de cantidad se queda en la descripción",()=>{
 const r=extraerDePaginas(pagina([
  [celda("R-1",40,55),celda("BRIDA (BOLSA",115,240),celda("100)",312,330),celda("3",340,345),celda("4,1000",410,430),celda("12,30",525,550)]
 ]),{registro,hoy:"2026-10-19"});
 const l=r.lineas[0];
 assert.equal(l.descripcion.literal,"BRIDA (BOLSA 100)");
 assert.equal(l.cantidad.valor,3);assert.equal(l.cuadre.estado,"VERIFICADO");
});

test("una fila con palabras de cabecera no se toma por cabecera repetida",()=>{
 const r=extraerDePaginas(pagina([
  [celda("0000000201",40,90),celda("ARTÍCULO SIN CANTIDAD",115,220)],
  [celda("R-2",40,55),celda("CODO",115,140),celda("2,00",325,345),celda("1,0000",405,430),celda("2,00",530,550)]
 ]),{registro,hoy:"2026-10-19"});
 assert.equal(r.lineas.length,2);assert.equal(r.lineas[0].estado,"REVISAR");
});
