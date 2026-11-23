"use strict";
/*
 * DAFRICA · Registro de proveedores identificados por NIF.
 *
 * IMPORTANTE: los NIF se rellenan copiándolos del albarán original autorizado
 * (o de la ficha del proveedor en STEL), nunca de memoria. Mientras un NIF no
 * esté registrado, el lector devuelve el NIF leído con estado
 * NIF_NO_REGISTRADO y no asigna nombre de proveedor.
 *
 * formato_numeros: "es" (1.234,56) o "en" (1,234.56). formato_confirmado=true
 * solo tras comprobarlo en documentos reales del proveedor.
 * formato_numero: expresión regular del número de albarán, tomada de sus albaranes reales.
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.proveedores=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){
const NIF=()=>req?req("./nif.js"):root.DafricaAlbaranes.nif;

/*
 * Perfiles de formato por proveedor (públicos). Los NIF reales NO están en el repositorio: cada
 * perfil guarda solo `huellas_nif` (SHA-256 del NIF normalizado, ver nif.js) para reconocer el
 * CIF leído en el documento. En pruebas, fusionar() añade los NIF en claro del registro privado
 * (pruebas/corpus-real/registro.json, fuera de git). Sin NIF ni huella, el proveedor se identifica
 * por su nombre impreso y su CIF solo se acepta si está junto a ese nombre.
 */
const REGISTRO={
 // La empresa receptora: nunca puede ser el emisor de un albarán de compra.
 // La segunda huella es de un tribunal de arbitraje citado en la letra pequeña de un proveedor: tampoco es nunca el emisor.
 empresa_propia:{nombres:["DAFRICA BIERZO","DAFRICA"],nifs:[],huellas_nif:["b34961e7941e7098c1fa1b2ccaeb123a8968344c606a5fb40039469e5dd68cbd","c8d8bd5c675f4f739e12dc325688323344871a0c8f3586519d042b72221a1d08"]},
 proveedores:[
  {id:"SALTOKI",nombre:"SALTOKI PONFERRADA, S.L.",nifs:[],huellas_nif:["9cb616254545790202aef285a434d1c5e3c171eea3234b641006a2dedd99375b"],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^\\d{3}\\.\\d{3}$",formato_referencia:"^\\d{10}$",
   // Columnas en puntos sobre una página de 595 de ancho (albaranes reales): si el OCR pierde la fila de títulos,
   // la tabla se lee con estas posiciones en vez de descartarla.
   columnas:[["referencia",55,110],["descripcion",111,415],["cantidad",416,455],["precio",456,506],["descuento",507,548],["importe",549,595]],
   // Números correlativos en el tiempo (albaranes reales de 2026: unos 300 al día, con cruces de hasta
   // ~150 entre fechas por sus distintos puestos): un número que rompe el orden de las fechas del lote en
   // más de 2.000 es una lectura dudosa (p. ej. la primera cifra mal leída).
   numeros_correlativos:{tolerancia:2000},
   // «PRENSAR Ø54X2»: el OCR lee el símbolo de diámetro como M, Y, W o «Y9».
   glifos_ocr:[["(\\bPRENSAR )(?:[MYWH]{1,2}9?)(?=\\d{2}X\\d)","$1Ø"]]},
  // Sin etiqueta junto al número. Tabla con «P.V.P.» (tarifa) y «PRECIO NETO U» (el del albarán, ya con descuento).
  {id:"MCASERO",nombre:"M.CASERO, S.A.",nombres:["MCASERO SA"],nifs:[],huellas_nif:["dbefd71a0404adeb90d637e2a79423fe4d4ef932b75d36cb37c23e03f5777f11"],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^\\d{7}-P$",numero_sin_etiqueta:true,numeros_correlativos:{tolerancia:2000},
   // Sus títulos llegan incompletos en el OCR: siempre estas columnas.
   columnas_fijas:true,columnas:[["referencia",30,100],["descripcion",101,295],["cantidad",296,372],["otra",373,435],["precio",436,498],["importe",499,590]]},
  {id:"RODAVI",nombre:"RODAVI SUMINISTROS, S.L.",nifs:[],huellas_nif:["50518a3a925c0a7a9e8ec9587574b3e58c0ed7bd7a2c2d7805c1421100d1165c"],formato_numeros:"es",formato_confirmado:true,
   // Códigos de 5 a 12 letras y cifras, con alguna cifra (2026-11-13, 3 albaranes reales: también los hay con letras, y el
   // formato de solo cifras dejaba en revisión la descripción de la línea anterior a cada uno).
   formato_numero:"^\\d{6}$",formato_referencia:"^(?=.*\\d)[0-9A-Z]{5,12}$",
   // «OBRA *** NOMBRE 1,00»: la obra va como una fila con cantidad 1 y sin precio (albarán real 2026-11-13).
   anotaciones_no_articulo:["RETIRADO POR","RECOGIDO POR","PEDIDO POR","OBRA"]},
  {id:"MADERAS_PEREIRA",nombre:"MADERAS PEREIRA REGUERAS, S.L.U.",nifs:[],huellas_nif:["9476058f5547f9a5855a6076ec17a0b6ca5200a6128ff64ac720f0df8a9cd502"],formato_numeros:"es",formato_confirmado:true,
   permite_sin_referencia:true,referencia_literal:true,formato_numero:"^\\d{2}/\\d{5}$"},
  // Número y fecha impresos sin etiqueta, juntos («L26-01234 01/10/2026»); sin precios.
  {id:"RIBEGAR",nombre:"RIBEGAR INTERIORES, S.L.U.",nifs:[],huellas_nif:["30c18fb125212caedb12099f5800d803e113a847fefba4b1a6663cf9b9f84f8f"],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^L\\d{2}-\\d{5}$",numero_sin_etiqueta:true},
  {id:"BERSUM",nombre:"FERRETERIA MARTINEZ BIERZO S.A.U.",nombres:["BERSUM SUMINISTROS INDUSTRIALES"],nifs:[],huellas_nif:["ac91a86a8e8f8beb31dc38f0d62149458f935a704dbf4846b07609969ad976c8"],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d-\\d{6}$"},
  // Talonario rellenado a mano: solo el número («SALIDA 1234») está impreso.
  {id:"FERRALLAS",nombre:"FERRALLAS Y MALLAZOS DEL BIERZO",nifs:[],huellas_nif:["076fc8b22f8ecd1c899cb919f4c44ba84a37a77d2734b63ebc6856d8d2e6877f"],formato_numeros:"es",formato_confirmado:false,
   formato_numero:"^\\d{4}$",etiqueta_numero:"SALIDA",manuscrito:true},
  {id:"ALMACENES_GALLEGO",nombre:"ALMACENES LUIS FERNANDEZ GALLEGO, S.L.",nombres:["ALMACENES GALLEGO SL"],nifs:[],huellas_nif:["df23f7997762981df4de6c82a0660224f0a4daad192c50072844e2199a4b5198"],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d{5}-[A-Za-z]$"},
  {id:"NOVELEC",nombre:"NOVELEC BIERZO, S.L.",nifs:[],huellas_nif:["aab3211b218b542e353cc80ce29589af4172621090ad23bd5e541703a246c0b8"],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^\\d{6}$"},
  // Número precedido de la serie («ALBARÁN AB26 001234»).
  {id:"DECOTAP",nombre:"CREACIONES EN PLACA DE YESO SL",nombres:["DECOTAP"],nifs:[],huellas_nif:["87752cafe4646693469e46e8d08e1adb0bed77eddee9690e78200e56cd8cd39a"],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d{6}$",
   // Código de artículo: 3 cifras y 10 letras o cifras, sin espacios (11 de 11 códigos revisados).
   formato_referencia:"^\\d{3}[A-Z0-9]{10}$"},
  // Tabla sin código: cantidad, concepto, dto., precio, importe.
  {id:"ARRIBAS",nombre:"HIJOS DE TOMAS ARRIBAS, S.L.",nombres:["HIJOSDETOMASSORRIBAS"],nifs:[],huellas_nif:["3f7cdfd390abe5ea7d63c73ee9cdeea2918b610cc0a3e4afa0c96c931a911596"],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d{4} ?/ ?\\d{4}$",permite_sin_referencia:true,sin_columna_codigo:true}
 ]
};

/* Añade al registro público los datos privados (NIF) por id de proveedor. */
function fusionar(base,privado){
 if(!privado)return base;
 const proveedores=base.proveedores.map(p=>{const x=(privado.proveedores||[]).find(q=>q.id===p.id);return x?{...p,...x}:p;});
 for(const x of privado.proveedores||[])if(!proveedores.some(p=>p.id===x.id))proveedores.push(x);
 return {empresa_propia:{...base.empresa_propia,...(privado.empresa_propia||{}),
  nombres:[...new Set([...(base.empresa_propia.nombres||[]),...(privado.empresa_propia?.nombres||[])])]},proveedores};
}

const limpio=n=>String(n||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
// ¿El NIF leído es uno de estos (en claro o por su huella)?
const coincide=(nif,{nifs=[],huellas_nif=[]}={})=>{const v=limpio(nif);return !!v&&(nifs.some(n=>limpio(n)===v)||(huellas_nif.length>0&&huellas_nif.includes(NIF().huella(v))));};
function buscarPorNif(nif,registro=REGISTRO){
 return (registro.proveedores||[]).find(p=>coincide(nif,p))||null;
}
const esPropio=(nif,registro=REGISTRO)=>coincide(nif,registro.empresa_propia||{});
const tieneIdentificador=p=>!!((p?.nifs||[]).length||(p?.huellas_nif||[]).length);

return {REGISTRO,buscarPorNif,esPropio,tieneIdentificador,fusionar};
});
