// DAFRICA SAT · firma sobre la pantalla, fotos comprimidas y grabación de audio.

/** Panel de firma con el dedo o el lápiz (eventos de puntero), nítido en pantallas de alta densidad. */
export class PanelFirma {
  constructor(canvas) {
    this.c = canvas; this.trazos = 0; this.dibujando = false;
    const ajustar = () => {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (!r.width) return;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      const x = canvas.getContext("2d");
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.lineWidth = 2.4; x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = "#0b1f44";
      this.trazos = 0;
    };
    ajustar();
    this.ajustar = ajustar;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId); this.dibujando = true;
      const x = canvas.getContext("2d"); const [a, b] = pos(e); x.beginPath(); x.moveTo(a, b); x.lineTo(a + 0.1, b + 0.1); x.stroke();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dibujando) return;
      e.preventDefault();
      const x = canvas.getContext("2d"); const [a, b] = pos(e); x.lineTo(a, b); x.stroke(); this.trazos++;
    });
    const fin = () => { this.dibujando = false; };
    canvas.addEventListener("pointerup", fin); canvas.addEventListener("pointercancel", fin);
  }
  vacia() { return this.trazos < 5; }
  limpiar() { this.c.getContext("2d").clearRect(0, 0, this.c.width, this.c.height); this.trazos = 0; }
  aPng() {
    // Fondo blanco (el PDF y STEL lo muestran igual en modo claro y oscuro).
    const o = document.createElement("canvas"); o.width = this.c.width; o.height = this.c.height;
    const x = o.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, o.width, o.height); x.drawImage(this.c, 0, 0);
    return new Promise((ok) => o.toBlob(ok, "image/png"));
  }
}

/** Foto comprimida a JPEG (lado mayor ≤ 1600 px), respetando la orientación del teléfono. */
export async function comprimirFoto(file, lado = 1600, calidad = 0.8) {
  let bmp;
  try { bmp = await createImageBitmap(file, {imageOrientation: "from-image"}); }
  catch { bmp = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file); }); }
  const w = bmp.width, h = bmp.height, k = Math.min(1, lado / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", calidad));
}

function tipoAudio() {
  const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];
  return tipos.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}
export function extensionAudio(mime) {
  return /mp4|aac|m4a/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /mpeg|mp3/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : "webm";
}
/** Graba del micrófono. Devuelve {parar(): Promise<Blob>, cancelar()}. */
export async function grabarAudio() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Este teléfono no permite grabar desde la aplicación: adjunta un audio grabado con el teléfono.");
  const flujo = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}});
  const tipo = tipoAudio();
  const rec = new MediaRecorder(flujo, tipo ? {mimeType: tipo} : undefined);
  const trozos = [];
  rec.ondataavailable = (e) => { if (e.data?.size) trozos.push(e.data); };
  rec.start(1000);
  const cerrar = () => flujo.getTracks().forEach((t) => t.stop());
  return {
    inicio: Date.now(),
    parar: () => new Promise((ok) => { rec.onstop = () => { cerrar(); ok(new Blob(trozos, {type: rec.mimeType || tipo || "audio/webm"})); }; rec.stop(); }),
    cancelar: () => { try { rec.stop(); } catch { /* nada */ } cerrar(); },
  };
}
