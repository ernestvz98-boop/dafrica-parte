#!/usr/bin/env node
"use strict";
/*
 * Prueba de fuerza de las reglas de aceptación de códigos de obra manuscritos: para cada obra T del
 * catálogo (con su nombre, o una sola de sus palabras, escrito en el albarán) la visión se equivoca
 * de forma realista y se cuenta cuántas lecturas FALSAS acabarían aceptadas (error crítico).
 *
 *   node pruebas/prueba-fuerza-obras.js [obras.tsv]
 *
 * obras.tsv: «código<TAB>nombre» por línea (por defecto pruebas/corpus-real/obras.tsv, fuera de git;
 * sin él, el catálogo ficticio de las pruebas). Familias de ataque:
 *   directa             lee R, otra obra que existe a una cifra o con dos cifras contiguas intercambiadas
 *   directa + buena     lee R (0,99) y T (0,6)
 *   dos lecturas        lee R (existe) o Z (no existe), y la cifra buena no está entre ellas
 *   una cifra           lee Z (no existe) a una mala lectura de T (regla del nombre)
 *   lote                otro albarán del lote validado con R y el mismo nombre; en este se lee R
 *   control             lee T bien (cuántas buenas se aceptan: la prueba no es vacía)
 * Fallo real que la originó (2026-10-22): con el catálogo real se aceptaban lecturas falsas por
 * palabras comunes a varias obras («HOSPITAL», «CENTRO»…) y por «solo esta existe».
 */
const fs=require("fs"),path=require("path");
const M=require("../albaranes/manuscritos.js");
const canon=t=>String(t||"").toUpperCase().replace(/[^A-Z0-9]/g,"");

function variantes(c){
 const out=new Set(),s=c.split("");
 for(let i=3;i<s.length;i++)for(const d of "0123456789")if(d!==s[i]){const x=[...s];x[i]=d;out.add(x.join(""));}
 for(let i=3;i<s.length-1;i++)if(s[i]!==s[i+1]){const x=[...s];[x[i],x[i+1]]=[x[i+1],x[i]];out.add(x.join(""));}
 return [...out];
}
const distintas=(a,b)=>[...a].filter((c,i)=>c!==b[i]).length;
const vista=(lecturas,texto)=>[{indice:0,tipo:"PRY",tachado:false,texto_literal:texto||lecturas[0][0],lecturas:lecturas.map(([codigo,confianza])=>({codigo,confianza}))}];

// Catálogo ficticio denso (códigos correlativos, como los reales) con palabras comunes a varias
// obras y dos nombres casi iguales con código contiguo: el caso difícil para validar por el nombre.
function catalogoFicticio(){
 const comunes=["HOSPITAL FICTICIO","CENTRO SALUD","CLIMATIZACION","CONSULTORIO","REFORMA","COLUMNA"];
 const propias=["ALFAREROS","BRAVOS","CORALES","DUNAS","EBANOS","FAROLES","GAVIOTAS","HELECHOS","ISLOTES","JARAS","LIRIOS","MIMBRES",
  "NOGALES","OLIVOS","PINARES","QUEJIGOS","ROBLEDAL"];
 const out=[];
 for(let i=0;i<61;i++)out.push({codigo:"PRY9"+String(100+i).padStart(4,"0"),nombre:comunes[i%comunes.length]+" "+propias[i%propias.length]+(i%7===0?" AMPLIACION":"")});
 out.push({codigo:"PRY90170",nombre:"MUTUA INVENTADA NORTE"},{codigo:"PRY90171",nombre:"MUTUA INVENTADA (FONTANERIA) NORTE"});
 return out;
}

function atacar(catalogo,{vias=["impresa","escrita"],palabras=true}={}){
 const cat=catalogo.map(o=>({codigo:canon(o.codigo),nombre:o.nombre}));
 const codigos=new Set(cat.map(o=>o.codigo)),tabla={};
 const anota=(familia,T,v,txt)=>{const f=tabla[familia]||(tabla[familia]={pruebas:0,falsas:0,buenas:0,ejemplos:[]});f.pruebas++;
  if(v?.estado!=="OK")return;if(v.valor===T.codigo)f.buenas++;else{f.falsas++;if(f.ejemplos.length<10)f.ejemplos.push(txt+" → "+v.valor+" ("+(v.resolucion?.metodo||"")+")");}};
 for(const T of cat){
  const textos=[T.nombre,...(palabras?[...M.palabrasObra(T.nombre)]:[])];
  for(const texto of textos)for(const via of vias){
   const ctx={catalogoObras:cat,catalogoObrasCompleto:true,obraImpresa:via==="impresa"?[texto]:[],obraEscrita:via==="escrita"?[texto]:[]};
   const pista=T.codigo+" «"+String(texto).slice(0,30)+"»";
   anota("control",T,M.validarCodigos(vista([[T.codigo,0.99]]),ctx).obra,pista);
   const vs=variantes(T.codigo);
   for(const r of vs.filter(x=>codigos.has(x))){
    anota("directa",T,M.validarCodigos(vista([[r,0.99]]),ctx).obra,pista+" leído "+r);
    anota("directa + buena",T,M.validarCodigos(vista([[r,0.99],[T.codigo,0.6]]),ctx).obra,pista+" leído "+r+" y "+T.codigo);
    for(const z of vs.filter(x=>!codigos.has(x)&&distintas(x,r)===1&&distintas(x,T.codigo)===1).slice(0,2))
     anota("dos lecturas",T,M.validarCodigos(vista([[r,0.6],[z,0.5]],"PRY?"),ctx).obra,pista+" leído "+r+"/"+z);
    const ancla={obraImpresa:ctx.obraImpresa,obraEscrita:ctx.obraEscrita,obra:{valor:r,estado:"OK",confianza:0.95,resolucion:{metodo:"vision_recorte_validada",evidencias:["Visión","Ancla"]}}};
    const este={obraImpresa:ctx.obraImpresa,obraEscrita:ctx.obraEscrita,obra:{valor:r,estado:"REVISAR",confianza:0.8,resolucion:{metodo:"vision_recorte"}}};
    M.coherenciaLote([ancla,este],{catalogoObras:cat});
    anota("lote",T,este.obra,pista+" leído "+r);
   }
   for(const z of vs.filter(x=>!codigos.has(x)))anota("una cifra",T,M.validarCodigos(vista([[z,0.99]]),ctx).obra,pista+" leído "+z);
  }
 }
 return tabla;
}

if(require.main===module){
 const ruta=process.argv[2]||path.join(__dirname,"corpus-real","obras.tsv");
 const catalogo=fs.existsSync(ruta)?fs.readFileSync(ruta,"utf8").trim().split("\n").map(l=>{const [codigo,nombre]=l.split("\t");return {codigo,nombre};}):
  catalogoFicticio();
 const tabla=atacar(catalogo);
 console.log("Catálogo: "+catalogo.length+" obras ("+(fs.existsSync(ruta)?ruta:"ficticio")+")");
 console.log("| Ataque | Pruebas | Falsas aceptadas | Buenas aceptadas |\n|---|---|---|---|");
 for(const [k,f] of Object.entries(tabla))console.log("| "+k+" | "+f.pruebas+" | "+f.falsas+" | "+f.buenas+" |");
 const falsas=Object.values(tabla).reduce((s,f)=>s+f.falsas,0);
 for(const [k,f] of Object.entries(tabla))for(const e of f.ejemplos)console.log(k+": "+e);
 if(falsas)process.exitCode=1;
}
module.exports={atacar,variantes,catalogoFicticio};
