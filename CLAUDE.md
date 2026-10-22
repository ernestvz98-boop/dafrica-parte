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
- No contratar servicios externos (OCR, visión) sin mostrar antes resultados y costes.

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
| `albaranes/vendor/` | librerías de terceros servidas por la web (jsQR, qrcode-generator, xlsx); ver su `LEEME.md` |
| `albaranes/motor-navegador.js` | pdf.js + tesseract.js en el navegador (renderizado bajo demanda) |
| `control-29.js` | módulo «Lector de albaranes» del menú (permiso `costes.ver`) |
| `pruebas/` | `npm test`, evaluador, corpus sintético; ver `pruebas/LEEME.md` |
