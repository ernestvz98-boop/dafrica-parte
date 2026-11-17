// DAFRICA SAT · ayudas de pantalla (escape de texto, avisos, diálogos, selector con buscador).

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

let temporizador;
export function avisar(texto, {error = false, ms = 3800} = {}) {
  const t = $("#aviso");
  t.textContent = texto; t.className = "toast" + (error ? " error" : ""); t.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { t.hidden = true; }, ms);
}

/** Diálogo modal. `html` es el cuerpo; botones: [{texto, valor, clase}]. Devuelve el valor pulsado (o null). */
export function dialogo(html, botones = [{texto: "Aceptar", valor: true}], {alAbrir} = {}) {
  const d = $("#dialogo");
  d.innerHTML = `<div class="cuerpo">${html}</div><div class="acciones">${botones.map((b, i) =>
    `<button type="button" class="boton ${b.clase || (i === botones.length - 1 ? "" : "sec")}" data-i="${i}">${esc(b.texto)}</button>`).join("")}</div>`;
  return new Promise((ok) => {
    const cerrar = (v) => { d.close(); ok(v); };
    d.querySelectorAll(".acciones button").forEach((b) => b.addEventListener("click", () => {
      const bt = botones[Number(b.dataset.i)];
      if (bt.validar && !bt.validar(d)) return;
      cerrar(typeof bt.valor === "function" ? bt.valor(d) : bt.valor);
    }));
    d.oncancel = (e) => { e.preventDefault(); cerrar(null); };
    d.showModal();
    alAbrir?.(d);
  });
}
export const confirmar = (texto, si = "Sí", no = "Cancelar", clase = "") =>
  dialogo(`<p>${esc(texto)}</p>`, [{texto: no, valor: false}, {texto: si, valor: true, clase}]);

export async function pedirTexto(titulo, {valor = "", placeholder = "", minimo = 0, multilinea = true, ayuda = ""} = {}) {
  return dialogo(`<h2>${esc(titulo)}</h2>${ayuda ? `<p class="suave">${esc(ayuda)}</p>` : ""}${multilinea
    ? `<textarea id="dlgTexto" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
    : `<input id="dlgTexto" value="${esc(valor)}" placeholder="${esc(placeholder)}">`}<p id="dlgError" class="suave"></p>`,
  [{texto: "Cancelar", valor: null}, {texto: "Aceptar", valor: (d) => $("#dlgTexto", d).value.trim(),
    validar: (d) => { const ok = $("#dlgTexto", d).value.trim().length >= minimo; if (!ok) $("#dlgError", d).textContent = `Escribe al menos ${minimo} caracteres.`; return ok; }}],
  {alAbrir: (d) => $("#dlgTexto", d).focus()});
}

const normal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Selector con buscador para listas largas (clientes, artículos…). Devuelve el elemento elegido, "nuevo" o null. */
export function elegir(titulo, lista, {texto = (x) => x.nombre, detalle = () => "", nuevo = null, max = 60} = {}) {
  const d = $("#dialogo");
  return new Promise((ok) => {
    d.innerHTML = `<div class="cuerpo"><h2>${esc(titulo)}</h2><input id="dlgBuscar" type="search" placeholder="Buscar…" autocomplete="off">
      <div id="dlgLista"></div></div><div class="acciones"><button type="button" class="boton sec" data-x="cancelar">Cancelar</button>
      ${nuevo ? `<button type="button" class="boton" data-x="nuevo">${esc(nuevo)}</button>` : ""}</div>`;
    const pintar = () => {
      const q = normal($("#dlgBuscar", d).value).split(/\s+/).filter(Boolean);
      const vistos = lista.filter((x) => { const t = normal(texto(x) + " " + detalle(x)); return q.every((p) => t.includes(p)); }).slice(0, max);
      $("#dlgLista", d).innerHTML = vistos.map((x) => `<button type="button" class="eleccion" data-i="${lista.indexOf(x)}">${esc(texto(x))}${detalle(x) ? `<small>${esc(detalle(x))}</small>` : ""}</button>`).join("")
        || `<p class="suave">Nada coincide.</p>`;
    };
    const cerrar = (v) => { d.close(); ok(v); };
    d.addEventListener("click", function manejador(e) {
      const b = e.target.closest("button"); if (!b || !d.contains(b)) return;
      if (b.dataset.i !== undefined) { d.removeEventListener("click", manejador); cerrar(lista[Number(b.dataset.i)]); }
      else if (b.dataset.x) { d.removeEventListener("click", manejador); cerrar(b.dataset.x === "nuevo" ? "nuevo" : null); }
    });
    d.oncancel = (e) => { e.preventDefault(); cerrar(null); };
    $("#dlgBuscar", d).addEventListener("input", pintar);
    pintar(); d.showModal(); $("#dlgBuscar", d).focus();
  });
}

export const fechaHora = (iso) => { const t = new Date(iso); return isNaN(t) ? "" : t.toLocaleString("es-ES", {dateStyle: "short", timeStyle: "short"}); };
export const fechaCorta = (ymd) => (ymd ? String(ymd).slice(0, 10).split("-").reverse().join("/") : "");

export const ESTADOS_PARTE = {
  BORRADOR: ["Borrador", "gris"], FIRMADO: ["Firmado", "azul"], ENVIADO: ["Enviado", "verde"], EN_REVISION: ["En revisión", "ambar"],
  INFO_SOLICITADA: ["Falta información", "rojo"], PRESUPUESTAR: ["Para presupuestar", "ambar"], NO_FACTURABLE: ["No facturable", "gris"],
  PENDIENTE_APROBACION: ["Factura por aprobar", "ambar"], APROBADO: ["Factura aprobada", "verde"], FACTURADO: ["Facturado", "verde"],
};
export const chipEstado = (e) => { const [t, c] = ESTADOS_PARTE[e] || [e || "—", "gris"]; return `<span class="chip ${c}">${esc(t)}</span>`; };

/** Abrir, descargar o compartir un PDF ya descargado (sin esperas: los navegadores bloquean ventanas tras un await). */
export function abrirBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function compartirBlob(blob, nombre, titulo) {
  const f = new File([blob], nombre, {type: blob.type || "application/pdf"});
  if (navigator.canShare?.({files: [f]})) { await navigator.share({files: [f], title: titulo}); return true; }
  descargarBlob(blob, nombre);
  avisar("Este teléfono no permite compartir directamente: se ha descargado el PDF.");
  return false;
}
