"use strict";
/*
 * Regresión de los fallos de la prueba real del 2026-10-28 (PDF de 40 páginas). Cada prueba reproduce el
 * fallo con palabras de OCR FICTICIAS (ningún número, código, precio ni NIF real en el repositorio).
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {registroCon,fila,cabeceraDoc,leer}=require("./ayudas-ocr.js");
const {finalizar}=require("../albaranes/extraer.js");
const C=require("../albaranes/cola-stel.js");
const L=require("../albaranes/lector.js");

const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const etiquetas=(numero,fecha="15/10/26")=>[...fila(120,["ALBARÁN",60],["Nº",105],[numero,120]),...fila(120,["FECHA",300],[fecha,340])];
const saltoki=(extra={})=>registroCon({formato_numero:"^\\d{3}\\.\\d{3}$",...extra});

test("número impreso con coma («600,111») con formato «ddd.ddd»: mismas cifras, aceptado y anotado (antes «600»)",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("600,111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:saltoki()});
 assert.equal(r.numero.valor,"600.111");assert.equal(r.numero.estado,"OK");
 assert.match(r.numero.notas.join(),/Impreso con coma/);
});

test("número partido por el OCR en «600» y «,111» se une; nunca queda «600»",()=>{
 const r=leer([...cabeceraDoc(),...fila(120,["ALBARÁN",60],["Nº",105],["600",120],[",111",140]),...fila(120,["FECHA",300],["15/10/26",340]),...titulos(),
  ...fila(218,["1300000001",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:saltoki()});
 assert.notEqual(r.numero.valor,"600");assert.equal(r.numero.valor,"600.111");
});

test("un número sin el formato del proveedor nunca queda aceptado, tampoco tras combinar lecturas («0.01»)",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:saltoki()});
 assert.equal(r.numero.estado,"OK");
 // Otra lectura dejó «0.01» como número aceptado: finalizar() vuelve a exigir el formato.
 r.numero={...r.numero,valor:"0.01",literal:"0,01",estado:"OK"};
 finalizar(r);
 assert.equal(r.numero.estado,"REVISAR");assert.notEqual(r.estado,"AUTO_OK");
});

test("«NETO» de la columna del descuento pegado a la descripción: fuera de la descripción y sin descuento",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["FICTICIO",150],["NETO",380],["2,00",420],["10,000",462],["20,00",560])],{registro:saltoki()});
 const l=r.lineas[0];
 assert.equal(l.descripcion.valor,"TUBO FICTICIO");
 assert.equal(l.cuadre.estado,"VERIFICADO");
});

test("albarán sin precios: un total suelto (p. ej. «9», «0») nunca se acepta ni pasa a la orden de STEL",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["7,00",420]),
  ...fila(700,["TOTAL:",480],["9",540])],{registro:saltoki()});
 assert.equal(r.lineas[0].precio.valor,null);
 if(r.totales.total.valor!=null)assert.equal(r.totales.total.estado,"REVISAR");
 const o=C.orden({archivo:"f.pdf",paginas:[1],estado_documento:"AUTO_OK",resultado:{...r,proveedor:{...r.proveedor,account_id:9001}}},{});
 assert.equal(o.plan.total,null);
});

test("«Total líneas» mal leído por el OCR («Total Iíneas») no es el total del albarán",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["7,00",420]),
  ...fila(700,["Total",60],["Iíneas:",90],["1",150])],{registro:saltoki()});
 assert.equal(r.totales.total.valor,null);
});

test("cuota de IVA que no es base × % («21» de la columna del tipo) queda en revisión",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560]),
  ...fila(700,["Base",300],["Imponible",330],["IVA",420],["Total",500]),...fila(715,["10,00",300],["21",420],["12,10",500])],{registro:saltoki()});
 if(r.totales.cuota_iva.valor===21)assert.equal(r.totales.cuota_iva.estado,"REVISAR");
});

test("importe con 4 decimales: el cuadre exige esos decimales (la última cifra mal leída no cuadra)",()=>{
 const linea=imp=>leer([...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["2,00",420],["13,1517",462],[imp,560])],{registro:saltoki()}).lineas[0];
 assert.equal(linea("26,3034").cuadre.estado,"VERIFICADO");
 assert.notEqual(linea("26,3036").cuadre.estado,"VERIFICADO");
});

test("número fuera de la secuencia del proveedor en el lote («500.300» entre «600.xxx»): a revisión; cruces pequeños, no",()=>{
 const perfil={id:"A",numeros_correlativos:{tolerancia:2000}};
 const doc=(num,fecha)=>({paginas:[1],estado_documento:"AUTO_OK",resultado:{proveedor:{id:"A"},numero:{valor:num,estado:"OK",motivos:[]},fecha:{valor:fecha,estado:"OK"},lineas:[]}});
 const docs=[doc("600.100","2026-10-09"),doc("600.900","2026-10-15"),doc("500.300","2026-10-19"),doc("601.500","2026-10-20"),doc("601.400","2026-10-23"),doc("601.700","2026-10-22")];
 const fuera=L._numerosFueraDeSecuencia(docs,{proveedores:[perfil]});
 assert.deepEqual(fuera.map(d=>d.resultado.numero.valor),["500.300"]);
});

test("abono o rectificativo solo por su título o sello, no por «devolución» en las condiciones del pie",()=>{
 const base=[...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560])];
 const condiciones=fila(760,["No",60],["se",80],["admitirá",95],["su",140],["devolución.",155],["En",210],["caso",225]);
 assert.equal(leer([...base,...condiciones],{registro:saltoki()}).tipo_documento.valor,"ALBARAN");
 assert.equal(leer([...base,...fila(90,["ALBARAN",60],["RECTIFICATIVO",120])],{registro:saltoki()}).tipo_documento.valor,"ABONO");
 assert.equal(leer([...base,...fila(780,["*ABONO*",500])],{registro:saltoki()}).tipo_documento.valor,"ABONO");
});
