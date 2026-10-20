"use strict";
/*
 * Regresión de los fallos hallados con el lote real B (20 albaranes de 8 proveedores, octubre 2026).
 * Cada prueba reproduce el fallo con palabras de OCR ficticias (ningún dato real en el repositorio).
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {NIF,HOY,registroCon,fila,cabeceraDoc,pagina,leer}=require("./ayudas-ocr.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");

const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const etiquetas=(numero="600.111",fecha="15/10/26")=>[...fila(120,["ALBARÁN",60],["Nº",105],[numero,120]),...fila(120,["FECHA",300],[fecha,340])];
const filaPrecio=(y,ref="1300000001")=>fila(y,[ref,60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]);

/* ------------------------------- Proveedor -------------------------------- */
test("un NIF personal dentro de la tabla («… 44444444A») no es el emisor; se identifica por el nombre registrado",()=>{
 const reg=registroCon({nombre:"FICTICIA INTERIORES, S.L.U."});
 const r=leer([...fila(40,["FICTICIA",60],["INTERIORES",110],[",S.L.U.",165]),...etiquetas(),...titulos(),filaPrecio(218)].flat().concat(
  fila(232,["JUAN",120],["PEREZ",150],["00000000T",180])),{registro:reg});
 assert.equal(r.proveedor.estado,"OK");
 assert.equal(r.proveedor.id,"A");
 assert.notEqual(r.proveedor.nif,"00000000T");
});

/* ----------------------------- Número y fecha ------------------------------ */
test("número y fecha sin etiqueta, juntos («L26-99999 05/10/2026»): se aceptan por el formato del proveedor",()=>{
 const reg=registroCon({formato_numero:"^L\\d{2}-\\d{5}$",numero_sin_etiqueta:true});
 const r=leer([...cabeceraDoc(),...fila(150,["L26-99999",50],["05/10/2026",110]),...titulos(),...filaPrecio(218)],{registro:reg});
 assert.equal(r.numero.valor,"L26-99999");assert.equal(r.numero.estado,"OK");
 assert.equal(r.fecha.valor,"2026-10-05");assert.equal(r.fecha.estado,"OK");
});

test("serie delante del número («ALBARÁN AB26 001234»): el número es el que cumple el formato",()=>{
 const reg=registroCon({formato_numero:"^\\d{6}$"});
 const r=leer([...cabeceraDoc(),...fila(120,["ALBARÁN",60],["AB26",110],["001234",140],["13/10/2026",190]),...titulos(),...filaPrecio(218)],{registro:reg});
 assert.equal(r.numero.valor,"001234");
});

test("etiqueta de número propia del proveedor («SALIDA 1234»)",()=>{
 const reg=registroCon({formato_numero:"^\\d{4}$",etiqueta_numero:"SALIDA"});
 const r=leer([...cabeceraDoc(),...fila(120,["SALIDA",300],["1234",350]),...fila(130,["2026",60]),...titulos(),...filaPrecio(218)],{registro:reg});
 assert.equal(r.numero.valor,"1234");
});

test("fecha pegada al título «ALBARÁN CARGO» se acepta; lejos de «Nº Albarán: 123» no",()=>{
 const cerca=leer([...cabeceraDoc(),...fila(120,["ALBARÁN CARGO",60,95,{ancho:70}],["16/10/2026",140]),...fila(135,["123456",60]),...titulos(),...filaPrecio(218)]);
 assert.equal(cerca.fecha.estado,"OK");
 const lejos=leer([...cabeceraDoc(),...fila(120,["Nº",60],["Albarán:",75],["123456",120],["16/10/2026",420]),...titulos(),...filaPrecio(218)]);
 assert.equal(lejos.fecha.estado,"REVISAR");
});

/* ------------------------------ Tipo y signo ------------------------------- */
test("sello «ABONO» y cantidades con el menos detrás («1,00-»)",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000002",60],["CODO",120],["1,00-",420]),...fila(400,["*ABONO*",480])]);
 assert.equal(r.tipo_documento.valor,"ABONO");
 assert.equal(r.lineas[0].cantidad.valor,-1);
 assert.equal(r.lineas[0].precio.valor,null,"sin precio: null, nunca 0");
});

test("devolución sin sello: todas las líneas negativas → ABONO",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000003",60],["CORREDERA",120],["-1,00",420],["100,000",462],["50",510],["-50,00",560])]);
 assert.equal(r.tipo_documento.valor,"ABONO");
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});

/* ---------------------------- Limpieza del OCR ----------------------------- */
test("rayas de la tabla pegadas al código y cola de rayas de un subrayado",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000004|",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560]),
  ...fila(232,["ABCD25LN-—",60],["TAPA",120],["1,00",420],["5,000",462],["10,00",500,95,{ancho:0}],["5,00",560])]);
 assert.equal(r.lineas[0].referencia.literal,"1300000004");
 assert.equal(r.lineas[1].referencia.literal,"ABCD25LN");
});

test("letras sueltas del texto vertical del margen (confianza alta) no crean filas",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),...fila(232,["3",30,96]),...fila(246,["ER",28,95])]);
 assert.equal(r.lineas.length,1);
});

test("trazo de bolígrafo leído como «(a» no se pega al código",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["(a",45,19],["1300000005",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560])]);
 assert.equal(r.lineas[0].referencia.literal,"1300000005");
});

test("fila partida (texto 4 pt más arriba que las cifras, sin solaparse) se une",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(214,["1300000006",60],["TUBO",120]),...fila(218,["2,00",420],["10,000",462],["50",510],["10,00",560])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].referencia.literal,"1300000006");
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});

test("la confianza de la descripción es la de su palabra menos segura",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000007",60],["TE",120],["PRENSAR",140],["M54X28X54",200,68],["2,00",420],["10,000",462],["50",510],["10,00",560])]);
 assert.ok(r.lineas[0].descripcion.confianza<0.9);
});

test("una fila impresa con OCR mediocre (50–70) no se descarta como manuscrito",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["CUT",50,53],["PEDO1/4X3/8",75,67],["ROLLO",120,57],["COBRE",150,57],["5",420,93],["PCE",432,83])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].cantidad.valor,5);
});

/* --------------------------------- Columnas -------------------------------- */
test("título «Descripción del» + «Producto» en dos renglones",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...fila(200,["Referencia",20],["Descripción del",82,97,{ancho:56}],["cantidad",350],["2da Und.",396],["Precio",467],["Desc.",498],["Importe",545]),
  ...fila(204,["Producto",141]),...fila(220,["25XX001",20],["SACO",83],["MORTERO",110],["56,00",362],["0",414])]);
 assert.equal(r.lineas[0].descripcion.literal,"SACO MORTERO");
 assert.equal(r.lineas[0].cantidad.valor,56);
 assert.equal(r.lineas[0].precio.valor,null,"el 0 de «2da Und.» no es precio");
});

test("anotaciones «De Pedido de cliente…» y «EN ALMACEN 2» no son artículos ni texto de la descripción",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(212,["De",120],["Pedido",135],["de",172],["cliente",186]),
  ...fila(222,["YS000001",60],["SACO",120],["2,00",420]),...fila(234,["EN",120],["ALMACEN",135],["2",180])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].descripcion.estado,"OK");
});

test("la cantidad es la primera columna: el texto que cae en ella pasa al concepto",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...fila(200,["Cantidad",51],["Concepto",190],["Precio",446],["Importe",512]),
  ...fila(218,["2,00",51],["Premarco",99],["10.0*3.5",145],["20,17",461],["40,34",541])],{registro:registroCon({permite_sin_referencia:true})});
 assert.equal(r.lineas[0].descripcion.literal,"Premarco 10.0*3.5");
 assert.equal(r.lineas[0].cantidad.valor,2);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});

test("unidad separada en la columna de cantidad («90,00» «ml», «1,00 Cajaj», «1,00 Caja]»)",()=>{
 const t=fila(200,["Código",40],["Descripción",151],["Bultos",370],["Cantidad",425],["Pvp",480],["Dto",515],["Total",552]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...t,
  ...fila(218,["002X0C01",40],["Canal",151],["90,00",425],["ml",455],["1,1300",478],["36,00%",514],["65,09",555]),
  ...fila(230,["081X0001",40],["Clavo",151],["1,00 Cajaj",425,90,{ancho:40}],["46,8260",470],["40,00%",514],["28,10",555]),
  ...fila(242,["062X0001",40],["Tornillo",151],["1,00",375],["1,00 Caja]",425,90,{ancho:40}],["37,7143",470],["50,00%",514],["18,86",555])]);
 assert.deepEqual(r.lineas.map(l=>[l.cantidad.valor,l.unidad.literal]),[[90,"ml"],[1,"Caja"],[1,"Caja"]]);
 assert.ok(r.lineas.every(l=>l.cuadre.estado==="VERIFICADO"));
});

test("una palabra sin cifras sola en la columna de código («Vegas») es una anotación, no un artículo",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(210,["Vegas",60]),...filaPrecio(222)]);
 assert.equal(r.lineas.length,1);
 assert.ok(r.lineas_ignoradas.some(x=>x.anotacion));
});

test("título «Código» ilegible: la columna de código se deduce por los códigos a la izquierda (marcada)",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...fila(200,["Descripción",151],["Cantidad",435],["Pvp",489],["Dto",517],["Total",545]),
  ...fila(218,["102X0154",36],["Espuma",92],["3,00",440],["6,7000",478],["40,00%",515],["12,06",558])]);
 assert.equal(r.lineas[0].referencia.literal,"102X0154");
 assert.equal(r.lineas[0].referencia.estado,"REVISAR");
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});

test("código que sigue en un segundo renglón («(20M)-(COASOL)») es continuación, no otra línea",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["PEDO1/4X3/8",60],["ROLLO",120],["COBRE",150],["5",420],["PCE",432]),
  ...fila(228,["(20M)(COAS)",60],["PE",125],["DOBLE",140])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].descripcion.literal,"ROLLO COBRE PE DOBLE");
 assert.equal(r.lineas[0].referencia.estado,"REVISAR");
});

/* --------------------------------- Totales --------------------------------- */
test("cuota sin etiqueta legible: se acepta la cifra impresa que cumple base + cuota = total",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),
  ...fila(600,["Base",60],["Imponible",82]),...fila(612,["10,00",70],["21,00%",130],["2,10",190]),...fila(630,["TOTAL",380],["12,10",505])]);
 assert.equal(r.totales.cuota_iva.valor,2.1);assert.equal(r.totales.cuota_iva.estado,"VERIFICADO");
 assert.equal(r.totales.validacion.estado,"OK");
});

test("base sin etiqueta: la cifra impresa igual a la suma de líneas verificadas",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),
  ...fila(600,["TIPO",60]),...fila(612,["21,00",60],["10,00",120],["10,00",430],["2,10",490]),...fila(640,["TOTAL:",420],["12,10",500])]);
 assert.equal(r.totales.base_imponible.valor,10);
 assert.equal(r.totales.cuota_iva.valor,2.1);
 assert.equal(r.totales.validacion.estado,"OK");
});

test("% de IVA impreso que solo ve otra lectura OCR: se acepta si base × % = cuota",async()=>{
 const pie=pct=>[...fila(600,["Base",60],["Imponible",82]),...fila(612,["10,00",70],[pct,130],["2,10",190]),...fila(630,["TOTAL",380],["12,10",505])];
 const cuerpo=[...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218)];
 // La lectura principal no ve «21,00 %» (lo lee «2l,0O»); la de psm 6 sí, pero pierde líneas.
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({psm=4,region=null}={}){
   const ps=psm===6?[...cabeceraDoc(),...pie("21,00%")]:[...cuerpo,...pie("2l,0O%")];
   if(!region)return ps;
   const [x,y,ww,h]=region;
   return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas.length,1);
 assert.equal(r.totales.iva_porcentaje.valor,21);
 assert.equal(r.totales.iva_porcentaje.resolucion.metodo,"cifra_impresa_validada");
});

test("pie en casillas con borde: el OCR de página no ve las cifras; se relee cada casilla bajo su título",async()=>{
 const cuerpo=[...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),
  ...fila(600,["BASE IMPONIBLE",100,95,{ancho:70}],["%IVA",220,95,{ancho:20}],["IMPORTE IVA",300,95,{ancho:55}],["TOTAL",450,95,{ancho:25}])];
 // Cifra que el OCR de línea lee en cada casilla (según el centro del recorte).
 const cifras=[[100,170,"10,00"],[220,240,"21"],[300,355,"2,10"],[450,475,"12,10"]];
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({region=null}={}){
   if(!region)return cuerpo;
   const [x,y,ww,h]=region;
   if(y>=600&&h<60){const c=cifras.find(([a,b])=>x+ww/2>=a&&x+ww/2<=b);return c?[{texto:c[2],x0:4,x1:30,y0:4,y1:13,conf:90}]:[];}
   return cuerpo.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 assert.equal(r.totales.validacion.estado,"OK");
 assert.equal(r.totales.base_imponible.valor,10);
 assert.equal(r.totales.cuota_iva.valor,2.1);
 assert.equal(r.totales.total.valor,12.1);
 assert.equal(r.totales.iva_porcentaje.valor,21);
});

/* ------------------------- Escaneado: orientación ------------------------- */
// Motor simulado con página girada: la orientación correcta da muchas palabras fiables.
function motorGirado(buenas,{giro=270}={}){
 const malas=buenas.map(p=>({...p,texto:"~",conf:10}));
 const pagina=(rot)=>({numero:1,anchoPx:595,altoPx:842,dpi:72,rotacion:rot,
  async ocr({region=null}={}){
   const ps=rot===giro?buenas:malas;
   if(!region)return ps;
   const [x,y,ww,h]=region;
   return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  },
  rotada(g){return pagina(((g%360)+360)%360);}});
 return [pagina(0)];
}
test("página escaneada de lado: se prueba el giro y se lee enderezada",async()=>{
 const palabras=[...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),...filaPrecio(232,"1300000009")];
 const r=await extraerEscaneado(motorGirado(palabras),{registro:registroCon(),hoy:HOY});
 assert.deepEqual(r.orientacion,[{pagina:1,grados:270}]);
 assert.equal(r.lineas.length,2);
});

/* ------------------------- Escaneado: segunda fase ------------------------- */
// Motor con relecturas por recorte: «recortes» decide qué devuelve cada estrategia en la casilla.
function motorRecortes(pagina,recortes){
 return [{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({psm=4,region=null,escala=1,umbral=null,lista=null}={}){
   if(!region)return pagina;
   const [x,y,ww,h]=region;
   if(ww<595){const r=recortes({psm,escala,umbral,lista,region});if(r)return r.map(t=>({texto:t[0],conf:t[1],x0:2,x1:40,y0:2,y1:10}));}
   return pagina.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
}
test("número tapado por una firma: la relectura dirigida de la casilla lo resuelve (con evidencias)",async()=>{
 const reg=registroCon({formato_numero:"^\\d{3}\\.\\d{3}$"});
 const pag=[...cabeceraDoc(),...titulos(),...filaPrecio(218),...fila(600,["ALBARÁ)A",120,44],["FECHA",200]),...fila(611,["600.1237",140,89],["14/10/26",240])];
 const r=await extraerEscaneado(motorRecortes(pag,()=>[["600.123",90]]),{registro:reg,hoy:HOY});
 assert.equal(r.numero.valor,"600.123");
 assert.equal(r.numero.resolucion.metodo,"relectura_dirigida");
 assert.ok(r.numero.resolucion.evidencias.length>=2);
});
test("dos interpretaciones fiables distintas («600.123» / «400.123»): el número NO se resuelve",async()=>{
 const reg=registroCon({formato_numero:"^\\d{3}\\.\\d{3}$"});
 const pag=[...cabeceraDoc(),...titulos(),...filaPrecio(218),...fila(600,["ALBARÁ)A",120,44],["FECHA",200]),...fila(611,["600.1237",140,89],["14/10/26",240])];
 const r=await extraerEscaneado(motorRecortes(pag,({psm})=>[[psm===7?"400.123":"600.123",90]]),{registro:reg,hoy:HOY});
 assert.notEqual(r.numero.estado,"OK");
});
test("código mal leído: el consenso de relecturas fiables lo corrige y guarda la lectura inicial",async()=>{
 const pag=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["006P0O0BA",60,60],["BANDA",120],["2,00",420],["10,000",462],["50",510],["10,00",560])];
 const r=await extraerEscaneado(motorRecortes(pag,({psm})=>psm===13?[["006 PO0OBAS030",4]]:[["006P000BA5030",88]]),{registro:registroCon(),hoy:HOY});
 const ref=r.lineas[0].referencia;
 assert.equal(ref.valor,"006P000BA5030");
 assert.equal(ref.resolucion.lectura_inicial,"006P0O0BA");
 // Alfanumérico con O/0, S/5…: corregido, pero sin validación externa no se acepta automáticamente.
 assert.ok(ref.confianza<0.9);
});

test("código alfanumérico con caracteres confundibles (S/5, O/0) no se acepta solo por OCR; uno solo numérico sí",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["12150P3456",60],["CORREDERA",120],["2,00",420],["10,000",462],["50",510],["10,00",560]),
  ...fila(232,["1300000010",60],["TUBO",120],["2,00",420],["10,000",462],["50",510],["10,00",560])]);
 assert.ok(r.lineas[0].referencia.confianza<0.9);
 assert.ok(r.lineas[1].referencia.confianza>=0.9);
});

/* ------------------------ Escaneado: banda oscura ------------------------- */
test("títulos de tabla en blanco sobre banda oscura: se leen invertidos y se trasladan",async()=>{
 const pagina=[...cabeceraDoc(),...etiquetas(),...fila(218,["CUT1",60],["ROLLO",120],["COBRE",150],["5",420],["PCE",432])];
 const tit=titulos(200).map(p=>({...p,y0:p.y0-196,y1:p.y1-196}));
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  bandasOscuras:()=>[[190,206]],
  async ocr({region=null,tratamiento=null}={}){
   if(tratamiento==="invertir")return tit;
   if(!region)return pagina;
   const [x,y,ww,h]=region;
   return pagina.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].cantidad.valor,5);
});

/* ------------- Símbolos que el OCR no conoce y formato de referencia ------------- */
test("Ø leído como M/Y/W tras «PRENSAR» se restituye solo con el perfil del proveedor y solo en escaneados",()=>{
 const {restituirGlifos}=require("../albaranes/extraer.js");
 const perfil={glifos_ocr:[["(\\bPRENSAR )(?:[MYWH]{1,2}9?)(?=\\d{2}X\\d)","$1Ø"]]};
 assert.equal(restituirGlifos("TE REDUCIDA PRENSAR M54X28X54 INOX",perfil),"TE REDUCIDA PRENSAR Ø54X28X54 INOX");
 assert.equal(restituirGlifos("REDUCCION PRENSAR Y922X15 INOX",perfil),"REDUCCION PRENSAR Ø22X15 INOX");
 assert.equal(restituirGlifos("ENTRONQUE MACHO PRENSAR WH28X1 INOX",perfil),"ENTRONQUE MACHO PRENSAR Ø28X1 INOX");
 // Una métrica real («TORNILLO CARRIL M8X30») no se toca; sin perfil, tampoco.
 assert.equal(restituirGlifos("TORNILLO CARRIL M8X30 38/40",perfil),"TORNILLO CARRIL M8X30 38/40");
 assert.equal(restituirGlifos("REDUCCION PRENSAR M22X15",null),"REDUCCION PRENSAR M22X15");
 const reg=registroCon({glifos_ocr:perfil.glifos_ocr});
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000001",60],["REDUCCION",120],["PRENSAR",170],["M22X15",210],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:reg});
 assert.equal(r.lineas[0].descripcion.valor,"REDUCCION PRENSAR Ø22X15");
 assert.equal(r.lineas[0].descripcion.literal,"REDUCCION PRENSAR M22X15");
});

test("referencia solo de cifras con el formato del proveedor: la unanimidad de las 6 relecturas la acepta; sin formato, no",async()=>{
 const pag=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300010015",60,55],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560])];
 const conFormato=await extraerEscaneado(motorRecortes(pag,({region})=>region[0]<100?[["1300010015",56]]:null),{registro:registroCon({formato_referencia:"^\\d{10}$"}),hoy:HOY});
 assert.equal(conFormato.lineas[0].referencia.valor,"1300010015");
 assert.ok(conFormato.lineas[0].referencia.confianza>=0.9);
 assert.match(conFormato.lineas[0].referencia.resolucion.evidencias[0],/formato de referencia/);
 const sinFormato=await extraerEscaneado(motorRecortes(pag,({region})=>region[0]<100?[["1300010015",56]]:null),{registro:registroCon(),hoy:HOY});
 assert.ok(sinFormato.lineas[0].referencia.confianza<0.9);
});
