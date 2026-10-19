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
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.proveedores=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){

const REGISTRO={
 // La empresa receptora: nunca puede ser el emisor de un albarán de compra.
 empresa_propia:{
  nombres:["DAFRICA BIERZO","DAFRICA"],
  nifs:["B24694960"] // Impreso como destinatario en los albaranes de Saltoki, Rodavi y Maderas Pereira.
 },
 proveedores:[
  {id:"SALTOKI",nombre:"SALTOKI PONFERRADA, S.L.",nifs:["B24680043"],formato_numeros:"es",formato_confirmado:true},
  {id:"RODAVI",nombre:"RODAVI SUMINISTROS, S.L.",nifs:["B24557613"],formato_numeros:"es",formato_confirmado:true,
   anotaciones_no_articulo:["RETIRADO POR","RECOGIDO POR","PEDIDO POR"]},
  {id:"MADERAS_PEREIRA",nombre:"MADERAS PEREIRA REGUERAS, S.L.U.",nifs:["B24598583"],formato_numeros:"es",formato_confirmado:true,
   permite_sin_referencia:true,referencia_literal:true}
 ]
};

function buscarPorNif(nif,registro=REGISTRO){
 const v=String(nif||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 return (registro.proveedores||[]).find(p=>(p.nifs||[]).some(n=>String(n).toUpperCase().replace(/[^A-Z0-9]/g,"")===v))||null;
}

return {REGISTRO,buscarPorNif};
});
