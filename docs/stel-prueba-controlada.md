# STEL · valores confirmados y prueba controlada (2026-10-19)

Todo lo siguiente se obtuvo con lecturas de la API de STEL (`GET`), sin escribir nada.

## 1. Serie y estado (confirmados con los albaranes de compra recientes)

La API pagina del más antiguo al más reciente; se localizó el final de la lista
(≈14.311 albaranes de compra) y se analizaron los 300 últimos (sep.–oct. 2026).

| Concepto | Valor | Evidencia |
|---|---|---|
| Serie | **ABP26 · «ALBARAN DE PROVEEDOR» (id 766480)** | Serie marcada `default`; 282 de 300 recientes; los 30 últimos (19-10-2026) todos en ABP26 |
| Otra serie activa | ALBPMP · «ALBARAN PROVEEDOR PANELES» (id 727978) | 18 de 300; uso específico de paneles, no para el flujo general |
| Estado inicial | **«Pendiente de facturar» (id 23350, orden 1)** | 26 de los 30 últimos; pasan a «Facturado» (23369) al facturar |
| Otros estados | «En curso» (23343), «Cerrado» (23328), «Facturado» (23369) | Uso residual |

La serie cambia cada año (ABP22…ABP26). En 2027 habrá que usar la nueva serie por
defecto: **la serie no se fija en el código**; se lee en cada ejecución la serie
`PURCHASEDELIVERYNOTE` marcada `default` y se comprueba que su prefijo sea `ABP` + año.

## 2. Líneas sin precio

- Lo que existe en STEL: en 14.000+ albaranes, `item-base-price` es **siempre un número**;
  nunca `null`. Hay 412 líneas con **precio 0** (135 en albaranes «Pendiente de facturar»)
  y en octubre de 2026, 19 albaranes llevan alguna línea a 0. **STEL admite precio 0.**
- Lo que solo puede confirmar una escritura: si la API acepta omitir el precio o enviar
  `null`. Se comprobará en la prueba controlada (paso 5): un envío que STEL rechaza no crea
  nada; si lo acepta, se lee lo que ha guardado.
- Diseño: en STEL la línea pendiente lleva precio **0** (o vacío, si la API lo admite y lo
  guarda así); en Supabase queda `estado_precio = precio_pendiente` y `precio_original = null`.
  El 0 de STEL nunca se interpreta como precio real.

## 3. Artículos (catálogo STEL)

- Campos siempre presentes en artículos existentes: `name`, `reference`, `primary-tax-id`
  (21 %: id 15), `stock-enabled`, precios (0 por defecto). La categoría (85 %) sigue la
  convención **categoría = proveedor** (p. ej. «Saltoki», 705 artículos).
- En las líneas de albarán, `item-reference` es la referencia del artículo y coincide en el
  100 % de los casos comprobados (1.220).
- El catálogo tiene duplicados: 56 referencias y 12 códigos de barras repetidos. De ahí la
  regla: varias coincidencias → `revision_articulo`, nunca una elección al azar.
- La API pagina el catálogo de 100 en 100; para crear un artículo hay que haberlo leído
  **completo** (si no, el módulo devuelve `revision_articulo`).
- Campos mínimos para **crear** un artículo: no publicados. Se confirmarán en la prueba con
  el mismo método (un envío rechazado no crea nada).

Resolución por línea: `albaranes/articulos.js` (mapeo guardado → referencia exacta →
código de barras → descripción normalizada idéntica → comprobación anti-duplicados → alta).

## 4. Prueba controlada propuesta (UN albarán real)

**Requisito previo:** un albarán real elegido por DAFRICA que **aún no esté registrado en
STEL** (si ya lo introdujo alguien a mano, la prueba crearía un duplicado), preferiblemente
un PDF digital de Saltoki con 2–5 líneas, con al menos una línea sin precio y, si existe,
una referencia que no esté en el catálogo.

Ejecución en una función Edge nueva con modo **simulación** por defecto; la escritura real
solo se activa con una confirmación explícita de esa ejecución concreta.

1. **Simulación (sin escribir nada):** lectura del PDF, proveedor por NIF → `account-id`,
   comprobación de que no existe ya en STEL un albarán de ese proveedor con ese número
   (`extra-reference`), resolución de cada artículo, serie por defecto y estado
   «Pendiente de facturar». Resultado: el JSON exacto que se enviaría y el estado de cada
   línea (`existente`/`mapeado`/`crear`/`revision_articulo`; `precio_confirmado`/`precio_pendiente`).
   **Se detiene aquí para tu aprobación.**
2. Con tu aprobación, si alguna línea necesita alta: `POST products` con los datos mínimos;
   se relee el artículo creado y se guarda el mapeo en Supabase (`creado_automaticamente`).
   Si hay `revision_articulo`, la prueba se detiene sin crear el albarán.
3. Antes de crear el albarán, nueva comprobación de duplicados en STEL.
4. `POST purchaseDeliveryNotes` con una sola cabecera: proveedor, serie ABP26, estado
   «Pendiente de facturar», fecha, número del proveedor en `extra-reference` y las líneas.
5. Para las líneas sin precio, primer intento **sin** precio. Si STEL lo rechaza no se crea
   nada y se reintenta una vez con precio 0. Se anota qué ha aceptado STEL.
6. Lectura del albarán creado (`GET purchaseDeliveryNotes/{id}`) y comparación campo a
   campo con lo enviado. En Supabase: `albaranes_stel` → `creado_stel` y después
   `pendiente_vincular_obra` (la obra la asigna DAFRICA; el robot la vinculará en la web).
7. Informe: número ABP26 asignado, `id` STEL, artículos usados o creados, precios.

Qué no hará la prueba: no vincula la obra en STEL, no crea facturas, no modifica ni borra
documentos existentes y no procesa ningún otro albarán.

Efectos irreversibles a tener en cuenta: el albarán consume el siguiente número de la serie
ABP26 y, si se anula después, quedará constancia en STEL. El artículo creado queda en el
catálogo (se puede desactivar, no conviene borrarlo si ya se usa en un albarán).
