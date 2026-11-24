# DAFRICA SAT · partes de técnicos con firma y facturación en STEL

Aplicación web instalable (móvil y ordenador) para el servicio técnico:
**aviso → asignación → visita → parte (dictado, fotos, materiales) → firmas → oficina y STEL → revisión
económica → aprobación de la factura → factura en la bandeja del técnico → entrega al cliente.**

Diseño y capacidades de STEL comprobadas: [`docs/sat-diseno.md`](../docs/sat-diseno.md).

---

## 1. Uso diario

### Técnico (móvil)
1. **Entrar**: con el mismo usuario de DAFRICA Control (la misma sesión y la verificación en dos pasos).
   Instalar en el móvil: abrir `…/sat/` en Chrome o Safari → «Añadir a pantalla de inicio».
2. **Parte rápido (por defecto, desde 0.3.0)**: **＋ Nuevo parte** → busca el cliente (nombre, NIF, teléfono o
   dirección; los clientes de STEL ya están en el teléfono) y tócalo. En UNA pantalla:
   - **● Grabar audio** contando qué le pasaba, qué has hecho, el material (con cantidades) y lo pendiente. Se
     transcribe solo (o «adjuntar un audio del teléfono», o «Prefiero escribirlo»).
   - **Fotos del trabajo** (antes / arreglado) y, si lo hay, **foto del albarán o ticket de compra**: se adjunta y
     se leen sus materiales solos. Si quedan códigos o descripciones dudosos, la foto se lee otra vez con la hoja
     enderezada (sale el texto mucho más limpio) y de ahí se proponen, siempre en duda, para compararlos con el papel
     (tarda el doble: un minuto más o menos en el móvil).
   - **¿Cómo queda?** (terminado, pendiente de presupuesto/repuestos/otra visita, o solo revisión), **horas de
     trabajo** y **horas de desplazamiento** con botones (½ h, 1 h…, «Otra…»).
   - **Firmar ✍️**: el texto del audio se ordena solo (avería, trabajos, pendiente; cada frase entera, sin
     inventar) y los materiales salen del albarán y de lo dictado CON cantidad. Lo leído con dudas va marcado
     «a confirmar por la oficina» (no impide firmar). Después, firmas y «Generar PDF y enviar».
   - «Rellenar a mano (modo detallado)» pasa al parte por pasos de abajo.
   Los avisos asignados por la oficina también se abren en el parte rápido.
3. **Parte detallado (4 pasos)**, si se elige «Rellenar a mano» o con «Crear un aviso con todos los datos»
   - *Datos*: tipo de visita (**diagnóstico**, **reparación finalizada** o **pendiente** de presupuesto,
     repuestos o segunda visita), fecha y horas («Ahora»), cliente, dirección, contacto, equipo.
   - *Dictado y fotos*: **● Grabar audio** (uno o varios). Se transcribe al momento si hay cobertura; si
     no, el audio queda guardado. Corrige el texto y pulsa **Proponer el parte con el dictado**: cada frase
     va tal cual a avería, comprobaciones, trabajos, materiales o pendientes. Los materiales solo salen con
     la cantidad que dijiste; lo dudoso (referencias dictadas, cantidades no dichas) sale en ámbar para
     confirmar. Fotos: **Hacer foto** o **Desde la galería**, con momento (antes/durante/después) y comentario.
   - *Trabajo*: comprobaciones con resultado, avería, trabajos, materiales (cantidad, unidad, referencia y,
     si lo sabes, el artículo de STEL), tiempos de trabajo y desplazamiento, estado final y pendientes.
     **📷 Foto del albarán o ticket del proveedor**: la foto se adjunta al parte y al albarán de trabajo de STEL, y el
     lector de albaranes (en el propio teléfono, sin enviar la foto a nadie) propone sus líneas como materiales:
     referencia, descripción y cantidad; si la referencia está una sola vez en STEL, el artículo se elige solo. Lo leído
     con dudas sale en ámbar para compararlo con el papel. La primera vez descarga el lector (unos 9 MB) y tarda alrededor
     de un minuto por foto. Con proveedores que el lector no reconoce no salen líneas: se escriben a mano.
   - *Revisar y firmar*: el parte completo y el texto del alcance. **Firma del técnico** y **firma del
     responsable** (nombre y cargo) o **«No está o no quiere firmar…»** con el motivo. Con las dos, **Generar
     PDF y enviar**. El PDF se puede enseñar o compartir al momento.
4. **Si cambias algo después de firmar**, las firmas dejan de valer (lo avisa) y hay que volver a firmar.
   La corrección queda registrada.
5. **Sin cobertura** todo se guarda en el teléfono. Arriba se ve «Sin conexión · N por subir» o
   «✓ Todo subido». Al tocarlo, la lista de lo pendiente. **No borres los datos de la aplicación** mientras
   haya algo por subir.
6. **Facturas**: la bandeja muestra las facturas emitidas de tus partes: Abrir, Descargar, Compartir (correo,
   WhatsApp… del teléfono). Cuando la entregues, **Marcar como entregada** y elige cómo. Recibir la factura
   no la marca como entregada.
7. Si la oficina **pide información**, el parte vuelve a abrirse con su nota: corrige, firma y envía.

### Administración («Oficina», ordenador o móvil)
- **Partes**: por revisar, por aprobar, facturados… Cada parte muestra datos, fotos, audios con su
  transcripción, firmas (válidas e invalidadas), versiones, PDF firmado, estado de STEL y registro completo.
- **Cliente provisional**: «Vincular a cliente de STEL» (lo normal: no duplica) o «Crear en STEL» (antes busca
  por NIF y por nombre; si hay parecidos, se para y lo decides tú).
- **Revisión económica**: «Proponer desde el parte» rellena los materiales a su **coste neto + margen** (30 % por
  defecto, en Ajustes): el coste es el precio con los descuentos del albarán del proveedor (si la línea cuadra con su
  importe) o, con «Precios de materiales (compra + margen)», el precio de compra del artículo en STEL; si no hay ninguno, un
  coste estimado con lo leído del papel, en ámbar «sin comprobar». **Margen de cada material**: bajo el precio de cada línea
  con coste está la casilla «coste … + __ %»; cambiarla pone ese margen solo a esa línea (y lo respeta «Precios de
  materiales»); las demás siguen con el de Ajustes. Un material del albarán del proveedor sin código (una tasa, un envase)
  se da de alta en STEL con una referencia propia «SR-…» fija (la misma cada vez: no se duplica). Lo que esté mal se corrige en la revisión, el técnico con
  «Corregir» (precio y descuento del papel) o en el albarán de STEL y «Traer precios corregidos». La
  mano de obra y el desplazamiento **por horas** (minutos anotados por el técnico ÷ 60) al **precio fijo por hora** de
  Ajustes (50 € por defecto; vacío = precio del servicio de STEL). Un desplazamiento solo con km queda sin horas para
  completarlo. Completa artículo, precio, descuento e IVA. **Guardar revisión**.
- **Decisión**: Facturar (pasa a aprobación), Presupuestar, Pedir información al técnico o No facturable.
- **STEL**: estado de cada operación, motivo de los bloqueos y «Reintentar». Pestaña **STEL** para todo lo
  pendiente. **Ajustes**: catálogo, servicios de mano de obra y desplazamiento, margen de los materiales, forma de
  pago y cuenta bancaria («Buscar en STEL y guardar»: van en todos los albaranes de trabajo y facturas; sin ellas se
  paran), serie, límite de llamadas, texto del alcance de la firma y servicio de transcripción.

### Responsable de facturación
- **Aprobar factura**: ve líneas y total, marca la confirmación y aprueba. Solo entonces se crea la factura
  en STEL (desde el albarán de trabajo; si ese albarán ya tenía factura en STEL, se reutiliza y no se crea otra).
- Si la emisión por la API está desactivada (por defecto), la factura queda **creada en STEL sin emitir**:
  emítela en STEL y pulsa **«Ya está emitida en STEL: traer el PDF»**. Nunca llega al técnico un borrador.
- Si STEL no da el PDF por la API, **Subir PDF de la factura** (el de STEL) y llega a la bandeja del técnico.

---

## 2. Permisos

| Permiso | Rol nuevo | Qué permite |
|---|---|---|
| `sat.tecnico` | `TECNICO_SAT` | Sus avisos y partes, firmar, enviar, su bandeja de facturas |
| `sat.administrar` | `ADMINISTRACION`, `FACTURACION_SAT` | Todos los avisos y partes, asignar, revisar precios, STEL, ajustes |
| `sat.facturar` | `FACTURACION_SAT` | Aprobar facturas y confirmar su emisión |

`DIRECCION_ADMIN` recibe los tres. Se asignan en DAFRICA Control → Administración (roles de usuario).
Todo lo hace la base de datos con estas comprobaciones; las tablas no son accesibles desde el navegador y los
archivos (fotos, audios, firmas, PDF) están en un almacén privado: cada técnico solo ve los de sus partes.
Queda registrado quién crea, cambia, firma, revisa, aprueba, factura y entrega (`sat_auditoria`).

---

## 3. Puesta en marcha

1. ✅ **Base de datos** (2026-11-17): aplicada con copia previa (ver `REGISTRO-CAMBIOS.md`).
2. ✅ **Función Edge `sat-stel`** (2026-11-17): desplegada con `verify_jwt`. Usa los secretos existentes
   `STEL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY`.
3. ✅ **Web**: `sat/` y el menú «Servicio técnico» publicados en `main`.
4. **Tú**: asignar los roles (`TECNICO_SAT`, `FACTURACION_SAT`) en DAFRICA Control → Administración.
5. **Tú, la primera vez**: Oficina → Ajustes → «Actualizar catálogo desde STEL» (solo lectura) y elegir los servicios
   de mano de obra y desplazamiento. Después, un primer parte real con un cliente de prueba confirma lo que la
   documentación de STEL no garantiza (ver §5).

---

## 4. Probar sin tocar producción

```bash
npm ci
```

```bash
npm run sat:emulador
```

Abre `http://127.0.0.1:8787/sat/`. Usuarios ficticios (contraseña `prueba`): `tecnico@prueba.local`,
`tecnico2@prueba.local`, `admin@prueba.local`, `factura@prueba.local`. Es la base de datos real de la propuesta
(PGlite), la función `sat-stel` real y un STEL falso fiel a la especificación oficial. Pérdida de conexión:
`/__red/caida` y `/__red/ok`.

```bash
npm test
```

`npm test` incluye `pruebas/sat-*.test.mjs` (dictado, importes, flujo completo, respuestas perdidas de STEL,
reintentos sin duplicados, factura sin PDF, clientes provisionales, límite de llamadas). Las reglas SQL:

```bash
node supabase/tests/ejecutar-local.mjs supabase/tests/sat_simulado.sql supabase/propuestas/20261116_sat_partes.sql supabase/tests/sat_partes.sql
```

---

## 5. Estado

**Funciona y está probado (local):** todo el flujo del técnico, también sin conexión y tras cerrar la
aplicación; dictado organizado sin inventar; fotos; firmas con invalidación al corregir; PDF firmado; envío;
oficina; revisión económica; aprobación expresa; factura; bandeja y entrega; permisos; registro; reintentos sin
duplicar incidencias, albaranes, adjuntos, facturas ni clientes.

**Necesita autorización / credenciales:** aplicar la migración, desplegar `sat-stel`, publicar la web. La clave
de STEL ya está en el servidor; nunca va al navegador.

**Pendiente de confirmar con la cuenta real de STEL:**
1. Plan y límite diario de llamadas (Lite 300, Business 1.000, Pro 2.000). La aplicación pone su propio
   límite (250 por defecto, en Ajustes). Un parte con 4 fotos gasta unas 10 llamadas.
2. Que la clave puede crear incidencias, albaranes de trabajo, adjuntos (`file-base64`) y facturas.
3. Si el filtro `title` de `workDeliveryNotes` busca exacto o «contiene» (las dos formas funcionan), y si `PUT`
   con `lines` sustituye las líneas al reenviar una corrección.
4. El contenido real de `pdf-path` y cómo descargarlo (si no, subida manual del PDF).
5. Si emitir con `issueInvoiceVerifactu` es lo que queréis (Ajustes → «Emitir la factura en STEL»).
6. Transcripción: desde 0.3.0 la hace la función propia `sat-transcribir` (permiso de la app de partes; misma
   clave y modelo de OpenAI que DAFRICA Parte, `gpt-4o-mini-transcribe`). El servicio anterior de DAFRICA Parte
   exigía permisos de «partes» de la aplicación antigua y por eso no transcribía. Sin cobertura, el audio queda
   guardado y se transcribe al volver; también se puede escribir.

---

## 6. Mantenimiento

| Fichero | Qué hace |
|---|---|
| `sat/app.js` | Pantallas del técnico, navegación, firmas, envío, bandeja |
| `sat/admin.js` | Oficina: partes, revisión, decisión, aprobación, avisos, STEL, ajustes |
| `sat/lib/cola.js` · `almacen.js` | Cola de subida idempotente e IndexedDB (borradores, archivos, cambios en fila) |
| `sat/lib/dictado.js` | Organizador del dictado (determinista, sin IA, sin inventar) |
| `sat/lib/contenido.js` · `economia.js` | Lo que se firma y sus comprobaciones · importes (igual que `sat_total`) |
| `sat/lib/pdf.js` · `medios.js` | PDF firmado (pdf-lib) · firma en pantalla, fotos, grabación |
| `sat/sw.js` | Abre sin conexión. **Al publicar una versión, cambia `CACHE` y `?v=` en `index.html`** |
| `supabase/propuestas/20261116_sat_partes.sql` | Tablas, estados, permisos, funciones y almacén |
| `supabase/functions/sat-stel/handler.mjs` | Única puerta a STEL (incidencia, albarán, adjuntos, factura, catálogo) |
| `pruebas/sat/` | Emulador local y STEL falso |

Reglas que no se cambian sin hablarlo: el contenido firmado no lleva importes; una firma vale solo para el
contenido exacto firmado; ninguna factura sin aprobación expresa de `sat.facturar`; el PDF de una factura no va
al técnico hasta que está emitida; avisar al técnico no marca la factura como entregada; en STEL siempre se busca
antes de crear.
