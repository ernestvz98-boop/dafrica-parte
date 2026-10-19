"use strict";
/*
 * DAFRICA · Normalización determinista de valores impresos en albaranes.
 * Regla: cada resultado conserva el texto LITERAL. «valor» solo se rellena
 * cuando la interpretación es inequívoca; en caso contrario queda null y
 * el estado (AMBIGUO / INVALIDO / VACIO) explica por qué. Nunca se inventa.
 * Funciona en navegador (DafricaAlbaranes.normalizar) y en Node (require).
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.normalizar=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){

const limpiar=v=>String(v??"").replace(/[   ]/g," ").replace(/\s+/g," ").trim();
const sinAcentos=v=>limpiar(v).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
// Clave de comparación: mayúsculas, sin acentos ni signos.
const canon=v=>sinAcentos(v).replace(/[^A-Z0-9]/g,"");

function resultado(literal){return {literal,valor:null,estado:"VACIO",motivos:[],notas:[]};}

/*
 * Formato de números:
 *  "es": coma decimal y punto de miles (1.234,56). Por defecto.
 *  "en": punto decimal y coma de miles (1,234.56).
 * formatoConfirmado=true cuando el perfil del proveedor o el propio documento
 * (p. ej. aparece «1.234,56» o «8,00») demuestran el formato. Sin esa prueba,
 * «1.000» es AMBIGUO: puede ser mil (miles) o uno (decimal con punto).
 */
function numero(literal,opciones={}){
 const formato=opciones.formato==="en"?"en":"es";
 const r=resultado(limpiar(literal));
 if(!r.literal)return r;
 let s=r.literal.replace(/\s+/g,"").replace(/€|EUR$/gi,"");
 if(opciones.porcentaje)s=s.replace(/%$/,"").replace(/^%/,"");
 let negativo=false;
 if(/^\(.+\)$/.test(s)){negativo=true;s=s.slice(1,-1);}
 if(/^[-−]/.test(s)){negativo=true;s=s.slice(1);}
 else if(/^\+/.test(s))s=s.slice(1);
 if(/[-−]$/.test(s)){negativo=true;s=s.slice(0,-1);} // «12,50-» en abonos
 if(!/^[0-9.,]+$/.test(s)||!/[0-9]/.test(s)){
  r.estado="INVALIDO";r.motivos.push("No es un número: «"+r.literal+"»");return r;
 }
 const decimal=formato==="es"?",":".",miles=formato==="es"?".":",";
 const nDec=s.split(decimal).length-1;
 if(nDec>1){r.estado="INVALIDO";r.motivos.push("Más de un separador decimal");return r;}
 const [entera,fraccion]=s.split(decimal);
 const gruposMiles=new RegExp("^\\d{1,3}(\\"+miles+"\\d{3})+$");
 if(entera.includes(miles)&&!gruposMiles.test(entera)){
  // «12.5» en formato español: el punto no agrupa miles.
  if(fraccion===undefined&&entera.split(miles).length===2){
   r.estado="AMBIGUO";
   r.motivos.push("Separador «"+miles+"» usado como decimal, contrario al formato "+formato);
   r.valor_alternativo=(negativo?-1:1)*Number(entera.replace(miles,"."));
   return r;
  }
  r.estado="INVALIDO";r.motivos.push("Agrupación de miles incorrecta");return r;
 }
 if(fraccion!==undefined&&!/^\d*$/.test(fraccion)){
  r.estado="INVALIDO";r.motivos.push("Parte decimal incorrecta");return r;
 }
 if(entera.includes(miles)&&fraccion===undefined&&!opciones.formatoConfirmado){
  r.estado="AMBIGUO";
  r.motivos.push("«"+r.literal+"» puede ser un número con miles o con decimales; el formato no está confirmado");
  r.valor_propuesto=(negativo?-1:1)*Number(entera.split(miles).join(""));
  r.valor_alternativo=(negativo?-1:1)*Number(entera.split(miles).join("."));
  return r;
 }
 const texto=(entera.split(miles).join("")||"0")+(fraccion?"."+fraccion:"");
 const valor=Number(texto);
 if(!Number.isFinite(valor)){r.estado="INVALIDO";r.motivos.push("Número fuera de rango");return r;}
 r.valor=negativo&&valor!==0?-valor:valor;
 r.decimales=fraccion?fraccion.length:0;
 r.estado="OK";
 return r;
}

/* Descuentos: «20», «20,00», «20%», «20+5», «20+5+3». Vacío o «NETO» = sin descuento. */
function descuento(literal,opciones={}){
 const r=resultado(limpiar(literal));
 r.porcentajes=[];r.factor=1;
 if(!r.literal||/^[-–—]$/.test(r.literal)||/^NETO$/i.test(r.literal))return r;
 const partes=r.literal.replace(/\s+/g,"").split("+");
 for(const parte of partes){
  const n=numero(parte,{...opciones,porcentaje:true});
  if(n.estado!=="OK"){
   r.estado=n.estado==="VACIO"?"INVALIDO":n.estado;
   r.motivos.push("Descuento «"+r.literal+"»: "+(n.motivos[0]||"parte vacía"));
   return r;
  }
  if(n.valor<0||n.valor>100){r.estado="INVALIDO";r.motivos.push("Descuento fuera de 0-100 %");return r;}
  r.porcentajes.push(n.valor);
 }
 r.factor=r.porcentajes.reduce((f,p)=>f*(1-p/100),1);
 r.valor=Math.round((1-r.factor)*1e8)/1e6; // porcentaje equivalente
 r.estado="OK";
 if(r.porcentajes.length>1)r.notas.push("Descuento en cascada "+r.porcentajes.join(" + ")+" % = "+r.valor+" % equivalente");
 return r;
}

const MESES={ENE:1,ENERO:1,FEB:2,FEBRERO:2,MAR:3,MARZO:3,ABR:4,ABRIL:4,MAY:5,MAYO:5,JUN:6,JUNIO:6,
 JUL:7,JULIO:7,AGO:8,AGOSTO:8,SEP:9,SEPT:9,SEPTIEMBRE:9,SETIEMBRE:9,OCT:10,OCTUBRE:10,
 NOV:11,NOVIEMBRE:11,DIC:12,DICIEMBRE:12};
const iso=(a,m,d)=>String(a).padStart(4,"0")+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
function fechaReal(a,m,d){
 const f=new Date(Date.UTC(a,m-1,d));
 return f.getUTCFullYear()===a&&f.getUTCMonth()===m-1&&f.getUTCDate()===d;
}
/*
 * Fechas impresas en España: día/mes/año. Admite 15/10/2026, 15-10-26,
 * 15.10.2026, 2026-10-15, «15 de octubre de 2026» y «15-oct-26».
 * Un orden distinto (mes/día) solo se aplica si el perfil del proveedor lo declara.
 */
function fecha(literal,opciones={}){
 const r=resultado(limpiar(literal));
 if(!r.literal)return r;
 const s=sinAcentos(r.literal).replace(/\s+/g," ");
 let a,m,d,m2;
 if((m2=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){a=+m2[1];m=+m2[2];d=+m2[3];}
 else if((m2=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))){
  const x=+m2[1],y=+m2[2];
  if(opciones.orden==="MDY"){m=x;d=y;}else{d=x;m=y;}
  a=+m2[3];
  if(m2[3].length===2){a+=2000;r.notas.push("Año impreso con dos cifras");}
 }
 else if((m2=s.match(/^(\d{1,2})(?: DE |[ \-\/.])([A-Z]+)\.?(?: DE |[ \-\/.])(\d{2}|\d{4})$/))){
  d=+m2[1];m=MESES[m2[2]];a=+m2[3];
  if(!m){r.estado="INVALIDO";r.motivos.push("Mes no reconocido: "+m2[2]);return r;}
  if(m2[3].length===2){a+=2000;r.notas.push("Año impreso con dos cifras");}
 }
 else{r.estado="INVALIDO";r.motivos.push("Formato de fecha no reconocido: «"+r.literal+"»");return r;}
 if(!fechaReal(a,m,d)){r.estado="INVALIDO";r.motivos.push("Fecha inexistente: «"+r.literal+"»");return r;}
 r.valor=iso(a,m,d);r.estado="OK";
 return r;
}

/* Prueba del formato numérico a partir de las cifras del propio documento. */
function deducirFormato(literales){
 let es=0,en=0;
 for(const t of literales){
  const s=limpiar(t).replace(/[\s€%]/g,"").replace(/^[-−+]|[-−]$/g,"");
  if(/^\d{1,3}(\.\d{3})+,\d+$/.test(s)||/^\d+,\d{1,2}$|^\d+,\d{4,}$/.test(s))es++;
  else if(/^\d{1,3}(,\d{3})+\.\d+$/.test(s)||/^\d+\.\d{1,2}$|^\d+\.\d{4,}$/.test(s))en++;
 }
 if(es&&!en)return {formato:"es",confirmado:true,pruebas:es};
 if(en&&!es)return {formato:"en",confirmado:true,pruebas:en};
 return {formato:"es",confirmado:false,pruebas:0,conflicto:!!(es&&en)};
}

return {limpiar,sinAcentos,canon,numero,descuento,fecha,deducirFormato};
});
