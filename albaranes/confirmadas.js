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
 * Misma tabla y misma regla para la tarifa o catálogo que importa una persona (origen «tarifa»):
 * el código existe una sola vez en la tarifa de ese proveedor y la descripción es compatible.
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

/*
 * Un código confirmado solo vale si tiene forma de código (fallo real 2026-10-23: se confirmaron
 * códigos con el principio de la descripción pegado, «… “ Montante», con un espacio en medio y un
 * importe leído en la columna del código, como «1.234,5600»). No vale con comillas, «?» u otros
 * signos que no son de un código, con forma de importe (cifras con decimales con coma) ni, si el
 * perfil del proveedor declara su formato de código (formato_referencia), sin ese formato.
 */
const SIGNOS_AJENOS=/[“”«»¨¡¿?"'`´‘’]/;
const IMPORTE=/^-?\d{1,3}(\.\d{3})*,\d+$/;
function codigoValido(referencia,perfil=null){
 const t=String(referencia??"").trim();
 if(!t||SIGNOS_AJENOS.test(t)||IMPORTE.test(t))return false;
 if(perfil?.formato_referencia&&!new RegExp(perfil.formato_referencia).test(t))return false;
 return true;
}
const perfilDe=p=>{try{return p?.id?(M("proveedores").REGISTRO?.proveedores||[]).find(x=>x.id===p.id)||null:null;}catch{return null;}};

/*
 * Código en dos renglones: el lector une los renglones con un espacio y el OCR pierde guiones y
 * espacios pequeños. Hasta lector27 la pantalla proponía esa lectura sin avisar y se confirmó tal
 * cual (fallo real 2026-10-23: un espacio donde el papel lleva guion; se habría aceptado un código
 * erróneo). Ahora la pantalla avisa y pide un segundo clic tras compararlo con el papel. Para esos
 * códigos solo vale una confirmación posterior a ese aviso, o la tarifa.
 */
const AVISO_DOS_RENGLONES=Date.parse("2026-10-23T09:05:00Z");
const dosRenglones=ref=>(ref?.motivos||[]).some(m=>/^Código en dos renglones/.test(m));
const conAviso=c=>c.origen==="tarifa"||Date.parse(c.confirmado_en)>=AVISO_DOS_RENGLONES;

/* Clave estable del proveedor: su perfil registrado o, si no lo tiene, su CIF. */
function clave(p){
 if(!p||p.estado!=="OK")return null;
 if(p.id)return "perfil:"+p.id;
 const nif=p.nif?M("nif").normalizar(p.nif):"";
 return nif?"nif:"+nif:null;
}

// Lo leído en una línea: el código, sus alternativas OCR y, si lleva texto pegado, su primera palabra.
function leidosDe(ref){
 const leidos=[ref.literal,ref.valor,...(ref.alternativas_ocr||[])].filter(Boolean);
 for(const t of [...leidos])leidos.push(String(t).trim().split(/\s+/)[0]);
 return leidos;
}
const pendiente=ref=>!!ref?.literal&&!(ref.estado==="OK"&&(ref.confianza??0)>=0.9);

/* Claves de clase que hay que pedir a la tabla, por proveedor: {clave: [clases]}. */
function necesarias(docs){
 const out={};
 for(const d of docs||[]){
  const det=d?.resultado||d,k=clave(det?.proveedor);if(!k)continue;
  for(const l of det.lineas||[])if(pendiente(l.referencia))
   for(const t of leidosDe(l.referencia)){const c=clase(t);if(c)(out[k]||(out[k]=new Set())).add(c);}
 }
 return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,[...v]]));
}

/* Aplica los códigos confirmados a las líneas de un albarán. Devuelve cuántas resuelve. */
function aplicar(det,confirmadas){
 const k=clave(det?.proveedor);
 if(!k||!Array.isArray(confirmadas)||!confirmadas.length)return 0;
 const perfil=perfilDe(det.proveedor);
 const delProveedor=confirmadas.filter(c=>c.proveedor_clave===k&&c.referencia&&c.descripcion&&codigoValido(c.referencia,perfil));
 if(!delProveedor.length)return 0;
 const compatible=M("verificacion").descripcionCompatible;
 let n=0;
 for(const l of det.lineas||[]){
  const ref=l.referencia;
  if(!pendiente(ref))continue;
  const leidos=leidosDe(ref);
  // Un solo código equivalente: si hay dos que solo difieren en O/0, S/5…, ni la igualdad exacta
  // con lo leído decide (el OCR pudo leer uno por otro).
  const candidatos=delProveedor.filter(c=>(!dosRenglones(ref)||conAviso(c))&&leidos.some(t=>clase(t)!==""&&clase(t)===clase(c.referencia)));
  if(candidatos.length!==1)continue;
  const exactos=candidatos.filter(c=>leidos.some(t=>sinSignos(t)===sinSignos(c.referencia)));
  const c=candidatos[0];
  if(!compatible(l.descripcion?.valor??l.descripcion?.literal,c.descripcion))continue;
  l.referencia={...ref,literal:c.referencia,valor:c.referencia,estado:"OK",motivos:[],validado_confirmada:true,literal_ocr_original:ref.literal,
   resolucion:{metodo:c.origen==="tarifa"?"referencia_tarifa":"referencia_confirmada",confianza:0.97,lectura_ocr:ref.literal,
    evidencias:[(c.origen==="tarifa"?"Código «"+c.referencia+"» de la tarifa de este proveedor (importada":"Código «"+c.referencia+"» de este proveedor confirmado por una persona")+
      (c.confirmado_en?" ("+String(c.confirmado_en).slice(0,10)+")":"")+(c.origen==="tarifa"?")":""),
     exactos.length?"Coincide con lo leído":"Lo leído («"+ref.literal+"») solo difiere en caracteres que el OCR confunde, y es el único código equivalente",
     "Descripción compatible con la "+(c.origen==="tarifa"?"de la tarifa":"confirmada")+": «"+c.descripcion+"»"]}};
  n++;
 }
 return n;
}
return {aplicar,clave,clase,necesarias,codigoValido,perfilDe,dosRenglones};
});
