"use strict";
/*
 * Corpus SINTÉTICO de albaranes digitales para pruebas automáticas.
 * Los PDF se generan al ejecutar las pruebas (no se guardan en el repositorio).
 * Empresas y NIF son FICTICIOS (dígitos de control válidos, comprobados aparte);
 * reproducen las situaciones vistas en la auditoría: descuentos en cascada,
 * descripciones en dos renglones, códigos con forma decimal, anotaciones de
 * recogida, el NIF de DAFRICA como destinatario, cantidades ambiguas, etc.
 */
const {PDFDocument,StandardFonts,rgb}=require("pdf-lib");
const zlib=require("zlib");

const NIF={A:"B24123457",PROPIO:"B24000002",B:"B24555559",C:"A24777773",D:"B33123456"};

// Registro de pruebas: mismo formato que albaranes/proveedores.js.
const REGISTRO={
 empresa_propia:{nombres:["DAFRICA BIERZO","DAFRICA"],nifs:[]},
 proveedores:[
  {id:"PROV_A",nombre:"SUMINISTROS NORTE FICTICIOS, S.L.",nifs:[NIF.A],formato_numeros:"es",formato_confirmado:false},
  {id:"PROV_B",nombre:"FERRETERIA DEL SIL FICTICIA, S.L.",nifs:[NIF.B],formato_numeros:"es",formato_confirmado:false,
   anotaciones_no_articulo:["RETIRADO POR","RECOGIDO POR"]},
  {id:"PROV_C",nombre:"MADERAS FICTICIAS DEL BIERZO, S.L.U.",nifs:[NIF.C],formato_numeros:"es",formato_confirmado:false,
   permite_sin_referencia:true}
 ]
};
const HOY="2026-10-19";

/* ------------------------------ Dibujo de PDF ------------------------------ */
async function nuevo(){
 const pdf=await PDFDocument.create();
 const fuente=await pdf.embedFont(StandardFonts.Helvetica);
 const negrita=await pdf.embedFont(StandardFonts.HelveticaBold);
 return {pdf,fuente,negrita};
}
function pagina(ctx){
 const p=ctx.pdf.addPage([595,842]);
 // y se expresa desde ARRIBA para que los diseños sean legibles.
 const t=(texto,x,y,o={})=>{
  const f=o.negrita?ctx.negrita:ctx.fuente,size=o.size||9;
  const ancho=f.widthOfTextAtSize(texto,size);
  const xx=o.derecha?x-ancho:x;
  p.drawText(texto,{x:xx,y:842-y,size,font:f,color:rgb(0,0,0)});
 };
 const linea=(y)=>p.drawLine({start:{x:30,y:842-y},end:{x:565,y:842-y},thickness:0.5});
 return {p,t,linea};
}
/*
 * Tabla genérica. cols: [{titulo,x,derecha}] ; filas: [[celdas...]] con "" para vacío.
 * Una celda puede ser {texto, extra:"segundo renglón"} para descripciones largas.
 */
function tabla(pg,cols,filas,y0,paso=16){
 cols.forEach(c=>pg.t(c.titulo,c.x,y0,{negrita:true,derecha:c.derecha}));
 pg.linea(y0+5);
 let y=y0+paso+2;
 for(const fila of filas){
  let extra=null;
  fila.forEach((celda,i)=>{
   const texto=typeof celda==="object"?celda.texto:celda;
   if(typeof celda==="object"&&celda.extra)extra={texto:celda.extra,x:cols[i].x};
   if(texto)pg.t(texto,cols[i].x,y,{derecha:cols[i].derecha});
  });
  if(extra){y+=11;pg.t(extra.texto,extra.x,y);}
  y+=paso;
 }
 pg.linea(y-paso+6);
 return y;
}
function cabeceraProveedor(pg,nombre,nif,direccion="C/ Ficticia 1, 24400 Ponferrada (León)"){
 pg.t(nombre,40,50,{negrita:true,size:12});
 pg.t(direccion,40,64);
 pg.t("CIF: "+nif,40,76);
}
function recuadroCliente(pg,titulo="CLIENTE",nif=NIF.PROPIO){
 pg.t(titulo,330,50,{negrita:true});
 pg.t("DAFRICA BIERZO, S.L.",330,64);
 pg.t("Avda. Inventada 10, 24400 Ponferrada",330,76);
 pg.t("NIF: "+nif,330,88);
}
// PNG blanco 1x1 (para simular un escaneo a página completa).
function pngBlanco(){
 const crc=(buf)=>{let c,crc=0xffffffff;for(const b of buf){c=(crc^b)&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;};
 const trozo=(tipo,datos)=>{const l=Buffer.alloc(4);l.writeUInt32BE(datos.length);const td=Buffer.concat([Buffer.from(tipo),datos]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ihdr=Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]);
 const idat=zlib.deflateSync(Buffer.from([0,255,255,255]));
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),trozo("IHDR",ihdr),trozo("IDAT",idat),trozo("IEND",Buffer.alloc(0))]);
}

/* ------------------------------- Documentos -------------------------------- */
const COLS_A=[{titulo:"REFERENCIA",x:40},{titulo:"DESCRIPCIÓN",x:115},{titulo:"CANTIDAD",x:345,derecha:true},
 {titulo:"UD",x:360},{titulo:"PRECIO",x:430,derecha:true},{titulo:"DTO",x:475,derecha:true},{titulo:"IMPORTE",x:550,derecha:true}];

const DOCUMENTOS=[
 {
  id:"S01-cascada-dos-renglones",
  descripcion:"Proveedor registrado, descuento 20+5, descripción en dos renglones, miles 1.500,00, NIF de DAFRICA en el recuadro del cliente",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"SUMINISTROS NORTE FICTICIOS, S.L.",NIF.A);recuadroCliente(pg);
   pg.t("ALBARÁN DE ENTREGA",40,120,{negrita:true,size:12});
   pg.t("Nº Albarán: 4500123456",40,140);pg.t("Fecha: 15/10/2026",250,140);pg.t("Nº Cliente: 430012",420,140);
   const y=tabla(pg,COLS_A,[
    ["0001230045","TUBO PVC EVAC. Ø32 MM 3M","8,00","UD","3,4500","20+5","20,98"],
    ["0009876500","CODO 87º PVC Ø32","12,00","UD","0,8900","20","8,54"],
    ["7701002003",{texto:"CABLE RZ1-K 0,6/1KV 3G2,5 MM2",extra:"BOBINA 100 M"},"100,00","M","1,2350","","123,50"],
    ["0000000007","MANGUITO UNIÓN Ø32","1.500,00","UD","0,1200","10","162,00"],
    ["4400123123","ABRAZADERA ISOFÓNICA M8","2,00","UD","15,0000","","30,00"]
   ],180);
   pg.t("BASE IMPONIBLE",380,y+20,{negrita:true});pg.t("345,02",550,y+20,{derecha:true});
   pg.t("Total líneas: 5",40,y+20);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"4500123456",fecha:"2026-10-15",
   lineas:[
    {referencia:"0001230045",descripcion:"TUBO PVC EVAC. Ø32 MM 3M",cantidad:8,precio:3.45,descuento:[20,5],importe:20.98},
    {referencia:"0009876500",descripcion:"CODO 87º PVC Ø32",cantidad:12,precio:0.89,descuento:[20],importe:8.54},
    {referencia:"7701002003",descripcion:"CABLE RZ1-K 0,6/1KV 3G2,5 MM2 BOBINA 100 M",cantidad:100,precio:1.235,descuento:null,importe:123.5},
    {referencia:"0000000007",descripcion:"MANGUITO UNIÓN Ø32",cantidad:1500,precio:0.12,descuento:[10],importe:162},
    {referencia:"4400123123",descripcion:"ABRAZADERA ISOFÓNICA M8",cantidad:2,precio:15,descuento:null,importe:30}
   ],marcados:[]}
 },
 {
  id:"S02-subtotal-anotacion-recogida",
  descripcion:"Columnas ARTÍCULO/SUBTOTAL/TOTAL, número y fecha en tabla de cabecera, fecha con año de dos cifras, fila «RETIRADO POR» con cantidad",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"FERRETERÍA DEL SIL FICTICIA, S.L.",NIF.B,"Pol. Ind. Inventado, nave 3, 24400 Ponferrada");
   recuadroCliente(pg,"DESTINATARIO");
   pg.t("ALBARÁN Nº",40,125,{negrita:true});pg.t("FECHA",150,125,{negrita:true});pg.t("CÓD. CLIENTE",260,125,{negrita:true});
   pg.t("003424",40,139);pg.t("17-10-26",150,139);pg.t("4300",260,139);
   const y=tabla(pg,[{titulo:"ARTÍCULO",x:40},{titulo:"DESCRIPCIÓN",x:100},{titulo:"CANTIDAD",x:290,derecha:true},
    {titulo:"PRECIO UNIDAD",x:390,derecha:true},{titulo:"SUBTOTAL",x:445,derecha:true},{titulo:"DTO",x:485,derecha:true},{titulo:"TOTAL",x:550,derecha:true}],[
    ["104578","BROCA SDS PLUS 10X160","3","4,95","14,85","10,00","13,37"],
    ["RETIRADO POR: PEDRO G.","","1","","","",""],
    ["200011","GUANTE NITRILO T9","12","1,10","13,20","","13,20"]
   ],175);
   pg.t("TOTAL ALBARÁN",380,y+20,{negrita:true});pg.t("26,57",550,y+20,{derecha:true});
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.B,numero:"003424",fecha:"2026-10-17",
   lineas:[
    {referencia:"104578",descripcion:"BROCA SDS PLUS 10X160",cantidad:3,precio:4.95,descuento:[10],importe:13.37},
    {referencia:"200011",descripcion:"GUANTE NITRILO T9",cantidad:12,precio:1.1,descuento:null,importe:13.2}
   ],marcados:[]}
 },
 {
  id:"S03-codigo-con-forma-decimal",
  descripcion:"Código impreso 8.286,0800 que NO es un precio, cantidades con 4 decimales, fecha en texto, línea sin código",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"MADERAS FICTICIAS DEL BIERZO, S.L.U.",NIF.C);recuadroCliente(pg);
   pg.t("Albarán:",40,125,{negrita:true});pg.t("26/012345",85,125);
   pg.t("Fecha:",250,125,{negrita:true});pg.t("16 de octubre de 2026",285,125);
   tabla(pg,[{titulo:"CÓDIGO",x:40},{titulo:"DESCRIPCIÓN",x:110},{titulo:"CANTIDAD",x:360,derecha:true},
    {titulo:"PRECIO",x:430,derecha:true},{titulo:"DTO.",x:480,derecha:true},{titulo:"IMPORTE",x:550,derecha:true}],[
    ["8.286,0800","TABLERO OSB 3 18MM 2500X1250","4,0000","21,5000","20,00","68,80"],
    ["","LISTÓN PINO 45X45 2,5M","10,0000","3,2000","","32,00"]
   ],170);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.C,numero:"26/012345",fecha:"2026-10-16",
   lineas:[
    {referencia:"8.286,0800",descripcion:"TABLERO OSB 3 18MM 2500X1250",cantidad:4,precio:21.5,descuento:[20],importe:68.8},
    {referencia:null,descripcion:"LISTÓN PINO 45X45 2,5M",cantidad:10,precio:3.2,descuento:null,importe:32}
   ],marcados:[]}
 },
 {
  id:"S04-sin-precios-cantidad-ambigua",
  descripcion:"Proveedor no registrado, albarán sin precios, «1.000» sin pruebas del formato numérico",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"TORNILLERÍA INVENTADA, S.L.",NIF.D,"C/ Imaginaria 7, 33001 Oviedo");recuadroCliente(pg);
   pg.t("Albarán nº 77812",40,125);pg.t("Fecha 18/10/2026",250,125);
   tabla(pg,[{titulo:"REF.",x:40},{titulo:"CONCEPTO",x:120},{titulo:"CANT.",x:420,derecha:true}],[
    ["A-100","TORNILLO 4X40 ZINCADO","1.000"],["A-200","TACO NYLON 6MM","5"],["A-300","ARANDELA M6","12"]
   ],170);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"REVISAR",tipo_pdf:"DIGITAL",proveedor_nif:NIF.D,numero:"77812",fecha:"2026-10-18",
   lineas:[
    {referencia:"A-100",descripcion:"TORNILLO 4X40 ZINCADO",cantidad:1000,precio:null,descuento:null,importe:null},
    {referencia:"A-200",descripcion:"TACO NYLON 6MM",cantidad:5,precio:null,descuento:null,importe:null},
    {referencia:"A-300",descripcion:"ARANDELA M6",cantidad:12,precio:null,descuento:null,importe:null}
   ],marcados:["lineas.1.cantidad"]}
 },
 {
  id:"S05-descuadre-precio-por-100-sin-fecha",
  descripcion:"Importe que no cuadra, precio expresado por 100 unidades sin indicarlo, fecha ausente",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"SUMINISTROS NORTE FICTICIOS, S.L.",NIF.A);recuadroCliente(pg);
   pg.t("Nº Albarán: 4500999001",40,125);
   tabla(pg,COLS_A,[
    ["X0000001","ARTÍCULO DE PRUEBA 1","2,00","UD","10,00","","25,00"],
    ["X0000002","ARTÍCULO DE PRUEBA 2","3,00","UD","5,00","10","13,50"],
    ["X0000003","ARANDELA PLANA M8 (CAJA)","200,00","UD","4,5000","","9,00"]
   ],170);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"REVISAR",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"4500999001",fecha:null,
   lineas:[
    {referencia:"X0000001",descripcion:"ARTÍCULO DE PRUEBA 1",cantidad:2,precio:10,descuento:null,importe:25},
    {referencia:"X0000002",descripcion:"ARTÍCULO DE PRUEBA 2",cantidad:3,precio:5,descuento:[10],importe:13.5},
    {referencia:"X0000003",descripcion:"ARANDELA PLANA M8 (CAJA)",cantidad:200,precio:4.5,descuento:null,importe:9}
   ],
   // Los valores impresos se leen bien, pero el descuadre debe obligar a revisarlos.
   marcados:["cabecera.fecha","lineas.1.importe","lineas.1.cantidad","lineas.1.precio","lineas.3.importe","lineas.3.cantidad","lineas.3.precio"]}
 },
 {
  id:"S06-solo-nif-dafrica",
  descripcion:"El emisor no imprime su NIF: solo aparece el de DAFRICA como destinatario. No debe tomarse como proveedor",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   pg.t("ALMACENES SIN NIF VISIBLE",40,50,{negrita:true,size:12});pg.t("Teléfono 987 000 000",40,64);
   recuadroCliente(pg,"DESTINATARIO");
   pg.t("Nº Albarán: 9001",40,125);pg.t("Fecha: 14/10/2026",250,125);
   tabla(pg,[{titulo:"REFERENCIA",x:40},{titulo:"DESCRIPCIÓN",x:120},{titulo:"CANTIDAD",x:420,derecha:true}],[
    ["Z-1","SACO CEMENTO 25 KG","10"]
   ],170);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"REVISAR",tipo_pdf:"DIGITAL",proveedor_nif:null,numero:"9001",fecha:"2026-10-14",
   lineas:[{referencia:"Z-1",descripcion:"SACO CEMENTO 25 KG",cantidad:10,precio:null,descuento:null,importe:null}],
   marcados:["cabecera.proveedor_nif"]}
 },
 {
  id:"S07-multipagina",
  descripcion:"Tabla en dos páginas con cabecera repetida y «SUMA Y SIGUE»; total de líneas y base en la última",
  async construir(){
   const ctx=await nuevo();
   const p1=pagina(ctx);
   cabeceraProveedor(p1,"SUMINISTROS NORTE FICTICIOS, S.L.",NIF.A);recuadroCliente(p1);
   p1.t("Nº Albarán: 4500777000",40,125);p1.t("Fecha: 13/10/2026",250,125);
   let y=tabla(p1,COLS_A,[
    ["0000000101","ARTÍCULO UNO","1,00","UD","10,0000","","10,00"],
    ["0000000102","ARTÍCULO DOS","2,00","UD","10,0000","50","10,00"],
    ["0000000103","ARTÍCULO TRES","3,00","UD","1,0000","","3,00"]
   ],170);
   p1.t("SUMA Y SIGUE",380,y+20,{negrita:true});p1.t("23,00",550,y+20,{derecha:true});
   const p2=pagina(ctx);
   p2.t("SUMINISTROS NORTE FICTICIOS, S.L. · Albarán 4500777000 · Página 2",40,50);
   y=tabla(p2,COLS_A,[
    ["0000000104","ARTÍCULO CUATRO","4,00","UD","2,5000","","10,00"],
    ["0000000105","ARTÍCULO CINCO","5,00","UD","2,0000","10","9,00"]
   ],90);
   p2.t("Total líneas: 5",40,y+20);
   p2.t("BASE IMPONIBLE",380,y+20,{negrita:true});p2.t("42,00",550,y+20,{derecha:true});
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"4500777000",fecha:"2026-10-13",
   lineas:[
    {referencia:"0000000101",descripcion:"ARTÍCULO UNO",cantidad:1,precio:10,descuento:null,importe:10},
    {referencia:"0000000102",descripcion:"ARTÍCULO DOS",cantidad:2,precio:10,descuento:[50],importe:10},
    {referencia:"0000000103",descripcion:"ARTÍCULO TRES",cantidad:3,precio:1,descuento:null,importe:3},
    {referencia:"0000000104",descripcion:"ARTÍCULO CUATRO",cantidad:4,precio:2.5,descuento:null,importe:10},
    {referencia:"0000000105",descripcion:"ARTÍCULO CINCO",cantidad:5,precio:2,descuento:[10],importe:9}
   ],marcados:[]}
 },
 {
  id:"S09-texto-caracter-a-caracter",
  descripcion:"El PDF posiciona cada carácter por separado (habitual en algunos ERP); títulos abreviados Cód./Artículo/Uds./P.V.P./% Dto/Neto",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   // Cada carácter es un objeto de texto independiente.
   const letras=(texto,x,y,o={})=>{
    const f=o.negrita?ctx.negrita:ctx.fuente,size=o.size||9;
    let xx=o.derecha?x-f.widthOfTextAtSize(texto,size):x;
    for(const ch of texto){if(ch!==" ")pg.t(ch,xx,y,{...o,derecha:false});xx+=f.widthOfTextAtSize(ch,size);}
   };
   letras("SUMINISTROS NORTE FICTICIOS, S.L.",40,50,{negrita:true,size:12});letras("CIF: "+NIF.A,40,64);
   letras("CLIENTE",330,50,{negrita:true});letras("DAFRICA BIERZO, S.L.",330,64);letras("NIF: "+NIF.PROPIO,330,76);
   letras("Albarán nº.",40,120);letras("4500888111",95,120);letras("Fecha albarán:",250,120);letras("09/10/2026",320,120);
   const cols=[["Cód.",40],["Artículo",110],["Uds.",330,1],["P.V.P.",400,1],["% Dto",450,1],["Neto",550,1]];
   for(const [t,x,d] of cols)letras(t,x,165,{negrita:true,derecha:!!d});
   const filas=[["CX-0045","PERFIL OMEGA GALVANIZADO 3M","25","2,10","15","44,63"],
    ["CX-0046","TORNILLO AUTOTALADRANTE 4,2X13","500","0,0300","","15,00"]];
   filas.forEach((f,i)=>f.forEach((t,j)=>{if(t)letras(t,cols[j][1],185+16*i,{derecha:!!cols[j][2]});}));
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"4500888111",fecha:"2026-10-09",
   lineas:[
    {referencia:"CX-0045",descripcion:"PERFIL OMEGA GALVANIZADO 3M",cantidad:25,precio:2.1,descuento:[15],importe:44.63},
    {referencia:"CX-0046",descripcion:"TORNILLO AUTOTALADRANTE 4,2X13",cantidad:500,precio:0.03,descuento:null,importe:15}
   ],marcados:[]}
 },
 {
  id:"S10-dos-nif-de-terceros",
  descripcion:"NIF del emisor (no registrado) en el encabezado y NIF de la agencia de transporte (sí registrada) en el pie: el transportista no debe tomarse como emisor",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"TORNILLERÍA INVENTADA, S.L.",NIF.D,"C/ Imaginaria 7, 33001 Oviedo");recuadroCliente(pg);
   pg.t("Nº Albarán: 55001",40,125);pg.t("Fecha: 10/10/2026",250,125);
   const y=tabla(pg,[{titulo:"REFERENCIA",x:40},{titulo:"DESCRIPCIÓN",x:120},{titulo:"CANTIDAD",x:420,derecha:true}],[
    ["T-9","TUERCA M10","40"]],170);
   pg.t("Transporte: AGENCIA DE PORTES FICTICIA, S.L. · CIF "+NIF.C,40,y+40);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"REVISAR",tipo_pdf:"DIGITAL",proveedor_nif:NIF.D,numero:"55001",fecha:"2026-10-10",
   lineas:[{referencia:"T-9",descripcion:"TUERCA M10",cantidad:40,precio:null,descuento:null,importe:null}],
   marcados:[]}
 },
 {
  id:"S11-fecha-sin-etiqueta-fila-sin-cantidad-portes",
  descripcion:"Única fecha sin etiqueta (se propone, no se acepta), artículo con referencia pero sin cantidad, descuento sobre precio neto redondeado, línea de PORTES",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"SUMINISTROS NORTE FICTICIOS, S.L.",NIF.A);recuadroCliente(pg);
   pg.t("Nº Albarán: 4500111222",40,125);pg.t("12/10/2026",420,125);
   tabla(pg,COLS_A,[
    ["0000000201","ARTÍCULO SIN CANTIDAD","","UD","","",""],
    ["0000000202","TORNILLERÍA A GRANEL","1.000,00","UD","3,4567","20","2.765,40"],
    ["PORTES","PORTES ENVÍO","1,00","UD","12,00","","12,00"]
   ],170);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"REVISAR",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"4500111222",fecha:"2026-10-12",
   lineas:[
    {referencia:"0000000201",descripcion:"ARTÍCULO SIN CANTIDAD",cantidad:null,precio:null,descuento:null,importe:null},
    {referencia:"0000000202",descripcion:"TORNILLERÍA A GRANEL",cantidad:1000,precio:3.4567,descuento:[20],importe:2765.4},
    {referencia:"PORTES",descripcion:"PORTES ENVÍO",cantidad:1,precio:12,descuento:null,importe:12}
   ],marcados:["cabecera.fecha","lineas.1.cantidad"]}
 },
 {
  id:"S12-hueco-vertical-en-tabla",
  descripcion:"Un artículo aparece muy separado del resto sin rótulo de pie: no puede perderse en silencio",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"SUMINISTROS NORTE FICTICIOS, S.L.",NIF.A);recuadroCliente(pg);
   pg.t("Nº Albarán: 4500333444",40,125);pg.t("Fecha: 11/10/2026",250,125);
   tabla(pg,COLS_A,[
    ["0000000301","ARTÍCULO A","1,00","UD","5,00","","5,00"],
    ["0000000302","ARTÍCULO B","2,00","UD","5,00","","10,00"]
   ],170);
   pg.t("0000000303",40,290);pg.t("ARTÍCULO C",115,290);pg.t("3,00",345,290,{derecha:true});
   pg.t("5,00",430,290,{derecha:true});pg.t("15,00",550,290,{derecha:true});
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"REVISAR",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"4500333444",fecha:"2026-10-11",
   lineas:[
    {referencia:"0000000301",descripcion:"ARTÍCULO A",cantidad:1,precio:5,descuento:null,importe:5},
    {referencia:"0000000302",descripcion:"ARTÍCULO B",cantidad:2,precio:5,descuento:null,importe:10},
    {referencia:"0000000303",descripcion:"ARTÍCULO C",cantidad:3,precio:5,descuento:null,importe:15}
   ],
   // Aceptable solo porque el documento queda bloqueado (validación fin_de_tabla).
   perdidas_permitidas:[3],marcados:[]}
 },
 {
  id:"S13-dos-descuentos-columnas-ajenas",
  descripcion:"Columnas Dto 1 y Dto 2 (cascada), columnas Lote y % IVA no usadas, unidad impresa junto a la cantidad, etiqueta «Número:»",
  async construir(){
   const ctx=await nuevo(),pg=pagina(ctx);
   cabeceraProveedor(pg,"SUMINISTROS NORTE FICTICIOS, S.L.",NIF.A);recuadroCliente(pg);
   pg.t("ALBARÁN",40,110,{negrita:true,size:12});
   pg.t("Número:",40,128,{negrita:true});pg.t("2026-A-0099",85,128);pg.t("Fecha: 08/10/2026",250,128);
   tabla(pg,[{titulo:"CÓDIGO",x:40},{titulo:"DESCRIPCIÓN",x:95},{titulo:"LOTE",x:255},{titulo:"CANTIDAD",x:340,derecha:true},
    {titulo:"PRECIO",x:390,derecha:true},{titulo:"DTO 1",x:425,derecha:true},{titulo:"DTO 2",x:460,derecha:true},
    {titulo:"% IVA",x:495,derecha:true},{titulo:"IMPORTE",x:555,derecha:true}],[
    ["AB-100","BLOQUE HORMIGÓN 40X20X20","L2610","8,00 UD","1,2000","10","5","21","8,21"],
    ["AB-200","MORTERO M-7,5 SACO 25KG","","20,00 SAC","3,1000","10","","21","55,80"]
   ],170);
   return ctx.pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"2026-A-0099",fecha:"2026-10-08",
   lineas:[
    {referencia:"AB-100",descripcion:"BLOQUE HORMIGÓN 40X20X20",cantidad:8,precio:1.2,descuento:[10,5],importe:8.21},
    {referencia:"AB-200",descripcion:"MORTERO M-7,5 SACO 25KG",cantidad:20,precio:3.1,descuento:[10],importe:55.8}
   ],marcados:[]}
 },
 {
  id:"S14-erp-texto-monoespaciado",
  descripcion:"El ERP escribe la cabecera y cada fila como un único texto con espacios (fuente Courier): las columnas se reparten por posición",
  async construir(){
   const pdf=await PDFDocument.create();
   const mono=await pdf.embedFont(StandardFonts.Courier),p=pdf.addPage([595,842]);
   const t=(s,x,y,size=9)=>p.drawText(s,{x,y:842-y,size,font:mono});
   // [texto, columna de inicio (izq) o de fin (der), alineación]
   const fila=celdas=>{const c=new Array(70).fill(" ");for(const [s,pos,al] of celdas){const ini=al==="R"?pos-s.length:pos;for(let i=0;i<s.length;i++)c[ini+i]=s[i];}return c.join("").replace(/\s+$/,"");};
   t("SUMINISTROS NORTE FICTICIOS, S.L.",40,50,11);t("CIF: "+NIF.A,40,64);
   t("CLIENTE",330,50);t("DAFRICA BIERZO, S.L.",330,64);t("NIF: "+NIF.PROPIO,330,76);
   t("ALBARAN N. 7700123",40,120);t("FECHA 07/10/2026",330,120);
   t(fila([["CODIGO",0,"L"],["DESCRIPCION",10,"L"],["CANT.",46,"R"],["PRECIO",56,"R"],["IMPORTE",68,"R"]]),40,160);
   t(fila([["X-1",0,"L"],["CINTA AISLANTE 19MM",10,"L"],["10",46,"R"],["0,8500",56,"R"],["8,50",68,"R"]]),40,176);
   t(fila([["X-22",0,"L"],["BRIDA NYLON 200X4,8 (BOLSA 100)",10,"L"],["3",46,"R"],["4,1000",56,"R"],["12,30",68,"R"]]),40,192);
   return pdf.save();
  },
  esperado:{estado_documento:"AUTO_OK",tipo_pdf:"DIGITAL",proveedor_nif:NIF.A,numero:"7700123",fecha:"2026-10-07",
   lineas:[
    {referencia:"X-1",descripcion:"CINTA AISLANTE 19MM",cantidad:10,precio:0.85,descuento:null,importe:8.5},
    {referencia:"X-22",descripcion:"BRIDA NYLON 200X4,8 (BOLSA 100)",cantidad:3,precio:4.1,descuento:null,importe:12.3}
   ],marcados:[]}
 },
 {
  id:"S08-escaneado",
  descripcion:"Página que solo contiene una imagen (escaneo): no debe extraerse ningún dato",
  async construir(){
   const pdf=await PDFDocument.create();
   const img=await pdf.embedPng(pngBlanco());
   const p=pdf.addPage([595,842]);p.drawImage(img,{x:0,y:0,width:595,height:842});
   return pdf.save();
  },
  esperado:{estado_documento:"NO_DIGITAL",tipo_pdf:"ESCANEADO",proveedor_nif:null,numero:null,fecha:null,lineas:[],
   marcados:["cabecera.proveedor_nif","cabecera.numero","cabecera.fecha"]}
 }
];

module.exports={DOCUMENTOS,REGISTRO,HOY,NIF};
