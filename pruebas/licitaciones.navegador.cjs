'use strict';
// Prueba de navegador aislada. Solo datos sintéticos; no conecta con Supabase o STEL.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./licitaciones.fixture.cjs');
const root=path.resolve(__dirname,'..');
async function boot(browser,options={}){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.setContent('<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><main id="content" style="max-width:1280px;margin:auto;padding:20px"></main></body></html>');
  await page.addStyleTag({path:path.join(root,'control.css')});await page.addStyleTag({path:path.join(root,'licitaciones/registro.css')});
  await page.addScriptTag({path:path.join(root,'licitaciones/modelo.js')});
  await page.evaluate(({rows,options})=>{
    window._allowed=options.denied!==true;window._calls=[];window._fail=options.fail===true;window._rows=rows;
    window.modules=[];window.state={module:'licitaciones'};window.has=()=>window._allowed;
    window.renderModule=async()=>{};window.setTopbar=()=>{};window.setContent=html=>document.querySelector('#content').innerHTML=html;window.$=id=>document.getElementById(id);
    window.sb=async query=>{window._calls.push(query);if(window._fail)throw new Error('Fallo sintético');if(!window._allowed)throw new Error('Acceso denegado');
      if(query.includes('id=eq.'))return window._rows.filter(r=>query.includes('id=eq.'+r.id));return window._rows;};
  },{rows:fixture(),options});
  await page.addScriptTag({path:path.join(root,'control-30.js')});await page.evaluate(()=>window.renderModule());
  return page;
}
if(require.main===module)(async()=>{
  const {chromium}=require('playwright');
  const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||chromium.executablePath();
  const browser=await chromium.launch({headless:true,...(fs.existsSync(executable)?{executablePath:executable}:{})});
  try{
    const page=await boot(browser);
    assert.deepEqual(await page.locator('#liDecision option').allTextContents(),['Todas','Estudiar','Pendiente de datos','Descartar']);
    assert.equal(await page.locator('.li-opportunity').count(),2);
    assert.match(await page.locator('#liComparison').innerText(),/-10,00/);
    assert.match(await page.locator('#liComparison').innerText(),/simulación/);
    assert.equal(await page.locator('a[href="https://example.org/pliego"]').count(),1);
    assert.equal(await page.locator('a[href="https://example.org/ppt"]').count(),1);
    assert.equal(await page.locator('#liItems img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
    await page.selectOption('#liDecision','ESTUDIAR');assert.equal(await page.locator('.li-opportunity').count(),1);
    await page.selectOption('#liDecision','');await page.selectOption('#liEconomia','SIN_MODELO');assert.equal(await page.locator('.li-opportunity').count(),1);
    await page.selectOption('#liEconomia','PERDIDA_BASE');assert.equal(await page.locator('.li-opportunity').count(),1);
    await page.locator('[data-li-open="0"]').click();assert.equal(await page.locator('#liOpportunity0').evaluate(e=>e.open),true);
    assert.match(await page.locator('#liOpportunity0').innerText(),/Simulación con supuestos/);
    const options=await page.locator('#liInforme option').allTextContents();assert.match(options[0],/Estudio complementario/);assert.match(options[1],/Revisión diaria/);
    const download=page.waitForEvent('download');await page.locator('#liDescargar').click();assert.match((await download).suggestedFilename(),/licitaciones-.*\.txt/);
    await page.evaluate(()=>window._allowed=false);let leaked=false;page.on('download',()=>leaked=true);await page.locator('#liDescargar').click();await page.waitForTimeout(100);assert.equal(leaked,false);
    await page.evaluate(()=>window._allowed=true);await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.LICITACIONES_SCREENSHOT_DIR){const dest=process.env.LICITACIONES_SCREENSHOT_DIR;fs.mkdirSync(dest,{recursive:true});await page.screenshot({path:path.join(dest,'licitaciones-movil-sintetico.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(dest,'licitaciones-escritorio-sintetico.png'),fullPage:true});}
    await page.close();
    const denied=await boot(browser,{denied:true});assert.match(await denied.locator('#content').innerText(),/No tienes permiso/);assert.equal((await denied.evaluate(()=>window._calls)).length,0);await denied.close();
    const failed=await boot(browser,{fail:true});assert.match(await failed.locator('[role="alert"]').innerText(),/No se pudo leer/);assert.equal(await failed.locator('#liItems').count(),0);await failed.close();
    console.log('Navegador OK: filtros, pérdidas, supuestos, enlaces, historial, exportación privada, permisos, errores, XSS y móvil.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
