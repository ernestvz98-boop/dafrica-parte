"use strict";
/*
 * Regresión: foto real de un albarán (2026-11-23) en la que el OCR de página no sacaba las cifras de 6 de 7 filas
 * (rayas de la tabla y trazos a mano sobre la columna de precios). Paso «cifrasPorCasillas» de la segunda fase: cada casilla
 * vacía se relee sola y solo se acepta la ÚNICA combinación que hace cuadrar la fila. Todas las cifras son inventadas.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {cifrasPorCasillas}=require("../albaranes/escaneado.js");

const C=(literal,valor,caja,extra={})=>({literal,valor,estado:"VERIFICADO",confianza:0.99,caja,...extra});
const vacio=()=>({estado:"VACIO",valor:null,literal:""});
// Dos filas que cuadran fijan las columnas (x en puntos) y el formato: cantidad 2 decimales, precio 3, importe 2.
const verificada=(fila,y,q,p,d,i)=>({fila,pagina:1,subtotal:vacio(),cuadre:{estado:"VERIFICADO"},
 referencia:C("18000000"+fila,"18000000"+fila,[68,y+1,107,5.3]),descripcion:C("PIEZA FICTICIA "+fila,"PIEZA FICTICIA "+fila,[113,y+0.6,200,4.3]),
 cantidad:C(q,Number(q.replace(",",".")),[393,y-2,407,5.5]),precio:C(p,Number(p.replace(",",".")),[434,y-1.7,451,5.5]),
 descuento:C(String(d),d,[483,y-2.1,490,4.8],{factor:1-d/100,porcentajes:[d]}),importe:C(i,Number(i.replace(",",".")),[520,y-0.7,533.5,5.5],{decimales:2})});
const sinCifras=(fila,y,ref,desc)=>({fila,pagina:1,subtotal:vacio(),cuadre:{estado:"SIN_PRECIOS"},
 referencia:C(ref,ref,[68,y,107,5.3]),descripcion:desc?C(desc,desc,[113,y,200,4.3]):vacio(),cantidad:vacio(),precio:vacio(),descuento:vacio(),importe:vacio()});
// Página ficticia (72 ppp: 1 punto = 1 píxel): el OCR de un recorte devuelve lo que diga `casillas(columna, yCentro)`.
const pagina=(casillas)=>({numero:1,dpi:72,anchoPx:600,altoPx:800,ocr:async({region:[x,y,w,h]})=>{
 const col=x+w<415?"cantidad":x+w<460?"precio":x+w<500?"descuento":"importe";
 const t=casillas(col,y+h/2);
 return t?t.split(" ").map((texto)=>({texto,conf:60,x0:0,x1:w,y0:0,y1:h})):[];
}});
const principal=(lineas)=>({lineas,_ctx:{}});
const ctx={opcionesNumero:{}};
// Filas que cuadran: 2 × 0,500 − 50 % = 0,50 y 4 × 0,250 − 20 % = 0,80.
const buenas=(n=2,y=151)=>[verificada(n,y,"2,00","0,500",50,"0,50"),verificada(n+1,y+10,"4,00","0,250",20,"0,80")];
// 1 × 40,000 − 25 % = 30,00, leída con la raya como «1» y el punto por la coma.
const fila1={cantidad:"1,001",precio:"40.000",descuento:"25",importe:"30.00"};

test("las cifras perdidas de una fila se aceptan solo si UNA combinación cuadra (coma/punto confundidos, raya leída como 1)",async()=>{
 const p=principal([sinCifras(1,120,"1300000001","BROCA FICTICIA"),...buenas()]);
 const hechos=await cifrasPorCasillas(p,[pagina((col,yc)=>yc<130?fila1[col]:null)],ctx,null);
 const l=p.lineas[0];
 assert.deepEqual(hechos,["linea 1 cifras (relectura por casillas y cuadre)"]);
 assert.deepEqual([l.cantidad.valor,l.precio.valor,l.descuento.valor,l.importe.valor,l.cuadre.estado],[1,40,25,30,"VERIFICADO"]);
 assert.deepEqual([l.precio.literal,l.importe.literal],["40,000","30,00"],"con el separador de las filas que cuadran");
 assert.equal(l.precio.resolucion.metodo,"relectura_casillas_cuadre");
 assert.equal(l.estado,"OK","sin motivos, la fila queda bien");
});

test("descuento en cascada leído sin espacio («455» = 45+5): lo decide el cuadre",async()=>{
 const p=principal([sinCifras(1,120,"1300000009","PIEZA DOBLE"),...buenas()]);
 // 2 × 10,000 × 0,55 × 0,95 = 10,45 (con 4+55 serían 8,64).
 const v={cantidad:"2,00",precio:"10,000",descuento:"455",importe:"10.45"};
 await cifrasPorCasillas(p,[pagina((col,yc)=>yc<130?v[col]:null)],ctx,null);
 assert.deepEqual([p.lineas[0].descuento.porcentajes,p.lineas[0].importe.valor,p.lineas[0].cuadre.estado],[[45,5],10.45,"VERIFICADO"]);
});

test("dos combinaciones que cuadran: no se resuelve",async()=>{
 const p=principal([sinCifras(1,120,"1300000001","BROCA FICTICIA"),...buenas()]);
 const v={cantidad:"2,00 1,00",precio:"20,000 40,000",descuento:"25",importe:"30,00"};
 const hechos=await cifrasPorCasillas(p,[pagina((col,yc)=>yc<130?v[col]:null)],ctx,null);
 assert.deepEqual(hechos,[]);
 assert.equal(p.lineas[0].precio.estado,"VACIO");
});

test("fragmento de la fila de al lado (sin descripción) con la misma combinación: la fila buena se queda las cifras",async()=>{
 const p=principal([sinCifras(1,112,"58",null),sinCifras(2,120,"25","BROCA FICTICIA"),...buenas(3)]);
 await cifrasPorCasillas(p,[pagina((col,yc)=>yc<130?fila1[col]:null)],ctx,null);
 assert.equal(p.lineas[0].precio.estado,"VACIO","el fragmento no recibe nada");
 assert.equal(p.lineas[1].importe.valor,30);
 // Dos filas con descripción y la misma combinación: ninguna.
 const q=principal([sinCifras(1,112,"1300000002","OTRA PIEZA"),sinCifras(2,120,"1300000001","BROCA FICTICIA"),...buenas(3)]);
 await cifrasPorCasillas(q,[pagina((col,yc)=>yc<130?fila1[col]:null)],ctx,null);
 assert.deepEqual([q.lineas[0].precio.estado,q.lineas[1].precio.estado],["VACIO","VACIO"]);
});

/* ---------------- Texto del margen (vertical) leído delante del código ---------------- */
const {fila,cabeceraDoc,leer}=require("./ayudas-ocr.js");
const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const articulo=(y,ref,desc,q,p,d,i,ruido=null)=>fila(y,...(ruido?[[ruido,38]]:[]),[ref,68],[desc,120],[q,420],[p,462],[d,510],[i,560]);

test("trozos del texto vertical del margen no son filas ni códigos",()=>{
 const r=leer([...cabeceraDoc(),...titulos(),...fila(212,["123",38]),
  ...articulo(220,"1300000001","BROCA","1,00","10,000","30","7,00","456"),
  ...articulo(232,"1300000002","CODO","2,00","1,000","","2,00"),
  ...articulo(244,"1300000003","TE","3,00","1,000","","3,00")]);
 assert.equal(r.lineas.length,3,"la fila fantasma no cuenta");
 assert.deepEqual(r.lineas.map(l=>l.referencia.valor),["1300000001","1300000002","1300000003"]);
 assert.equal(r.lineas[0].descripcion.valor,"BROCA","el código real no acaba en la descripción");
 // Una columna CON título a la izquierda (nº de línea) sí se lee: no es margen.
 const t=leer([...cabeceraDoc(),...fila(200,["Nº",30],["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]),
  ...articulo(220,"1300000001","BROCA","1,00","10,000","30","7,00","1"),...articulo(232,"1300000002","CODO","2,00","1,000","","2,00","2"),
  ...articulo(244,"1300000003","TE","3,00","1,000","","3,00","3")]);
 assert.equal(t.lineas.length,3);
});

test("sin dos filas que cuadren no hay columnas probadas: nada cambia; lo ya leído no se toca",async()=>{
 const p=principal([sinCifras(1,120,"1300000001","BROCA FICTICIA"),buenas()[0]]);
 assert.deepEqual(await cifrasPorCasillas(p,[pagina(()=>"1,00")],ctx,null),[]);
 // El importe leído por el OCR de página (6,00) es el único candidato de su casilla: un 6,60 releído no lo sustituye.
 const l=sinCifras(1,120,"1300000009","PIEZA DOBLE");l.importe={...C("6,00",6,[520,119,533.5,5.5]),estado:"OK",decimales:2};
 const q=principal([l,...buenas()]);
 const v={cantidad:"1,00",precio:"12,000",descuento:"45",importe:"6,60"};
 await cifrasPorCasillas(q,[pagina((col,yc)=>yc<130?v[col]:null)],ctx,null);
 assert.equal(q.lineas[0].importe.valor,6);
 assert.equal(q.lineas[0].cuadre.estado,"SIN_PRECIOS","con 45 % no cuadra a 6,00 y no se inventa otro descuento");
});
