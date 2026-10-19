# Creación de albaranes de compra en STEL · diseño (2026-10-19)

## Arquitectura acordada

1. El lector interpreta el PDF (`albaranes/extraer.js`).
2. DAFRICA Control / Supabase determina la obra.
3. La API de STEL se usa para proveedores, artículos, pedidos y para crear/gestionar el albarán.
4. Supabase guarda el `id` del albarán creado en STEL y la obra DAFRICA.
5. Fase posterior: un robot de navegador abre el albarán en la web de STEL y lo vincula
   a la obra. **La API no expone esa vinculación y no se sustituye por comentarios,
   referencias ni otros campos.**

Estados del albarán en DAFRICA:

| Estado | Significado |
|---|---|
| `pendiente_creacion_stel` | Lectura validada y obra determinada; falta crearlo en STEL |
| `creado_stel` | Creado y releído en STEL; `stel_id` guardado |
| `pendiente_vincular_obra` | Listo para el robot (tiene `stel_id` y `obra_id`) |
| `obra_vinculada` | El robot confirmó la vinculación en la web de STEL |
| `error` | Fallo con detalle; se reintenta solo de forma idempotente |

Precios: las líneas pueden crearse sin precio (`precio_pendiente`); antes de facturar se
resuelven con `albaranes/precios.js` (pedido → artículo STEL → factura recibida → revisión).

## Qué exige un albarán de compra (deducido de 500 albaranes existentes)

Análisis de solo lectura de los 500 primeros `purchaseDeliveryNotes` que devuelve la API
y de sus 1.434 líneas. No se ha creado ningún documento: los campos «obligatorios» son una
inferencia (lo que la web de STEL rellena siempre) y se confirmarán con una creación de
prueba autorizada.

### Cabecera

| Campo | Presente | Observaciones | Origen en DAFRICA |
|---|---|---|---|
| `account-id` | 500/500 | Proveedor (`suppliers/{id}`), 92 distintos | Mapeo NIF → `account-id` |
| `serial-number-id` | 500/500 | Solo 2 series en uso | Configuración (serie a decidir) |
| `document-state-id` | 500/500 | 2 estados en uso (443 / 57) | Configuración (estado inicial a decidir) |
| `date` | siempre | Fecha del albarán | Lector |
| `extra-reference` | — | N.º de albarán del proveedor | Lector (clave de duplicados) |
| `currency-code` | 500/500 | Siempre `EUR` | Fijo |
| `primary-tax-enabled` | 499 true | IVA activado | Fijo |
| `creator-id`, `agent-id` | 500/500 | Empleado (`employees/{id}`); casi siempre el mismo | Probablemente lo asigna STEL según la clave |
| `payment-option-id` | 479/500 | 18 distintos; probablemente el del proveedor | Dejar el predeterminado del proveedor |
| `parent-document-id` | 62/500 | Pedido de compra origen (`purchaseOrders/{id}`) | Si existe pedido |
| `income-tax-enabled`, `settled`, `signed` | siempre `false` | — | Fijo |

### Líneas `lines[]`

| Campo | Presente | Observaciones |
|---|---|---|
| `line-type` | 1434/1434 | `ITEM` (1.419) o `SECTION` (15, títulos sin artículo) |
| `item-id` | todas las `ITEM` | **Obligatorio en la práctica**: no hay líneas de artículo sin `item-id` |
| `units` | siempre | Cantidad |
| `item-base-price` | siempre | Precio; para `precio_pendiente` hay que confirmar si STEL acepta 0 |
| `discount-percentage` | siempre | Un solo porcentaje: los descuentos en cascada se convierten al equivalente |
| `primary-tax-id` | todas las `ITEM` | Casi siempre el mismo impuesto (`taxLines/{id}`) |
| `warehouse-id` | 271/1434 | Opcional |
| `order` | siempre | Orden de la línea |

Recursos relacionados (rutas observadas): `suppliers`, `serialNumbers`, `documentStates`,
`employees`, `paymentOptions`, `bankAccounts`, `purchaseOrders`, `products`, `taxLines`,
`warehouses`.

## Mapeo de proveedores

- `suppliers` tiene `tax-identification-number`: 886 de los 1.000 primeros proveedores
  lo tienen relleno. **El NIF leído del PDF es la clave de mapeo** (`stel_proveedores`).
- Los tres proveedores actuales del lector (Saltoki, Rodavi, Maderas Pereira) existen en
  STEL, cada uno con un único `account-id` y con NIF.
- Regla: solo se crea el albarán si el NIF corresponde a **un único** proveedor no borrado.
  Sin NIF en STEL o con varios → revisión (nunca por parecido del nombre).

## Mapeo de artículos

- Cada línea de artículo necesita `item-id`. En la muestra, 1.419 líneas usan 1.312
  artículos distintos: el catálogo crece casi una referencia por línea.
- De 35 referencias de proveedor ya leídas por DAFRICA, solo 4 aparecen como `reference`
  en los primeros 2.000 artículos (el catálogo es mayor; lectura incompleta).
- Propuesta: tabla `stel_articulos` con clave (proveedor, referencia del proveedor) → `item-id`.
  1. Buscar el mapeo guardado.
  2. Si no existe, buscar en el catálogo STEL por `reference`/`barcode` exactos; aceptar solo
     un resultado único.
  3. Si no existe, **crear el artículo** en STEL (decisión pendiente: hace falta autorizarlo
     y fijar qué datos llevan los artículos nuevos), o dejar la línea en revisión.

## Pendiente de confirmar antes de escribir en STEL

1. Serie y estado inicial con los que se deben crear los albaranes.
2. Si STEL acepta líneas con precio 0 o sin precio, y si permite actualizar líneas después
   (`PUT purchaseDeliveryNotes/{id}`) al resolver precios.
3. Si se permite crear artículos nuevos automáticamente.
4. Lectura completa de catálogos de proveedores y artículos (más de 1.000 / 2.000) y orden
   de paginación de la API.
5. Primera creación de prueba: en una empresa de pruebas o como borrador anulable, con aprobación.
