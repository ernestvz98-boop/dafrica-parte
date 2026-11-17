// DAFRICA SAT · almacenamiento en el teléfono (IndexedDB): borradores, fotos, audios, firmas, PDF y cola de envío.
// Sobrevive a cerrar la aplicación y a perder la conexión. Se pide al navegador que no lo borre (persist).

const NOMBRE = "dafrica_sat", VERSION = 1;
let dbp = null;

function abrir() {
  dbp ??= new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", {keyPath: "k"});
      if (!db.objectStoreNames.contains("partes")) db.createObjectStore("partes", {keyPath: "id"});
      if (!db.objectStoreNames.contains("archivos")) db.createObjectStore("archivos", {keyPath: "id"}).createIndex("parte_id", "parte_id");
      if (!db.objectStoreNames.contains("cola")) db.createObjectStore("cola", {keyPath: "n", autoIncrement: true}).createIndex("clave", "clave", {unique: true});
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return dbp;
}
async function tx(tienda, modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction(tienda, modo);
    let resultado;
    Promise.resolve(fn(t.objectStore(tienda))).then((x) => { resultado = x; });
    t.oncomplete = () => ok(resultado);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error || new Error("Transacción abortada"));
  });
}
const req = (r) => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });

export async function pedirPersistencia() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* opcional */ }
}

export const kv = {
  get: async (k) => (await tx("kv", "readonly", (s) => req(s.get(k))))?.v,
  set: (k, v) => tx("kv", "readwrite", (s) => req(s.put({k, v}))),
};
// Todas las modificaciones de un parte pasan en fila (pantalla y cola de envío): nunca se pisan dos cambios.
let filaPartes = Promise.resolve();
export const partes = {
  get: (id) => tx("partes", "readonly", (s) => req(s.get(id))),
  put: (p) => tx("partes", "readwrite", (s) => req(s.put({...p, actualizado: Date.now()}))),
  /** Lee el parte, aplica `fn(p)` (que lo cambia en el sitio) y lo guarda, en exclusiva. Devuelve el parte guardado. */
  modificar(id, fn) {
    const r = filaPartes.then(async () => {
      const p = await partes.get(id);
      if (!p) return null;
      await fn(p);
      await partes.put(p);
      return p;
    });
    filaPartes = r.catch(() => {});
    return r;
  },
  todas: () => tx("partes", "readonly", (s) => req(s.getAll())),
  borrar: (id) => tx("partes", "readwrite", (s) => req(s.delete(id))),
};
export const archivos = {
  get: (id) => tx("archivos", "readonly", (s) => req(s.get(id))),
  put: (a) => tx("archivos", "readwrite", (s) => req(s.put(a))),
  deParte: (parteId) => tx("archivos", "readonly", (s) => req(s.index("parte_id").getAll(parteId))),
  borrar: (id) => tx("archivos", "readwrite", (s) => req(s.delete(id))),
};
export const cola = {
  /** Añade una tarea; si ya hay una con la misma clave, se queda la existente (lee los datos al ejecutarse) con `rev` + 1:
   *  si estaba ejecutándose, se repite al terminar para subir también el último cambio. */
  async poner(tarea) {
    return tx("cola", "readwrite", async (s) => {
      const previa = await req(s.index("clave").get(tarea.clave));
      if (previa) {
        await req(s.put({...previa, rev: (previa.rev || 0) + 1, ...(previa.error ? {error: null, intentos: 0} : {})}));
        return previa.n;
      }
      return req(s.add({...tarea, creada: Date.now(), intentos: 0, error: null, rev: 0}));
    });
  },
  get: (n) => tx("cola", "readonly", (s) => req(s.get(n))),
  todas: () => tx("cola", "readonly", (s) => req(s.getAll())),
  quitar: (n) => tx("cola", "readwrite", (s) => req(s.delete(n))),
  actualizar: (t) => tx("cola", "readwrite", (s) => req(s.put(t))),
};

export async function sha256(blob) {
  const b = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  const h = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
