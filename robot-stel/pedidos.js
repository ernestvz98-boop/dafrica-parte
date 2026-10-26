"use strict";
/*
 * DAFRICA · Entregas de un pedido a proveedor (regla acordada con el usuario el 2026-10-26).
 *
 * En STEL, generar un albarán desde un pedido («Más → Generar → Albarán de proveedor») pasa el
 * pedido ENTERO a «Recibido», aunque falten líneas, y ya no deja generar otro albarán desde él.
 * Por eso:
 * - Entrega que NO completa el pedido: el albarán se crea A MANO, con «PAPxxxxx» en el título, las
 *   observaciones y cada línea, los precios del pedido y su obra. El pedido sigue abierto.
 * - Entrega que completa lo que falta: el albarán se GENERA DESDE EL PEDIDO, quitando las líneas
 *   (o las cantidades) que ya llegaron en albaranes anteriores; así el pedido queda cerrado y enlazado.
 * - Cualquier línea fuera del pedido o cantidad mayor que lo pendiente: se para (revisión).
 * El robot calcula lo pendiente con el pedido y los albaranes anteriores con ese PAP.
 *
 * pedido: {codigo, cerrado, lineas: [{clave, cantidad}]}; previos: [{lineas: [{clave, cantidad}]}]
 * (albaranes ya creados de ese pedido); albaran: {lineas: [{clave, cantidad}]} (el que se va a crear).
 * clave: id del artículo de STEL o, en líneas libres, la referencia escrita.
 * Devuelve {modo: "a_mano" | "generar" | "parar", pendiente_antes, pendiente_despues, generar_lineas, motivos}.
 * generar_lineas: lo que debe quedar en el albarán generado (lo de este papel).
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.DafricaRobotPedidos=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const EPS=1e-6;
const suma=lineas=>{const m=new Map();for(const l of lineas||[]){const k=String(l.clave);m.set(k,(m.get(k)||0)+Number(l.cantidad));}return m;};
const objeto=m=>Object.fromEntries([...m].filter(([,v])=>Math.abs(v)>EPS));

function decidirEntrega({pedido,previos=[],albaran}){
 const motivos=[];
 const pedidas=suma(pedido?.lineas);
 const recibidas=suma((previos||[]).flatMap(p=>p.lineas||[]));
 const trae=suma(albaran?.lineas);
 for(const [k,v] of [...pedidas,...recibidas,...trae])if(!Number.isFinite(v)||v<0)motivos.push("Cantidad no válida en «"+k+"»");
 const pendiente=new Map();
 for(const [k,v] of pedidas)pendiente.set(k,v-(recibidas.get(k)||0));
 for(const [k,v] of recibidas)if(!pedidas.has(k))motivos.push("Un albarán anterior trae «"+k+"», que no está en el pedido "+(pedido?.codigo||""));
 for(const [k,v] of pendiente)if(v<-EPS)motivos.push("Ya se recibió más «"+k+"» de lo pedido");
 if(!trae.size)motivos.push("El albarán no tiene líneas");
 for(const [k,v] of trae){
  if(!pedidas.has(k)){motivos.push("«"+k+"» no está en el pedido "+(pedido?.codigo||""));continue;}
  if(v>(pendiente.get(k)||0)+EPS)motivos.push("«"+k+"»: llegan "+v+" y solo quedan pendientes "+Math.max(0,pendiente.get(k)||0));
 }
 const despues=new Map([...pendiente].map(([k,v])=>[k,v-(trae.get(k)||0)]));
 const completa=[...despues.values()].every(v=>Math.abs(v)<=EPS);
 const res={pendiente_antes:objeto(pendiente),pendiente_despues:objeto(despues),generar_lineas:null,motivos};
 if(motivos.length)return {...res,modo:"parar"};
 if(!completa)return {...res,modo:"a_mano"};
 // Completa el pedido: generar desde él, dejando solo lo de este papel.
 if(pedido?.cerrado)return {...res,modo:"parar",motivos:["El pedido "+(pedido?.codigo||"")+" ya está cerrado en STEL: no se puede generar el albarán desde él"]};
 return {...res,modo:"generar",generar_lineas:objeto(trae)};
}

return {decidirEntrega};
});
