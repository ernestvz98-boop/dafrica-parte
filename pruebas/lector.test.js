"use strict";
/*
 * Lector de PDF completos (albaranes/lector.js): separación en albaranes, albaranes de varias
 * páginas, PDF grandes, errores por página, cancelación y PDF mixtos. Datos ficticios.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {NIF,HOY,registroCon,fila,cabeceraDoc,pagina}=require("./ayudas-ocr.js");
const {leerPdf,agruparPaginas,continua}=require("../albaranes/lector.js");

const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const etiquetas=(numero,fecha="15/10/26")=>[...fila(120,["ALBARÁN",60],["Nº",105],[numero,120]),...fila(120,["FECHA",300],[fecha,340])];
const linea=(y,ref)=>fila(y,[ref,60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]);
const totales=y=>[...fila(y,["Base",60],["Imponible",82],["10,00",140]),...fila(y+12,["IVA",60],["21,00%",90],["2,10",140]),...fila(y+24,["TOTAL",380],["12,10",505])];
// Página digital (capa de texto) construida con las mismas palabras.
const digital=(palabras,n)=>({...pagina(palabras),numero:n,tipo:"DIGITAL",caracteres:500,fraccion_imagen:0});
const albaran=(numero,ref="1300000001")=>[...cabeceraDoc(),...etiquetas(numero),...titulos(),...linea(218,ref),...totales(600)];

function fuenteDe(paginas,{ocr={},fallan=new Set()}={}){
 const liberadas=[];
 return {numPaginas:paginas.length,liberadas,
  async texto(n){if(fallan.has(n))throw Error("página dañada");return paginas[n-1];},
  async ocr(n){return ocr[n];},
  liberar(n){liberadas.push(n);}};
}
const opciones={registro:registroCon({formato_numero:"^\\d{3}\\.\\d{3}$"}),hoy:HOY};

test("varios albaranes en un PDF: uno por página, separados por su número",async()=>{
 const f=fuenteDe([digital(albaran("600.111"),1),digital(albaran("600.112"),2),digital(albaran("600.113"),3)]);
 const r=await leerPdf(f,opciones);
 assert.deepEqual(r.documentos.map(d=>d.paginas),[[1],[2],[3]]);
 assert.deepEqual(r.documentos.map(d=>d.resultado.numero.valor),["600.111","600.112","600.113"]);
 assert.equal(r.resumen.documentos,3);
});

test("albarán de dos páginas («Página 1 de 2» / «2 de 2», mismo número) seguido de otro",async()=>{
 const p1=[...cabeceraDoc(),...etiquetas("600.111"),...fila(30,["Página",450],["1",490],["de",500],["2",515]),...titulos(),...linea(218,"1300000001")];
 const p2=[...cabeceraDoc(),...etiquetas("600.111"),...fila(30,["Página",450],["2",490],["de",500],["2",515]),...titulos(),...linea(218,"1300000002"),
  ...fila(600,["Base",60],["Imponible",82],["20,00",140]),...fila(612,["IVA",60],["21,00%",90],["4,20",140]),...fila(624,["TOTAL",380],["24,20",505])];
 const f=fuenteDe([digital(p1,1),digital(p2,2),digital(albaran("600.120"),3)]);
 const r=await leerPdf(f,opciones);
 assert.deepEqual(r.documentos.map(d=>d.paginas),[[1,2],[3]]);
 assert.equal(r.documentos[0].resultado.lineas.length,2);
 assert.equal(r.documentos[0].resultado.totales.validacion.estado,"OK");
});

test("página sin cabecera propia tras una sin totales: continúa el albarán; con totales, no se une",()=>{
 const abierta={nif:NIF,numero:"600111",pagina:null,sigue:false,totales:false,vacia:false};
 const sinCabecera={nif:null,numero:null,pagina:null,sigue:false,totales:true,vacia:false};
 assert.equal(continua(abierta,abierta,sinCabecera),true);
 assert.equal(continua(abierta,{...abierta,totales:true},sinCabecera),false);
 // Otro proveedor u otro número: albarán nuevo aunque falten totales.
 assert.equal(continua(abierta,abierta,{...sinCabecera,nif:"B24999999"}),false);
 assert.equal(continua(abierta,abierta,{...sinCabecera,nif:NIF,numero:"600112"}),false);
 assert.equal(agruparPaginas([{n:1,firma:abierta},{n:2,firma:sinCabecera},{n:3,firma:{...abierta,numero:"600112"}}]).length,2);
});

test("una página ilegible se registra como error y el resto del PDF se procesa",async()=>{
 const f=fuenteDe([digital(albaran("600.111"),1),digital(albaran("600.112"),2),digital(albaran("600.113"),3)],{fallan:new Set([2])});
 const r=await leerPdf(f,opciones);
 // La página dañada queda como ERROR_DOCUMENTO en su posición: ninguna página se pierde.
 assert.deepEqual(r.documentos.map(d=>d.paginas),[[1],[2],[3]]);
 assert.deepEqual(r.documentos.map(d=>d.estado_documento),["AUTO_OK","ERROR_DOCUMENTO","AUTO_OK"]);
 assert.deepEqual(r.errores.map(e=>e.paginas),[[2]]);
 assert.match(r.errores[0].error,/dañada/);
 assert.equal(r.resumen.error_documento,1);assert.equal(r.resumen.paginas_completas,true);
});

test("PDF grande (120 páginas): se procesa por bloques, informa del avance y libera cada página",async()=>{
 const paginas=Array.from({length:120},(_,i)=>digital(albaran("6"+String(i).padStart(2,"0")+".111"),i+1));
 const f=fuenteDe(paginas),eventos=[];
 const r=await leerPdf(f,{...opciones,tamLote:10,alProgresar:e=>eventos.push(e)});
 assert.equal(r.documentos.length,120);
 assert.equal(r.errores.length,0);
 // Sin pérdidas, duplicados ni desorden entre bloques.
 assert.equal(r.resumen.paginas_completas,true);
 assert.deepEqual(r.documentos.map(d=>d.resultado.numero.valor),paginas.map((_,i)=>"6"+String(i).padStart(2,"0")+".111"));
 assert.equal(eventos.filter(e=>e.fase==="lote").length,12);
 assert.equal(eventos.at(-1).fase,"fin");
 assert.deepEqual([...new Set(f.liberadas)].sort((a,b)=>a-b),paginas.map(p=>p.numero));
});

test("cancelar detiene la lectura y conserva los albaranes ya leídos",async()=>{
 const paginas=Array.from({length:10},(_,i)=>digital(albaran("6"+String(i).padStart(2,"0")+".111"),i+1));
 let leidas=0;
 const f=fuenteDe(paginas);
 const r=await leerPdf(f,{...opciones,alProgresar:e=>{if(e.fase==="pagina")leidas++;},cancelado:()=>leidas>=4});
 assert.equal(r.documentos.length,4);
 assert.deepEqual(r.resumen.paginas_no_procesadas,[5,6,7,8,9,10]);
});

test("estado de cada albarán: AUTO_OK, REVISAR o ERROR_DOCUMENTO (nada reconocible)",()=>{
 const {estadoDocumento}=require("../albaranes/lector.js");
 assert.equal(estadoDocumento({estado:"AUTO_OK",lineas:[{}]}),"AUTO_OK");
 assert.equal(estadoDocumento({estado:"REVISAR",lineas:[{}],numero:{valor:"1"}}),"REVISAR");
 assert.equal(estadoDocumento({estado:"REVISAR",lineas:[],numero:{valor:null},proveedor:{nif:null}}),"ERROR_DOCUMENTO");
 assert.equal(estadoDocumento({estado:"NO_DIGITAL"}),"ERROR_DOCUMENTO");
 assert.equal(estadoDocumento(null),"ERROR_DOCUMENTO");
});

test("PDF mixto: la página sin capa de texto se lee por OCR y la digital por su texto",async()=>{
 const escaneada=albaran("600.200");
 const motor={numero:2,anchoPx:595,altoPx:842,dpi:72,async ocr({region=null}={}){
  if(!region)return escaneada;
  const [x,y,ww,h]=region;
  return escaneada.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
 }};
 const f=fuenteDe([digital(albaran("600.111"),1),{numero:2,tipo:"ESCANEADO",caracteres:0,fraccion_imagen:1,lineas:[]}],{ocr:{2:motor}});
 const r=await leerPdf(f,opciones);
 assert.deepEqual(r.documentos.map(d=>d.resultado.tipo_pdf),["DIGITAL","ESCANEADO_OCR"]);
 assert.equal(r.documentos[1].resultado.numero.valor,"600.200");
});

test("continuación con la misma cabecera de proveedor, «Página 2» sin «de N» y «SUMA Y SIGUE» en la anterior",()=>{
 const p1={nif:NIF,numero:"4500777000",pagina:null,sigue:true,totales:false,vacia:false};
 const p2={nif:NIF,numero:null,pagina:{k:2,n:null},sigue:false,totales:true,vacia:false};
 assert.equal(continua(p1,p1,p2),true);
 // Solo «SUMA Y SIGUE» (sin «Página 2»): también continúa.
 assert.equal(continua(p1,p1,{...p2,pagina:null}),true);
 // Albarán sin totales del mismo proveedor, sin número legible ni aviso de continuación: no se une.
 assert.equal(continua({...p1,sigue:false},{...p1,sigue:false},{...p2,pagina:null}),false);
 // «Pág: 1» abre siempre un albarán nuevo.
 assert.equal(continua(p1,p1,{...p2,pagina:{k:1,n:null}}),false);
});

test("página escaneada en blanco: se adjunta al albarán anterior y se informa; con tinta pero ilegible: ERROR_DOCUMENTO propio",async()=>{
 const gris=oscuros=>async()=>{const d=new Uint8Array(100*100).fill(255);for(let i=0;i<oscuros;i++)d[i*7]=0;return {ancho:100,alto:100,datos:d,dpi:75};};
 const escaneada=(n,oscuros)=>({numero:n,anchoPx:595,altoPx:842,dpi:72,gris:gris(oscuros),async ocr(){return [];}});
 const vacia=n=>({numero:n,tipo:"ESCANEADO",caracteres:0,fraccion_imagen:1,lineas:[]});
 const sinTotales=[...cabeceraDoc(),...etiquetas("600.111"),...titulos(),...linea(218,"1300000001")];
 const f=fuenteDe([digital(sinTotales,1),vacia(2),vacia(3),digital(albaran("600.112"),4)],{ocr:{2:escaneada(2,0),3:escaneada(3,900)}});
 const r=await leerPdf(f,opciones);
 assert.deepEqual(r.documentos.map(d=>d.paginas),[[1,2],[3],[4]]);
 assert.deepEqual(r.documentos[0].paginas_en_blanco,[2]);
 assert.equal(r.documentos[1].estado_documento,"ERROR_DOCUMENTO");
 assert.deepEqual(r.resumen.paginas_en_blanco,[2]);assert.equal(r.resumen.paginas_completas,true);
});
