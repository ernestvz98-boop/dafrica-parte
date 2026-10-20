"use strict";
/*
 * Regresión de los fallos hallados con albaranes REALES escaneados (lote de 10 páginas,
 * octubre 2026). Cada prueba reproduce el fallo con palabras de OCR construidas a mano:
 * proveedores, NIF, códigos e importes son FICTICIOS; ningún documento real entra en el repositorio.
 * Escala: 72 ppp, así que píxeles = puntos PDF.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {extraerDePaginas}=require("../albaranes/extraer.js");
const {paginaDesdePalabras,estimarInclinacion}=require("../albaranes/ocr.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");

const NIF="B24123457";
const registro={empresa_propia:{nombres:["DAFRICA"],nifs:["B24000002"]},
 proveedores:[{id:"A",nombre:"PROVEEDOR FICTICIO, S.L.",nifs:[NIF],formato_numeros:"es",formato_confirmado:true}]};
const HOY="2026-10-19";

// Palabra de OCR: x0 e y de la base en puntos; ancho estimado 5 pt por carácter.
let lineaId=0;
const w=(texto,x0,y,conf=95,{ancho=null,linea=null}={})=>({texto,x0,x1:x0+(ancho??texto.length*5),y0:y-8,y1:y,conf,linea});
const fila=(y,...palabras)=>{const id="L"+(lineaId++);return palabras.map(([t,x,c,o])=>w(t,x,y,c??95,{...(o||{}),linea:id}));};
const cabeceraDoc=()=>[...fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]),...fila(52,["CIF",60],[NIF,80])];
const leer=palabras=>extraerDePaginas([paginaDesdePalabras(palabras,{numero:1,anchoPx:595,altoPx:842,dpi:72})],{registro,hoy:HOY});
const etiquetas=(numero="600.123",fecha="27/08/26")=>[...fila(120,["ALBARÁN",60],["Nº",105],[numero,120]),...fila(120,["FECHA",300],[fecha,340])];
const cabeceraSaltoki=()=>fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO|",460],["DTO%",500],["IMPORTE",545]);

test("un manuscrito sobre la tabla no genera líneas y «2op» nunca es la cantidad 2",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),
  ...fila(218,["4300099900",60],["REDUCCION",120],["GALVA",175],["2,00",420],["30,000",462],["60",505],["5",520],["22,80",560]),
  ...fila(234,["eN",60,36],["r9ro",300,0],["EDS",345,37],["2op",420,13]),
  ...fila(246,["EE",60,27],["COLL",180,0],["Nx",265,52])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
 assert.ok(r.lineas_ignoradas.some(x=>/baja confianza OCR/.test(x.motivo)));
 assert.ok(!r.lineas.some(l=>l.cantidad.literal==="2op"));
});

test("cantidad tapada: el cuadre la sugiere al revisor, pero nunca se asigna",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),
  ...fila(218,["4300099900",60],["REDUCCION",120],["30,000",462],["60",505],["5",520],["22,80",560])]);
 const l=r.lineas[0];
 assert.equal(l.cantidad.valor,null);
 assert.equal(l.cantidad.sugerida,2);
 assert.equal(l.estado,"REVISAR");
 assert.notEqual(r.estado,"AUTO_OK");
});

test("«ALBARÁN» sobre la cabecera no se fusiona con ella y «PRECIO|» es la columna de precio",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...fila(190,["ALBARÁN",520]),...cabeceraSaltoki(),
  ...fila(218,["4300099900",60],["REDUCCION",120],["2,00",420],["30,000",462],["60",505],["5",520],["22,80",560])]);
 assert.equal(r.lineas[0].precio.valor,30);
 assert.deepEqual(r.lineas[0].descuento.porcentajes,[60,5]);
 assert.equal(r.lineas[0].importe.valor,22.8);
});

test("«Entrega en:» con una cifra en la columna de cantidad y su dirección no son artículos",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),
  ...fila(218,["1200000013",60],["NIPPEL",120],["GALVA",160],["4,00",420]),
  ...fila(240,["Entrega",60],["en:",95],["PG",120],["POLIGONO",135],["18",240],["SECTOR",255],["1",287]),
  ...fila(252,["C.P.:",200],["24410",225]),
  ...fila(255,["LOCALIDAD",120]),
  // Texto girado del margen leído como fragmentos cortos de confianza media.
  ...fila(252,["25",20,80]),...fila(262,["Ep:",20,90])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].descripcion.literal,"NIPPEL GALVA");
 assert.equal(r.lineas[0].cantidad.valor,4);
 assert.equal(r.lineas[0].precio.valor,null,"albarán sin precio: precio = null, nunca 0");
});

test("escaneo inclinado: se endereza y la fila no se parte; código y descripción separados por el hueco",()=>{
 const pendiente=0.012,cx=297.5;
 const inclinar=ps=>ps.map(p=>{const d=pendiente*((p.x0+p.x1)/2-cx);return {...p,y0:p.y0+d,y1:p.y1+d};});
 const palabras=inclinar([...cabeceraDoc(),...etiquetas("009901","13/10/2026"),
  ...fila(200,["ARTÍCULO",60],["DESCRIPCIÓN",250],["CANTIDAD",380],["PRECIO",440],["DTO.",500],["TOTAL",545]),
  ...fila(218,["150001",60],["SELLANTE",140],["255",190],["FIJACION",210],["1,00",395],["8,0000",440],["25,00",500],["6,00",555]),
  ...fila(230,["110002",60],["POLIMERO",140],["GRIS",185],["SELLANTE",210],["1,00",395],["6,0000",440],["25,00",500],["4,50",555]),
  ...fila(242,["0800003",60],["BROCA",140],["HEX-9",170],["HARD",200],["2,00",395],["10,0000",440],["20,00",555])]);
 assert.ok(Math.abs(estimarInclinacion(palabras,595)-pendiente)<0.003);
 const r=leer(palabras);
 assert.equal(r.lineas.length,3);
 assert.ok(r.lineas.every(l=>l.cuadre.estado==="VERIFICADO"));
 assert.equal(r.lineas[0].referencia.literal,"150001");
 assert.equal(r.lineas[0].descripcion.literal,"SELLANTE 255 FIJACION");
});

test("título «Descrinción» mal leído y cifras dentro de la descripción («… 1,22 x 19 mm»)",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("26/09001","31-07-2026"),
  ...fila(200,["Cod. Artículo",60,59,{ancho:60}],["Descrinción",130,46],["Cantidad",380],["Precio",430],["Dto.",480],["Importe",520]),
  ...fila(218,["2.100,0000",60],["Tablero",130],["2,44",190],["x",212],["1,22",220],["x",242],["19",250],["mm",262],
   ["6,0000",385],["10,0000",430],["20,00",480],["48,0000",520])]);
 const l=r.lineas[0];
 assert.equal(l.descripcion.literal,"Tablero 2,44 x 1,22 x 19 mm");
 assert.equal(l.cantidad.valor,6);
 assert.equal(l.cuadre.estado,"VERIFICADO");
});

test("valor de casilla dos renglones bajo la etiqueta («Número»), saltando una fecha",()=>{
 const r=leer([...cabeceraDoc(),
  ...fila(150,["Número",60],["Fecha",120],["Código",170],["Cliente",205]),
  ...fila(156,["podiaOLINDSERZOO",285,0]),
  ...fila(164,["18-09-2026",110],["563",175]),
  ...fila(168,["26/09002",55]),
  ...cabeceraSaltoki(),...fila(218,["R-1",60],["TABLERO",120],["1,00",420],["10,000",462],["10,00",560])]);
 assert.equal(r.numero.valor,"26/09002");
 assert.equal(r.fecha.valor,"2026-09-18");assert.equal(r.fecha.estado,"OK");
});

test("fecha etiquetada en el pie: valor desplazado bajo «FECHA», no el número de la casilla vecina",()=>{
 const r=leer([...cabeceraDoc(),...cabeceraSaltoki(),
  ...fila(218,["R-1",60],["TABLERO",120],["1,00",420],["10,000",462],["10,00",560]),
  ...fila(600,["CLIENTE",50],["ALBARÁN",120],["FECHA",200]),
  ...fila(611,["100001",50],["600.123",140],["27/08/26",240],["15:11:48",296])]);
 assert.equal(r.numero.valor,"600.123");
 assert.equal(r.fecha.valor,"2026-08-27");assert.equal(r.fecha.estado,"OK");
});

test("totales con etiquetas partidas, «CuotalVA» y base impresa con 4 y 2 decimales",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("26/09001","31-07-2026"),
  ...fila(200,["Cod. Artículo",60,95,{ancho:60}],["Descripción",130],["Cantidad",380],["Precio",430],["Dto.",480],["Importe",520]),
  ...fila(218,["2.100,0000",60],["Tablero",130],["6,0000",385],["10,0000",430],["20,00",480],["48,0000",520]),
  ...fila(600,["Base",36,96,{ancho:19}],["Imponible",59,90,{ancho:38}],["%",106,87,{ancho:7}],["IVA",117,91,{ancho:13}],["CuotalVA",146,39,{ancho:40}],["60,00",337]),
  ...fila(622,["Suma",320],["Neto",345]),
  ...fila(631,["48,0000",60],["21",120],["10,0800",156]),
  ...fila(641,["48,00",335],["10,08",391]),
  ...fila(661,["48,00",72],["10,08",166]),
  ...fila(670,["TOTAL",380],["58,08",505])]);
 const t=r.totales;
 assert.equal(t.validacion.estado,"OK");
 assert.equal(t.base_imponible.valor,48);
 assert.equal(t.cuota_iva.valor,10.08);
 assert.equal(t.total.valor,58.08);
 assert.equal(t.iva_porcentaje.valor,21);
});

test("motas en la banda de títulos y «PRECIOUNIDAD» pegado",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("009902","30/09/2026"),
  ...fila(200,["ARTÍCULO",40],["ÉS",93,40],["DESCRIPCIÓN",145],["ó",215,30],["CANTIDAD",290],["PRECIOUNIDAD",346],["SUBTOTAL",426],["DTO.",491],["TOTAL",543]),
  ...fila(218,["100076",40],["SELLADOR",107],["ACRILICO",152],["5,00",315],["3,0000",377],["15,00",447],["20,00",495],["12,00",558])]);
 const l=r.lineas[0];
 assert.equal(l.precio.valor,3);assert.equal(l.subtotal.valor,15);
 assert.equal(l.cuadre.estado,"VERIFICADO");
});

test("texto rodeado a bolígrafo: continuación añadida pero marcada; texto previo, en revisión",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("26/09001","31-07-2026"),
  ...fila(200,["Cod. Artículo",60,95,{ancho:60}],["Descripción",130],["Cantidad",380],["Precio",430],["Dto.",480],["Importe",520]),
  ...fila(214,["REF",130],["TORRE",150]),
  ...fila(228,["2.100,0000",60],["Tablero",130],["6,0000",385],["10,0000",430],["20,00",480],["48,0000",520]),
  ...fila(240,["refterzo",130,40],["de",172,45],["pladur",184,50])]);
 const d=r.lineas[0].descripcion;
 assert.equal(d.estado,"REVISAR");
 assert.match(d.literal,/pladur$/);
 assert.equal(d.texto_previo,"REF TORRE");
 assert.equal(r.lineas[0].estado,"REVISAR");
});

test("Rodavi: precio, descuento e importe en sus columnas (el SUBTOTAL no es precio ni importe)",()=>{
 // Caso real 003424 (16/10/2026): el lector anterior guardaba código, descripción y cantidad
 // pero dejaba precio, descuento e importe vacíos. Valores inventados.
 const r=leer([...cabeceraDoc(),...etiquetas("009902","30/09/2026"),
  ...fila(200,["ARTÍCULO",40],["DESCRIPCIÓN",145],["CANTIDAD",290],["PRECIO UNIDAD",346,95,{ancho:60}],["SUBTOTAL",426],["DTO.",491],["TOTAL",543]),
  ...fila(214,["PEDIDO",40],["POR",75],["***",107],["JUAN",125],["1,00",315]),
  ...fila(226,["100076",40],["SELLADOR",107],["ACRILICO",152],["BLANCO",197],["5,00",315],["3,0000",377],["15,00",447],["20,00",495],["12,00",558]),
  ...fila(600,["TOTAL:",420],["14,52",500])]);
 assert.equal(r.lineas.length,1,"«PEDIDO POR» no es un artículo aunque tenga cantidad");
 const l=r.lineas[0];
 assert.equal(l.referencia.literal,"100076");
 assert.equal(l.cantidad.valor,5);
 assert.equal(l.precio.valor,3);
 assert.equal(l.subtotal.valor,15);
 assert.deepEqual(l.descuento.porcentajes,[20]);
 assert.equal(l.importe.valor,12);
 assert.equal(l.cuadre.estado,"VERIFICADO");
 assert.equal(r.totales.total.valor,14.52);
});

test("títulos de código y descripción ilegibles en la banda gris: columnas por posición, marcadas",()=>{
 // tesseract.js leyó «ARTO» y «ESCMPIÓN» donde pone ARTÍCULO y DESCRIPCIÓN (caso Rodavi real).
 const r=leer([...cabeceraDoc(),...etiquetas("009902","30/09/2026"),
  ...fila(200,["ARTO",40,42],["ESCMPIÓN",145,0],["CANTIDAD",290,71],["PRECIOUNIDAD",346,47],["SUBTOTAL",426,34],["DTO.",491],["TOTAL",543]),
  ...fila(226,["100076",40],["SELLADOR",107],["ACRILICO",152],["5,00",315],["3,0000",377],["15,00",447],["20,00",495],["12,00",558])]);
 const l=r.lineas[0];
 assert.equal(l.referencia.literal,"100076");assert.equal(l.referencia.estado,"REVISAR");
 assert.equal(l.descripcion.literal,"SELLADOR ACRILICO");assert.equal(l.descripcion.estado,"REVISAR");
 assert.equal(l.precio.valor,3);assert.equal(l.importe.valor,12);
 assert.equal(l.cuadre.estado,"VERIFICADO");
 assert.notEqual(r.estado,"AUTO_OK");
});

test("OCR: líneas con importe y sin total localizado no se aceptan automáticamente",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas("009902","30/09/2026"),
  ...fila(200,["ARTÍCULO",40],["DESCRIPCIÓN",145],["CANTIDAD",290],["PRECIO UNIDAD",346,95,{ancho:60}],["SUBTOTAL",426],["DTO.",491],["TOTAL",543]),
  ...fila(226,["100076",40],["SELLADOR",107],["5,00",315],["3,0000",377],["15,00",447],["20,00",495],["12,00",558])]);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
 assert.equal(r.totales.total.confianza,0.5);
 assert.notEqual(r.estado,"AUTO_OK");
});

test("número con formato ajeno al del proveedor («26109003» por «26/09003») no se acepta",()=>{
 const reg={...registro,proveedores:[{...registro.proveedores[0],formato_numero:"^\\d{2}/\\d{5}$"}]};
 const pag=n=>paginaDesdePalabras([...cabeceraDoc(),...etiquetas(n,"25-09-2026"),...cabeceraSaltoki(),
  ...fila(218,["R-1",60],["TABLERO",120],["1,00",420],["10,000",462],["10,00",560])],{numero:1,anchoPx:595,altoPx:842,dpi:72});
 assert.equal(extraerDePaginas([pag("26/09003")],{registro:reg,hoy:HOY}).numero.estado,"OK");
 const r=extraerDePaginas([pag("26109003")],{registro:reg,hoy:HOY});
 assert.equal(r.numero.estado,"REVISAR");
 assert.notEqual(r.estado,"AUTO_OK");
});

test("total sin base ni cuota legibles: se verifica con la suma de líneas y el IVA, o queda en revisión",()=>{
 const doc=total=>leer([...cabeceraDoc(),...etiquetas("009902","30/09/2026"),
  ...fila(200,["ARTÍCULO",40],["DESCRIPCIÓN",145],["CANTIDAD",290],["PRECIO UNIDAD",346,95,{ancho:60}],["SUBTOTAL",426],["DTO.",491],["TOTAL",543]),
  ...fila(226,["100076",40],["SELLADOR",107],["5,00",315],["3,0000",377],["15,00",447],["20,00",495],["12,00",558]),
  ...fila(600,["TOTAL:",420],[total,500])]);
 const bien=doc("14,52");
 assert.equal(bien.totales.total.estado,"VERIFICADO");
 assert.ok(bien.validaciones.some(v=>v.nombre==="total_con_lineas"&&v.estado==="OK"));
 const mal=doc("19,52"); // no cuadra con 21, 10, 4 ni 0 %: ¿falta una línea?
 assert.equal(mal.totales.total.estado,"REVISAR");
 assert.notEqual(mal.estado,"AUTO_OK");
});

test("una cifra suelta de baja confianza, sin código, descripción ni cantidad, no es una línea",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),
  ...fila(218,["4300099900",60],["REDUCCION",120],["2,00",420],["30,000",462],["60",505],["5",520],["22,80",560]),
  ...fila(232,["4",470,75])]);
 assert.equal(r.lineas.length,1);
});

/* ------------------------- Combinación de lecturas ------------------------- */
// Motor OCR simulado: una lista de palabras por variante (psm/umbral) y otra «limpia» para recortes.
function motor(variantes,{limpias=[]}={}){
 return [{numero:1,anchoPx:595,altoPx:842,dpi:72,async ocr({psm=4,region=null,umbral=null}={}){
  const pagina=variantes[(umbral?umbral+"_":"")+psm]||variantes[4];
  if(region){
   // Solo un recorte estrecho (una casilla) se lee limpio; las bandas de ancho completo, como la página.
   const [x,y,ww,h]=region,origen=ww<595?limpias:pagina;
   return origen.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }
  return pagina;
 }}];
}

test("cabecera legible solo con umbral adaptativo: se traslada a la lectura que separa bien las cifras",async()=>{
 const comunes=[...cabeceraDoc(),...etiquetas("009902","30/09/2026")];
 const filaBuena=fila(218,["100076",40],["SELLADOR",107],["ACRILICO",152],["5,00",315],["3,0000",377],["15,00",447],["20,00",495],["12,00",558]);
 const titulos=fila(200,["ARTÍCULO",40],["DESCRIPCIÓN",145],["CANTIDAD",290],["PRECIO UNIDAD",346,95,{ancho:60}],["SUBTOTAL",426],["DTO.",491],["TOTAL",543]);
 const r=await extraerEscaneado(motor({
  4:[...comunes,...fila(200,["AA,",40,26],["NN",357,47]),...filaBuena],
  sauvola_4:[...comunes,...titulos,...fila(218,["100076 SELLADOR ACRILICO 5,00 3,0000 15,00 20,00 12,00",40,90,{ancho:530}])]
 }),{registro,hoy:HOY});
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
 assert.equal(r.lineas[0].descripcion.literal,"SELLADOR ACRILICO");
});

test("fecha cruzada por la firma: se relee solo su casilla",async()=>{
 const base=[...cabeceraDoc(),...cabeceraSaltoki(),...fila(218,["R-1",60],["TABLERO",120],["1,00",420],["10,000",462],["10,00",560]),
  ...fila(600,["CLIENTE",50],["ALBARÁN",120],["FECHA",200])];
 const pagina=[...base,...fila(611,["100001",50],["600.456",140],["14/10/26)La",230,0])];
 const limpias=[...fila(600,["FECHA",200]),...fila(611,["14/10/26",240,96])];
 const r=await extraerEscaneado(motor({4:pagina},{limpias}),{registro,hoy:HOY});
 assert.equal(r.fecha.valor,"2026-10-14");
 assert.ok(r.lecturas_ocr.some(x=>/^casilla_fecha/.test(x.lectura)));
});

test("aviso legal vertical del margen leído como una palabra de confianza alta: no ocupa la columna de código",()=>{
 // tesseract.js lee el texto girado entero («personaldatostratamiento.», conf 96) en una caja
 // estrecha y alta pegada al borde de la fila: imposible para texto horizontal.
 const girada={texto:"personaldatostratamiento.",x0:27,x1:41,y0:192,y1:218,conf:96,linea:"V"};
 const r=leer([...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),girada,
  ...fila(218,["1300000001",60],["ACUMULADOR",120],["CARBONO",180],["1,00",420],["10,000",462],["10,00",560])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].referencia.valor,"1300000001");
 assert.equal(r.lineas[0].descripcion.valor,"ACUMULADOR CARBONO");
 // Una palabra horizontal normal (aunque esté en el margen y sea larga) no se descarta por esto.
 assert.ok(paginaDesdePalabras([{texto:"1300000001",x0:20,x1:70,y0:210,y1:218,conf:96}],{anchoPx:595,altoPx:842,dpi:72}).lineas.length===1);
});

test("unidad «mil» leída por OCR junto a la cantidad: puede ser «ml» con una «i» de más, queda en revisión",()=>{
 const pag=u=>[...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),
  ...fila(218,["1300000001",60],["CANALETA",120],["30,00 "+u,400],["10,000",462],["300,00",560])];
 const r=leer(pag("mil"));
 assert.equal(r.lineas[0].cantidad.valor,30);
 assert.equal(r.lineas[0].unidad.estado,"REVISAR");
 assert.equal(r.lineas[0].estado,"REVISAR");assert.notEqual(r.estado,"AUTO_OK");
 assert.equal(leer(pag("ml")).lineas[0].unidad.estado,"OK");
});

test("CIF del emisor impreso solo en el aviso legal vertical: sigue identificando al proveedor, fuera de la tabla",()=>{
 const cabecera=fila(40,["PROVEEDOR",60],["FICTICIO,",115],["S.L.",165]);
 const tabla=[...etiquetas(),...cabeceraSaltoki(),...fila(218,["1300000001",60],["TUBO",120],["1,00",420],["10,000",462],["10,00",560])];
 const girado=[{texto:"CIF.:",x0:27,x1:36,y0:300,y1:330,conf:90,linea:"V"},{texto:NIF,x0:27,x1:36,y0:335,y1:390,conf:92,linea:"V"}];
 const r=leer([...cabecera,...tabla,...girado]);
 assert.equal(r.proveedor.nif,NIF);assert.equal(r.proveedor.via,"nif");
 assert.equal(r.lineas.length,1);assert.equal(r.lineas[0].referencia.valor,"1300000001");
 // Sin el aviso girado solo queda el nombre (evidencia más débil).
 assert.notEqual(leer([...cabecera,...tabla]).proveedor.via,"nif");
});

test("descripción partida por un trazo a mano («LATON 2» en una fila sin código justo debajo): la anterior no se acepta",()=>{
 const pag=sigue=>[...cabeceraDoc(),...etiquetas(),...cabeceraSaltoki(),
  ...fila(218,["1300000001",60],["CODO",120],["92",145],["M-H",160],["-1,00",420],["10,000",462],["-10,00",560]),
  ...(sigue?fila(224,["LATON",180,60],["2",210,60],["1",420,50]):[]),
  ...fila(236,["1300000002",60],["ROSCA",120],["DOBLE",150],["-4,00",420],["10,000",462],["-40,00",560])];
 const r=leer(pag(true));
 assert.equal(r.lineas[0].descripcion.estado,"REVISAR");
 assert.match(r.lineas[0].descripcion.motivos.at(-1),/fila siguiente, sin código/);
 assert.notEqual(r.estado,"AUTO_OK");
 // Sin esa fila, la descripción se acepta como antes.
 assert.equal(leer(pag(false)).lineas[0].descripcion.estado,"OK");
});
