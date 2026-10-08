"use strict";

// ===== Localización: alertas configurables + historial =====
const __renderLocalizacionV11 = renderLocalizacion;

renderLocalizacion = async function(){
  try{
    await sb("/rest/v1/rpc/refrescar_alertas_localizacion",{
      method:"POST",
      body:"{}"
    });
  }catch{}

  await __renderLocalizacionV11();

  const host = $("content");
  if(!host) return;

  const [devices, pending, settings] = await Promise.all([
    sb("/rest/v1/gps_dispositivos?activo=eq.true&select=id,codigo,tipo_dispositivo,machine_id,vehiculo_id,nombre_equipo,ultima_conexion,bateria_pct&order=codigo.asc").catch(()=>[]),
    sb("/rest/v1/gps_eventos?atendido=eq.false&select=id,dispositivo_id,geocerca_id,tipo,ocurrido_en,latitud,longitud,detalle&order=ocurrido_en.desc&limit=100").catch(()=>[]),
    sb("/rest/v1/app_settings?id=eq.1&select=alert_config&limit=1").catch(()=>[])
  ]);

  const dm = new Map((devices||[]).map(d=>[d.id,d]));
  const cfg = settings?.[0]?.alert_config || {};
  const signalHours = Number(cfg.gps_sin_senal_horas ?? 6);
  const lowBattery = Number(cfg.gps_bateria_baja_pct ?? 20);

  const alertHtml = (pending||[]).map(e=>{
    const d = dm.get(e.dispositivo_id);
    return `<div class="list-item">
      <b>${esc(e.tipo || "ALERTA")}</b>
      <div class="meta">${esc(d?.codigo || "Dispositivo")} · ${esc(e.ocurrido_en ? new Date(e.ocurrido_en).toLocaleString() : "—")}</div>
      ${e.detalle ? '<div class="meta">'+esc(JSON.stringify(e.detalle))+'</div>' : ""}
      ${has("localizacion.editar") ? '<button class="btn secondary" type="button" data-attend-event="'+esc(e.id)+'">Marcar atendida</button>' : ""}
    </div>`;
  }).join("");

  const deviceOptions = (devices||[]).map(d=>
    '<option value="'+esc(d.id)+'">'+esc([d.codigo,d.nombre_equipo,d.tipo_dispositivo].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  const extra = document.createElement("div");
  extra.innerHTML = `
    <div class="grid two" style="margin-top:16px">
      <div class="card">
        <div class="section-head">
          <div>
            <h3>Alertas automáticas</h3>
            <p>Salida de geocerca, pérdida de señal y batería baja.</p>
          </div>
          <span class="badge">${(pending||[]).length} pendiente(s)</span>
        </div>

        ${has("localizacion.editar") ? `
        <form id="gpsAlertConfigForm">
          <div class="form-grid">
            <div>
              <label>Alerta sin señal después de</label>
              <input id="gpsSignalHours" type="number" min="1" max="168" value="${esc(signalHours)}">
            </div>
            <div>
              <label>Batería baja (%)</label>
              <input id="gpsLowBattery" type="number" min="1" max="90" value="${esc(lowBattery)}">
            </div>
          </div>
          <button class="btn secondary" type="submit">Guardar límites</button>
          <span id="gpsAlertCfgStatus" class="statusline"></span>
        </form>` : ""}

        <div class="list" style="margin-top:12px">
          ${alertHtml || '<div class="muted">No hay alertas pendientes.</div>'}
        </div>
      </div>

      <div class="card">
        <h3>Historial de posiciones</h3>
        <p class="muted">Consulta los últimos puntos recibidos por un GPS/Beacon.</p>
        <div class="form-grid">
          <div>
            <label>Dispositivo</label>
            <select id="gpsHistoryDevice">
              <option value="">Seleccionar…</option>
              ${deviceOptions}
            </select>
          </div>
          <div>
            <label>Número de puntos</label>
            <select id="gpsHistoryLimit">
              <option value="20">20</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>
        <button id="gpsHistoryBtn" class="btn secondary" type="button">Ver historial</button>
        <div id="gpsHistoryHost" style="margin-top:12px"></div>
      </div>
    </div>
  `;

  host.appendChild(extra);

  $("gpsAlertConfigForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    const s=$("gpsAlertCfgStatus");
    s.textContent="Guardando…";
    s.className="statusline muted";
    try{
      await sb("/rest/v1/rpc/actualizar_alertas_localizacion",{
        method:"POST",
        body:JSON.stringify({
          p_sin_senal_horas:Number($("gpsSignalHours").value),
          p_bateria_baja_pct:Number($("gpsLowBattery").value)
        })
      });
      s.textContent="Configuración guardada.";
      s.className="statusline ok";
    }catch(err){
      s.textContent=err.message;
      s.className="statusline error";
    }
  });

  document.querySelectorAll("[data-attend-event]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      btn.disabled=true;
      try{
        await sb("/rest/v1/rpc/atender_evento_gps",{
          method:"POST",
          body:JSON.stringify({p_evento_id:Number(btn.dataset.attendEvent)})
        });
        await renderLocalizacion();
      }catch(err){
        btn.disabled=false;
        alert(err.message);
      }
    });
  });

  $("gpsHistoryBtn")?.addEventListener("click", async ()=>{
    const id=$("gpsHistoryDevice").value;
    const limit=Number($("gpsHistoryLimit").value)||50;
    const h=$("gpsHistoryHost");
    if(!id){
      h.innerHTML='<div class="error">Selecciona un dispositivo.</div>';
      return;
    }
    h.innerHTML='<div class="muted">Cargando historial…</div>';
    try{
      const rows=await sb(
        "/rest/v1/gps_posiciones?dispositivo_id=eq."+encodeURIComponent(id)+
        "&select=id,registrado_en,latitud,longitud,precision_m,velocidad_kmh,bateria_pct,ignicion"+
        "&order=registrado_en.desc&limit="+limit
      );
      const body=(rows||[]).map((p,i)=>`<tr>
        <td>${esc(p.registrado_en ? new Date(p.registrado_en).toLocaleString() : "—")}</td>
        <td>${esc(Number(p.latitud).toFixed(6))}, ${esc(Number(p.longitud).toFixed(6))}</td>
        <td>${esc(p.velocidad_kmh ?? "—")}</td>
        <td>${esc(p.bateria_pct ?? "—")}</td>
        <td><button class="linkbtn" type="button" data-history-map="${i}">Mapa</button></td>
      </tr>`).join("");

      h.innerHTML=`
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Coordenadas</th><th>km/h</th><th>Batería %</th><th></th></tr></thead>
          <tbody>${body || '<tr><td colspan="5" class="empty">Sin posiciones recibidas.</td></tr>'}</tbody>
        </table></div>
      `;

      document.querySelectorAll("[data-history-map]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const p=(rows||[])[Number(btn.dataset.historyMap)];
          renderLocalMap(
            p.latitud,
            p.longitud,
            "Posición histórica",
            p.registrado_en ? new Date(p.registrado_en).toLocaleString() : ""
          );
          $("localMapHost")?.scrollIntoView({behavior:"smooth",block:"start"});
        });
      });
    }catch(err){
      h.innerHTML='<div class="error">'+esc(err.message)+'</div>';
    }
  });
};

// ===== Costes / consumos: preparado para STEL =====
renderCostes = async function(){
  setTopbar("Costes / Consumos","Control económico · STEL preparado");
  loading("Cargando costes…");

  const [docs,works,logs] = await Promise.all([
    sb("/rest/v1/coste_documentos?select=id,origen,stel_id,tipo,numero_documento,proveedor_nombre,fecha_documento,fecha_vencimiento,base_imponible,impuestos,total,moneda,estado,ia_estado,ia_confianza,obra_id,created_at&order=fecha_documento.desc.nullslast,created_at.desc&limit=200").catch(()=>[]),
    has("obras.ver")
      ? sb("/rest/v1/obras?activo=eq.true&select=id,legacy_id,nombre&order=nombre.asc").catch(()=>[])
      : Promise.resolve([]),
    sb("/rest/v1/stel_sync_log?select=id,iniciado_en,finalizado_en,tipo_sync,estado,registros_leidos,registros_creados,registros_actualizados,error&order=iniciado_en.desc&limit=20").catch(()=>[])
  ]);

  const wm=new Map((works||[]).map(w=>[w.id,w]));
  const total=(docs||[]).reduce((s,d)=>s+(Number(d.total)||0),0);
  const fromStel=(docs||[]).filter(d=>String(d.origen||"").toUpperCase()==="STEL").length;

  const byWork=new Map();
  (docs||[]).forEach(d=>{
    const key=d.obra_id || "__sin_obra__";
    byWork.set(key,(byWork.get(key)||0)+(Number(d.total)||0));
  });

  const workSummary=[...byWork.entries()].sort((a,b)=>b[1]-a[1]).map(([id,amount])=>{
    const w=wm.get(id);
    return '<div class="list-item"><b>'+esc(w ? (w.nombre||w.legacy_id) : "Sin obra asignada")+
      '</b><div class="meta">'+amount.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+' €</div></div>';
  }).join("");

  const rows=(docs||[]).map((d,i)=>`<tr>
    <td>${esc(d.fecha_documento||"—")}</td>
    <td>${esc(d.origen||"—")}</td>
    <td>${esc(d.tipo||"—")}</td>
    <td><b>${esc(d.numero_documento||"—")}</b></td>
    <td>${esc(d.proveedor_nombre||"—")}</td>
    <td>${esc(wm.get(d.obra_id)?.nombre || "—")}</td>
    <td>${Number(d.total||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(d.moneda||"EUR")}</td>
    <td>${statusBadge(d.estado||d.ia_estado||"—")}</td>
    <td><button class="linkbtn" type="button" data-cost-doc="${i}">Ver</button></td>
  </tr>`).join("");

  const logRows=(logs||[]).map(l=>`<tr>
    <td>${esc(l.iniciado_en ? new Date(l.iniciado_en).toLocaleString() : "—")}</td>
    <td>${esc(l.tipo_sync||"—")}</td>
    <td>${statusBadge(l.estado||"—")}</td>
    <td>${esc(l.registros_leidos??0)}</td>
    <td>${esc(l.registros_creados??0)}</td>
    <td>${esc(l.registros_actualizados??0)}</td>
    <td>${esc(l.error||"")}</td>
  </tr>`).join("");

  setContent(`
    <div class="module-note sensitive-note">
      <b>Acceso económico restringido.</b> La base de costes y el registro de sincronización STEL están preparados.
      Para activar sincronización real todavía necesitaremos las credenciales/API de STEL; no se guardarán secretos en esta web.
    </div>

    <div class="grid cards">
      <div class="card"><div class="metric-label">Documentos</div><div class="metric">${(docs||[]).length}</div></div>
      <div class="card"><div class="metric-label">Total mostrado</div><div class="metric">${total.toLocaleString("es-ES",{maximumFractionDigits:2})} €</div></div>
      <div class="card"><div class="metric-label">Origen STEL</div><div class="metric">${fromStel}</div></div>
      <div class="card"><div class="metric-label">Sincronizaciones</div><div class="metric">${(logs||[]).length}</div></div>
    </div>

    <div class="grid two">
      <div class="card"><h3>Coste por obra</h3><div class="list">${workSummary || '<div class="muted">Aún no hay costes asignados.</div>'}</div></div>
      <div class="card"><h3>Estado STEL</h3>
        <div class="list">
          <div class="list-item"><b>Estructura de datos</b><div class="meta">Lista para documentos, líneas, obras y trazabilidad de sincronización.</div></div>
          <div class="list-item"><b>Conexión externa</b><div class="meta">Pendiente únicamente de credenciales/API de STEL.</div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Documentos económicos</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Origen</th><th>Tipo</th><th>Número</th><th>Proveedor</th><th>Obra</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="empty">Sin documentos de costes.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h3>Historial de sincronización STEL</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Inicio</th><th>Tipo</th><th>Estado</th><th>Leídos</th><th>Creados</th><th>Actualizados</th><th>Error</th></tr></thead>
        <tbody>${logRows || '<tr><td colspan="7" class="empty">Todavía no se ha ejecutado ninguna sincronización STEL.</td></tr>'}</tbody>
      </table></div>
    </div>
  `);

  document.querySelectorAll("[data-cost-doc]").forEach(btn=>{
    btn.addEventListener("click",()=>openCostDocument((docs||[])[Number(btn.dataset.costDoc)],works||[]));
  });
};

async function openCostDocument(doc,works){
  if(!doc) return;
  loading("Cargando documento económico…");

  const lines=await sb(
    "/rest/v1/coste_lineas?documento_id=eq."+encodeURIComponent(doc.id)+
    "&select=id,codigo_articulo,descripcion,cantidad,unidad,precio_unitario,descuento_pct,impuesto_pct,total_linea,categoria,obra_id&order=created_at.asc"
  ).catch(()=>[]);

  const wm=new Map((works||[]).map(w=>[w.id,w]));
  const options=(works||[]).map(w=>
    '<option value="'+esc(w.id)+'"'+(w.id===doc.obra_id?' selected':'')+'>'+esc([w.legacy_id,w.nombre].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  const rows=(lines||[]).map(l=>`<tr>
    <td>${esc(l.codigo_articulo||"—")}</td>
    <td>${esc(l.descripcion||"—")}</td>
    <td>${esc(l.cantidad??"—")} ${esc(l.unidad||"")}</td>
    <td>${Number(l.precio_unitario||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} €</td>
    <td>${Number(l.total_linea||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} €</td>
    <td>${esc(l.categoria||"—")}</td>
  </tr>`).join("");

  setTopbar("Costes / Consumos","Detalle de documento");
  setContent(`
    <div class="section-head">
      <div><h2>${esc(doc.numero_documento||doc.tipo||"Documento")}</h2><p>${esc(doc.proveedor_nombre||"")}</p></div>
      <button id="backCosts" class="btn secondary" type="button">Volver</button>
    </div>

    <div class="card">
      <div class="detail-grid">
        <div class="kv"><b>Origen</b><span>${esc(doc.origen||"—")}</span></div>
        <div class="kv"><b>Tipo</b><span>${esc(doc.tipo||"—")}</span></div>
        <div class="kv"><b>Fecha</b><span>${esc(doc.fecha_documento||"—")}</span></div>
        <div class="kv"><b>Total</b><span>${Number(doc.total||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(doc.moneda||"EUR")}</span></div>
        <div class="kv"><b>Estado</b><span>${statusBadge(doc.estado||"—")}</span></div>
        <div class="kv"><b>STEL ID</b><span>${esc(doc.stel_id||"—")}</span></div>
      </div>
    </div>

    ${has("costes.editar") ? `
    <div class="card">
      <h3>Asignación a obra</h3>
      <form id="costWorkForm">
        <label>Obra</label>
        <select id="costWork"><option value="">Sin obra</option>${options}</select>
        <button class="btn secondary" type="submit">Guardar obra</button>
        <span id="costWorkStatus" class="statusline"></span>
      </form>
    </div>` : ""}

    <div class="card">
      <h3>Líneas</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Código</th><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th><th>Categoría</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">Sin líneas registradas.</td></tr>'}</tbody>
      </table></div>
    </div>
  `);

  $("backCosts")?.addEventListener("click",()=>renderCostes().catch(handleModuleError));

  $("costWorkForm")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const s=$("costWorkStatus");
    s.textContent="Guardando…";
    s.className="statusline muted";
    try{
      const obraId=$("costWork").value || null;
      await sb("/rest/v1/coste_documentos?id=eq."+encodeURIComponent(doc.id),{
        method:"PATCH",
        headers:{"Prefer":"return=minimal"},
        body:JSON.stringify({obra_id:obraId,updated_at:new Date().toISOString(),updated_by:state.user.id})
      });
      doc.obra_id=obraId;
      s.textContent="Obra asignada.";
      s.className="statusline ok";
    }catch(err){
      s.textContent=err.message;
      s.className="statusline error";
    }
  });
}

// ===== Administración: usuarios existentes + roles =====
renderAdministracion = async function(){
  setTopbar("Administración","Usuarios, permisos y configuración");

  const canView=has("usuarios.ver") || has("usuarios.gestionar") || has("configuracion.gestionar");
  const canManage=has("usuarios.gestionar");

  let users=[],roles=[];
  if(canView){
    [users,roles]=await Promise.all([
      sb("/rest/v1/rpc/admin_listar_usuarios",{method:"POST",body:"{}"}).catch(()=>[]),
      sb("/rest/v1/roles?select=id,codigo,nombre&order=nombre.asc").catch(()=>[])
    ]);
  }

  const grouped=new Map();
  (users||[]).forEach(u=>{
    if(!grouped.has(u.usuario_id)){
      grouped.set(u.usuario_id,{
        usuario_id:u.usuario_id,
        email:u.email,
        nombre:u.nombre,
        creado_en:u.creado_en,
        ultimo_acceso:u.ultimo_acceso,
        roles:[]
      });
    }
    if(u.rol_codigo) grouped.get(u.usuario_id).roles.push({codigo:u.rol_codigo,nombre:u.rol_nombre});
  });
  const userRows=[...grouped.values()];

  const roleOptions=(roles||[]).map(r=>'<option value="'+esc(r.codigo)+'">'+esc(r.nombre||r.codigo)+'</option>').join("");

  const rows=userRows.map((u,i)=>`<tr>
    <td><b>${esc(u.nombre || u.email || "Usuario")}</b></td>
    <td>${esc(u.email||"—")}</td>
    <td>${esc(u.roles.map(r=>r.nombre||r.codigo).join(", ") || "Sin rol")}</td>
    <td>${esc(u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleString() : "Nunca")}</td>
    <td>${canManage ? '<select data-admin-role="'+i+'"><option value="">Cambiar rol…</option>'+roleOptions+'</select>' : ""}</td>
    <td>${canManage ? '<button class="btn secondary" type="button" data-admin-save="'+i+'">Guardar</button>' : ""}</td>
  </tr>`).join("");

  const permList=[...state.permissions].sort().map(p=>'<span class="badge">'+esc(p)+'</span>').join(" ");

  setContent(`
    <div class="module-note sensitive-note">
      Este apartado administra permisos y roles. No se muestran contraseñas ni claves del sistema.
    </div>

    <div class="grid two">
      <div class="card">
        <h3>Usuario actual</h3>
        <div class="detail-grid">
          <div class="kv"><b>Nombre</b><span>${esc(state.profile?.full_name || state.user?.email || "—")}</span></div>
          <div class="kv"><b>Email</b><span>${esc(state.user?.email || "—")}</span></div>
          <div class="kv"><b>Rol</b><span>${esc(state.roles.map(r=>r.nombre||r.codigo).join(", ") || "—")}</span></div>
        </div>
      </div>
      <div class="card">
        <h3>Seguridad activa</h3>
        <div class="list">
          <div class="list-item"><b>Login obligatorio</b><div class="meta">Sin sesión no se consulta información privada.</div></div>
          <div class="list-item"><b>RLS de Supabase</b><div class="meta">Los permisos se vuelven a validar en base de datos.</div></div>
          <div class="list-item"><b>Storage privado</b><div class="meta">Documentos protegidos por permisos.</div></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <div><h3>Usuarios</h3><p>Los usuarios que ya existan en Supabase Auth pueden recibir su rol desde aquí.</p></div>
        <span class="badge">${userRows.length}</span>
      </div>
      <div class="module-note">
        El alta inicial de una cuenta de acceso se hará al final desde Supabase Auth. Después, el rol se puede gestionar aquí sin tocar la base de datos manualmente.
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol actual</th><th>Último acceso</th><th>Nuevo rol</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">No hay usuarios visibles.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card"><h3>Permisos efectivos de mi sesión</h3><div class="row">${permList || '<span class="muted">Sin permisos.</span>'}</div></div>
  `);

  document.querySelectorAll("[data-admin-save]").forEach(btn=>{
    btn.addEventListener("click",async ()=>{
      const i=Number(btn.dataset.adminSave);
      const u=userRows[i];
      const sel=document.querySelector('[data-admin-role="'+i+'"]');
      const role=sel?.value;
      if(!u || !role) return;
      btn.disabled=true;
      try{
        await sb("/rest/v1/rpc/admin_asignar_rol",{
          method:"POST",
          body:JSON.stringify({p_usuario_id:u.usuario_id,p_rol_codigo:role})
        });
        await renderAdministracion();
      }catch(err){
        btn.disabled=false;
        alert(err.message);
      }
    });
  });
};
