# DAFRICA Control · reglas permanentes del proyecto

Aplicación web estática (GitHub Pages, rama `main`) con Supabase (base de datos y funciones
Edge). El repositorio es **público**.

## Fases y aprobación

- **Fase 1 (en curso): lector de albaranes.** PDF digitales, escaneados y mixtos, de cualquier
  tamaño; separación de albaranes; manuscritos relevantes (códigos de obra); campos de
  cabecera, líneas y totales; resolución automática solo con evidencia; 0 errores críticos.
- **Fase 2 (solo con aprobación expresa del usuario):** STEL (artículos, albaranes, obra),
  precios pendientes y facturación, robot de vinculación de obra, CRM.
- No se avanza de fase sin que el usuario apruebe el informe de la fase anterior.

## Ramas y producción

- Trabajo en la rama de desarrollo indicada en la sesión; **no modificar `main`** sin aprobación.
- **Producción = `main` + funciones Edge desplegadas.** Ningún despliegue ni cambio de esquema,
  datos o funciones sin autorización expresa. Nada destructivo sin copia de seguridad
  recuperable y confirmación.
- STEL solo a través de funciones Edge con el secreto `STEL_API_KEY`; nunca copiar, imprimir ni
  registrar el valor de ningún secreto. Antes de escribir en STEL, acceso solo de lectura.
- Excepción aprobada por el usuario (2026-10-22): el robot de la web de STEL (`robot-stel/`) **solo
  para revisar**. Toda petición pasa por `robot-stel/guardia.js` (cualquier escritura se cancela);
  credenciales solo en variables del entorno; no pulsa botones salvo la entrada y los enlaces del
  menú principal (navegación).
- No contratar servicios externos (OCR, visión) sin mostrar antes resultados y costes.
- Pedidos a proveedor (regla del usuario, 2026-10-26; cálculo en `robot-stel/pedidos.js`).
  - **Por qué:** en STEL, generar un albarán desde un pedido lo pasa entero a «Recibido» y ya no
    deja generar otro.
  - **Lo pendiente:** el robot vigila qué falta en cada pedido, a partir del pedido y de los
    albaranes anteriores con su PAP.
  - **Entrega que no completa el pedido:** albarán A MANO, con «PAPxxxxx» en el título, las
    observaciones y cada línea, los precios del pedido y su obra. La Ref. Documento Proveedor lleva
    el número del albarán del proveedor.
  - **Entrega que completa lo que falta:** albarán GENERADO DESDE EL PEDIDO, con solo lo de ese
    papel, para dejarlo cerrado y enlazado.
  - **Se para:** si hay líneas fuera del pedido, más cantidad que la pendiente o el pedido ya está
    cerrado.
  - **Precio ausente en el albarán:** se toma el del pedido.

## Datos reales

- Nunca subir al repositorio: albaranes reales, NIF reales en claro, precios reales, números de
  albarán, códigos de obra reales, nombres de personas, secretos.
- `pruebas/corpus-real/` y `pruebas/informes-reales/` están fuera de git. Las pruebas usan
  datos ficticios (`pruebas/ayudas-ocr.js`, `pruebas/sinteticos.js`).
- Los perfiles públicos de proveedor (`albaranes/proveedores.js`) llevan solo la huella SHA-256
  del CIF (`huellas_nif`, ver `albaranes/nif.js`), nunca el CIF en claro.
- Antes de cada commit: buscar en los ficheros cambiados NIF, números y códigos del corpus.

## Reglas del lector

- Nunca inventar: un dato que no existe es `null`; un precio ausente es `precio_pendiente`,
  nunca 0. Nunca estimar precios, cantidades ni importes con IA (tampoco con visión).
- Un valor incorrecto nunca se acepta automáticamente (confianza ≥ 0,9 = aceptado).
  Mejor revisión que error. No bajar umbrales para subir porcentajes.
- Coincidir varias lecturas del MISMO motor sobre la misma imagen no es evidencia
  independiente (errores sistemáticos: «Ø» → M/Y, «S» → 5).
- Un campo dudoso se resuelve solo con evidencia: cuadre matemático, formato del proveedor,
  unanimidad de relecturas con validación estructural, catálogo de solo lectura con
  coincidencia única, obra impresa, coherencia del lote. Si quedan dos interpretaciones
  plausibles, no se resuelve. Cada resolución guarda método, confianza y evidencias.
- Un NIF válido no registrado se conserva pero queda en revisión. DAFRICA nunca es el emisor.
- Visión solo sobre recortes de anotaciones manuscritas (o de un campo dudoso), nunca la página.
- Relectura y visión confirman los caracteres de una casilla, no sus límites: si el código lleva
  texto pegado, la descripción no se confirma por esa vía.
- Un código manuscrito (obra o STEL) leído pero sin validar impide AUTO_OK.
- Un catálogo de obras incompleto (`lector_obras`) solo valida un código con el nombre de la obra;
  «solo una de las lecturas existe en el catálogo» y «lectura a una cifra de la única obra con ese
  nombre» exigen el catálogo completo (STEL o lista marcada como completa en `lector_ajustes`).
- El nombre de la obra solo es prueba si ninguna obra de código confundible (una cifra distinta o
  dos contiguas intercambiadas) coincide con el albarán igual o más («HOSPITAL», «CENTRO» son de
  varias obras); «solo una de las lecturas existe» exige que, con cualquier cifra en la posición
  dudosa, no exista otra obra. Todo cambio en estas reglas pasa `node pruebas/prueba-fuerza-obras.js`
  con el catálogo real (`pruebas/corpus-real/obras.tsv`): 0 lecturas falsas aceptadas.
- El albarán de compra de STEL se busca en la cuenta del CIF del proveedor; si no está ahí, en una
  cuenta de STEL SIN CIF válido (nunca la de otro CIF) solo con número de 5+ caracteres en el título,
  la misma fecha y siendo el único de STEL con ese número. Si la visión falla, los códigos a mano
  quedan sin comprobar (nunca AUTO_OK).
- Un ABP escrito a mano se valida con STEL por la fecha solo si ese albarán de compra es el ÚNICO
  del proveedor ese día y no está asignado a otro albarán leído (con varios el mismo día, una cifra
  mal leída da otro); si no, hace falta el número del proveedor en STEL. Si STEL dice OTRO número del
  proveedor (referencia externa o título), no se valida nunca. Un albarán de compra de STEL aceptado
  para dos albaranes leídos deja ambos en revisión. Una búsqueda con páginas recortadas o una lista
  que cambia durante la lectura queda incompleta.
- Un código confirmado por una persona o de una tarifa solo se usa si tiene forma de código: sin
  texto de la descripción pegado, comillas ni signos ajenos, sin forma de importe y con el formato
  de código del proveedor si su perfil lo declara (`formato_referencia`). La confirmación es
  evidencia tan buena como su exactitud: se confirma comparando con el papel letra a letra. En un
  código de dos renglones (el OCR pierde guiones y espacios) la pantalla avisa y guarda al segundo
  clic; las confirmaciones de esos códigos anteriores a ese aviso no se usan.
- Un descuento que el OCR no leyó se acepta por relectura solo si con él la línea cuadra.
- Separación: dos páginas con números de albarán distintos nunca se unen; «Página k» solo prueba la
  continuación si es la siguiente. Las relecturas y recortes de una línea, siempre en su página.
- Si la casilla del código puede llevar el principio de la descripción (palabra pegada al código,
  proveedor sin columna de código, fila siguiente sin forma de código del proveedor), la descripción
  no se acepta sola. Un signo de baja confianza entre palabras impresas no se descarta como trazo.
- Consultas a STEL: una sola búsqueda de albaranes de compra por lectura (todas las cuentas, solo
  las fechas de la lectura); nada de consultas sueltas que agoten su cupo («403»). Si STEL no
  responde («403»/«429»), un solo reintento al minuto y ninguna consulta más en esa lectura; una
  consulta fallida nunca cuenta como «no existe».

## Proceso ante cada fallo real

reproducir → explicar → corregir → prueba de regresión → `npm test` completo →
evaluación del corpus (`node pruebas/evaluar.js --incluir-sin-revisar`, también con
`--sin-registro-privado`, que reproduce lo que tiene la web) → documentar en
`REGISTRO-CAMBIOS.md`. Si una corrección mejora un caso y rompe otro, no se acepta.

## Mapa del lector

| Fichero | Función |
|---|---|
| `albaranes/lector.js` | PDF completo página a página, separación de albaranes, errores por página |
| `albaranes/texto-pdf.js` / `extraer.js` | capa de texto, cabecera, tabla, cuadres, totales, confianza |
| `albaranes/ocr.js` / `escaneado.js` | OCR multilectura, combinación validada, segunda fase |
| `albaranes/manuscritos.js` / `vision.js` | anotaciones manuscritas: detección, recortes, validación |
| `albaranes/verificacion.js` | contraste con el catálogo STEL de solo lectura |
| `albaranes/catalogo.js` | catálogo STEL en el navegador: caché 24 h y descarga reanudable con empalme comprobado |
| `albaranes/confirmadas.js` | códigos de proveedor confirmados por una persona o de tarifas importadas (tabla `lector_referencias_confirmadas`, sin precios) |
| `albaranes/compras-stel.js` | albarán de compra de STEL por el número del proveedor en su título (ABP sin leer la letra a mano) |
| `albaranes/datos-referencia.js` | importación de listas de obras (`lector_obras`) y tarifas de proveedor desde CSV/Excel, nunca precios |
| `albaranes/etiquetas.js` | etiquetas de obra con QR: hoja para imprimir y lectura del QR en el escaneo |
| `robot-stel/` | robot de la web de STEL Order, solo lectura (guardia, exploración); ver su `LEEME.md` |
| `albaranes/vendor/` | librerías de terceros servidas por la web (jsQR, qrcode-generator, xlsx); ver su `LEEME.md` |
| `albaranes/motor-navegador.js` | pdf.js + tesseract.js en el navegador (renderizado bajo demanda) |
| `control-29.js` | módulo «Lector de albaranes» del menú (permiso `costes.ver`) |
| `pruebas/` | `npm test`, evaluador, corpus sintético; ver `pruebas/LEEME.md` |
