# API de STEL Order · diagnóstico de lectura (2026-10-19)

Acceso exclusivamente desde funciones Edge de Supabase con el secreto `STEL_API_KEY`
(cabecera `APIKEY`, base `https://app.stelorder.com/app/`). El valor del secreto no
se copia en código, registros ni repositorio.

Prueba realizada: solo `GET ?limit=1` y `OPTIONS` sobre una lista fija de rutas, desde
una función temporal que devolvía únicamente códigos HTTP y nombres de campos.

## Autenticación y rutas disponibles

| Ruta | GET | Uso previsto |
|---|---|---|
| `purchaseDeliveryNotes` | 200 | **Albaranes de compra**: consulta y, en el futuro, creación |
| `purchaseDeliveryNotes/{id}` | 200 | Detalle (devuelve una lista con el documento) |
| `purchaseOrders` | 200 | Pedidos de compra (posible documento origen del albarán) |
| `purchaseInvoices` | 200 | Facturas de compra (precios definitivos) |
| `suppliers` | 200 | Proveedores (`tax-identification-number` puede venir vacío) |
| `products` | 200 | Artículos (`reference`, `barcode`, `purchase-price`) |
| `warehouses` | 200 | Almacenes (las líneas llevan `warehouse-id`) |
| `documentStates` | 200 | Estados de documento |
| `workOrders`, `incidents` | 200 | Órdenes de trabajo e incidencias |
| `clients`, `salesDeliveryNotes`, `expenses`, `employees` | 200 | No necesarios para compras |
| `projects` | **404** | No expuesto: no hay catálogo de obras/proyectos por la API |
| `salesInvoices`, `taxes` | 404 | No expuestos con estos nombres |

`OPTIONS purchaseDeliveryNotes` anuncia `GET, HEAD, POST, PUT, DELETE`. Eso indica los
métodos del servidor, **no** que esta clave tenga permiso de escritura: no se ha probado
ninguna escritura. No se observaron cabeceras de límite de peticiones.

## Estructura de un albarán de compra (`purchaseDeliveryNotes`)

- Cabecera: `id`, `reference`, `full-reference`, `extra-reference` (n.º del proveedor),
  `date`, `account-id` (proveedor), `document-state-id`, `parent-document-id`
  (documento origen, p. ej. pedido), `title`, `comments`, `private-comments`,
  `discount-percentage`, `subtotal-amount`, `tax-total-amount`, `total-amount`,
  `tax-breakdown[]`, `settled`, `deleted`, `utc-last-modification-date`.
- Líneas `lines[]`: `item-id`, `item-reference`, `item-name`, `item-description`,
  `units`, `item-base-price`, `discount-percentage`, `primary-tax-id`,
  `primary-tax-percentage`, `warehouse-id`, `total-amount`, `line-type`, `order`.

## Consecuencias para la integración

1. **Consultar albaranes**: viable (`GET purchaseDeliveryNotes`, filtro `full-reference`
   ya usado en producción; el filtro `extra-reference` respondió 400 en diagnósticos
   anteriores y hay que paginar con `limit`/`start`).
2. **Vincular albarán ↔ obra**: el albarán de compra **no tiene campo de proyecto/obra**
   en la API y `projects` no existe (404). Hay que acordar dónde vive la obra en STEL
   (p. ej. `title`, `comments`, una orden de trabajo, o un campo que no expone la API).
3. **Crear albaranes**: cada línea necesita `item-id` de un artículo existente; hace falta
   una tabla de correspondencia referencia del proveedor → artículo STEL. El proveedor se
   resuelve por `account-id`; el NIF de STEL puede estar vacío, así que se necesita una
   correspondencia NIF → `account-id` mantenida en DAFRICA.
4. **Permiso de escritura**: pendiente de comprobar con una operación autorizada
   (idealmente en una empresa de pruebas, o crear un borrador y anularlo con aprobación).
