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

// Fallo real 2026-11-25: hoja escaneada torcida 3,5° (más de lo que se endereza con las posiciones): sin ninguna línea; y con las
// posiciones enderezadas, los recortes que se vuelven a leer (número, escrito a mano) salían desplazados. Se gira la imagen.
test("hoja torcida más de 2,9°: se endereza la imagen antes de leerla; poco o demasiado torcida, no",async()=>{
 const palabras=[...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),...filaPrecio(232,"1300000009")];
 const cx=297.5,inclinar=m=>palabras.map(p=>{const d=m*((p.x0+p.x1)/2-cx);return {...p,y0:p.y0+d,y1:p.y1+d};});
 const motor=m=>{const pedidas=[];
  const pagina=(ps,enderezada)=>({numero:1,anchoPx:595,altoPx:842,dpi:72,rotacion:0,
   async ocr({region=null}={}){
    if(!region)return ps;
    const [x,y,ww,h]=region;
    return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
   },
   // Girada de lado, nada legible: se queda la página tal cual.
   rotada(){return pagina([],true);},
   ...(enderezada?{}:{enderezada(pend){pedidas.push(pend);return pagina(palabras,true);}})});
  return {paginas:[pagina(inclinar(m),false)],pedidas};};
 const t=motor(0.08),r=await extraerEscaneado(t.paginas,{registro:registroCon(),hoy:HOY});
 assert.equal(t.pedidas.length,1);assert.ok(Math.abs(t.pedidas[0]-0.08)<0.003,String(t.pedidas[0]));
 assert.deepEqual(r.orientacion,[{pagina:1,grados:0,torcida:4.6}]);
 assert.equal(r.lineas.length,2);
 assert.match(r.incidencias.join(" "),/torcida 4,6°/);
 // Hasta 0,05 se enderezan las posiciones, como siempre; más de 0,15, nada.
 for(const m of [0.03,0.2]){const u=motor(m);await extraerEscaneado(u.paginas,{registro:registroCon(),hoy:HOY});assert.equal(u.pedidas.length,0,String(m));}
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

/* Un perfil de formato público no contiene NIF privados: no es un conflicto. */
test("perfil público sin NIF: usa el formato sin verificar la identidad del proveedor",()=>{
 const reg=registroCon({nifs:[],formato_numero:"^\\d{6}$"});
 const r=leer([...cabeceraDoc(),...fila(120,["ALBARÁN",60],["AB26",110],["009876",140],["13/10/2026",190]),...titulos(),...filaPrecio(218)],{registro:reg});
 assert.equal(r.proveedor.estado,"NIF_NO_REGISTRADO");
 assert.equal(r.proveedor.id,reg.proveedores[0].id);
 assert.equal(r.numero.valor,"009876");assert.equal(r.estado,"REVISAR");
 assert.ok(r.proveedor.confianza<0.9);
});
test("NIF configurado que contradice el impreso sigue bloqueando al proveedor",()=>{
 const reg=registroCon({nifs:['B24555559'],formato_numero:"^\\d{6}$"});
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218)],{registro:reg});
 assert.equal(r.proveedor.estado,"AMBIGUO");assert.equal(r.proveedor.nif,null);assert.equal(r.estado,"REVISAR");
});
test('número partido por OCR: une año/serie y sufijo impreso, sin tomar solo el año',()=>{
 const r=leer([...cabeceraDoc(),...fila(120,['Albarán',400],['2026',450,95,{ancho:18}],['/9123',475,93,{ancho:25}]),...titulos(),...filaPrecio(218)]);
 assert.equal(r.numero.valor,'2026/9123');assert.equal(r.numero.estado,'OK');
});
test('un sufijo lejano no se pega al número de albarán',()=>{
 const r=leer([...cabeceraDoc(),...fila(120,['Albarán',60],['2026',120,95,{ancho:18}],['/9123',510,93,{ancho:25}]),...titulos(),...filaPrecio(218)]);
 assert.equal(r.numero.valor,'2026');
});
test('nombre de perfil sin NIF y CIF registrado en otro proveedor: conserva el conflicto',()=>{
 const reg=registroCon({nifs:[]});
 reg.proveedores.push({id:'OTRO',nombre:'OTRO PROVEEDOR FICTICIO',nifs:[NIF]});
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218)],{registro:reg});
 assert.equal(r.proveedor.estado,'AMBIGUO');assert.equal(r.estado,'REVISAR');
});

function motorDescuentoAmpliado({desplazamiento=0,cantidad='2,00',descuento='20',sinDescuento=false}={}){
 const base=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,['R-0',60,60],['TUBO',120],['MULTICAPA',150],['2,00',420],['10,00',462],['16,00',560])];
 const nueva=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218+desplazamiento,['R-O',60,60],['TUBO',120],['MULTICAPA',150],[cantidad,420],['10,00',462],...(!sinDescuento?[[descuento,510]]:[]),['16,00',560])];
 return [{numero:1,anchoPx:595,altoPx:842,dpi:72,async ocr({region=null,escala=1}={}){
  const ps=region&&region[2]===595&&escala===2?nueva:base;
  if(!region)return ps;
  const [x,y,w,h]=region;
  return ps.filter(p=>p.x0>=x&&p.x1<=x+w&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
 }}];
}
test('descuento perdido por rasterización: relectura ampliada rescata el literal sin corregir el código dudoso',async()=>{
 const r=await extraerEscaneado(motorDescuentoAmpliado(),{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas[0].descuento.valor,20);assert.equal(r.lineas[0].cuadre.estado,'VERIFICADO');
 assert.equal(r.lineas[0].referencia.literal,'R-0');assert.ok(r.lineas[0].referencia.confianza<0.9);
 assert.equal(r.estado,'REVISAR');
});
test('un descuento de otra fila física no se traslada aunque los importes coincidan',async()=>{
 const r=await extraerEscaneado(motorDescuentoAmpliado({desplazamiento:12}),{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas[0].descuento.valor,null);assert.equal(r.lineas[0].cuadre.estado,'DESCUADRE');
});
test('la relectura con cantidad distinta no corrige una referencia diferente',async()=>{
 const r=await extraerEscaneado(motorDescuentoAmpliado({cantidad:'4,00',descuento:'60'}),{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas[0].cantidad.valor,2);assert.equal(r.lineas[0].descuento.valor,null);
});
test('sin porcentaje impreso en ninguna lectura no se deduce descuento a partir del cuadre',async()=>{
 const r=await extraerEscaneado(motorDescuentoAmpliado({sinDescuento:true}),{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas[0].descuento.valor,null);assert.equal(r.lineas[0].cuadre.estado,'DESCUADRE');
});

test("unidad «ml» que una lectura OCR lee «mi»: se toma de otra lectura de la misma fila; si discrepan, no",async()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
 const linea=u=>fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],[u,432],["10,000",462],["50",510],["10,00",560]);
 const motor=porPsm=>[{numero:1,anchoPx:595,altoPx:842,dpi:72,async ocr({psm=4,region=null}={}){
  const ps=[...cabeceraDoc(),...etiquetas(),...tit,...linea(porPsm[psm]||"mi")];
  if(!region)return ps;
  const [x,y,ww,h]=region;
  return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
 }}];
 const r=await extraerEscaneado(motor({6:"ml",3:"ml"}),{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas[0].unidad.valor,"ml");
 // Todas las lecturas dicen «mi»: no se acepta «m» (resto de raya) ni se deduce «ml».
 const s=await extraerEscaneado(motor({}),{registro:registroCon(),hoy:HOY});
 assert.ok(!["m","ml"].includes(s.lineas[0]?.unidad?.valor));
});

// Fallo real (2026-10-23): el OCR de la página no leyó el descuento impreso de una línea; la línea no
// cuadraba y cantidad, precio e importe quedaban en revisión.
test("descuento no leído en una línea que no cuadra: se relee la casilla y solo vale si con él la línea cuadra",async()=>{
 const pag=[...cabeceraDoc(),...etiquetas(),...titulos(),
  ...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]),
  ...fila(232,["1300000002",60],["CODO",120],["LATON",150],["50,00",420],["2,000",462],["80,00",560])];
 // La relectura de la casilla del descuento (columna x≈510, fila de la segunda línea) lee «20,00%».
 const relee=texto=>({region})=>region[0]>480&&region[0]<530&&region[1]>215&&region[1]<235?[[texto,92]]:null;
 const r=await extraerEscaneado(motorRecortes(pag,relee("20,00%")),{registro:registroCon(),hoy:HOY});
 const l=r.lineas[1];
 assert.equal(l.descuento.valor,20);assert.equal(l.descuento.estado,"VERIFICADO");assert.equal(l.descuento.resolucion.metodo,"relectura_dirigida_cuadre");
 assert.equal(l.cuadre.estado,"VERIFICADO");
 for(const k of ["cantidad","precio","importe"])assert.equal(l[k].estado,"VERIFICADO",k);
 // Con otro descuento la línea no cuadra: no se acepta nada.
 const s=await extraerEscaneado(motorRecortes(pag,relee("10,00%")),{registro:registroCon(),hoy:HOY});
 assert.equal(s.lineas[1].descuento.estado,"VACIO");assert.notEqual(s.lineas[1].cuadre.estado,"VERIFICADO");
 assert.ok(s.lineas[1].importe.confianza<0.9);
});

// Fallo real (2026-10-23): en un albarán de dos páginas, el código y la descripción dudosos de una
// línea de la SEGUNDA página se releían en la PRIMERA, a la misma altura, y se tomaba el texto de
// otra línea («PLATO … 80X80» en lugar de «… 130X90»), aceptado con 0,93.
test("albarán de dos páginas: una línea de la segunda se relee en su página, nunca en la primera",async()=>{
 const p1=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560])];
 const p2=[...titulos(),...fila(218,["1300000002",60],["CODO",120,70],["LATON",150,70],["1,00",420],["5,000",462],["50",510],["2,50",560])];
 const pagina=(numero,palabras)=>({numero,anchoPx:595,altoPx:842,dpi:72,
  async ocr({region=null}={}){
   if(!region)return palabras;
   const [x,y,ww,h]=region;
   return palabras.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }});
 const r=await extraerEscaneado([pagina(1,p1),pagina(2,p2)],{registro:registroCon(),hoy:HOY});
 const l=r.lineas.find(x=>x.pagina===2);
 assert.ok(l,"la línea de la segunda página existe");
 assert.equal(l.descripcion.valor,"CODO LATON");
 assert.ok(l.descripcion.confianza<0.9,"poca confianza del OCR y sin relectura fiable en su página: en revisión");
});

// Fallo real (2026-10-23): la primera palabra de la descripción caía en la casilla del código
// («100200 RACOR» y descripción «GF MANGUERA…»; «Yeso proyectar» en un proveedor sin código) o el
// siguiente renglón de una descripción larga se leía como otra línea («15m2/paquete»), y la
// descripción incompleta se aceptaba. 8 errores críticos en la lectura del usuario.
test("descripción posiblemente incompleta: código con palabra pegada, proveedor sin código o renglón siguiente sin forma de código",()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
 const cif=(y,cod,...desc)=>fila(y,[cod,60],...desc.map((t,i)=>[t,120+40*i]),["2,00",420],["10,000",462],["50",510],["10,00",560]);
 // Código con una palabra pegada: la descripción no se acepta.
 let r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["130001",60],["RACOR",92],["GF",125],["MANGUERA",140],["2,00",420],["10,000",462],["50",510],["10,00",560])]);
 assert.equal(r.lineas[0].referencia.literal,"130001 RACOR");
 assert.ok(r.lineas[0].descripcion.confianza<0.9,"código con texto pegado: descripción en revisión");
 // Un código propio con espacios que no termina en palabra no afecta a la descripción.
 r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["CUT",60],["T1/2",77],["GF",120],["MANGUERA",135],["2,00",420],["10,000",462],["50",510],["10,00",560])]);
 assert.ok(r.lineas[0].descripcion.confianza>=0.9);
 // Proveedor que no imprime código: lo leído como código hace dudosa la descripción.
 r=leer([...cabeceraDoc(),...etiquetas(),...tit,...cif(218,"YESO","PROYECTAR","FINO")],{registro:registroCon({sin_columna_codigo:true,permite_sin_referencia:true})});
 assert.ok(r.lineas[0].descripcion.confianza<0.9,"sin columna de código: descripción en revisión");
 // Con formato de código: el renglón siguiente sin ese formato puede ser el final de la descripción.
 const reg=registroCon({formato_referencia:"^\\d{10}$"});
 r=leer([...cabeceraDoc(),...etiquetas(),...tit,...cif(218,"1300000001","TUBO","MULTICAPA"),...fila(232,["15m2/paquete",60])],{registro:reg});
 assert.ok(r.lineas[0].descripcion.confianza<0.9,"la siguiente fila no es un código: descripción anterior en revisión");
 r=leer([...cabeceraDoc(),...etiquetas(),...tit,...cif(218,"1300000001","TUBO","MULTICAPA"),...cif(232,"1300000002","CODO","LATON")],{registro:reg});
 assert.ok(r.lineas[0].descripcion.confianza>=0.9&&r.lineas[1].descripcion.confianza>=0.9,"dos códigos con formato: nada cambia");
});

// Fallo real (2026-10-23): el trazo de una firma en la columna de la cantidad se leyó «7» como una
// fila sin código ni descripción, con la cantidad aceptada.
test("fila sin código ni descripción: sus cifras no se aceptan solas",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]),
  ...fila(250,["7",425])]);
 const fantasma=r.lineas.find(l=>l.referencia.estado==="VACIO"&&l.descripcion.estado==="VACIO");
 assert.ok(fantasma,"precondición: la fila del trazo se lee");
 assert.ok(fantasma.cantidad.confianza<0.9,"la cantidad de una fila sin artículo queda en revisión");
 assert.ok(r.lineas[0].cantidad.confianza>=0.9);
});
test("fila siguiente con código y texto pegado («1300000002 CODO»): sí es otra fila de artículo",()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
 const reg=registroCon({formato_referencia:"^\\d{10}$"});
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]),
  ...fila(232,["1300000002",60],["CODO",112],["LATON",140],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:reg});
 assert.ok(r.lineas[0].descripcion.confianza>=0.9);
 // Código con caracteres que el OCR confunde («13OOOOOOO2», «l3000000O2»): también es una fila de artículo.
 for(const cod of ["13OOOOOOO2","l3000000O2"]){
  const q=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]),
   ...fila(232,[cod,60],["CODO",120],["LATON",150],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:reg});
  assert.ok(q.lineas[0].descripcion.confianza>=0.9,cod);
 }
});

/* --------------- Lote real del 2026-10-30 (cifras y nombres ficticios) --------------- */
const COLUMNAS=[["referencia",55,110],["descripcion",111,395],["cantidad",396,445],["precio",446,500],["descuento",501,540],["importe",541,595]];
test("sin la fila de títulos, la tabla se lee con las columnas del perfil; sin perfil, no se inventa ninguna",()=>{
 const cuerpo=[...cabeceraDoc(),...etiquetas(),...filaPrecio(218),...filaPrecio(232,"1300000002")];
 const reg=registroCon({columnas:COLUMNAS,formato_referencia:"^\\d{10}$"});
 const r=leer(cuerpo,{registro:reg});
 assert.equal(r.lineas.length,2);
 assert.deepEqual([r.lineas[0].cantidad.valor,r.lineas[0].precio.valor],[2,10]);
 assert.equal(leer(cuerpo).lineas.length,0);
 // Con títulos completos, las columnas del perfil no se usan.
 assert.equal(leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218)],{registro:reg}).lineas.length,1);
});
test("tabla sin cifras: se relee el lado derecho y se junta con el izquierdo; la lectura sin cifras no se queda",async()=>{
 const izquierda=(y,ref)=>fila(y,[ref,60],["TUBO",120],["MULTICAPA",150]);
 const derecha=y=>fila(y,["2,00",420],["10,000",462],["50",510],["10,00",550]);
 const comun=[...cabeceraDoc(),...etiquetas(),...titulos(),...izquierda(218,"1300000001"),...izquierda(232,"1300000002")];
 const conCifras=[...derecha(218),...derecha(232)];
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({region=null}={}){
   if(!region)return comun;
   const [x,y,ww,h]=region;
   // Solo el recorte del lado derecho ve las cifras (fallo real: marca de agua y rayas verticales).
   const ps=x>200?[...comun,...conCifras]:comun;
   return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas.length,2);
 assert.deepEqual(r.lineas.map(l=>[l.cantidad.valor,l.importe.valor]),[[2,10],[2,10]]);
});
test("«P.V.P.» y «PRECIO NETO» en la misma tabla: el precio de la línea es el neto",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),
  ...fila(200,["CÓDIGO",60],["DESCRIPCION",120],["CANTIDAD",330],["P.V.P.",400],["PRECIO NETO",450,95,{ancho:60}],["IMPORTE",545]),
  ...fila(218,["1300000001",60],["TUBO",120],["4",345],["0,939",400],["0,376",465],["1,50",550])]);
 assert.equal(r.lineas[0].precio.valor,0.376);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});
// Fallo real (2026-11-12, escaneado con las columnas del perfil): la descripción empieza unos puntos antes del límite de la
// columna del código y su primera palabra se leía como parte del código («1300000001 TUBO»), aceptado sin serlo.
test("código con el formato del proveedor: la palabra con letras que sigue es de la descripción, no del código",()=>{
 const reg=registroCon({columnas:COLUMNAS,formato_referencia:"^\\d{10}$"});
 // El código termina en 105 y la descripción empieza en 107 o 108: el límite de la columna del perfil está en 110,5.
 for(const x of [107,108]){
  const filaCorrida=(y,ref)=>fila(y,[ref,55],["TUBO",x],["MULTICAPA",x+30],["2,00",420],["10,000",462],["50",510],["10,00",560]);
  const r=leer([...cabeceraDoc(),...etiquetas(),...filaCorrida(218,"1300000001"),...filaCorrida(232,"1300000002")],{registro:reg});
  assert.deepEqual(r.lineas.map(l=>[l.referencia.valor,l.descripcion.valor]),[["1300000001","TUBO MULTICAPA"],["1300000002","TUBO MULTICAPA"]],"x="+x);
 }
 // Si el código junto con esa palabra también tiene el formato («AB12» + «CD34», partido por el OCR), no se corta.
 const alfa=registroCon({columnas:COLUMNAS,formato_referencia:"^[A-Z]{2}\\d{2}([A-Z]{2}\\d{2})?$"});
 const r2=leer([...cabeceraDoc(),...etiquetas(),...fila(218,["AB12",80],["CD34",107],["TUBO",140],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:alfa});
 assert.equal(r2.lineas.length,1);
 assert.equal(r2.lineas[0].descripcion.valor,"TUBO");
});
// Fallo real (2026-11-12, albarán escaneado sin precios): «4,00 UN» leído «400 UN» y la cantidad aceptada (nada la cuadra).
test("cantidad entera de 3 cifras entre cantidades con decimales: en revisión (la coma puede no haberse leído)",()=>{
 const sinPrecio=(y,ref,cant)=>fila(y,[ref,60],["CALZO",120],["FICTICIO",150],[cant,420],["UN",445]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...sinPrecio(218,"1300000001","2,00"),...sinPrecio(232,"1300000002","400")]);
 assert.equal(r.lineas.length,2);
 assert.ok(r.lineas[0].cantidad.confianza>=0.9);
 assert.equal(r.lineas[1].cantidad.valor,400,"no se cambia el valor");
 assert.ok(r.lineas[1].cantidad.confianza<0.9,"en revisión");
 // Todas enteras: nada que sospechar.
 const q=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...sinPrecio(218,"1300000001","2"),...sinPrecio(232,"1300000002","400")]);
 assert.ok(q.lineas.every(l=>l.cantidad.confianza>=0.9));
 // Con precio e importe que cuadran, la cantidad queda verificada aunque sea entera.
 const c=leer([...cabeceraDoc(),...etiquetas(),...titulos(),...filaPrecio(218),...fila(232,["1300000002",60],["TUBO",120],["400",420],["1,000",462],["50",510],["200,00",555])]);
 assert.ok(c.lineas[1].cantidad.confianza>=0.9);
});
// Fallo real (2026-11-13): descripción en dos renglones con las cifras en el segundo («… (CAJA» / «4)  1,00  4,2000 …»).
test("descripción en dos renglones con las cifras en el segundo: una sola línea",()=>{
 const tit=()=>fila(200,["ARTÍCULO",30],["DESCRIPCIÓN",160],["CANTIDAD",290],["PRECIO",340],["DTO.",400],["TOTAL",450]);
 const base=[...cabeceraDoc(),...etiquetas(),...tit(),...fila(218,["1300000001",25],["TUBO",120],["MULTICAPA",145],["2,00",300],["10,0000",340],["50,00",400],["10,00",455])];
 const r=leer([...base,...fila(230,["1300000002",25],["PILA",120],["FICTICIA",145],["(CAJA",190]),
  ...fila(242,["4)",120],["1,00",300],["4,2000",340],["25,00",400],["3,15",455])]);
 assert.deepEqual(r.lineas.map(l=>[l.referencia.valor,l.descripcion.valor,l.cantidad.valor,l.precio.valor,l.importe.valor]),
  [["1300000001","TUBO MULTICAPA",2,10,10],["1300000002","PILA FICTICIA (CAJA 4)",1,4.2,3.15]]);
 assert.ok(r.lineas[1].confianza>=0.9);
 // La fila de abajo con forma de código es otro artículo: no se une.
 const otro=leer([...base,...fila(230,["1300000002",25],["PILA",120],["FICTICIA",145]),
  ...fila(242,["1300000003",25],["CODO",120],["1,00",300],["4,2000",340],["25,00",400],["3,15",455])]);
 assert.equal(otro.lineas.length,3);
 // Si la fila de arriba ya tiene cifras, la de abajo no es su continuación.
 const conCifras=leer([...base,...fila(242,["4)",120],["1,00",300],["4,2000",340],["25,00",400],["3,15",455])]);
 assert.equal(conCifras.lineas[0].cantidad.valor,2);
 assert.equal(conCifras.lineas[0].descripcion.valor,"TUBO MULTICAPA");
});
// Fallo real (2026-11-13): «4,00 × 2,8517 = 11,4068» con el importe leído «1,4068» (la primera cifra perdida).
test("importe con la primera cifra perdida: solo si una única cifra hace cuadrar la línea",()=>{
 const linea=(imp,cant="4,00",precio="2,8517")=>leer([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],[cant,420],[precio,462],[imp,555])]).lineas[0];
 const l=linea("1,4068");
 assert.equal(l.importe.valor,11.4068);
 assert.equal(l.cuadre.estado,"VERIFICADO");
 assert.ok(l.cantidad.confianza>=0.9&&l.precio.confianza>=0.9);
 assert.match(l.importe.notas.join(" "),/Primera cifra perdida/);
 // Con menos de 4 cifras leídas, no se repara.
 const corta=linea("1,20","3,00","4,00");
 assert.notEqual(corta.importe.valor,12);
 assert.notEqual(corta.cuadre.estado,"VERIFICADO");
 // Si ninguna cifra delante cuadra, nada cambia.
 const nada=linea("1,5000");
 assert.equal(nada.importe.valor,1.5);
 assert.notEqual(nada.cuadre.estado,"VERIFICADO");
});
// Fallo real (2026-11-13): «OBRA *** NOMBRE 1,00», la obra impresa como fila con cantidad, aceptada como artículo «OBRA».
test("perfil con formato de código: un código sin ese formato no se acepta solo; la fila «OBRA … 1,00» no es un artículo",()=>{
 const tit=()=>fila(200,["ARTÍCULO",30],["DESCRIPCIÓN",160],["CANTIDAD",290],["PRECIO",340],["DTO.",400],["TOTAL",450]);
 const filas=[...fila(218,["OBRA",25],["***",120],["NOMBRE",135],["FICTICIO",175],["1,00",300]),
  ...fila(232,["4700012345",25],["TUBO",120],["MULTICAPA",145],["2,00",300],["10,0000",340],["50,00",400],["10,00",455])];
 const formato="^(?=.*\\d)[0-9A-Z]{5,12}$";
 const conAnotacion=leer([...cabeceraDoc(),...etiquetas(),...tit(),...filas],{registro:registroCon({formato_referencia:formato,anotaciones_no_articulo:["OBRA"]})});
 assert.deepEqual(conAnotacion.lineas.map(l=>l.referencia.valor),["4700012345"]);
 // Sin la anotación en el perfil, la fila queda, pero su código no tiene el formato: nunca aceptada.
 const sin=leer([...cabeceraDoc(),...etiquetas(),...tit(),...filas],{registro:registroCon({formato_referencia:formato})});
 const obra=sin.lineas.find(l=>l.referencia.valor==="OBRA");
 assert.ok(obra&&obra.referencia.confianza<0.9&&obra.confianza<0.9);
 assert.ok(sin.lineas.find(l=>l.referencia.valor==="4700012345").referencia.confianza>=0.9);
});

/* --------------- Descuento sin título bajo el del precio (2026-11-17) --------------- */
// Fallo real: «PRECIO 7,63 50,00» con el importe 3,81 y sin columna de descuento; las dos cifras en la columna del precio
// dejaban precio y descuento sin leer. Cifras ficticias.
test("descuento sin título junto al precio: se acepta solo si la línea cuadra con su importe",()=>{
 const tit=fila(200,["ARTÍCULO",60],["DESCRIPCIÓN",120],["CANTIDAD",380],["PRECIO",440],["IMPORTE",545]);
 const bien=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX0001",60],["SPRAY",120],["FICTICIO",155],["1,00",395],["8,40",440],["50,00",480],["4,20",555])]);
 const l=bien.lineas[0];
 assert.equal(l.precio.valor,8.4);assert.deepEqual(l.descuento.porcentajes,[50]);assert.equal(l.cuadre.estado,"VERIFICADO");
 // Si con la segunda cifra como descuento no cuadra, ninguna se acepta (como antes).
 const mal=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX0001",60],["SPRAY",120],["FICTICIO",155],["1,00",395],["8,40",440],["50,00",480],["7,00",555])]);
 const m=mal.lineas[0];
 assert.equal(m.precio.valor,null);assert.equal(m.precio.estado,"AMBIGUO");
 assert.ok(!["OK","VERIFICADO"].includes(m.descuento.estado)||!(m.descuento.porcentajes||[]).length);
});

// Código de barras EAN con su dígito de control (fallo real 2026-11-17: EAN bien leídos quedaban en revisión). EAN ficticios
// de los de ejemplo de la norma.
test("eanValido: EAN-13 y EAN-8 con su dígito de control; una cifra cambiada no vale",()=>{
 const {eanValido}=require("../albaranes/escaneado.js");
 for(const x of ["4006381333931","5901234123457","96385074"])assert.equal(eanValido(x),true,x);
 for(const x of ["4006381333932","5901234123458","96385075","123","40063813339311","ABC1234567890"])assert.equal(eanValido(x),false,x);
});

// Clase de documento por el título impreso (usuario, 2026-11-17). Palabras ficticias.
test("clase impresa: «ALBARÁN» o un título de pedido como renglón propio; «Su pedido: …» no cuenta",()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
 const lin=fila(218,["1300000001",60],["TUBO",120],["2,00",420],["10,00",462],["20,00",560]);
 assert.equal(leer([...cabeceraDoc(),...etiquetas(),...tit,...lin]).clase_impresa,"ALBARAN");
 const ped=leer([...cabeceraDoc(),...fila(100,["CONFIRMACIÓN",60],["DE",140],["PEDIDO",160]),...fila(120,["Nº",60],["600111",80],["15/10/26",340]),...tit,...lin]);
 assert.equal(ped.clase_impresa,"PEDIDO");
 const suPedido=leer([...cabeceraDoc(),...fila(100,["SU",60],["PEDIDO:",80],["OBRA",130]),...fila(120,["Nº",60],["600111",80],["15/10/26",340]),...tit,...lin]);
 assert.equal(suPedido.clase_impresa,null);
});

// Número de una confirmación de pedido tras «PRESUPUESTO» (usuario, 2026-11-17); nunca en un albarán. Palabras ficticias.
test("numeroDePedido: el número tras «PRESUPUESTO» solo leyendo pedidos",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
 const lin=fila(218,["KC100",60],["REGULADOR",120],["1,00",420],["10,00",462],["10,00",560]);
 const pal=[...cabeceraDoc(),...fila(120,["PRESUPUESTO",60],["2600001",140]),...fila(130,["FECHA",300],["15/10/26",340]),...tit,...lin];
 assert.equal(extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDePedido:true}).numero.valor,"2600001");
 assert.notEqual(extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY}).numero.valor,"2600001");
});

/* --------------- Confirmación de pedido escaneada (fallos reales 2026-11-18; datos ficticios) --------------- */
test("título «PRECIO UNID.»: la cifra bajo «UNID.» es el precio",()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",380],["PRECIO UNID.",430],["DTO",500],["IMPORTE NETO",530]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX0001",60],["REGULADOR",120],["1,00",395],["34,76",455],["58%",505],["14,60",560])]);
 assert.equal(r.lineas[0].precio.valor,34.76);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});
test("«OBSERVACIONES» entre dos artículos no termina la tabla; al final de la tabla, sí",()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",380],["PRECIO",440],["IMPORTE",545]);
 const art=(y,ref)=>fila(y,[ref,60],["REGULADOR",120],["2,00",395],["10,00",440],["20,00",555]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...art(218,"EX0001"),...fila(232,["OBSERVACIONES",60],["DEFINIR",160],["COLOR",200]),...art(246,"EX0002"),...art(260,"EX0003")]);
 assert.deepEqual(r.lineas.map(l=>l.referencia.valor),["EX0001","EX0002","EX0003"]);
 // Sin un artículo detrás, «OBSERVACIONES» es el pie: lo que sigue no son líneas.
 const pie=leer([...cabeceraDoc(),...etiquetas(),...tit,...art(218,"EX0001"),...fila(232,["OBSERVACIONES",60],["ENTREGA",160],["EN",200],["OBRA",220]),...fila(246,["TOTAL",380],["20,00",555])]);
 assert.deepEqual(pie.lineas.map(l=>l.referencia.valor),["EX0001"]);
});
test("numeroDePedido: el número va debajo de «PRESUPUESTO»; una cifra en otra columna a la derecha no lo es",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
 const lin=fila(218,["EX0001",60],["REGULADOR",120],["1,00",420],["10,00",462],["10,00",560]);
 const pal=[...cabeceraDoc(),...fila(120,["PRESUPUESTO",60],["99999",330],["VILLAFICTICIA",360]),...fila(132,["2600001",70]),
  ...fila(150,["FECHA",300],["15/10/26",340]),...tit,...lin];
 assert.equal(extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDePedido:true}).numero.valor,"2600001");
});
test("cifras de otra lectura OCR: solo de la misma fila física (la misma referencia en otra página no vale)",async()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",380],["PRECIO",440],["IMPORTE",545]);
 // Página 1: «EX0001 4,00 10,00» con el importe ilegible; la lectura psm 6 de esa página no ve la fila.
 // Solo la lectura principal (psm 4) ve además «EX0009», que cuadra (por eso es la principal).
 const p1=psm=>[...cabeceraDoc(),...etiquetas(),...tit,...(psm===4?[...fila(218,["EX0009",60],["TUERCA",120],["1,00",395],["5,00",440],["5,00",555]),...fila(232,["EX0001",60],["REGULADOR",120],["4,00",395],["10,00",440])]:[])];
 // Página 2: «EX0001 3,00 10,00 30,00», leída igual por todas.
 const p2=()=>[...tit,...fila(218,["EX0001",60],["REGULADOR",120],["3,00",395],["10,00",440],["30,00",555])];
 const motor=[p1,p2].map((f,i)=>({numero:i+1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({psm=4,region=null}={}){
   const ps=f(psm);
   if(!region)return ps;
   const [x,y,ww,h]=region;
   return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}));
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 const l=r.lineas.find(x=>x.pagina===1&&x.referencia?.valor==="EX0001");
 assert.ok(l,"falta la línea de la página 1: "+JSON.stringify(r.lineas.map(x=>[x.pagina,x.referencia?.valor,x.cantidad?.valor,x.cuadre?.estado])));
 assert.equal(l.cantidad.valor,4,JSON.stringify(r.lineas.map(x=>[x.pagina,x.referencia?.valor,x.cantidad?.valor,x.cuadre?.estado,x.notas])));
 assert.notEqual(l.cuadre.estado,"VERIFICADO");
});
test("títulos partidos en dos celdas («IMPORTE» | «NETO», «PRECIO» | «UNID.»): una sola columna",()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",360],["PRECIO",410],["UNID.",440],["DTO",490],["IMPORTE",515],["NETO",552]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX0001",60],["REGULADOR",120],["1,00",375],["34,76",445],["58%",493],["14,60",560])]);
 assert.equal(r.lineas[0].precio.valor,34.76);
 assert.equal(r.lineas[0].importe.valor,14.6);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
});
test("firma digital junto a la tabla («NOMBRE - DNI»): palabras en la columna de la cantidad sin código ni descripción, no es una línea",()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",380],["PRECIO",440],["IMPORTE",545]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX0001",60],["REGULADOR",120],["2,00",395],["10,00",440],["20,00",555]),
  ...fila(240,["FICTICIO-",380],["12345678",440])]);
 assert.deepEqual(r.lineas.map(l=>l.referencia.valor),["EX0001"]);
});
test("numeroDePedido: serie y número en dos celdas debajo de «PRESUPUESTO» («SERIE» | «2600001»)",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
 const lin=fila(218,["EX0001",60],["REGULADOR",120],["1,00",420],["10,00",462],["10,00",560]);
 const pal=[...cabeceraDoc(),...fila(120,["PRESUPUESTO",60],["99999",330],["VILLAFICTICIA",360]),...fila(132,["SERIE",60],["2600001",100]),
  ...fila(150,["FECHA",300],["15/10/26",340]),...tit,...lin];
 assert.equal(extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDePedido:true}).numero.valor,"SERIE 2600001");
});
// Usuario 2026-11-18: las zonas del presupuesto («ZONA …») son el reparto, no productos. Textos ficticios.
test("rótulos de zona entre las líneas (también con la viñeta leída «A»): no son artículos",()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",120],["CANTIDAD",380],["PRECIO",440],["IMPORTE",545]);
 const art=(y,ref)=>fila(y,[ref,60],["REGULADOR",120],["2,00",395],["10,00",440],["20,00",555]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(214,["ZONA",120],["VESTUARIOS",145]),...art(228,"EX0001"),
  ...fila(242,["AZONA",60],["DE",92],["ACCESO",120]),...art(256,"EX0002"),...fila(270,["ZONA",60],["ACCESO",88],["PISCINAS",120],["DUCHAS",160]),...art(284,"EX0003")]);
 assert.deepEqual(r.lineas.map(l=>l.referencia.valor),["EX0001","EX0002","EX0003"]);
 assert.ok(r.lineas.every(l=>!/ZONA/.test(l.descripcion.valor||"")));
});
// Fallo real 2026-11-18: título «CONCEPTOS» centrado y descripciones alineadas mucho más a la izquierda; sin código, el principio
// de la descripción se tomaba como código. Textos ficticios.
test("descripciones alineadas a la izquierda del título centrado: el principio de la descripción no es código",()=>{
 const tit=fila(200,["REFERENCIA",60],["CONCEPTOS",250],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
 const art=(y,ref,d1,d2)=>fila(y,...(ref?[[ref,60]]:[]),[d1,140],[d2,185],["2,00",415],["10,00",462],["20,00",560]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...art(218,"EX0001","REGULADOR","FICTICIO"),...art(232,"EX0002","TOBERA","FICTICIA"),
  ...art(246,null,"DF-99","ESTRECHO"),...art(260,"EX0003","REJILLA","FICTICIA"),...art(274,"EX0004","BOCA","FICTICIA")]);
 const l=r.lineas.find(x=>/ESTRECHO/.test(x.descripcion.valor||x.descripcion.literal||""));
 assert.ok(l,JSON.stringify(r.lineas.map(x=>[x.referencia.literal,x.descripcion.literal])));
 assert.ok(!l.referencia.valor,"sin código: "+l.referencia.valor);
 assert.match(l.descripcion.literal,/^DF-99 ESTRECHO/);
 assert.deepEqual(r.lineas.filter(x=>x.referencia.valor).map(x=>x.referencia.valor),["EX0001","EX0002","EX0003","EX0004"]);
});
// Fallo real 2026-11-18: tabla «Nº | Descripción | Cantidad | Un.» sin precios y con el código («MODELOX») bajo «Nº». Ficticio.
test("tabla «Nº | Descripción | Cantidad | Un.»: se lee, con el código bajo «Nº» si son códigos con letras",()=>{
 const tit=fila(200,["Nº",60],["Descripción",160],["Cantidad",400],["Un.",450]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["MODELOX",60],["CAMARA",160],["FICTICIA",200],["1",420],["Unidad",450])]);
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].cantidad.valor,1);
 assert.equal(r.lineas[0].referencia.literal,"MODELOX");
 // Con números de línea bajo «Nº», no es el código.
 const n=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["1",60],["CAMARA",160],["FICTICIA",200],["1",420],["Unidad",450])]);
 assert.equal(n.lineas.length,1);assert.notEqual(n.lineas[0].referencia.literal,"1");
});
// Fallo real 2026-11-18: código de modelo solo de letras a la izquierda (título «Nº» perdido) y renglones de peso tras la tabla.
test("código solo de letras que también está en su descripción: es el código; «Peso bruto/neto» termina la tabla",()=>{
 const tit=fila(200,["Descripción",160],["Cantidad",400],["Un.",450]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["MODELOX",60],["CAMARA",160],["MODELOX",200],["105",240],["1",420],["Unidad",450]),
  ...fila(240,["Peso",60],["bruto",88],["(Kg)",118],["0,00",160]),...fila(254,["Peso",60],["neto",88],["(Kg)",118],["0,00",160])]);
 assert.deepEqual(r.lineas.map(l=>l.referencia.literal),["MODELOX"]);
 // Una palabra sin cifras que no está en su descripción no es un código.
 const p=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["PALABRA",60],["CAMARA",160],["FICTICIA",200],["1",420],["Unidad",450])]);
 assert.notEqual(p.lineas[0]?.referencia.literal,"PALABRA");
});

/* --------------- Factura de proveedor (usuario 2026-11-20; datos ficticios) --------------- */
test("factura: títulos «DESCRIPCIÓN EQUIPOS ALQUILADOS» y «PRECIO DIA»; número bajo «NÚMERO» (serie y número), no los «ALBARÁN Nº» de las líneas",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const tit=fila(200,["CÓDIGO",45],["CANTIDAD",95],["DESCRIPCIÓN EQUIPOS ALQUILADOS",140],["PRECIO DIA",425],["IMPORTE",517]);
 const pal=[...cabeceraDoc(),...fila(100,["FECHA",400],["NÚMERO",470]),...fila(112,["15/10/26",400],["A",478],["009999",488]),...tit,
  ...fila(214,["ALBARAN",140],["Nº",180],["111.111",200]),...fila(228,["EX00001",45],["1,00",111],["MORDAZA",140],["10,000",442],["10,00",547]),
  ...fila(242,["ALBARAN",140],["Nº",180],["222.222",200]),...fila(256,["EX00002",45],["2,00",111],["TALADRO",140],["5,000",442],["10,00",547])];
 const r=extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.equal(r.numero.valor,"A 009999");
 assert.deepEqual(r.lineas.map(l=>[l.referencia.valor,l.cantidad.valor,l.precio.valor]),[["EX00001",1,10],["EX00002",2,5]]);
 assert.notEqual(extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY}).numero.valor,"A 009999");
});
test("factura: el título «FACTURA» encima de «NÚMERO» da las cifras sin la serie; vale la lectura completa. Una dirección no es número",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const tit=fila(200,["CÓDIGO",45],["CANTIDAD",95],["DESCRIPCIÓN",140],["PRECIO",425],["IMPORTE",517]);
 const lin=fila(228,["EX00001",45],["1,00",111],["MORDAZA",140],["10,000",442],["10,00",547]);
 const pal=[...cabeceraDoc(),...fila(86,["FACTURA",488]),...fila(100,["FECHA",400],["NÚMERO",470]),...fila(112,["15/10/26",400],["A",478],["009999",488]),...tit,...lin];
 assert.equal(extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDeFactura:true}).numero.valor,"A 009999");
 const dir=[...cabeceraDoc(),...fila(100,["FACTURA",60]),...fila(112,["24999",60],["VILLAFICTICIA",100]),...tit,...lin];
 assert.notEqual(extraerDePaginas([pagina(dir)],{registro:registroCon(),hoy:HOY,numeroDeFactura:true}).numero.valor,"24999 VILLAFICTICIA");
});
test("factura digital: «1,00 RTH» en un solo texto (cantidad y principio de la descripción): 1 a la cantidad, «RTH» a la descripción",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js"),{agruparLineas}=require("../albaranes/texto-pdf.js");
 // Texto de PDF digital (sin cajas por palabra): [texto, x0, x1, y].
 const fr=(t,x0,x1,y,alto=7)=>({texto:t,crudo:t,x0,x1,y,alto});
 const fs_=[fr("PROVEEDOR FICTICIO, S.L.",28,140,40),fr("CIF ${NIF}",28,90,52),fr("ALBARÁN Nº 600.111",300,380,82),fr("FECHA 15/10/26",400,460,82),
  fr("CÓDIGO",43,72,223),fr("CANTIDAD",93,131,223),fr("DESCRIPCIÓN EQUIPOS ALQUILADOS",139,270,223),fr("PRECIO DIA",425,467,223),fr("IMPORTE",517,551,223),
  fr("EX00001",40,88,258),fr("1,00 RTH",111,148,258),fr("MORDAZA FICTICIA",152,230,258),fr("10,000",442,470,258),fr("NETO",496,516,258),fr("10,00",547,571,258)];
 const pag={numero:1,ancho:595,alto:842,tipo:"DIGITAL",lineas:agruparLineas(fs_)};
 const r=extraerDePaginas([pag],{registro:registroCon(),hoy:HOY});
 assert.equal(r.lineas.length,1);
 assert.equal(r.lineas[0].cantidad.valor,1);
 assert.match(r.lineas[0].descripcion.valor,/^RTH MORDAZA/);
 assert.equal(r.lineas[0].importe.valor,10);
});
test("factura de alquiler: «Total 00010 Días» bajo cada línea no termina la tabla; renglones sin código ni cifras no son artículos",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js"),{agruparLineas}=require("../albaranes/texto-pdf.js");
 const fr=(t,x0,x1,y,alto=7)=>({texto:t,crudo:t,x0,x1,y,alto});
 const art=(y,ref,precio)=>[fr(ref,40,88,y),fr("1,00 RTH",111,148,y),fr("MORDAZA FICTICIA",152,230,y),fr(precio,442,470,y),fr("NETO",496,516,y),fr(precio.replace(/0$/,""),547,571,y),
  fr("Total",133,157,y+12),fr("00010",162,186,y+12),fr("Días",191,210,y+12),fr("Ref.Contrato:",277,340,y+12),fr("009999",344,373,y+12)];
 const fs_=[fr("PROVEEDOR FICTICIO, S.L.",28,140,40),fr("CIF ${NIF}",28,90,52),fr("FECHA 15/10/26",400,460,82),
  fr("CÓDIGO",43,72,223),fr("CANTIDAD",93,131,223),fr("DESCRIPCIÓN EQUIPOS ALQUILADOS",139,270,223),fr("PRECIO DIA",425,467,223),fr("IMPORTE",517,551,223),
  ...art(258,"EX00001","10,000"),fr("1,00 FICTICIA 1",111,176,282),...art(306,"EX00002","20,000"),fr("TOTAL",482,504,626),fr("30,00",540,570,640)];
 const r=extraerDePaginas([{numero:1,ancho:595,alto:842,tipo:"DIGITAL",lineas:agruparLineas(fs_)}],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.deepEqual(r.lineas.filter(l=>l.referencia?.valor).map(l=>[l.referencia.valor,l.importe.valor]),[["EX00001",10],["EX00002",20]]);
});

/* --------------- Descuentos en la columna del importe y abonos (fallos reales 2026-11-20; datos ficticios) --------------- */
test("descuento en cascada con su segunda cifra caída en la columna del importe («55» | «7  83,70»): el cuadre lo confirma",()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",380],["PRECIO",430],["DTO%",480],["IMPORTE",540]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX00001",60],["CODO",120],["FICTICIO",145],["10,00",395],["20,000",430],["55",485],["7",527],["83,70",548])]);
 assert.deepEqual(r.lineas[0].descuento.porcentajes,[55,7]);
 assert.equal(r.lineas[0].importe.valor,83.7);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
 // Si con esas cifras la línea no cuadra, sigue en duda (nunca se inventa).
 const mal=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX00001",60],["CODO",120],["FICTICIO",145],["10,00",395],["20,000",430],["55",485],["9",527],["83,70",548])]);
 assert.equal(mal.lineas[0].importe.estado,"AMBIGUO");
});
test("abono: cantidad negativa con el importe impreso en positivo cuadra; descuento «50.» con punto final, si cuadra",()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",380],["PRECIO",430],["DTO%",480],["IMPORTE",540]);
 const r=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX00001",60],["MAQUINA",120],["FICTICIA",160],["-1,00",395],["400,000",430],["50.",485],["200,00",548])]);
 assert.deepEqual(r.lineas[0].descuento.porcentajes,[50]);
 assert.equal(r.lineas[0].cuadre.estado,"VERIFICADO");
 const d=leer([...cabeceraDoc(),...etiquetas(),...tit,...fila(218,["EX00001",60],["MAQUINA",120],["FICTICIA",160],["-1,00",395],["50,000",430],["52",527],["24,00",548])]);
 assert.deepEqual(d.lineas[0].descuento.porcentajes,[52]);
 assert.equal(d.lineas[0].cuadre.estado,"VERIFICADO");
});
// Facturas con albaranes que faltan (2026-11-23): cada línea y cada «ALBARÁN Nº» descartado llevan su altura «y» en la página, para
// saber bajo qué albarán va cada línea. Fallo real: la cabecera del primer albarán («línea sin cantidad») salía sin posición.
test("factura: las líneas y los «ALBARÁN Nº» descartados llevan su posición en la página",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const tit=fila(200,["CÓDIGO",45],["CANTIDAD",95],["DESCRIPCIÓN",140],["PRECIO",425],["IMPORTE",517]);
 const pal=[...cabeceraDoc(),...fila(100,["FECHA",400],["NÚMERO",470]),...fila(112,["15/10/26",400],["A",478],["009999",488]),...tit,
  ...fila(214,["ALBARAN",140],["Nº",180],["111.111",200]),...fila(228,["EX00001",45],["1,00",111],["MORDAZA",140],["10,000",442],["10,00",547]),
  ...fila(242,["ALBARAN",140],["Nº",180],["222.222",200]),...fila(256,["EX00002",45],["2,00",111],["TALADRO",140],["5,000",442],["10,00",547])];
 const r=extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 const cab=r.lineas_ignoradas.filter(x=>/ALBARAN/.test(x.texto));
 assert.equal(cab.length,2);
 assert.ok(cab.every(x=>Number.isFinite(x.y)),JSON.stringify(cab));
 assert.ok(r.lineas.every(l=>Number.isFinite(l.y)));
 // Cada línea, debajo de su albarán: la primera entre los dos, la segunda después del segundo.
 assert.ok(cab[0].y<r.lineas[0].y&&r.lineas[0].y<cab[1].y&&cab[1].y<r.lineas[1].y);
});
// Facturas reales del 2026-11-23 (datos ficticios): «Albarán: 26/0002  Fecha: 08/10/26» en la columna del código no es un artículo
// ni el número de la factura.
test("factura: «Albarán: …» bajo la cabecera de la tabla no es una línea; su número nunca es el de la factura",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const cab=[...cabeceraDoc(),...fila(100,["Documento",29],["Núm,",95],["Fecha",148],["Vendedor",206]),...fila(112,["FACTURA",32],["26/0001",90],["08/10/26",144],["NOMBRE",216])];
 const tabla=[...fila(200,["Código",28],["Descripción",108],["Cantidad",349],["Precio",402],["%",480],["Importe",515]),
  ...fila(214,["Albarán:",23],["26/0002",58],["Fecha:",100],["08/10/26",131]),
  ...fila(228,["METACRILATO",108],["FICTICIO",170],["2,00",358],["10,0000",400],["20,00",545])];
 const r=extraerDePaginas([pagina([...cab,...tabla])],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.equal(r.numero.valor,"26/0001");
 assert.deepEqual(r.lineas.map(l=>l.descripcion.valor),["METACRILATO FICTICIO"]);
 const alb=r.lineas_ignoradas.find(x=>/Albar/.test(x.texto));
 assert.ok(alb&&Number.isFinite(alb.y)&&/citado/.test(alb.motivo),JSON.stringify(r.lineas_ignoradas));
 // Sin número de factura legible, el del albarán citado no ocupa su lugar.
 const sin=extraerDePaginas([pagina([...cabeceraDoc(),...fila(100,["Documento",29],["Fecha",148]),...fila(112,["FACTURA",32],["08/10/26",144]),...tabla])],
  {registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.notEqual(sin.numero.valor,"26/0002");
});
test("factura: «FECHA» que encabeza una columna con la fecha de cada cargo no es la fecha de la factura; un albarán con «FECHA» y «FECHA ENTREGA» sí",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const cargos=[...fila(200,["FECHA",40],["DESCRIPCION",112],["CARGOS",441],["ABONOS",505]),...fila(214,["03/10/26",40],["SUPLIDOS",93],["FICTICIOS",140],["1,11",470]),
  ...fila(228,["06/10/26",41],["TASAS",93],["FICTICIAS",130],["2,22",466]),...fila(242,["09/10/26",41],["HONORARIOS",93],["3,33",466])];
 const r=extraerDePaginas([pagina([...cabeceraDoc(),...fila(100,["FACTURA",100]),...fila(112,["1/0001",99]),...cargos])],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.ok(!(r.fecha.estado==="OK"&&r.fecha.valor==="2026-10-03"),JSON.stringify(r.fecha));
 assert.notEqual(r.fecha.estado,"OK");
 // Un albarán con la fecha y, debajo, otra etiqueta con su fecha: la del albarán sigue siendo la etiquetada.
 const alb=leer([...cabeceraDoc(),...fila(100,["FECHA",400]),...fila(112,["15/10/26",400]),...fila(124,["FECHA ENTREGA",400]),...fila(136,["16/10/26",400]),
  ...fila(120,["ALBARÁN",60],["Nº",105],["600.111",120]),...titulos(),...filaPrecio(218)]);
 assert.equal(alb.fecha.valor,"2026-10-15");
 assert.equal(alb.fecha.estado,"OK");
});
test("factura: la barra leída como «1» en la fila del número («1511026» por la fecha) deja el número en revisión y propone la fecha",()=>{
 const {extraerDePaginas}=require("../albaranes/extraer.js");
 const pal=[...cabeceraDoc(),...fila(100,["HA",57],["FACTURA",100],["CLIENTE",176]),...fila(112,["1511026",45],["110001",99],["30001",177]),
  ...fila(200,["CÓDIGO",45],["CANTIDAD",95],["DESCRIPCIÓN",140],["PRECIO",425],["IMPORTE",517]),...fila(228,["EX00001",45],["1,00",111],["MORDAZA",140],["10,000",442],["10,00",547])];
 const r=extraerDePaginas([pagina(pal)],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.equal(r.numero.valor,"110001");
 assert.notEqual(r.numero.estado,"OK");
 assert.equal(r.fecha.valor,"2026-10-15");
 assert.notEqual(r.fecha.estado,"OK");
 // Una barra bien y la otra perdida (otra lectura OCR: «1510/26»).
 const media=extraerDePaginas([pagina([...cabeceraDoc(),...fila(100,["FACTURA",100]),...fila(112,["1510/26",45],["110001",99]),...pal.slice(-11)])],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.equal(media.numero.estado,"REVISAR");
 assert.equal(media.fecha.valor,"2026-10-15");
 // Sin esa fecha sin barras en la fila, el número se acepta como siempre.
 const ok=extraerDePaginas([pagina([...cabeceraDoc(),...fila(100,["FACTURA",100]),...fila(112,["110001",99]),...pal.slice(-11)])],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.equal(ok.numero.estado,"OK");
});

/* --------- Fallo real 2026-11-23 (Comfriber): «Nº de Albarán» leído «N* de Albarán» y «Precio Unit.» sin leer (datos ficticios) --------- */
test("«N* de Albarán» / «N? de Albarán» (el «º» mal leído) es la etiqueta del número",()=>{
 const tit=fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
 const lin=fila(218,["EX0001",60],["REGULADOR",120],["1,00",420],["10,00",462],["10,00",560]);
 for(const et of ["N*","N?"]){
  const r=leer([...cabeceraDoc(),...fila(110,["Número de Cliente",296],[et+" de Albarán",388],["Fecha",488]),
   ...fila(122,["99999999",322],["L/9.999",390],["15/10/26",470]),...tit,...lin]);
  assert.equal(r.numero.valor,"L/9.999",et);
  assert.equal(r.numero.estado,"OK",et);
 }
});
const sinTituloPrecio=()=>fila(200,["CÓDIGO",60],["DESCRIPCIÓN",120],["UNIDADES",337],["DTO.(%)",469],["IMPORTE TOTAL",518]);
test("precio sin título de columna caído al final de la descripción: se separa si la línea cuadra; la descripción, a revisión",()=>{
 const r=leer([...cabeceraDoc(),...etiquetas(),...sinTituloPrecio(),
  ...fila(218,["EX0001",50],["REJILLA",122],["FICTICIA",165],["20,00",250],["4,00",358],["50",487],["40,00",545])]);
 const l=r.lineas[0];
 assert.equal(l.precio.valor,20,JSON.stringify([l.descripcion.literal,l.precio,l.cantidad.valor,l.importe.valor]));
 assert.equal(l.cuadre.estado,"VERIFICADO");
 assert.equal(l.descripcion.valor,"REJILLA FICTICIA");
 assert.equal(l.descripcion.estado,"REVISAR");
});
test("cifra al final de la descripción que no cuadra, o cantidad 1 sin descuento: no es el precio",()=>{
 const noCuadra=leer([...cabeceraDoc(),...etiquetas(),...sinTituloPrecio(),
  ...fila(218,["EX0001",50],["REJILLA",122],["FICTICIA",165],["21,00",250],["4,00",358],["50",487],["40,00",545])]).lineas[0];
 assert.notEqual(noCuadra.precio.valor,21);
 assert.match(noCuadra.descripcion.literal,/21,00$/);
 const trivial=leer([...cabeceraDoc(),...etiquetas(),...sinTituloPrecio(),
  ...fila(218,["EX0001",50],["CABLE",122],["FICTICIO",160],["2,50",250],["1,00",358],["2,50",545])]).lineas[0];
 assert.notEqual(trivial.precio.valor,2.5);
 assert.match(trivial.descripcion.literal,/2,50$/);
});
