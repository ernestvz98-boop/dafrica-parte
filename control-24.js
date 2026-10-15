"use strict";
// Perfil experimental de Saltoki: detecta FILAS geométricamente y conserva sus columnas.
function pcSaltokiGroups(ctx,canvas,rect){
 const [x0,y0,x1,y1]=rect;
 const xx=Math.round(canvas.width*x0),yy=Math.round(canvas.height*y0);
 const w=Math.round(canvas.width*x1)-xx,h=Math.round(canvas.height*y1)-yy;
 const bytes=ctx.getImageData(xx,yy,w,h).data;
 const levels=new Uint16Array(h),min=Math.max(5,Math.round(w*.035));
 for(let y=0;y<h;y++){
  let count=0;
  for(let x=0;x<w;x++){
   const k=(y*w+x)*4;
   const v=.299*bytes[k]+.587*bytes[k+1]+.114*bytes[k+2];
   if(v<150)count++;
  }
  levels[y]=count;
 }
 const grouped=[];
 for(let y=0;y<h;y++){
  if(levels[y]<min)continue;
  if(grouped.length&&y-grouped[grouped.length-1].at(-1)<=2)grouped[grouped.length-1].push(y);
  else grouped.push([y]);
 }
 const minHeight=Math.max(5,Math.floor(canvas.height/2105*6));
 return grouped.filter(g=>g.length>=minHeight).map(g=>({
  start:yy+g[0],end:yy+g.at(-1),center:yy+(g[0]+g.at(-1))/2
 }));
}
function pcSaltokiMediana(vals){
 const sorted=[...vals].sort((a,b)=>a-b);
 return sorted[Math.floor(sorted.length/2)]||0;
}
async function pcLeerSaltokiFilas(doc){
 if(!String(doc?.proveedor||"").toUpperCase().includes("SALTOKI"))
  throw Error("Perfil específico solo para SALTOKI");
 const encoded=String(doc.pdf_separado_b64||"");
 if(!encoded||encoded.length>9_000_000)throw Error("Falta PDF original para la lectura geométrica");
 const pdfjs=await pcLoadPdfJs();
 const binary=atob(encoded),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 const task=pdfjs.getDocument({data:bytes,verbosity:0,useSystemFonts:true});
 let page,canvas;
 try{
  const docPdf=await task.promise;
  if(docPdf.numPages!==1)throw Error("Saltoki: el perfil de filas solo admite una página");
  page=await docPdf.getPage(1);
  const base=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(5.2,2400/base.width)});
  canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true,alpha:false});
  if(!ctx)throw Error("El navegador no permite identificar líneas");
  ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx,viewport}).promise;
  // Columnas del formato Saltoki, medidas sobre una muestra real de octubre de 2026.
  const refs=pcSaltokiGroups(ctx,canvas,[.101,.16,.180,.52]);
  const qty=pcSaltokiGroups(ctx,canvas,[.65,.16,.735,.52]);
  if(refs.length<7||refs.length>50||refs.length!==qty.length)
   throw Error("La geometría no coincide: "+refs.length+" referencias y "+qty.length+" cantidades; no se infieren filas faltantes");
  const gaps=refs.slice(1).map((r,i)=>r.center-refs[i].center);
  const spacing=pcSaltokiMediana(gaps);
  if(spacing<10||gaps.some(d=>Math.abs(d-spacing)>Math.max(6,spacing*.20)))
   throw Error("El espacio entre filas no es regular. El formato de Saltoki puede haber cambiado.");
  if(refs.some((r,i)=>Math.abs(r.center-qty[i].center)>spacing*.19))
   throw Error("La columna de cantidades no está alineada con la de referencias");
  const count=refs.length;
  const firstX=Math.floor(canvas.width*.092),lastX=Math.ceil(canvas.width*.746);
  const sourceW=lastX-firstX,lead=65;
  const half=Math.min(spacing*.45,canvas.height*.009);
  const rowH=56,top=34,scaling=Math.min(1.35,1730/sourceW),bodyW=Math.ceil(sourceW*scaling);
  // La anotación PRY manuscrita se trata aparte: no debe confundirse con las filas impresas.
  const pryCrop=document.createElement("canvas");
  const px0=Math.floor(canvas.width*.44),py0=Math.floor(canvas.height*.565);
  const pw=Math.floor(canvas.width*.31),ph=Math.floor(canvas.height*.095);
  pryCrop.width=1200;pryCrop.height=Math.round(1200*ph/pw);
  const pryCtx=pryCrop.getContext("2d",{alpha:false});
  pryCtx.fillStyle="#fff";pryCtx.fillRect(0,0,pryCrop.width,pryCrop.height);
  pryCtx.drawImage(canvas,px0,py0,pw,ph,0,0,pryCrop.width,pryCrop.height);
  const pryImagen=pryCrop.toDataURL("image/jpeg",.96);
  pryCrop.width=0;pryCrop.height=0;
  const bands=[];
  for(let offset=0;offset<count;offset+=5){
   const m=Math.min(5,count-offset),out=document.createElement("canvas");
   out.width=lead+bodyW+14;out.height=top+m*rowH+8;
   const c=out.getContext("2d",{alpha:false});
   c.fillStyle="#ffffff";c.fillRect(0,0,out.width,out.height);
   c.fillStyle="#1a1a1a";c.font="bold 16px sans-serif";
   c.fillText("FILA",8,24);
   c.fillText("REFERENCIA",lead+5,24);
   c.fillText("DESCRIPCIÓN",lead+bodyW*.23,24);
   c.fillText("CANTIDAD",lead+bodyW*.86,24);
   for(let j=0;j<m;j++){
    const ref=refs[offset+j],y=Math.round(ref.center-half);
    const h=Math.ceil(half*2);
    c.drawImage(canvas,firstX,y,sourceW,h,lead,top+j*rowH,bodyW,rowH);
    c.fillStyle="#000000";c.font="bold 18px sans-serif";
    c.fillText("F"+(offset+j+1),7,top+j*rowH+rowH*.65);
    c.strokeStyle="#bec4cc";c.lineWidth=1;
    c.beginPath();c.moveTo(0,top+(j+1)*rowH);c.lineTo(out.width,top+(j+1)*rowH);c.stroke();
   }
   bands.push(out.toDataURL("image/jpeg",.94));
   out.width=0;out.height=0;
  }
  const parsed=await sb("/functions/v1/compras-saltoki-filas",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({numero_filas:count,franjas:bands,imagen_codigo:pryImagen})
  });
  if(!Array.isArray(parsed.lineas)||parsed.lineas.length!==count)
   throw Error("La IA no ha devuelto todas las "+count+" filas detectadas");
  const warnings=Array.isArray(parsed.advertencias)?parsed.advertencias:[];
  return {
   tipo:"SALTOKI_FILAS",numero_filas_geometricas:count,
   estado:parsed.estado,lineas_validas:parsed.lineas_validas===true,codigo_pry_sin_conflictos:parsed.codigo_pry_sin_conflictos===true,lineas:parsed.lineas.map(x=>({
    referencia:String(x.referencia||""),
    descripcion:String(x.descripcion||""),
    cantidad:x.cantidad,unidad:String(x.unidad||""),
    precio_unitario:x.precio_unitario
   })),
   codigo_proyecto:String(parsed.codigo_proyecto||""),codigo_proyecto_literal:String(parsed.codigo_proyecto_literal||""),
   advertencias:warnings,imagenes_zonas:bands,
   fuente:"Columnas de referencias y cantidades alineadas físicamente"
  };
 }finally{
  if(canvas){canvas.width=0;canvas.height=0;}
  await task.destroy().catch(()=>{});
 }
}
