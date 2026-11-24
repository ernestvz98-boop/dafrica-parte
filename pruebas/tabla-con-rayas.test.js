"use strict";
/*
 * Tablas en casillas con rayas (2026-11-24; factura real escaneada del 2026-11-23 con los títulos pegados a las rayas y una firma
 * encima: el OCR de página no veía los títulos y la factura salía sin líneas). Palabras de OCR construidas a mano, 72 ppp
 * (píxeles = puntos PDF); proveedor, NIF, números e importes FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {extraerDePaginas}=require("../albaranes/extraer.js");
const {unirFilasEntreRayas}=require("../albaranes/ocr.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");
const {HOY,registroCon,fila,cabeceraDoc,pagina}=require("./ayudas-ocr.js");

const etiquetas=()=>[...fila(120,["ALBARÁN",60],["Nº",105],["600.123",120]),...fila(120,["FECHA",300],["27/08/26",340])];
// Títulos de la factura real: «Albarán | Concepto | Unid. | Imp. Uni. | % Dto. | Importe» («Imp.» y «Uni.» en dos casillas).
const titulos=()=>fila(200,["Albarán",60],["Concepto",130],["Unid.",335],["Imp.",380],["Uni.",410],["Dto.",450],["Importe",500]);
// Cada fila de la tabla: el texto en dos renglones y las cifras centradas entre ellos (tres renglones del OCR entre dos rayas).
const filaEnTres=(y,{numero,texto1,texto2,cantidad,precio,importe})=>[
 ...fila(y,[numero,60],...texto1.split(" ").reduce((a,t)=>{const x=a.length?a[a.length-1][1]+a[a.length-1][0].length*5+3:130;return [...a,[t,x]];},[])),
 ...fila(y+10,[cantidad,335],[precio,380],[importe,500]),
 ...fila(y+20,...texto2.split(" ").reduce((a,t)=>{const x=a.length?a[a.length-1][1]+a[a.length-1][0].length*5+3:130;return [...a,[t,x]];},[]))];
const filas=()=>[
 ...filaEnTres(222,{numero:"99A00001",texto1:"CONTENEDOR ESCOMBRO",texto2:"MIXTO 6 M3",cantidad:"1,00",precio:"100,00",importe:"100,00"}),
 ...filaEnTres(260,{numero:"99A00002",texto1:"M3. VOLUMINOSO",texto2:"RESIDUO MEZCLA",cantidad:"2,00",precio:"30,00",importe:"60,00"})];
const rayas=[{y:210,x0:50,x1:560},{y:248,x0:50,x1:560},{y:286,x0:50,x1:560}];
const leerPagina=pag=>extraerDePaginas([pag],{registro:registroCon(),hoy:HOY});

test("cada fila entre dos rayas es una línea, aunque el OCR la lea en tres renglones",()=>{
 const pag=pagina([...cabeceraDoc(),...etiquetas(),...titulos(),...filas()]);
 // Sin unir: el primer renglón de cada fila (sin cifras) se descarta y la descripción se queda con el segundo.
 const suelta=leerPagina(pag);
 assert.ok(suelta.lineas.every(l=>!/CONTENEDOR|VOLUMINOSO/.test(String(l.descripcion.valor))));
 assert.ok(suelta.lineas_ignoradas.some(x=>/CONTENEDOR ESCOMBRO/.test(x.texto)));
 const unida=unirFilasEntreRayas(pag,rayas);
 assert.ok(unida.avisos.some(a=>/2 filas de la tabla unidas/.test(a)));
 const r=leerPagina(unida);
 assert.equal(r.lineas.length,2);
 assert.deepEqual(r.lineas.map(l=>[l.cantidad.valor,l.precio.valor,l.importe.valor,l.cuadre.estado]),[[1,100,100,"VERIFICADO"],[2,30,60,"VERIFICADO"]]);
 assert.match(String(r.lineas[0].descripcion.valor),/CONTENEDOR ESCOMBRO MIXTO 6 M3/);
 assert.match(String(r.lineas[1].descripcion.valor),/M3\. VOLUMINOSO RESIDUO MEZCLA/);
});

test("franjas que no son una fila (muy altas, o de un solo renglón) se dejan como están",()=>{
 const pag=pagina([...cabeceraDoc(),...etiquetas(),...titulos(),...filas()]);
 // Solo las rayas del borde de la tabla: una franja con las dos filas (6 renglones, más de 5 alturas de letra).
 assert.equal(unirFilasEntreRayas(pag,[{y:210,x0:50,x1:560},{y:286,x0:50,x1:560}]),pag);
 // Una franja con un solo renglón (la cabecera entre dos rayas).
 assert.equal(unirFilasEntreRayas(pag,[{y:190,x0:50,x1:560},{y:205,x0:50,x1:560}]),pag);
 // Sin rayas, o con una sola.
 assert.equal(unirFilasEntreRayas(pag,[]),pag);
 assert.equal(unirFilasEntreRayas(pag,[rayas[0]]),pag);
});

test("escaneado: si ninguna lectura ve los títulos, se lee sin rayas y la tabla sale entera",async()=>{
 // El OCR de página no ve los títulos (pegados a las rayas) y sí el resto; sin rayas, ve los títulos.
 const normal=[...cabeceraDoc(),...etiquetas(),...filas()],sinRayas=[...cabeceraDoc(),...etiquetas(),...titulos(),...filas()];
 const tratamientos=[];
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({region=null,tratamiento=null}={}){
   if(tratamiento)tratamientos.push(tratamiento);
   if(tratamiento==="sinRayas"){const ps=[...sinRayas];Object.defineProperty(ps,"rayasH",{value:rayas,enumerable:false});return ps;}
   if(!region)return normal;
   const [x,y,ww,h]=region;
   return normal.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 assert.ok(tratamientos.includes("sinRayas"));
 assert.equal(r.lineas.length,2);
 assert.deepEqual(r.lineas.map(l=>[l.cantidad.valor,l.precio.valor,l.importe.valor]),[[1,100,100],[2,30,60]]);
});

test("escaneado: con los títulos ya leídos no se hace la lectura sin rayas",async()=>{
 const todo=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(222,["99A00001",60],["CONTENEDOR",130],["1,00",335],["100,00",380],["100,00",500])];
 const tratamientos=[];
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({region=null,tratamiento=null}={}){
   if(tratamiento)tratamientos.push(tratamiento);
   if(!region)return todo;
   const [x,y,ww,h]=region;
   return todo.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
 const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
 assert.ok(!tratamientos.includes("sinRayas"));
 assert.equal(r.lineas.length,1);
});

test("«Imp.» | «Uni.» en dos casillas es la columna del precio; «Unid.» es la cantidad",()=>{
 const r=leerPagina(pagina([...cabeceraDoc(),...etiquetas(),...titulos(),...fila(222,["99A00001",60],["CONTENEDOR",130],["3,00",335],["12,50",380],["37,50",500])]));
 assert.equal(r.lineas.length,1);
 assert.deepEqual([r.lineas[0].cantidad.valor,r.lineas[0].precio.valor,r.lineas[0].importe.valor,r.lineas[0].cuadre.estado],[3,12.5,37.5,"VERIFICADO"]);
});

test("«Unid.» junto a otra columna de cantidad es la unidad de medida, no la cantidad",()=>{
 const casos=[
  [fila(200,["CÓDIGO",60],["DESCRIPCIÓN",130],["CANT.",300],["UNID.",340],["PRECIO",390],["IMPORTE",500]),fila(222,["4300099900",60],["CODO",130],["2,00",300],["UD",345],["10,00",390],["20,00",500])],
  // «Unid.» antes que la cantidad: sin la regla se tomaba «UD» (o «1») por la cantidad.
  [fila(200,["CÓDIGO",60],["DESCRIPCIÓN",130],["UNID.",300],["CANT.",340],["PRECIO",390],["IMPORTE",500]),fila(222,["4300099900",60],["CODO",130],["UD",305],["2,00",340],["10,00",390],["20,00",500])],
  [fila(200,["CÓDIGO",60],["DESCRIPCIÓN",130],["UNID.",300],["CANTIDAD",340],["PRECIO",390],["IMPORTE",500]),fila(222,["4300099900",60],["CODO",130],["1",305],["2,00",340],["10,00",390],["20,00",500])]];
 for(const [tit,cel] of casos){
  const r=leerPagina(pagina([...cabeceraDoc(),...etiquetas(),...tit,...cel]));
  assert.equal(r.lineas.length,1);
  assert.deepEqual([r.lineas[0].cantidad.valor,r.lineas[0].precio.valor,r.lineas[0].cuadre.estado],[2,10,"VERIFICADO"]);
 }
});

test("«Unid.» como única columna de cantidad con la unidad escrita («UD»): sin cantidad, nunca una inventada",()=>{
 const tit=fila(200,["CÓDIGO",60],["DESCRIPCIÓN",130],["UNID.",340],["PRECIO",390],["IMPORTE",500]);
 const r=leerPagina(pagina([...cabeceraDoc(),...etiquetas(),...tit,...fila(222,["4300099900",60],["CODO",130],["UD",345],["10,00",390],["20,00",500])]));
 for(const l of r.lineas)assert.equal(l.cantidad.valor,null);
 assert.notEqual(r.estado,"AUTO_OK");
});

/* ---- Cifras sin coma que cuadran igual (fallo real 2026-11-24: «37,50» y «0,75» leídos «3750» y «075» en la misma fila) ---- */
const titulosCuadre=()=>fila(200,["CONCEPTO",130],["CANTIDAD",330],["PRECIO",390],["IMPORTE",500]);
const lineaCifras=(cant,precio,importe)=>fila(222,["PAPEL",130],["Y",162],["CARTON",172],[cant,335],[precio,390],[importe,505]);
test("precio e importe sin coma que cuadran también con ella: dos lecturas, ninguna se acepta (ni se «repara»)",()=>{
 for(const [cant,precio,importe,otra] of [["0,020","3750","075",/«3750» o «37,50», «075» o «0,75»/],["0,2","3750","750",/«3750» o «[0-9,]+», «750» o «[0-9,]+»/],["3","150","450",/«150» o «1,50», «450» o «4,50»/]]){
  const r=leerPagina(pagina([...cabeceraDoc(),...etiquetas(),...titulosCuadre(),...lineaCifras(cant,precio,importe)]));
  const l=r.lineas[0];
  assert.equal(l.cuadre.estado,"AMBIGUO",precio);
  assert.match(l.cuadre.detalle,otra);
  for(const k of ["precio","importe"]){assert.notEqual(l[k].estado,"VERIFICADO",k);assert.ok(!(l[k].confianza>=0.9),k+" "+l[k].confianza);}
  assert.equal(l.estado,"REVISAR");
  assert.ok(l.motivos.some(m=>/Cuadre con dos lecturas posibles/.test(m)));
 }
 // Con la coma leída, una sola lectura: se acepta como siempre.
 const bien=leerPagina(pagina([...cabeceraDoc(),...etiquetas(),...titulosCuadre(),...lineaCifras("0,020","37,50","0,75")])).lineas[0];
 assert.deepEqual([bien.cuadre.estado,bien.precio.valor,bien.importe.valor,bien.precio.estado],["VERIFICADO",37.5,0.75,"VERIFICADO"]);
});
test("escaneado: si una lectura pierde las comas y otra no, quedan las cifras de la que cuadra sin ambigüedad",async()=>{
 const conComas=[...cabeceraDoc(),...etiquetas(),...titulosCuadre(),...lineaCifras("0,020","37,50","0,75")];
 const sinComas=[...cabeceraDoc(),...etiquetas(),...titulosCuadre(),...lineaCifras("0,020","3750","075")];
 for(const malPsm of [4,6]){
  const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
   async ocr({psm=4,region=null}={}){
    const ps=psm===malPsm?sinComas:conComas;
    if(!region)return ps;
    const [x,y,ww,h]=region;
    return ps.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
   }}];
  const r=await extraerEscaneado(motor,{registro:registroCon(),hoy:HOY});
  assert.equal(r.lineas.length,1,"psm "+malPsm);
  const l=r.lineas[0];
  assert.ok(!(l.precio.valor===3750&&l.precio.confianza>=0.9),"nunca 3750 aceptado (psm "+malPsm+")");
  assert.deepEqual([l.precio.valor,l.importe.valor,l.cuadre.estado],[37.5,0.75,"VERIFICADO"],"psm "+malPsm);
 }
});
