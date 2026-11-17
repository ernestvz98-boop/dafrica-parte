# DAFRICA SAT · partes de técnicos con firma y facturación en STEL (diseño, 2026-11-16)

Aplicación móvil (web instalable, funciona sin conexión) para avisos, inspecciones, mantenimientos
y reparaciones, con dictado, fotos, firmas, revisión económica y factura de STEL Order.

## Arquitectura (la más sencilla que cubre el proceso)

| Pieza | Qué es | Dónde |
|---|---|---|
| `sat/` | Web instalable (PWA) para técnicos, administración y facturación. Sin compilación. Guarda borradores, fotos, audios y firmas en el teléfono (IndexedDB) y los sube con una cola de envío idempotente. | GitHub Pages, junto a DAFRICA Control (mismo inicio de sesión y verificación en dos pasos) |
| Supabase | Tablas `sat_*`, funciones `sat_*` (toda la lógica de estados y permisos), almacén privado `sat-archivos` | Proyecto actual |
| `sat-stel` | Función Edge: la ÚNICA que habla con STEL (clave `STEL_API_KEY` en el servidor) | Supabase |
| Transcripción | Servicio ya usado por DAFRICA Parte (`/transcribir`), configurable; sin conexión, el dictado del teclado del teléfono | Existente |

Se reutiliza: inicio de sesión, roles y permisos (`tiene_permiso`), patrón de funciones Edge con
`STEL_API_KEY`, y el estilo de DAFRICA Control. Las tablas `mantenimiento_*` (mantenimiento
preventivo interno) no se tocan.

## Pantallas

**Técnico** (botones grandes, 1 pulgar):
1. *Mis avisos*: tarjetas por prioridad; botón «+ Aviso por llamada».
2. *Aviso nuevo*: cliente (buscador del catálogo de STEL o alta provisional), dirección, contacto,
   instalación/equipo, motivo, prioridad.
3. *Parte* en 5 pasos: **Datos** (tipo de visita, horas) → **Dictado y fotos** → **Trabajo**
   (comprobaciones con resultado, avería, trabajos, materiales con cantidad y unidad, tiempos,
   estado final y pendientes) → **Revisar** → **Firmas**.
4. *Firmas*: el parte completo, texto del alcance, firma del técnico y del responsable (nombre y
   cargo) o motivo de ausencia/negativa. Genera el PDF firmado.
5. *Bandeja*: facturas emitidas de sus partes: abrir, descargar, compartir y «Entregada al cliente».
6. Barra fija de estado: «Todo subido» / «3 elementos pendientes de subir».

**Administración**: avisos (crear y asignar), partes recibidos, detalle (fotos, audios, firmas,
versiones, PDF, estado de STEL), revisión económica (artículo de STEL, precio, descuento, IVA,
desplazamiento) y decisión: facturar, presupuestar, pedir información, no facturable.
**Facturación**: aprobación expresa (con el total a la vista) y estado de la factura.

## Estados

Aviso: `NUEVO → ASIGNADO → EN_CURSO → CERRADO` (o `ANULADO`).
Parte: `BORRADOR → FIRMADO → ENVIADO → EN_REVISION → PENDIENTE_APROBACION → APROBADO → FACTURADO`,
con `INFO_SOLICITADA` (vuelve al técnico), `PRESUPUESTAR` y `NO_FACTURABLE`.
Tipo de visita: `DIAGNOSTICO`, `REPARACION_FINALIZADA`, `PENDIENTE` (de presupuesto, repuestos o
segunda visita). Factura: `APROBADA → EN_STEL → EMITIDA`; entrega `SIN_PDF / PENDIENTE_ENTREGA / ENTREGADA`
(solo la marca el técnico; avisarle NO la marca como entregada).

Firmas: cada firma guarda el contenido exacto que se firmó. Si el contenido cambia después
(también fotos), las firmas quedan invalidadas, se guarda la versión anterior y hay que volver a
firmar. Los importes NO forman parte de lo firmado.

## Capacidades de STEL Order verificadas en la documentación oficial

Fuente: especificación OpenAPI oficial `https://app.stelorder.com/app/api/openapi.json` (OpenAPI
3.0.1, leída el 2026-11-16) y pruebas de solo lectura del 2026-10-19 (`docs/stel-api.md`).

| Necesidad | Ruta de STEL | Verificado |
|---|---|---|
| Clientes, direcciones, contactos | `GET clients`, `addresses?account-id`, `contacts?account-id` | Documentación; `clients` respondió 200 con nuestra clave |
| Equipos / instalaciones del cliente | `GET assets?account-id` (marca, modelo, n.º de serie, dirección) | Documentación |
| Artículos, servicios, precios | `GET products`, `services` (`sales-price`, `primary-tax-percentage`), `rates`, `specialPrices`, `itemRates` | Documentación |
| Aviso | `POST incidents` (prioridad, cliente, dirección, equipos, técnico, **`external-id`**) y `GET incidents?external-id=` | Documentación; `incidents` respondió 200 |
| **Documento previo a la factura** | **Albarán de trabajo** `POST workDeliveryNotes`: cliente, dirección de trabajo, equipos, `parent-incident-id`, fechas de inicio y fin, líneas (`item-id` obligatorio) | Documentación |
| Adjuntar PDF firmado y fotos | `POST entityAttachments` con `file-base64` + `file-name`, `entity-type: WORKDELIVERYNOTE`; `GET entityAttachments?entity-id&entity-type` | Documentación |
| Estado del documento | `GET workDeliveryNotes/{id}` (`document-state-id`, `signed`), `documentStates` | Documentación |
| Factura desde el albarán | `POST ordinaryInvoices` con `parent-document-id` = albarán de trabajo; `GET ordinaryInvoices?parent-document-id=` | Documentación |
| Emitir (Verifactu) | `POST issueInvoiceVerifactu/{id}` | Documentación |
| PDF de la factura | Campo `pdf-path` en `GET ordinaryInvoices/{id}` (en los ejemplos viene vacío) | **Sin confirmar** |
| Enviar factura por correo | `PUT sendDocument/{id}` | Documentación |

Límites oficiales: 60 llamadas/minuto y 300 (Lite), 1.000 (Business) o 2.000 (Pro) al día. POST de
un solo elemento por llamada.

**Lo que la API no permite y su alternativa:**
- Los documentos (albarán de trabajo, factura) **no aceptan `external-id` al crearlos** (solo las
  incidencias). Para no duplicar: el código del parte (`PT-26-00001`) va en el título y en las
  observaciones privadas y, antes de cada creación, se busca por cliente y fecha; el id devuelto se
  guarda. La factura se busca por `parent-document-id` (si alguien la hizo a mano, se reutiliza).
- Cada línea necesita un artículo o servicio de STEL (`item-id`): los materiales se eligen del
  catálogo en el móvil; lo que el técnico escriba libre lo asigna administración en la revisión.
  Mano de obra y desplazamiento usan dos servicios de STEL que se configuran una vez.
- La firma en pantalla de STEL (`signed`) no se puede poner por la API: la firma va en el PDF
  adjunto y queda guardada en DAFRICA.
- Proyectos (`projects`) no existen en la API.
- PDF de la factura: si `pdf-path` no lo da, administración sube el PDF exportado de STEL con un
  botón y llega igual a la bandeja del técnico.
- Emisión: con «Emitir la factura en STEL» desactivado (por defecto), la factura se crea en STEL sin emitir y
  su PDF solo se trae cuando quien puede facturar confirma que la emitió: nunca llega un borrador al cliente.

## Pendiente de confirmar con la cuenta real (con autorización)

1. Plan de STEL (límite diario de llamadas).
2. Que la clave actual puede crear incidencias, albaranes de trabajo, adjuntos y facturas.
3. Si `pdf-path` trae el PDF de la factura y cómo se descarga.
4. Si las facturas deben emitirse por la API (`issueInvoiceVerifactu`) o en STEL a mano.
5. Los dos servicios de STEL para mano de obra y desplazamiento, y la serie de los albaranes de trabajo.
6. Que el servicio de transcripción actual acepta a los técnicos.
