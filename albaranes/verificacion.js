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
  // Clases de caracteres que el OCR confunde en códigos impresos (O/0, S/5, I/1, B/8, Z/2, G/6).
  const clase=v=>codigo(v).replace(/O/g,'0').replace(/S/g,'5').replace(/I/g,'1').replace(/B/g,'8').replace(/Z/g,'2').replace(/G/g,'6');
  // Descripción compatible con el nombre del catálogo: las mismas cifras (medidas) y la mayoría de
  // las palabras leídas presentes en el nombre (el OCR puede perder o deformar alguna palabra).
  const compatible=(ocr,cat)=>{
   const a=nombre(ocr),b=nombre(cat);if(!a||!b)return false;
   if(a===b)return true;
   const cifras=t=>new Set((t.match(/\d+(?:,\d+)?/g)||[]));
   const ca=cifras(a),cb=cifras(b);
   if(ca.size!==cb.size||[...ca].some(x=>!cb.has(x)))return false;
   const pa=a.split(' ').filter(w=>w.length>2&&!/^\d/.test(w)),pb=new Set(b.split(' '));
   return pa.length>0&&pa.filter(w=>pb.has(w)).length/pa.length>=0.6;
  };
  // Artículos: proveedor verificado en el catálogo o identificado con seguridad por la huella de su CIF.
  if(catalogo.articulos_completo&&(p?.account_id!=null||(p?.estado==='OK'&&p?.via==='nif'))){
   for(const l of det.lineas){
    const refs=new Set([l.referencia?.literal,...(l.referencia?.alternativas_ocr||[])].map(codigo).filter(Boolean));
    const exactos=(catalogo.articulos||[]).filter(a=>refs.has(codigo(a.referencia))&&nombre(a.descripcion)&&nombre(a.descripcion)===nombre(l.descripcion?.literal));
    // Sin coincidencia exacta: referencia EXISTENTE en el catálogo que solo difiere de lo leído en
    // caracteres confundibles, única en todo el catálogo y con descripción compatible. Nunca se
    // fabrica un código: se toma el del catálogo, y solo si no hay otro equivalente.
    const clases=new Set([...refs].map(clase));
    const equivalentes=exactos.length?[]:(catalogo.articulos||[]).filter(a=>clases.has(clase(a.referencia)));
    const porClase=equivalentes.filter(a=>compatible(l.descripcion?.valor??l.descripcion?.literal,a.descripcion));
    const candidatos=exactos.length?exactos:(equivalentes.length===1?porClase:[]);
    // Mismo texto pero dos códigos de catálogo posibles: no elegir ninguno.
    if(candidatos.length!==1){motivos.push('Fila '+l.fila+': referencia/descripción sin coincidencia exacta y única');continue;}
    const a=candidatos[0],porConfundibles=!exactos.length;
    if(l.referencia?.estado==='OK'){
     l.referencia={...l.referencia,literal:String(a.referencia),valor:String(a.referencia),validado_catalogo:true,
      literal_ocr_original:l.referencia.literal,motivos:[],
      resolucion:porConfundibles?{metodo:'catalogo_stel_confundibles',confianza:0.97,item_id:a.id,lectura_ocr:l.referencia.literal,
       evidencias:['El OCR leyó «'+l.referencia.literal+'»; difiere de la referencia del catálogo «'+a.referencia+'» solo en caracteres confundibles (O/0, S/5, I/1, B/8, Z/2, G/6)',
        'Única referencia equivalente en el catálogo completo de STEL (solo lectura)','Descripción compatible: «'+a.descripcion+'»']}:
       {metodo:'catalogo_stel',confianza:0.99,item_id:a.id,evidencias:['Referencia observada en OCR y nombre equivalente exacto en catálogo completo']}};
    }
    // La descripción solo se da por buena si el texto impreso es equivalente al nombre del catálogo.
    if(l.descripcion?.estado==='OK'&&nombre(a.descripcion)===nombre(l.descripcion?.valor??l.descripcion?.literal))l.descripcion={...l.descripcion,
     resolucion:{metodo:'catalogo_stel',confianza:0.96,item_id:a.id,evidencias:['Texto impreso equivalente al nombre del artículo de referencia única']}};
   }
  }else motivos.push('Catálogo de artículos incompleto o proveedor aún sin verificar');
  M('extraer').finalizar(det);
  det.comprobacion_automatica={catalogo_disponible:true,motivos};
  return det;
 }
 return {verificar};
});
