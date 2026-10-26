'use strict';
// Prueba de navegador de la verificación en dos pasos (2026-10-26). Supabase simulado con datos
// ficticios: no conecta con Supabase ni con STEL. Uso: node pruebas/dos-pasos.navegador.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const SUPA='https://sbocfjxamjmwabmqbeyw.supabase.co';
const TIPOS={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png'};

const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=aal=>b64({alg:'HS256'})+'.'+b64({sub:'usuario-ficticio',aal,exp:Math.floor(Date.now()/1000)+3600})+'.firma';

// `todos`: sirve control-1.js con el interruptor DOS_PASOS_PARA_TODOS encendido.
function servidor({todos=false}={}){
  return new Promise(res=>{
    const s=http.createServer((req,resp)=>{
      const ruta=decodeURIComponent(new URL(req.url,'http://x').pathname);
      const f=path.join(root,ruta==='/'?'index.html':ruta);
      if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);resp.end();return;}
      resp.writeHead(200,{'Content-Type':TIPOS[path.extname(f)]||'application/octet-stream'});
      if(todos&&ruta==='/control-1.js'){
        const js=fs.readFileSync(f,'utf8');
        assert.match(js,/const DOS_PASOS_PARA_TODOS = false;/);
        resp.end(js.replace('const DOS_PASOS_PARA_TODOS = false;','const DOS_PASOS_PARA_TODOS = true;'));return;
      }
      fs.createReadStream(f).pipe(resp);
    });
    s.listen(0,'127.0.0.1',()=>res(s));
  });
}

// Supabase Auth simulado: contraseña → aal1; alta TOTP; reto y verificación con el código 123456 → aal2.
function simulador(){
  const st={factores:[],llamadas:[],permisosSinAal2:0,siguiente:1};
  const nivel=req=>{try{return JSON.parse(Buffer.from((req.headers().authorization||'').split(' ')[1].split('.')[1],'base64url')).aal;}catch{return null;}};
  const responder=(route,status,cuerpo,cab={})=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*',...cab},body:cuerpo===undefined?'':JSON.stringify(cuerpo)});
  const manejar=async route=>{
    const req=route.request(),u=new URL(req.url()),m=req.method(),p=u.pathname;
    if(m==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    st.llamadas.push(m+' '+p);
    const cuerpo=req.postData()?JSON.parse(req.postData()):{};
    if(p==='/auth/v1/token'&&u.searchParams.get('grant_type')==='password')
      return cuerpo.password==='clave-ficticia'?responder(route,200,{access_token:jwt('aal1'),refresh_token:'r1',expires_in:3600}):responder(route,400,{error_description:'Invalid login credentials'});
    if(p==='/auth/v1/user')return responder(route,200,{id:'usuario-ficticio',email:'prueba@example.org',factors:st.factores});
    if(p==='/auth/v1/factors'&&m==='POST'){
      const id='f'+st.siguiente++;st.factores.push({id,factor_type:'totp',status:'unverified'});
      return responder(route,200,{id,type:'totp',totp:{qr_code:'data:image/svg+xml;utf-8,<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ffffff"/><path d="M1 1h3v3H1z" fill="#000000"/></svg>',secret:'SECRETOFICTICIO',uri:'otpauth://totp/DAFRICA%20Control:prueba@example.org?secret=SECRETOFICTICIO&issuer=DAFRICA%20Control'}});
    }
    let x=p.match(/^\/auth\/v1\/factors\/([^/]+)$/);
    if(x&&m==='DELETE'){st.factores=st.factores.filter(f=>f.id!==x[1]);return responder(route,200,{id:x[1]});}
    x=p.match(/^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/);
    if(x){
      const f=st.factores.find(f=>f.id===x[1]);if(!f)return responder(route,404,{msg:'Factor not found'});
      if(x[2]==='challenge')return responder(route,200,{id:'reto-'+x[1]});
      if(cuerpo.code!=='123456')return responder(route,422,{code:422,error_code:'mfa_verification_failed',msg:'Invalid TOTP code entered'});
      f.status='verified';return responder(route,200,{access_token:jwt('aal2'),refresh_token:'r2',expires_in:3600});
    }
    if(p==='/auth/v1/logout')return responder(route,204);
    // Base de datos simulada: con la verificación activada, sin aal2 no hay permisos (tiene_permiso).
    if(p==='/rest/v1/rpc/mis_permisos'){
      if(nivel(req)!=='aal2'&&st.factores.some(f=>f.status==='verified')){st.permisosSinAal2++;return responder(route,200,[]);}
      return responder(route,200,[{codigo:'costes.ver'}]);
    }
    if(p.startsWith('/rest/v1/'))return responder(route,200,[],{'content-range':'0-0/0'});
    return responder(route,404,{});
  };
  return {st,manejar};
}

async function nuevaPagina(browser,base,sim,{sesion}={}){
  const ctx=await browser.newContext();
  await ctx.route(SUPA+'/**',sim.manejar);
  await ctx.route(/^https:\/\/(?!sbocfjxamjmwabmqbeyw)/,r=>r.abort());
  if(sesion)await ctx.addInitScript(s=>{if(!sessionStorage.getItem('puesta')){localStorage.setItem('dafrica_web_session',JSON.stringify(s));sessionStorage.setItem('puesta','1');}},sesion);
  const page=await ctx.newPage();
  await ctx.addInitScript({path:path.join(root,'albaranes/vendor/jsQR.js')});
  const errores=[];page.on('pageerror',e=>errores.push(String(e)));
  await page.goto(base+'/');
  return {page,ctx,errores};
}
const visible=(page,sel)=>page.locator(sel).isVisible();
const guardada=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('dafrica_web_session')||'null'));
const nivelGuardado=async page=>{const s=await guardada(page);return s?JSON.parse(Buffer.from(s.access_token.split('.')[1],'base64url')).aal:null;};

if(require.main===module)(async()=>{
  const {chromium}=require('playwright');
  const srv=await servidor({todos:true});const base='http://127.0.0.1:'+srv.address().port;
  const srvReal=await servidor();const baseReal='http://127.0.0.1:'+srvReal.address().port;
  const browser=await chromium.launch();
  try{
    // 0. Interruptor apagado (lo publicado): sin el código activado se entra con la contraseña, sin
    //    alta; con el código activado, se pide siempre.
    {
      const s0=simulador();
      const {page,ctx,errores}=await nuevaPagina(browser,baseReal,s0);
      await page.fill('#loginEmail','prueba@example.org');await page.fill('#loginPassword','clave-ficticia');await page.click('#loginButton');
      await page.waitForSelector('#appView:not(.hidden)');
      assert.equal(await visible(page,'#mfaForm'),false);
      assert.ok(!s0.st.llamadas.includes('POST /auth/v1/factors'),'sin el interruptor no se crea ningún alta');
      assert.deepEqual(errores,[]);
      await ctx.close();
      const s1=simulador();s1.st.factores.push({id:'fv',factor_type:'totp',status:'verified'});
      const r=await nuevaPagina(browser,baseReal,s1);
      await r.page.fill('#loginEmail','prueba@example.org');await r.page.fill('#loginPassword','clave-ficticia');await r.page.click('#loginButton');
      await r.page.waitForSelector('#mfaForm:not(.hidden)');
      assert.equal(await visible(r.page,'#mfaAlta'),false);
      assert.equal(await visible(r.page,'#appView'),false);
      await r.page.fill('#mfaCodigo','123456');await r.page.click('#mfaBoton');
      await r.page.waitForSelector('#appView:not(.hidden)');
      assert.equal(await nivelGuardado(r.page),'aal2');
      await r.ctx.close();
    }
    // 1. Interruptor encendido. Primera entrada: alta obligatoria con QR; código mal escrito, incorrecto y correcto.
    const sim=simulador();sim.st.factores.push({id:'f0',factor_type:'totp',status:'unverified'});
    let {page,ctx,errores}=await nuevaPagina(browser,base,sim);
    await page.fill('#loginEmail','prueba@example.org');await page.fill('#loginPassword','clave-ficticia');await page.click('#loginButton');
    await page.waitForSelector('#mfaForm:not(.hidden)');
    assert.equal(await visible(page,'#loginForm'),false);
    assert.equal(await visible(page,'#mfaAlta'),true,'la primera vez se muestra el alta con QR');
    // El QR se ve y contiene la dirección otpauth (fallo real: el SVG de Supabase no se mostraba).
    await page.waitForFunction(()=>document.querySelector('#mfaQr').complete);
    assert.ok(await page.evaluate(()=>document.querySelector('#mfaQr').naturalWidth>0),'la imagen del QR se carga');
    const leido=await page.evaluate(()=>{const i=document.querySelector('#mfaQr'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;
      const x=c.getContext('2d');x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height);return jsQR(d.data,c.width,c.height)?.data||null;});
    assert.match(leido||'',/^otpauth:\/\/totp\/.*secret=SECRETOFICTICIO/);
    assert.equal(await page.textContent('#mfaSecreto'),'SECRETOFICTICIO');
    assert.equal(await page.inputValue('#loginPassword'),'','la contraseña no se queda en el formulario');
    assert.ok(sim.st.llamadas.includes('DELETE /auth/v1/factors/f0'),'el alta a medias anterior se borra');
    await page.fill('#mfaCodigo','12');await page.click('#mfaBoton');
    assert.match(await page.textContent('#mfaMsg'),/6 números/);
    await page.fill('#mfaCodigo','000000');await page.click('#mfaBoton');
    await page.waitForFunction(()=>/incorrecto/.test(document.querySelector('#mfaMsg').textContent));
    assert.equal(await visible(page,'#appView'),false,'con un código incorrecto no se entra');
    await page.fill('#mfaCodigo','123 456');await page.click('#mfaBoton');
    await page.waitForSelector('#appView:not(.hidden)');
    assert.equal(await nivelGuardado(page),'aal2');
    assert.equal(sim.st.permisosSinAal2,0,'los permisos se piden ya con la verificación hecha');
    assert.equal(await visible(page,'#mfaForm'),false);
    // 2. Recargar con la sesión verificada: entra directamente.
    await page.reload();await page.waitForSelector('#appView:not(.hidden)');
    assert.equal(await visible(page,'#mfaForm'),false);
    assert.deepEqual(errores,[]);
    await ctx.close();

    // 3. Sesión solo con contraseña (p. ej. contraseña robada) y verificación activada: pide el código,
    //    sin QR; al cancelar se cierra la sesión también en el servidor.
    const ses1={access_token:jwt('aal1'),refresh_token:'r1',expires_at:Date.now()+3600e3,ultimo_uso:Date.now()};
    ({page,ctx,errores}=await nuevaPagina(browser,base,sim,{sesion:ses1}));
    await page.waitForSelector('#mfaForm:not(.hidden)');
    assert.equal(await visible(page,'#mfaAlta'),false,'con la verificación ya activada no se vuelve a mostrar el QR');
    assert.equal(await visible(page,'#appView'),false);
    const altas=sim.st.llamadas.filter(l=>l==='POST /auth/v1/factors').length;
    await page.click('#mfaSalir');
    await page.waitForSelector('#loginForm:not(.hidden)');
    assert.equal(await guardada(page),null);
    assert.ok(sim.st.llamadas.includes('POST /auth/v1/logout'));
    assert.equal(sim.st.llamadas.filter(l=>l==='POST /auth/v1/factors').length,altas,'no se crea otra alta');
    assert.deepEqual(errores,[]);
    await ctx.close();

    // 4. Misma sesión de contraseña con el código correcto: entra.
    ({page,ctx,errores}=await nuevaPagina(browser,base,sim,{sesion:ses1}));
    await page.waitForSelector('#mfaForm:not(.hidden)');
    await page.fill('#mfaCodigo','123456');await page.click('#mfaBoton');
    await page.waitForSelector('#appView:not(.hidden)');
    assert.equal(await nivelGuardado(page),'aal2');
    await ctx.close();

    // 5. Sesión abandonada más de 12 horas: hay que volver a entrar.
    const vieja={access_token:jwt('aal2'),refresh_token:'r2',expires_at:Date.now()+3600e3,ultimo_uso:Date.now()-13*3600e3};
    ({page,ctx,errores}=await nuevaPagina(browser,base,sim,{sesion:vieja}));
    await page.waitForSelector('#loginForm:not(.hidden)');
    assert.equal(await visible(page,'#appView'),false);
    assert.equal(await guardada(page),null);
    await ctx.close();

    // 6. Contraseña incorrecta: no se llega a la verificación.
    ({page,ctx}=await nuevaPagina(browser,base,simulador()));
    await page.fill('#loginEmail','prueba@example.org');await page.fill('#loginPassword','otra');await page.click('#loginButton');
    await page.waitForFunction(()=>/Invalid/.test(document.querySelector('#loginMsg').textContent));
    assert.equal(await visible(page,'#mfaForm'),false);
    await ctx.close();
    console.log('Navegador OK: solo quien lo tiene activado (interruptor apagado), alta con QR, código incorrecto, entrada con aal2, recarga, contraseña sola, cancelar, inactividad y contraseña incorrecta.');
  }finally{await browser.close();srv.close();srvReal.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
