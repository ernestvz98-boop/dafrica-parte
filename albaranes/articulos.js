"use strict";
/*
 * DAFRICA · Resolución de artículos STEL para las líneas de un albarán de compra.
 *
 * Orden de búsqueda (la primera regla que da UNA coincidencia fiable gana):
 *   1. correspondencia guardada proveedor + referencia            → "mapeado"
 *   2. referencia exacta del proveedor en el catálogo STEL         → "existente"
 *   3. código de barras exacto (si la línea lo trae)               → "existente"
 *   4. coincidencia inequívoca (misma descripción normalizada)     → "existente"
 * Sin coincidencias: comprobación final anti-duplicados (referencia sin ceros ni signos,
 * descripción con mayúsculas/espacios/unidades normalizados). Si aparece algún parecido,
 * NO se crea: "revision_articulo". Si no, se propone el alta  → "crear"
 * (tras darlo de alta, el estado registrado es "creado_automaticamente").
 * Varias coincidencias en cualquier regla → "revision_articulo". Nunca se elige al azar.
 *
 * El catálogo STEL no guarda el proveedor de un artículo; por convención DAFRICA usa
 * categorías por proveedor (p. ej. «Saltoki»). Si se conoce la categoría del proveedor,
 * se usa para desempatar y para rechazar artículos de la categoría de otro proveedor.
 * Funciones puras: no leen ni escriben en STEL ni en Supabase.
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.articulos=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const N=()=>req?req("./normalizar.js"):root.DafricaAlbaranes.normalizar;
const ESTADOS={EXISTENTE:"existente",MAPEADO:"mapeado",CREADO:"creado_automaticamente",REVISION:"revision_articulo",CREAR:"crear"};

const refCanon=v=>N().canon(v);
const refSinCeros=v=>refCanon(v).replace(/^0+(?=\d)/,"");
const UNIDADES=[[/\b(METROS?|MTS?|MT)\b/g,"M"],[/\b(MILIMETROS?|MMS)\b/g,"MM"],[/\b(CENTIMETROS?|CMS)\b/g,"CM"],
 [/\b(UNIDADES|UNIDAD|UDS|UNDS|UN|U)\b/g,"UD"],[/\b(KILOS?|KGS)\b/g,"KG"],[/\b(LITROS?|LTS?|LT)\b/g,"L"]];
/* Descripción normalizada: sin acentos, mayúsculas, signos fuera, unidades unificadas,
   números pegados a su unidad («25 KG» = «25KG»). */
function descripcionNormalizada(v){
 let s=N().sinAcentos(v).replace(/Ø/g," D ").replace(/[^A-Z0-9,.X ]/g," ").replace(/(\d)[,.](?=\d)/g,"$1_").replace(/[,.]/g," ").replace(/_/g,",");
 for(const [re,u] of UNIDADES)s=s.replace(re,u);
 return s.replace(/(\d)\s+(MM|CM|M|KG|L|UD|W|V|A)\b/g,"$1$2").replace(/\s+/g," ").trim();
}
const fichas=s=>new Set(descripcionNormalizada(s).split(" ").filter(t=>t.length>1));
function parecido(a,b){
 const x=fichas(a),y=fichas(b);if(!x.size||!y.size)return 0;
 let comun=0;for(const t of x)if(y.has(t))comun++;
 return comun/(x.size+y.size-comun);
}
const activo=p=>p&&p.deleted!==true&&p.inactive!==true;

function elegir(candidatos,categoria,via,estado){
 let lista=candidatos.filter(activo);
 if(!lista.length)return null;
 if(categoria!=null&&lista.length>1){
  const deSuCategoria=lista.filter(p=>String(p["product-category-id"])===String(categoria));
  if(deSuCategoria.length)lista=deSuCategoria;
 }
 if(lista.length>1)return {estado:ESTADOS.REVISION,via,candidatos:lista.map(p=>p.id),motivo:"Varios artículos posibles por "+via};
 const p=lista[0];
 if(categoria!=null&&p["product-category-id"]!=null&&String(p["product-category-id"])!==String(categoria))
  return {estado:ESTADOS.REVISION,via,candidatos:[p.id],motivo:"El único artículo por "+via+" pertenece a la categoría de otro proveedor"};
 return {estado,item_id:p.id,via,candidatos:[p.id],motivo:""};
}

/*
 * linea: {referencia, descripcion, unidad?, barcode?}
 * proveedor: {account_id, nif?, categoria_id?}
 * datos: {mapeos:[{account_id, referencia_canonica, item_id}], catalogo:[producto STEL], catalogo_completo:boolean}
 */
function resolverArticulo(linea,proveedor,datos){
 const ref=refCanon(linea.referencia),cat=proveedor.categoria_id??null,catalogo=datos.catalogo||[];
 const porId=new Map(catalogo.map(p=>[String(p.id),p]));
 // 1. Correspondencia guardada.
 const mapeo=(datos.mapeos||[]).find(m=>String(m.account_id)===String(proveedor.account_id)&&m.referencia_canonica===ref&&ref);
 if(mapeo){
  const p=porId.get(String(mapeo.item_id));
  if(p&&activo(p))return {estado:ESTADOS.MAPEADO,item_id:p.id,via:"mapeo_guardado",candidatos:[p.id],motivo:""};
  if(p||datos.catalogo_completo)return {estado:ESTADOS.REVISION,via:"mapeo_guardado",candidatos:[mapeo.item_id],motivo:"El artículo del mapeo guardado ya no existe o está inactivo"};
  return {estado:ESTADOS.MAPEADO,item_id:mapeo.item_id,via:"mapeo_guardado",candidatos:[mapeo.item_id],motivo:"Artículo no presente en la parte leída del catálogo"};
 }
 // 2. Referencia exacta.
 if(ref){const r=elegir(catalogo.filter(p=>refCanon(p.reference)===ref),cat,"referencia",ESTADOS.EXISTENTE);if(r)return r;}
 // 3. Código de barras.
 const bc=refCanon(linea.barcode);
 if(bc){const r=elegir(catalogo.filter(p=>refCanon(p.barcode)===bc),cat,"codigo_barras",ESTADOS.EXISTENTE);if(r)return r;}
 // 4. Coincidencia inequívoca por descripción normalizada (exacta).
 const desc=descripcionNormalizada(linea.descripcion);
 if(desc){const r=elegir(catalogo.filter(p=>descripcionNormalizada(p.name)===desc),cat,"descripcion",ESTADOS.EXISTENTE);if(r)return r;}
 // Sin coincidencia: no se puede crear sin datos mínimos ni con un catálogo leído a medias.
 if(!ref&&!desc)return {estado:ESTADOS.REVISION,via:"sin_datos",candidatos:[],motivo:"Línea sin referencia ni descripción"};
 if(!datos.catalogo_completo)return {estado:ESTADOS.REVISION,via:"catalogo_incompleto",candidatos:[],motivo:"No se crea un artículo sin haber leído el catálogo completo"};
 // Comprobación final anti-duplicados.
 const sinCeros=refSinCeros(linea.referencia);
 const parecidos=catalogo.filter(activo).filter(p=>
  (sinCeros&&refSinCeros(p.reference)===sinCeros)||
  (ref&&refCanon(p.reference).length>=4&&(refCanon(p.reference).includes(ref)||ref.includes(refCanon(p.reference))))||
  (desc&&parecido(p.name,linea.descripcion)>=0.85));
 if(parecidos.length)return {estado:ESTADOS.REVISION,via:"anti_duplicados",candidatos:parecidos.map(p=>p.id).slice(0,10),
  motivo:"Artículos parecidos en STEL; no se crea otro automáticamente"};
 return {estado:ESTADOS.CREAR,item_id:null,via:"alta_nueva",candidatos:[],motivo:"",
  propuesta_alta:{reference:N().limpiar(linea.referencia),name:N().limpiar(linea.descripcion),
   "product-category-id":cat,descripcion_normalizada:desc,unidad:N().limpiar(linea.unidad||""),barcode:N().limpiar(linea.barcode||"")||null}};
}

return {ESTADOS,resolverArticulo,descripcionNormalizada,parecido};
});
