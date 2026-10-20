"use strict";
/* Verificación automática contra una fuente independiente, íntegra y de solo
 * lectura. No basta la repetición de OCR; no se rellenan precios ni cantidades. */
(function(root,factory){
 const req=typeof module==='object'&&module.exports?require:null;
 const api=factory(root,req);if(req)module.exports=api;
 else {root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.verificacion=api;}
})(globalThis,function(root,req){
 const M=k=>req?require('./'+k+'.js'):root.DafricaAlbaranes[k];
 const codigo=v=>String(v||'').trim().toUpperCase().replace(/\s/g,'');
 function verificar(det,catalogo){
  if(!det?._ctx)return det;
  const p=det.proveedor;
  const prueba=catalogo?.solo_lectura===true&&catalogo.persistido===false&&catalogo.escritura_supabase===false&&catalogo.escritura_stel===false;
  if(!prueba){det.comprobacion_automatica={catalogo_disponible:false,motivos:['No se dispone de una respuesta verificable del catálogo de solo lectura']};return det;}
  const motivos=[];
  if(catalogo.proveedores_completo&&p?.nif&&M('nif').validar(p.nif).valido&&['OK','NIF_NO_REGISTRADO'].includes(p.estado)){
   const candidatos=(catalogo.proveedores||[]).filter(s=>M('nif').normalizar(s.nif)===M('nif').normalizar(p.nif));
   if(candidatos.length===1){
    p.estado='OK';p.motivos=[];p.account_id=candidatos[0].id;p.via='catalogo_stel_nif';
    p.verificacion_catalogo={metodo:'CIF exacto y único en catálogo completo',account_id:p.account_id};
   }else motivos.push(candidatos.length?'CIF duplicado en el catálogo de proveedores':'CIF no encontrado en el catálogo de proveedores');
  }else if(p?.estado!=='OK')motivos.push('Catálogo de proveedores incompleto o identidad no resoluble');
  const nombre=v=>M('articulos').descripcionNormalizada(v);
  if(catalogo.articulos_completo&&p?.account_id!=null){
   for(const l of det.lineas){
    const refs=new Set([l.referencia?.literal,...(l.referencia?.alternativas_ocr||[])].map(codigo).filter(Boolean));
    const candidatos=(catalogo.articulos||[]).filter(a=>refs.has(codigo(a.referencia))&&nombre(a.descripcion)&&nombre(a.descripcion)===nombre(l.descripcion?.literal));
    // Mismo texto pero dos códigos de catálogo posibles: no elegir ninguno.
    if(candidatos.length!==1){motivos.push('Fila '+l.fila+': referencia/descripción sin coincidencia exacta y única');continue;}
    const a=candidatos[0];
    if(l.referencia?.estado==='OK'){
     l.referencia={...l.referencia,literal:String(a.referencia),valor:String(a.referencia),validado_catalogo:true,
      literal_ocr_original:l.referencia.literal,motivos:[],
      resolucion:{metodo:'catalogo_stel',confianza:0.99,item_id:a.id,evidencias:['Referencia observada en OCR y nombre equivalente exacto en catálogo completo']}};
    }
    if(l.descripcion?.estado==='OK')l.descripcion={...l.descripcion,
     resolucion:{metodo:'catalogo_stel',confianza:0.96,item_id:a.id,evidencias:['Texto impreso equivalente al nombre del artículo de referencia única']}};
   }
  }else motivos.push('Catálogo de artículos incompleto o proveedor aún sin verificar');
  M('extraer').finalizar(det);
  det.comprobacion_automatica={catalogo_disponible:true,motivos};
  return det;
 }
 return {verificar};
});
