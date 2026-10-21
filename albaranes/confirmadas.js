"use strict";
/*
 * DAFRICA · Códigos de proveedor confirmados por una persona (tabla de Supabase
 * `lector_referencias_confirmadas`; solo proveedor, código y descripción, sin precios).
 *
 * Cuando una persona revisa un albarán y confirma «este proveedor usa este código», el lector
 * valida después ese mismo código de ese mismo proveedor sin revisión, si además la descripción
 * leída es compatible con la confirmada. Lo leído puede diferir del código confirmado solo en
 * caracteres que el OCR confunde (O/0, S/5, I/1, B/8, Z/2, G/6) y únicamente si entre los
 * códigos confirmados del proveedor hay uno solo equivalente. Nunca se inventa un código.
 */
(function(root,factory){
 const req=typeof module==="object"&&module.exports?require:null;
 const api=factory(root,req);if(req)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.confirmadas=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){
const M=k=>req?require("./"+k+".js"):root.DafricaAlbaranes[k];
const codigo=v=>String(v||"").trim().toUpperCase().replace(/\s/g,"");
const sinSignos=v=>codigo(v).replace(/[^A-Z0-9]/g,"");
const clase=v=>sinSignos(v).replace(/O/g,"0").replace(/S/g,"5").replace(/I/g,"1").replace(/L/g,"1").replace(/B/g,"8").replace(/Z/g,"2").replace(/G/g,"6");

/* Clave estable del proveedor: su perfil registrado o, si no lo tiene, su CIF. */
function clave(p){
 if(!p||p.estado!=="OK")return null;
 if(p.id)return "perfil:"+p.id;
 const nif=p.nif?M("nif").normalizar(p.nif):"";
 return nif?"nif:"+nif:null;
}

/* Aplica los códigos confirmados a las líneas de un albarán. Devuelve cuántas resuelve. */
function aplicar(det,confirmadas){
 const k=clave(det?.proveedor);
 if(!k||!Array.isArray(confirmadas)||!confirmadas.length)return 0;
 const delProveedor=confirmadas.filter(c=>c.proveedor_clave===k&&c.referencia&&c.descripcion);
 if(!delProveedor.length)return 0;
 const compatible=M("verificacion").descripcionCompatible;
 let n=0;
 for(const l of det.lineas||[]){
  const ref=l.referencia;
  if(!ref?.literal||(ref.estado==="OK"&&(ref.confianza??0)>=0.9))continue;
  // Lo leído: el código, sus alternativas OCR y, si lleva texto pegado, su primera palabra.
  const leidos=[ref.literal,ref.valor,...(ref.alternativas_ocr||[])].filter(Boolean);
  for(const t of [...leidos])leidos.push(String(t).trim().split(/\s+/)[0]);
  const exactos=delProveedor.filter(c=>leidos.some(t=>sinSignos(t)!==""&&sinSignos(t)===sinSignos(c.referencia)));
  const candidatos=exactos.length?exactos:delProveedor.filter(c=>leidos.some(t=>clase(t)!==""&&clase(t)===clase(c.referencia)));
  if(candidatos.length!==1)continue;
  const c=candidatos[0];
  if(!compatible(l.descripcion?.valor??l.descripcion?.literal,c.descripcion))continue;
  l.referencia={...ref,literal:c.referencia,valor:c.referencia,estado:"OK",motivos:[],validado_confirmada:true,literal_ocr_original:ref.literal,
   resolucion:{metodo:"referencia_confirmada",confianza:0.97,lectura_ocr:ref.literal,
    evidencias:["Código «"+c.referencia+"» de este proveedor confirmado por una persona"+(c.confirmado_en?" ("+String(c.confirmado_en).slice(0,10)+")":""),
     exactos.length?"Coincide con lo leído":"Lo leído («"+ref.literal+"») solo difiere en caracteres que el OCR confunde, y es el único código confirmado equivalente",
     "Descripción compatible con la confirmada: «"+c.descripcion+"»"]}};
  n++;
 }
 return n;
}
return {aplicar,clave};
});
