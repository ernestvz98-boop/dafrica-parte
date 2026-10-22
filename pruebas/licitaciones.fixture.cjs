'use strict';
const M=require('../licitaciones/modelo.js');
function fixture(){
  const fecha=M.hoy(),inicio=new Date().toISOString();
  const estimacion={cobertura:'PARCIAL',resumen:'Modelo ficticio; precios por validar.',partidas:[{concepto:'Paquete de prueba',importe:110}],
    modelo_economico:{alcance:'TODAS_LAS_FAMILIAS_MODELADAS',oferta_hipotetica:true,familias:Object.fromEntries(M.familiasCoste.map(k=>[k,'INCLUIDA_EN_PARTIDAS']))},
    escenarios:['PESIMISTA','BASE','OPTIMISTA'].map((nombre,i)=>({nombre,coste_total_sin_iva:120-i*10,oferta_sin_iva:100,beneficio_sin_iva:9999,margen_pct:99}))};
  const o={organo:'Organismo ficticio',expediente:'EXP-FICTICIO',lote:'1',objeto:'Reforma ficticia',ubicacion:'Localidad ficticia',estado:'ABIERTA',recomendacion:'ESTUDIAR',moneda:'EUR',url:'https://example.org/anuncio',fuentes:['https://example.org/pliego',{url:'https://example.org/ppt',nombre:'PPT ficticio'}],estimacion};
  return [{id:'informe-ficticio-a',clave_ejecucion:'licitaciones-estudio:'+fecha+':prueba',fecha_local:fecha,estado:'PARCIAL',iniciada_en:inicio,finalizada_en:inicio,resumen:'Informe ficticio de navegador',informe:'<script>window.__xss=true</script>',fuentes:[{url:'https://example.org/fuente',nombre:'Fuente ficticia',estado:'FALLIDA'}],limitaciones:['Prueba local'],oportunidades:[o,{...o,lote:'2',objeto:'<img src=x onerror="window.__xss=true">',recomendacion:'PENDIENTE_DE_DATOS',estimacion:{cobertura:'NO_ESTIMABLE'}}]},
    {id:'informe-ficticio-b',clave_ejecucion:'licitaciones-diarias:'+fecha,fecha_local:fecha,estado:'PARCIAL',iniciada_en:inicio,finalizada_en:inicio,resumen:'Informe diario ficticio',oportunidades:[]}];
}
module.exports={fixture};
