"use strict";
/*
 * Comparación campo a campo entre la lectura y el resultado esperado.
 * Categorías (de mejor a peor):
 *   CORRECTO               valor correcto y aceptado automáticamente
 *   MARCADO_COMO_ESPERADO  el campo debía quedar marcado para revisión y lo está
 *   CORRECTO_A_REVISAR     valor correcto, pero marcado para revisión (coste humano)
 *   SIN_VALOR_MARCADO      no se dio valor y quedó marcado (seguro, coste humano)
 *   INCORRECTO_MARCADO     valor erróneo pero marcado (seguro, coste humano)
 *   INCORRECTO_NO_MARCADO  valor erróneo aceptado como bueno  ← CRÍTICO
 *   FALTA_MARCA            debía marcarse y se aceptó         ← CRÍTICO
 */
const N=require("../albaranes/normalizar.js");

const ACEPTADOS=new Set(["OK","VERIFICADO"]);
const CRITICAS=new Set(["INCORRECTO_NO_MARCADO","FALTA_MARCA"]);

const iguales={
 texto:(a,b)=>(a===null||a===undefined||a==="")?(b===null||b===undefined||b===""):N.limpiar(a)===N.limpiar(b),
 descripcion:(a,b)=>N.canon(a)===N.canon(b),
 // Un importe impreso con dos precisiones («48,0000» y «48,00») admite ambas: [48, 48.0].
 numero:(a,b)=>Array.isArray(a)?a.some(x=>iguales.numero(x,b)):(a===null||a===undefined)?(b===null||b===undefined):(typeof b==="number"&&Math.abs(a-b)<1e-9),
 descuento:(a,b)=>{
  const x=a===null||a===undefined?[]:[].concat(a),y=b===null||b===undefined?[]:[].concat(b);
  return x.length===y.length&&x.every((v,i)=>Math.abs(v-y[i])<1e-9);
 }
};

// Por debajo de este umbral el campo no se da por fiable: cuenta como marcado para revisión.
const UMBRAL=0.9;
// inciertos: campos cuyo valor esperado no se pudo transcribir con seguridad (pendientes de
// confirmación humana). Se informan, pero no cuentan en la precisión.
function clasificar({campo,esperado,obtenido,estado,debeMarcarse,tipo,confianza=null,motivos=[],incierto=false}){
 const marcado=!ACEPTADOS.has(estado)||(confianza!==null&&confianza<UMBRAL);
 const correcto=iguales[tipo](esperado,obtenido);
 let categoria;
 if(debeMarcarse)categoria=marcado?"MARCADO_COMO_ESPERADO":"FALTA_MARCA";
 else if(!marcado)categoria=correcto?"CORRECTO":"INCORRECTO_NO_MARCADO";
 else if(obtenido===null||obtenido===undefined)categoria=correcto?"CORRECTO_A_REVISAR":"SIN_VALOR_MARCADO";
 else categoria=correcto?"CORRECTO_A_REVISAR":"INCORRECTO_MARCADO";
 if(incierto)categoria="ESPERADO_INCIERTO";
 return {campo,esperado,obtenido,estado,categoria,correcto,confianza,aviso:marcado?(motivos.filter(Boolean).join("; ")||(confianza!==null&&confianza<UMBRAL?"Confianza "+confianza+" < "+UMBRAL:estado)):""};
}

// Alineación de líneas esperadas/obtenidas para que una fila perdida no desplace las demás.
// Solo empareja filas; cada campo se juzga después igual. También vale la primera palabra del código
// leído («100200 RACOR» es la fila de «100200») y el importe (proveedores sin código): sin ello, una
// fila con texto pegado al código se emparejaba con la siguiente y daba errores que no eran.
function alinear(esperadas,obtenidas){
 const primera=t=>N.limpiar(String(t||"").trim().split(/\s+/)[0]||"");
 const sim=(e,o)=>(e.referencia&&(N.limpiar(e.referencia)===N.limpiar(o.referencia.literal)||
   (String(o.referencia.literal||"").trim().includes(" ")&&primera(o.referencia.literal)===N.limpiar(e.referencia)))?2:0)+
  (N.canon(e.descripcion)&&N.canon(e.descripcion)===N.canon(o.descripcion.literal)?1:0)+
  (e.importe!=null&&typeof o.importe?.valor==="number"&&[].concat(e.importe).some(x=>Math.abs(x-o.importe.valor)<1e-9)?1:0);
 const n=esperadas.length,m=obtenidas.length;
 const S=Array.from({length:n+1},()=>new Array(m+1).fill(0));
 for(let i=1;i<=n;i++)S[i][0]=-i;
 for(let j=1;j<=m;j++)S[0][j]=-j;
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
  const s=sim(esperadas[i-1],obtenidas[j-1]);
  S[i][j]=Math.max(S[i-1][j-1]+(s>0?s:-0.5),S[i-1][j]-1,S[i][j-1]-1);
 }
 const pares=[];let i=n,j=m;
 while(i>0||j>0){
  if(i>0&&j>0){
   const s=sim(esperadas[i-1],obtenidas[j-1]);
   if(S[i][j]===S[i-1][j-1]+(s>0?s:-0.5)){pares.push([i-1,j-1]);i--;j--;continue;}
  }
  if(i>0&&S[i][j]===S[i-1][j]-1){pares.push([i-1,null]);i--;}
  else{pares.push([null,j-1]);j--;}
 }
 return pares.reverse();
}

function comparar(resultado,esperado){
 const campos=[],marcados=new Set(esperado.marcados||[]),inciertos=new Set(esperado.inciertos||[]);
 const add=x=>campos.push(clasificar({...x,incierto:inciertos.has(x.campo)}));
 const prov=resultado.proveedor||{nif:null,estado:"VACIO"};
 // Un NIF bien leído pero aún no registrado es una lectura correcta del campo.
 const conf=x=>typeof x?.confianza==="number"?x.confianza:null;
 add({campo:"cabecera.proveedor_nif",tipo:"texto",esperado:esperado.proveedor_nif,obtenido:prov.nif,
  estado:prov.estado==="NIF_NO_REGISTRADO"?"OK":prov.estado,debeMarcarse:marcados.has("cabecera.proveedor_nif"),confianza:conf(prov),motivos:prov.motivos||[]});
 const num=resultado.numero||{valor:null,estado:"VACIO"};
 add({campo:"cabecera.numero",tipo:"texto",esperado:esperado.numero,obtenido:num.valor,estado:num.estado,debeMarcarse:marcados.has("cabecera.numero"),confianza:conf(num),motivos:num.motivos||[]});
 const fecha=resultado.fecha||{valor:null,estado:"VACIO"};
 add({campo:"cabecera.fecha",tipo:"texto",esperado:esperado.fecha,obtenido:fecha.valor,estado:fecha.estado,debeMarcarse:marcados.has("cabecera.fecha"),confianza:conf(fecha),motivos:fecha.motivos||[]});
 // Totales del pie, solo si el resultado esperado los incluye.
 for(const [k,e] of Object.entries(esperado.totales||{})){
  const t=resultado.totales?.[k]||{valor:null,estado:"VACIO"};
  add({campo:"totales."+k,tipo:"numero",esperado:e,obtenido:t.valor,estado:t.estado,debeMarcarse:marcados.has("totales."+k),confianza:conf(t),motivos:t.motivos||[]});
 }
 // Anotaciones manuscritas (códigos de obra y de STEL): solo si se ejecutó el motor de visión;
 // si no, se cuentan aparte como no evaluadas (no hay lectura que comparar).
 const sinMotor=[];
 for(const [k,e] of Object.entries(esperado.manuscritos||{})){
  if(!resultado.manuscritos){sinMotor.push("manuscritos."+k);continue;}
  const m=resultado.manuscritos[k]||{valor:null,estado:"VACIO"};
  // Sin anotación esperada y nada leído (ni literal): correcto, no «pendiente».
  const vacioEsperado=(e===null||e===undefined)&&m.estado==="VACIO"&&!m.literal&&!marcados.has("manuscritos."+k);
  add({campo:"manuscritos."+k,tipo:"texto",esperado:e,obtenido:m.valor,estado:vacioEsperado?"OK":m.estado,debeMarcarse:marcados.has("manuscritos."+k),confianza:vacioEsperado?null:conf(m),motivos:m.motivos||[]});
 }
 const lineas=[];
 for(const [ie,io] of alinear(esperado.lineas||[],resultado.lineas||[])){
  if(io===null){
   // Una línea no leída es aceptable solo si el documento quedó bloqueado y así se esperaba.
   const permitida=resultado.estado!=="AUTO_OK"&&(esperado.perdidas_permitidas||[]).includes(ie+1);
   lineas.push({fila_esperada:ie+1,categoria:permitida?"LINEA_PERDIDA_BLOQUEADA":"LINEA_PERDIDA"});continue;
  }
  if(ie===null){lineas.push({fila_obtenida:io+1,categoria:"LINEA_SOBRANTE"});continue;}
  const e=esperado.lineas[ie],o=resultado.lineas[io],p="lineas."+(ie+1)+".";
  const reglas=[["referencia","texto",o.referencia.valor],["descripcion","descripcion",o.descripcion.valor],
   ["cantidad","numero",o.cantidad.valor],["unidad","texto",o.unidad?.valor??null],["precio","numero",o.precio.valor],
   ["descuento","descuento",o.descuento.valor===null?null:o.descuento.porcentajes],["importe","numero",o.importe.valor]];
  for(const [k,tipo,valor] of reglas){
   if(!(k in e))continue;
   const campo=o[k]||{estado:"VACIO"};
   // Un campo vacío que se esperaba vacío es correcto (p. ej. precio = null en un albarán sin precios).
   const vacioEsperado=campo.estado==="VACIO"&&(e[k]===null||e[k]===undefined)&&!marcados.has(p+k);
   const motivos=campo.motivos||[];
   add({campo:p+k,tipo,esperado:e[k],obtenido:valor,estado:vacioEsperado?"OK":campo.estado,debeMarcarse:marcados.has(p+k),
    confianza:vacioEsperado?null:conf(campo),motivos});
  }
 }
 const criticos=campos.filter(c=>CRITICAS.has(c.categoria)).length+
  (resultado.estado==="AUTO_OK"?lineas.filter(l=>l.categoria==="LINEA_PERDIDA"||l.categoria==="LINEA_SOBRANTE").length:0);
 return {
  estado_esperado:esperado.estado_documento,estado_obtenido:resultado.estado,
  estado_correcto:!esperado.estado_documento||esperado.estado_documento===resultado.estado,
  // Un AUTO_OK con cualquier campo incorrecto es el peor fallo posible.
  auto_ok_falso:resultado.estado==="AUTO_OK"&&(criticos>0||campos.some(c=>c.categoria!=="CORRECTO")),
  campos,lineas,criticos,sin_motor:sinMotor
 };
}

function agregar(informes){
 const porCampo={},tot={};
 for(const inf of informes)for(const c of inf.comparacion.campos){
  const nombre=c.campo.replace(/^lineas\.\d+\./,"lineas.*.");
  porCampo[nombre]=porCampo[nombre]||{};
  porCampo[nombre][c.categoria]=(porCampo[nombre][c.categoria]||0)+1;
  tot[c.categoria]=(tot[c.categoria]||0)+1;
 }
 return {porCampo,totales:tot};
}

module.exports={comparar,agregar,alinear,CRITICAS,UMBRAL};
