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
const {HOY,registroCon,fila,cabeceraDoc,pagina,NIF_PROPIO}=require("./ayudas-ocr.js");
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

// Vendedores de tiendas en línea (banco de facturas, 2026-11-25): la base y el IVA del desglose van dos renglones por debajo de su título, con
// «(excl.VAT)» en medio, y el IVA cero se imprime «€0.0». Datos FICTICIOS.
const amazon=({iva,base,cuota,total})=>[
 ...fila(176,celda("Invoice #",348,27),celda("AbCdEfGhI-1234567890",429,78)),
 ...fila(186,celda("Total payable",348,40),celda("€"+total,429,21)),
 ...fila(479,celda("Description",60,34),celda("Qty",303,10),celda("Unit price",340,29),celda("VAT rate",398,26),celda("Unit price",450,29),celda("Item subtotal",495,39)),
 ...fila(488,celda("(excl.VAT)",339,30),celda("(incl.VAT)",451,28),celda("(incl.VAT)",507,28)),
 ...fila(504,celda("Funda ficticia",60,100),celda("1",309,4),celda("€"+base,352,17),celda(iva+"%",404,20),celda("€"+total,462,17),celda("€"+total,514,21)),
 ...fila(534,celda("Shipping Charge",60,49),celda("€0.0",355,14),celda("€0.0",465,14),celda("€0.0",521,14)),
 ...fila(587,celda("Invoice total",297,52),celda("€"+total,504,31)),
 ...fila(618,celda("VAT rate",347,26),celda("Item subtotal",415,39),celda("VAT subtotal",496,39)),
 ...fila(627,celda("(excl.VAT)",424,30)),
 ...fila(646,celda(iva+"%",353,20),celda("€"+base,433,21),celda("€"+cuota,521,14)),
 ...fila(664,celda("Total",302,15),celda("€"+base,433,21),celda("€"+cuota,521,14))];

test("tienda en línea: la base bajo «Item subtotal» con «(excl.VAT)» en medio y el IVA «€0.0»; «(incl.VAT)» nunca da la base",()=>{
 const cero=leer(amazon({iva:"0.00",base:"23.46",cuota:"0.0",total:"23.46"}));
 assert.deepEqual(tot(cero),{base_imponible:[23.46,"VERIFICADO"],cuota_iva:[0,"VERIFICADO"],total:[23.46,"VERIFICADO"]});
 assert.equal(cero.numero.valor,"AbCdEfGhI-1234567890");
 const veintiuno=leer(amazon({iva:"21",base:"19.39",cuota:"4.07",total:"23.46"}));
 assert.deepEqual(tot(veintiuno),{base_imponible:[19.39,"VERIFICADO"],cuota_iva:[4.07,"VERIFICADO"],total:[23.46,"VERIFICADO"]});
});

test("número partido en dos renglones («ES-…-2026-» y debajo sus últimas cifras) y entero más abajo: vale el entero",()=>{
 const r=leer([...fila(168,celda("Invoice #",348,27),celda("ES-1234567-2026-",429,98)),...fila(177,celda("1234567890",429,37)),
  ...fila(431,celda("Invoice # ES-1234567-2026-1234567890",304,235))]);
 assert.equal(r.numero.valor,"ES-1234567-2026-1234567890");assert.equal(r.numero.estado,"OK");
});

test("recibo («Receipt» arriba, sin número de factura): su número y su fecha; con «Invoice number», nunca el del recibo",()=>{
 const r=leer([...fila(62,celda("Receipt",500,39)),
  ...fila(158,celda("Receipt date/Delivery",348,65),celda("3 mayo 2026",429,42)),...fila(167,celda("date",348,14)),
  ...fila(176,celda("Receipt #",348,29),celda("AbCdEfGhI-1234567890",429,76))]);
 assert.equal(r.numero.valor,"AbCdEfGhI-1234567890");assert.equal(r.numero.estado,"OK");
 assert.equal(r.fecha.valor,"2026-05-03");assert.equal(r.fecha.estado,"OK");
 const ambos=leer([...fila(62,celda("Receipt",500,39)),...fila(80,celda("Invoice number",30,67),celda("ABCDEFGH 0014",104,91)),
  ...fila(94,celda("Receipt number",30,68),celda("1234 5678",104,47))]);
 assert.equal(ambos.numero.valor,"ABCDEFGH 0014");
});

// Factura bilingüe (banco de facturas, 2026-11-25): «Factura/Invoice» o «Factura de deudor/Credit Note», la base en «Precio neto total»
// y los pesos con «Total gross weight». Datos FICTICIOS.
const bilingue=titulo=>[...fila(152,celda(titulo,29,115),celda("Número/Number:",176,66),celda("1234567890",278,45)),
 ...fila(284,celda("Peso bruto total/Total gross Weight",343,136),celda("1.210,00 KG",499,39)),
 ...fila(295,celda("Peso neto total/Total Net Weight",343,123),celda("1.000,00 KG",499,39)),
 ...fila(746,celda("Precio neto total",387,50),celda("1.000,00",556,25)),...fila(751,celda("Total Net Price",391,46)),
 ...fila(759,celda("Importe del IVA (EUR )",366,71),celda("210,00",561,20)),
 ...fila(772,celda("Total Valor (EUR)",382,55),celda("1.210,00",556,25)),...fila(777,celda("Total Value",402,35))];

test("factura bilingüe: base «Precio neto total», los pesos nunca son el total y «Credit Note» tras la barra es un abono",()=>{
 const factura=leer(bilingue("Factura/Invoice"));
 assert.deepEqual(tot(factura),{base_imponible:[1000,"VERIFICADO"],cuota_iva:[210,"VERIFICADO"],total:[1210,"VERIFICADO"]});
 const abono=leer(bilingue("Factura de deudor/Credit Note"));
 assert.deepEqual(tot(abono),{base_imponible:[-1000,"VERIFICADO"],cuota_iva:[-210,"VERIFICADO"],total:[-1210,"VERIFICADO"]});
});

test("«№.12345678901» bajo el título «FACTURA» es el número de la factura; «№ de Envío» y «№ Cliente» no",()=>{
 const r=leer([...fila(159,celda("FACTURA",450,66)),...fila(173,celda("№.12345678901",385,67),celda("Fecha: 9-MAY-2026",470,86)),
  ...fila(256,celda("№ de Envio",172,43),celda("№ Cliente",400,37)),...fila(276,celda("ABC123",172,40),celda("7654321",400,37))]);
 assert.equal(r.numero.valor,"12345678901");assert.equal(r.numero.estado,"OK");
 assert.equal(r.fecha.valor,"2026-05-09");
});

test("importes con punto decimal y «EUR» en la casilla de al lado («100.00 | EUR»): el formato lo dice el documento",()=>{
 const r=leer([...fila(380,celda("Material",43,25),celda("Cant.",384,16),celda("Precio Ud.",414,34),celda("Total",474,16)),
  ...fila(400,celda("Pieza ficticia",43,60),celda("2,5",384,12),celda("40.00",414,20),celda("100.00",474,22)),
  ...fila(495,celda("Total Base Imponible:",400,70),celda("100.00",522,21),celda("EUR",554,14)),
  ...fila(506,celda("Total IVA:",400,31),celda("21.00",526,17),celda("EUR",554,14)),
  ...fila(520,celda("Total Factura IVA",400,55),celda("121.00",522,21),celda("EUR",554,14))]);
 assert.deepEqual(tot(r),{base_imponible:[100,"VERIFICADO"],cuota_iva:[21,"VERIFICADO"],total:[121,"VERIFICADO"]});
});

// Cifras con «€» en las líneas (factura real 2026-11-25: el precio y el importe acababan pegados a la descripción y la línea quedaba
// sin importe). Datos FICTICIOS.
test("cifras con «€» en las líneas («12,34 €»): precio e importe, nunca pegados a la descripción",()=>{
 const r=leer([...fila(344,celda("DESCRIPCIÓN",34,46),celda("UNIDADES",342,35),celda("PRECIO UNITARIO",407,61),celda("IVA %",481,19),celda("IMPORTE (EUR)",508,51)),
  ...fila(380,celda("Servicio ficticio (mensual) - Cargos",34,224),celda("1",371,6),celda("12,34 €",439,29),celda("21 %",476,24),celda("12,34 €",530,29)),
  ...fila(394,celda("prorrateados",34,66)),
  ...fila(430,celda("Total excl. IVA",432,68),celda("12,34 €",530,29)),
  ...fila(452,celda("IVA @ 21 %",446,54),celda("2,59 €",530,29)),
  ...fila(485,celda("Total",474,26),celda("14,93 €",530,29))]);
 assert.equal(r.lineas.length,1);
 const l=r.lineas[0];
 assert.equal(l.descripcion.valor,"Servicio ficticio (mensual) - Cargos prorrateados");
 assert.equal(l.cantidad.valor,1);assert.equal(l.precio.valor,12.34);assert.equal(l.importe.valor,12.34);
 assert.equal(r.totales.total.valor,14.93);
});

test("filas vacías «0,00 €» de la plantilla y la suma suelta de la columna al final: ni son líneas ni ocultan el total",()=>{
 const vacias=[316,325,334,343].flatMap(y=>fila(y,celda("0,00 €",404,17)));
 const r=leer([...fila(235,celda("Cantidad",95,25),celda("Concepto",224,27),celda("Precio",344,17),celda("Total",383,14)),
  ...fila(244,celda("2",128,5),celda("menú ficticio",136,50),celda("10,00 €",359,21),celda("20,00 €",397,24)),
  ...fila(253,celda("1",128,5),celda("postre",136,30),celda("2,00 €",363,17),celda("2,00 €",404,17)),
  ...vacias,...fila(369,celda("22,00 €",397,24)),
  ...fila(387,celda("Base impobible",95,43),celda("20,00 €",185,24)),...fila(396,celda("% iva",95,14),celda("10",163,7)),
  ...fila(405,celda("total iva",95,23),celda("2,00 €",188,21))]);
 assert.equal(r.lineas.length,2,JSON.stringify(r.lineas.map(l=>[l.descripcion?.valor,l.importe?.valor])));
 assert.deepEqual(tot(r),{base_imponible:[20,"VERIFICADO"],cuota_iva:[2,"VERIFICADO"],total:[22,"VERIFICADO"]});
});

// Suscripciones de otros países de la UE (facturas reales 2026-11-26: tabla en inglés sin leer, proveedor con NIF-IVA irlandés sin
// reconocer, y una devolución solo del IVA). Datos FICTICIOS.
// Sin la cabecera de ejemplo (lleva un CIF español): la de un proveedor de otro país.
const leerUE=palabras=>extraerDePaginas([pagina(palabras)],{registro:registroCon({formato_confirmado:false}),hoy:HOY,numeroDeFactura:true});
const suscripcion=(extra=[])=>[...fila(80,celda("Invoice",60,40)),
 ...fila(100,celda("Invoice number",60,60),celda("ABCDEFGH 0014",160,60)),
 ...fila(112,celda("Date of issue",60,50),celda("March 2, 2026",160,60)),
 ...fila(150,celda("Empresa Ajena Limited",60,100),celda("Bill to",300,30)),
 ...fila(162,celda("IE VAT IE1234567FA",60,80),celda("ES VAT ES"+NIF_PROPIO,300,80)),
 ...fila(300,celda("Description",60,50),celda("Qty",300,15),celda("Unit price",360,40),celda("Tax",420,20),celda("Amount",480,35)),
 ...fila(314,celda("Servicio ficticio",60,70),celda("1",300,5),celda("€20.00",360,30),celda("21%",420,15),celda("€20.00",480,30)),
 ...fila(326,celda("Mar 2 Apr 2, 2026",60,70)),
 ...fila(360,celda("Subtotal",360,40),celda("€20.00",480,30)),
 ...fila(372,celda("Total excluding tax",360,70),celda("€20.00",480,30)),
 ...fila(384,celda("VAT - Spain",300,45),celda("21% on €20.00",360,50),celda("€4.20",480,25)),
 ...fila(396,celda("Total",360,25),celda("€24.20",480,30)),...extra];
test("tabla en inglés («Description | Qty | Unit price | Tax | Amount»): la línea con su periodo, cuadrada",()=>{
 const r=leer(suscripcion());
 assert.equal(r.lineas.length,1);
 const l=r.lineas[0];
 assert.match(l.descripcion.valor,/^Servicio ficticio Mar 2 Apr 2, 2026$/);
 assert.deepEqual([l.cantidad.valor,l.precio.valor,l.importe.valor],[1,20,20]);
 assert.equal(l.importe.estado,"VERIFICADO");
});
test("NIF-IVA de otro país con su etiqueta («IE VAT IE…»): el del proveedor, por comprobar en STEL; nunca el «ES VAT» del cliente",()=>{
 const r=leerUE(suscripcion());
 assert.equal(r.proveedor.nif,"IE1234567FA");
 assert.equal(r.proveedor.estado,"NIF_NO_REGISTRADO");
 assert.equal(r.proveedor.intracomunitario,true);
});
test("devolución solo del IVA: queda la factura sin IVA (base y total = lo que queda, IVA 0) y no es un abono",()=>{
 const devolucion=[...fila(430,celda("Credited subtotal",360,60),celda("€0.00",480,25)),
  ...fila(442,celda("VAT - Spain",300,45),celda("21% on €20.00",360,50),celda("€4.20",480,25)),
  ...fila(454,celda("Credited total",360,50),celda("€4.20",480,25)),
  ...fila(466,celda("Adjusted invoice total",360,80),celda("€20.00",480,30))];
 const r=leer([...fila(60,celda("Refund",60,40)),...suscripcion(devolucion)]);
 assert.deepEqual(tot(r),{base_imponible:[20,"VERIFICADO"],cuota_iva:[0,"VERIFICADO"],total:[20,"VERIFICADO"]});
 assert.equal(r.totales.iva_devuelto.valor,4.2);
 assert.notEqual(r.tipo_documento?.valor,"ABONO");
 // Si lo devuelto no es el IVA de la factura, como antes: a revisión.
 const otra=[...fila(430,celda("Credited subtotal",360,60),celda("€0.00",480,25)),...fila(454,celda("Credited total",360,50),celda("€5.00",480,25)),
  ...fila(466,celda("Adjusted invoice total",360,80),celda("€19.20",480,30))];
 const r2=leer([...fila(60,celda("Refund",60,40)),...suscripcion(otra)]);
 assert.equal(r2.totales.total.estado,"REVISAR");assert.equal(r2.totales.iva_devuelto,undefined);
});
test("el NIF-IVA de otro país solo identifica al proveedor si está exacto y una sola vez en el catálogo de STEL",()=>{
 const V=require("../albaranes/verificacion.js");
 const cat=proveedores=>({solo_lectura:true,persistido:false,escritura_supabase:false,escritura_stel:false,proveedores_completo:true,articulos_completo:false,proveedores,articulos:[]});
 const con=c=>V.verificar(leerUE(suscripcion()),cat(c)).proveedor;
 assert.deepEqual([con([{id:77,nif:"IE1234567FA"},{id:78,nif:"B00000000"}]).account_id,con([{id:77,nif:"IE1234567FA"}]).via],[77,"catalogo_stel_nif_ue"]);
 assert.equal(con([{id:79,nif:"1234567FA"}]).account_id,79);
 assert.equal(con([]).account_id,undefined);
 assert.equal(con([{id:77,nif:"IE1234567FA"},{id:80,nif:"IE 1234567 FA"}]).account_id,undefined);
});
