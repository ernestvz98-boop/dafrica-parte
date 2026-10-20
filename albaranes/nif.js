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

/*
 * Huella SHA-256 de un NIF normalizado. Los perfiles públicos guardan solo la huella (nunca el
 * NIF en claro): el lector calcula la huella del NIF leído y la compara. Síncrona, sin dependencias.
 */
function sha256(texto){
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
  0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,
  0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,
  0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,
  0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const b=[...unescape(encodeURIComponent(String(texto)))].map(c=>c.charCodeAt(0));
 const l=b.length*8;b.push(0x80);while(b.length%64!==56)b.push(0);
 for(let i=7;i>=0;i--)b.push(i>3?0:(l>>>(i*8))&0xff);
 const r=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let o=0;o<b.length;o+=64){
  const w=[];for(let i=0;i<16;i++)w[i]=(b[o+4*i]<<24)|(b[o+4*i+1]<<16)|(b[o+4*i+2]<<8)|b[o+4*i+3];
  for(let i=16;i<64;i++){const s0=r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3),s1=r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}
  let [a,bb,c,d,e,f,g,h]=H;
  for(let i=0;i<64;i++){
   const t1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+w[i])|0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&bb)^(a&c)^(bb&c)))|0;
   h=g;g=f;f=e;e=(d+t1)|0;d=c;c=bb;bb=a;a=(t1+t2)|0;
  }
  [a,bb,c,d,e,f,g,h].forEach((v,i)=>{H[i]=(H[i]+v)|0;});
 }
 return H.map(v=>(v>>>0).toString(16).padStart(8,"0")).join("");
}
const huella=nif=>sha256("dafrica-nif:"+normalizar(nif));

return {normalizar,validar,buscar,huella,sha256};
});
