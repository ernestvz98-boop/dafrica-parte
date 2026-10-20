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
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.proveedores=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){

/*
 * Perfiles de formato por proveedor (públicos). Los NIF reales NO están en el repositorio:
 * se añaden en tiempo de ejecución con fusionar() desde un registro privado
 * (pruebas/corpus-real/registro.json en pruebas; en producción, una fuente privada).
 * Sin NIF registrado el proveedor se identifica por su nombre impreso, con menos confianza.
 */
const REGISTRO={
 // La empresa receptora: nunca puede ser el emisor de un albarán de compra.
 empresa_propia:{nombres:["DAFRICA BIERZO","DAFRICA"],nifs:[]},
 proveedores:[
  {id:"SALTOKI",nombre:"SALTOKI PONFERRADA, S.L.",nifs:[],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^\\d{3}\\.\\d{3}$"},
  {id:"RODAVI",nombre:"RODAVI SUMINISTROS, S.L.",nifs:[],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^\\d{6}$",
   anotaciones_no_articulo:["RETIRADO POR","RECOGIDO POR","PEDIDO POR"]},
  {id:"MADERAS_PEREIRA",nombre:"MADERAS PEREIRA REGUERAS, S.L.U.",nifs:[],formato_numeros:"es",formato_confirmado:true,
   permite_sin_referencia:true,referencia_literal:true,formato_numero:"^\\d{2}/\\d{5}$"},
  // Número y fecha impresos sin etiqueta, juntos («L26-01234 01/10/2026»); sin precios.
  {id:"RIBEGAR",nombre:"RIBEGAR INTERIORES, S.L.U.",nifs:[],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^L\\d{2}-\\d{5}$",numero_sin_etiqueta:true},
  {id:"BERSUM",nombre:"FERRETERIA MARTINEZ BIERZO S.A.U.",nombres:["BERSUM SUMINISTROS INDUSTRIALES"],nifs:[],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d-\\d{6}$"},
  // Talonario rellenado a mano: solo el número («SALIDA 1234») está impreso.
  {id:"FERRALLAS",nombre:"FERRALLAS Y MALLAZOS DEL BIERZO",nifs:[],formato_numeros:"es",formato_confirmado:false,
   formato_numero:"^\\d{4}$",etiqueta_numero:"SALIDA",manuscrito:true},
  {id:"ALMACENES_GALLEGO",nombre:"ALMACENES LUIS FERNANDEZ GALLEGO, S.L.",nombres:["ALMACENES GALLEGO SL"],nifs:[],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d{5}-[A-Za-z]$"},
  {id:"NOVELEC",nombre:"NOVELEC BIERZO, S.L.",nifs:[],formato_numeros:"es",formato_confirmado:true,
   formato_numero:"^\\d{6}$"},
  // Número precedido de la serie («ALBARÁN AB26 001234»).
  {id:"DECOTAP",nombre:"CREACIONES EN PLACA DE YESO SL",nombres:["DECOTAP"],nifs:[],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d{6}$"},
  // Tabla sin código: cantidad, concepto, dto., precio, importe.
  {id:"ARRIBAS",nombre:"HIJOS DE TOMAS ARRIBAS, S.L.",nombres:["HIJOSDETOMASSORRIBAS"],nifs:[],
   formato_numeros:"es",formato_confirmado:true,formato_numero:"^\\d{4} ?/ ?\\d{4}$",permite_sin_referencia:true}
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

function buscarPorNif(nif,registro=REGISTRO){
 const v=String(nif||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 return (registro.proveedores||[]).find(p=>(p.nifs||[]).some(n=>String(n).toUpperCase().replace(/[^A-Z0-9]/g,"")===v))||null;
}

return {REGISTRO,buscarPorNif,fusionar};
});
