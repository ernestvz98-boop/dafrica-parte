"use strict";
/*
 * DAFRICA · Validación y búsqueda de NIF, NIE y CIF españoles.
 * Solo se aceptan identificadores con dígito o letra de control correctos.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.nif=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){

const LETRAS_DNI="TRWAGMYFPDXBNJZSQVHLCKE";
const normalizar=v=>String(v??"").toUpperCase().replace(/[\s.\-\/]/g,"").replace(/^ES(?=[A-Z0-9]{9}$)/,"");

function validar(entrada){
 const v=normalizar(entrada);
 if(/^\d{8}[A-Z]$/.test(v))
  return {nif:v,tipo:"NIF",valido:LETRAS_DNI[Number(v.slice(0,8))%23]===v[8]};
 if(/^[XYZ]\d{7}[A-Z]$/.test(v))
  return {nif:v,tipo:"NIE",valido:LETRAS_DNI[Number("XYZ".indexOf(v[0])+v.slice(1,8))%23]===v[8]};
 if(/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)){
  const d=v.slice(1,8).split("").map(Number);
  let suma=0;
  d.forEach((n,i)=>{
   if(i%2===1)suma+=n;
   else{const x=2*n;suma+=Math.floor(x/10)+x%10;}
  });
  const control=(10-suma%10)%10,letra="JABCDEFGHI"[control],ultimo=v[8];
  // Entidades que siempre llevan letra / siempre dígito de control.
  const valido="PQRSNW".includes(v[0])?ultimo===letra:
   "ABEH".includes(v[0])?ultimo===String(control):
   ultimo===letra||ultimo===String(control);
  return {nif:v,tipo:"CIF",valido};
 }
 return {nif:v,tipo:null,valido:false};
}

// Formatos impresos habituales: B24123457, B-24123457, B-24.123.457, ES B24123457, 12345678-Z.
const PATRON=/(?:\bES[\s-]?)?(?:\b[ABCDEFGHJNPQRSUVW][\s.-]?\d{2}[.\s]?\d{3}[.\s]?\d{2}[\s.-]?[0-9A-J]\b|\b\d{8}[\s-]?[A-Z]\b|\b[XYZ][\s-]?\d{7}[\s-]?[A-Z]\b)/gi;

/* Devuelve los identificadores válidos encontrados en un texto, con su posición. */
function buscar(texto){
 const encontrados=[];
 const s=String(texto??"");
 for(const m of s.matchAll(PATRON)){
  const r=validar(m[0]);
  if(r.valido)encontrados.push({...r,literal:m[0],indice:m.index});
 }
 return encontrados;
}

return {normalizar,validar,buscar};
});
