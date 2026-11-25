"use strict";
/*
 * Facturas en inglés y de plataformas en línea (banco privado de facturas registradas en STEL, 2026-11-25): «Factura #— …» y «Fecha
 * de la factura— nov 3, 2026» en una sola casilla, «Invoice number CÓDIGO CIFRAS», fechas con el mes delante o en inglés, importes
 * «€23.45», «Tax 0%» sin cuota con su llamada de nota, «Refund», «Cuota 21,0%» / «TOTAL CUOTAS» frente al «0,00%» de las retenciones
 * y la etiqueta de fecha partida en dos renglones («Fecha de / Envío:»). Datos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {extraerDePaginas}=require("../albaranes/extraer.js");
const N=require("../albaranes/normalizar.js");
const T=require("../albaranes/texto-pdf.js");
const {HOY,registroCon,fila,cabeceraDoc,pagina}=require("./ayudas-ocr.js");
// Proveedor sin el formato de las cifras en su perfil: lo dice el propio documento.
const leer=palabras=>extraerDePaginas([pagina([...cabeceraDoc(),...palabras])],{registro:registroCon({formato_confirmado:false}),hoy:HOY,numeroDeFactura:true});
const celda=(t,x,ancho,alto)=>[t,x,95,{ancho,...(alto?{alto}:{})}];
const tot=r=>Object.fromEntries(["base_imponible","cuota_iva","total"].map(k=>[k,[r.totales[k].valor,r.totales[k].estado]]));

test("fechas con el mes delante («nov 3, 2026», «February 12, 2026») y meses en inglés («10-APR-26»)",()=>{
 const F=t=>N.fecha(t);
 assert.equal(F("nov 3, 2026").valor,"2026-11-03");
 assert.equal(F("ene 4, 2026").valor,"2026-01-04");
 assert.equal(F("February 12, 2026").valor,"2026-02-12");
 assert.equal(F("Oct 9, 2026").valor,"2026-10-09");
 assert.equal(F("10-APR-26").valor,"2026-04-10");
 assert.equal(F("12-JUL-2026").valor,"2026-07-12");
 // Con el mes delante, solo con el año de cuatro cifras; un mes desconocido o un día que no existe, nunca.
 assert.notEqual(F("nov 3, 26").estado,"OK");
 assert.notEqual(F("Foo 12, 2026").estado,"OK");
 assert.notEqual(F("February 30, 2026").estado,"OK");
});

test("«Factura #— AB…» y «Fecha de la factura— nov 3, 2026» en una sola casilla",()=>{
 const r=leer([...fila(79,celda("Factura #— AB202610-12345",365,112)),
  ...fila(94,celda("Fecha de la factura— nov 3, 2026",365,139)),
  ...fila(110,celda("Importe de la factura— 12,34 € (EUR)",365,151))]);
 assert.equal(r.numero.valor,"AB202610-12345");assert.equal(r.numero.estado,"OK");
 assert.equal(r.fecha.valor,"2026-11-03");assert.equal(r.fecha.estado,"OK");
});

test("«Invoice number ABCDEFGH 0012» (con un espacio) y «Date of issue»; nunca «Date due»; trozos con «/» o «-»",()=>{
 const r=leer([...fila(100,celda("Invoice number",60,60),celda("ABCDEFGH 0012",160,60)),
  ...fila(112,celda("Date of issue",60,50),celda("February 12, 2026",160,70)),
  ...fila(124,celda("Date due",60,40),celda("March 12, 2026",160,60))]);
 assert.equal(r.numero.valor,"ABCDEFGH 0012");assert.equal(r.numero.estado,"OK");
 assert.equal(r.fecha.valor,"2026-02-12");assert.equal(r.fecha.estado,"OK");
 for(const n of ["ES/2026/X1-1234","AbCdEfGhI-1234567890"]){
  const x=leer([...fila(100,celda("Invoice No:",60,45),celda(n,160,80)),...fila(112,celda("Invoice date",60,50),celda("Oct 9, 2026",160,55))]);
  assert.equal(x.numero.valor,n);assert.equal(x.numero.estado,"OK");
  assert.equal(x.fecha.valor,"2026-10-09");
 }
 // «CÓDIGO CIFRAS» con un espacio solo tras «Invoice number»: con otra etiqueta nunca se acepta.
 const otra=leer([...fila(100,celda("Número",60,40),celda("GESTION 12345",160,60))]);
 assert.notEqual(otra.numero.valor,"GESTION 12345");
});

test("«€23.45» y «Tax 0%» sin cuota impresa: la base que es el total, con cuota 0; la llamada de nota bajo «Tax» no es el %",()=>{
 const pie=[...fila(411,celda("Subtotal",306,36),celda("€23.45",554,28)),
  ...fila(425,celda("Total",306,21),celda("€23.45",554,28)),
  ...fila(439,celda("Amount due",306,53),celda("€23.45",553,29))];
 const r=leer([...fila(346,celda("Description",30,40,7.5),celda("Qty",396,13,7.5),celda("Unit price",439,34,7.5),celda("Tax",510,13,7.5),celda("Amount",554,28,7.5)),
  ...fila(363,celda("1",518,3,5.4)),
  ...fila(368,celda("Servicio ficticio",30,90),celda("1",405,4),celda("€23.45",446,27),celda("0%",503,13),celda("€23.45",554,28)),
  ...pie,...fila(483,celda("1",33,3),celda("Tax to be paid on reverse charge basis",41,137))]);
 assert.deepEqual(tot(r),{base_imponible:[23.45,"VERIFICADO"],cuota_iva:[0,"VERIFICADO"],total:[23.45,"VERIFICADO"]});
 assert.equal(r.totales.iva_porcentaje.valor,0);
 // Sin ningún 0 % impreso, la base que es el total nunca se acepta sola.
 const sin=leer(pie);
 assert.notEqual(sin.totales.total.estado,"VERIFICADO");
});

test("«Refund» (devolución en inglés): lo impreso es la factura devuelta; los importes, a revisión y nunca en negativo",()=>{
 const r=leer([...fila(80,celda("Refund",60,40)),
  ...fila(100,celda("Invoice number",60,60),celda("ABCDEFGH 0013",160,60)),
  ...fila(112,celda("Date of issue",60,50),celda("March 2, 2026",160,60)),
  ...fila(400,celda("Subtotal",360,40),celda("€100.00",480,35)),
  ...fila(412,celda("VAT (21%)",360,45),celda("€21.00",480,30)),
  ...fila(424,celda("Total",360,25),celda("€121.00",480,35))]);
 for(const k of ["base_imponible","cuota_iva","total"])assert.equal(r.totales[k].estado,"REVISAR",k);
 assert.equal(r.totales.total.valor,121);
});

test("«Cuota 21,0%» y «TOTAL CUOTAS» son la cuota; el «0,00%» de las retenciones nunca hace aceptar la base como total",()=>{
 const arriba=[...fila(388,celda("Importe factura TOTAL/ORIGEN:",329,123),celda("300,00 €",498,31)),
  ...fila(400,celda("Importe factura ANTERIOR:",347,105),celda("0,00 €",507,22)),
  ...fila(412,celda("Importe factura PERIODO:",352,100),celda("300,00 €",498,31)),
  ...fila(444,celda("BASE IMPONIBLE:",381,71),celda("300,00 €",498,31))];
 const abajo=[...fila(522,celda("TOTAL A FACTURAR:",368,84),celda("363,00 €",498,31)),
  ...fila(542,celda("Retenciones / Otros Conceptos",295,119),celda("%",432,7)),
  ...fila(558,celda("0,00%",424,23),celda("0,00 €",507,22))];
 const r=leer([...arriba,...fila(484,celda("Cuota 21,0%",404,46),celda("63,00 €",502,27)),...fila(505,celda("TOTAL CUOTAS:",387,65),celda("63,00 €",502,27)),...abajo]);
 assert.deepEqual(tot(r),{base_imponible:[300,"VERIFICADO"],cuota_iva:[63,"VERIFICADO"],total:[363,"VERIFICADO"]});
 assert.equal(r.totales.iva_porcentaje.valor,21);
 const sin=leer([...arriba,...abajo]);
 assert.notEqual(sin.totales.total.estado,"VERIFICADO",JSON.stringify(sin.totales.total));
});

test("«Fecha de» con «Envío:» debajo (etiqueta en dos renglones) nunca es la fecha de la factura",()=>{
 for(const envio of ["10-ABR-26","10-APR-26"]){
  const r=leer([...fila(173,celda("Fecha: 12-JUL-2026",449,70)),
   ...fila(256,celda("Forma de Pago",58,58),celda("Vencimiento",246,48),celda("Fecha de",323,35),celda("N / Referencia",391,53)),
   ...fila(265,celda("Envio:",329,24)),
   ...fila(276,celda("12-JUL-2026",239,52),celda(envio,319,45),celda("1234567",400,35))]);
  assert.equal(r.fecha.valor,"2026-07-12",envio+" "+JSON.stringify(r.fecha));assert.equal(r.fecha.estado,"OK");
 }
});

test("caracteres de control en el texto de un PDF («ABCDEFGH␀0012»): un espacio",async()=>{
 const mult=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
 const pdfjs={Util:{transform:mult},OPS:{save:1,restore:2,transform:3,paintImageXObject:4}};
 const items=[{str:"Invoice number",transform:[10,0,0,10,60,742],width:70,height:10},
  {str:"ABCDEFGH\u00000012",transform:[10,0,0,10,160,742],width:65,height:10}];
 const page={getViewport:()=>({transform:[1,0,0,-1,0,842],width:595,height:842}),
  getTextContent:async()=>({items}),getOperatorList:async()=>({fnArray:[],argsArray:[]})};
 const p=await T.leerPagina(pdfjs,page,1);
 assert.ok(p.lineas.some(l=>l.texto.includes("ABCDEFGH 0012")),JSON.stringify(p.lineas.map(l=>l.texto)));
});
