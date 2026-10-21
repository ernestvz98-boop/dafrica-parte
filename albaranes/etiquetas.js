"use strict";
/*
 * DAFRICA · Etiquetas de obra con QR. En el almacén se pega en el albarán una etiqueta impresa
 * con el código de la obra («PRY12345») en grande y un QR «DAFRICA-OBRA:PRY12345». El lector
 * busca el QR en cada página escaneada: un QR con ese formato es el código de obra exacto (impreso
 * y legible por máquina), sin depender de la letra a mano. Dos códigos distintos en el mismo
 * albarán: AMBIGUO. Si la letra a mano (validada por otra vía) dice otra obra: REVISAR.
 *
 * jsQR (albaranes/vendor/jsQR.js) se pasa como función: jsQR(rgba, ancho, alto, opciones).
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.etiquetas=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const PREFIJO="DAFRICA-OBRA:";
const RE=/^DAFRICA-OBRA:(PRY\d{5})$/;
const contenido=codigo=>PREFIJO+codigo;

/* QR de obra de cada página (imagen en grises reducida a la mitad: un QR de 2,5 cm sobra). */
function detectar(paginas,jsQR,{factor=2}={}){
 const out=[];
 if(typeof jsQR!=="function")return out;
 for(const p of paginas||[]){
  if(typeof p.gris!=="function")continue;
  let g;try{g=p.gris(factor);}catch{continue;}
  const n=g.ancho*g.alto,rgba=new Uint8ClampedArray(n*4);
  for(let i=0;i<n;i++){const v=g.datos[i];rgba[4*i]=rgba[4*i+1]=rgba[4*i+2]=v;rgba[4*i+3]=255;}
  const r=jsQR(rgba,g.ancho,g.alto,{inversionAttempts:"dontInvert"});
  const m=r&&String(r.data||"").trim().match(RE);
  if(m)out.push({pagina:p.numero,codigo:m[1]});
 }
 return out;
}

/* Aplica las etiquetas encontradas al resultado de un albarán (r.etiqueta_obra y manuscritos.obra). */
function aplicar(r,hallazgos){
 if(!r||!hallazgos?.length)return false;
 const codigos=[...new Set(hallazgos.map(h=>h.codigo))];
 r.etiqueta_obra={codigos,paginas:hallazgos.map(h=>h.pagina)};
 if(!r.manuscritos)return false;
 const previa=r.manuscritos.obra||{};
 if(codigos.length>1){
  r.manuscritos.obra={valor:null,literal:previa.literal||"",estado:"AMBIGUO",confianza:0,motivos:["Etiquetas de obra distintas en el mismo albarán: "+codigos.join(" / ")],resolucion:{alternativas:codigos}};
  return false;
 }
 const codigo=codigos[0],ev="Etiqueta QR de obra impresa: «"+codigo+"» (página "+hallazgos.map(h=>h.pagina).join(", ")+")";
 if(previa.estado==="OK"&&previa.valor&&previa.valor!==codigo){
  r.manuscritos.obra={...previa,estado:"REVISAR",confianza:0.5,motivos:[...(previa.motivos||[]),"La etiqueta QR dice "+codigo+" y lo escrito a mano "+previa.valor]};
  return false;
 }
 r.manuscritos.obra={valor:codigo,literal:previa.literal||"",estado:"OK",confianza:0.99,motivos:[],
  resolucion:{metodo:"etiqueta_qr",evidencias:[ev,...(previa.valor===codigo?["Coincide con lo escrito a mano"]:[])],alternativas:[codigo]}};
 return true;
}

/*
 * Hoja A4 de etiquetas para imprimir (HTML autónomo): código grande, nombre de la obra y QR.
 * qrcode: qrcode-generator (albaranes/vendor/qrcode.js).
 */
const esc=t=>String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function hojaEtiquetas({codigo,nombre="",copias=21},qrcode){
 if(!/^PRY\d{5}$/.test(codigo))throw Error("Código de obra no válido (PRY y 5 cifras)");
 const q=qrcode(0,"M");q.addData(contenido(codigo));q.make();
 const svg=q.createSvgTag({cellSize:4,margin:2,scalable:true});
 const una='<div class="e"><div class="q">'+svg+'</div><div class="t"><b>'+esc(codigo)+'</b><span>'+esc(nombre).slice(0,60)+'</span></div></div>';
 return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas '+esc(codigo)+'</title><style>'+
  '@page{size:A4;margin:8mm}body{margin:0;font-family:Arial,Helvetica,sans-serif}'+
  '.h{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}'+
  '.e{display:flex;align-items:center;gap:3mm;border:1px dashed #999;height:36mm;padding:2mm;box-sizing:border-box;break-inside:avoid}'+
  '.q svg{width:28mm;height:28mm;display:block}.t{display:flex;flex-direction:column}.t b{font-size:15pt;letter-spacing:1px}.t span{font-size:8pt}'+
  '</style></head><body><div class="h">'+Array.from({length:Math.max(1,Math.min(60,copias))},()=>una).join("")+'</div></body></html>';
}
return {detectar,aplicar,hojaEtiquetas,contenido,PREFIJO};
});
