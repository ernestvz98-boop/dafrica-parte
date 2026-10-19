# Informe de precisión · lector determinista de albaranes

- Corpus: **sintético**
- Versión del extractor: `determinista-p0-1`
- Documentos evaluados: **14**
- Documentos aceptados automáticamente (AUTO_OK): **4** · AUTO_OK con algún error: **0**
- Estado de documento igual al esperado: **11/14**
- Campos evaluados: **240** · correctos y aceptados: **226** (94.2 %)
- **Fallos críticos (valor erróneo aceptado como bueno): 0**

## Precisión por campo

| Campo | Total | Correcto automático | Marcado (esperado) | Correcto a revisar | Sin valor, marcado | Erróneo, marcado | **Erróneo aceptado** | % automático correcto |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cabecera.proveedor_nif | 14 | 12 | 2 | 0 | 0 | 0 | **0** | 85.7 % |
| cabecera.numero | 14 | 13 | 1 | 0 | 0 | 0 | **0** | 92.9 % |
| cabecera.fecha | 14 | 11 | 3 | 0 | 0 | 0 | **0** | 78.6 % |
| lineas.*.referencia | 33 | 33 | 0 | 0 | 0 | 0 | **0** | 100.0 % |
| lineas.*.descripcion | 33 | 33 | 0 | 0 | 0 | 0 | **0** | 100.0 % |
| lineas.*.cantidad | 33 | 29 | 4 | 0 | 0 | 0 | **0** | 87.9 % |
| lineas.*.precio | 33 | 31 | 2 | 0 | 0 | 0 | **0** | 93.9 % |
| lineas.*.descuento | 33 | 33 | 0 | 0 | 0 | 0 | **0** | 100.0 % |
| lineas.*.importe | 33 | 31 | 2 | 0 | 0 | 0 | **0** | 93.9 % |

## Detalle por documento

### S01-cascada-dos-renglones ⚠
Proveedor registrado, descuento 20+5, descripción en dos renglones, miles 1.500,00, NIF de DAFRICA en el recuadro del cliente

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **REVISAR**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500123456» (OK) · Fecha «15/10/2026» → 2026-10-15 (OK)
- Líneas: 5
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 5 líneas de artículo
- Validación total_lineas: OK · Impreso 5 / leídas 5
- Validación totales: FALLO · Base + IVA no coincide con el total impreso
- Incidencia: Validación totales: Base + IVA no coincide con el total impreso

### S02-subtotal-anotacion-recogida ⚠
Columnas ARTÍCULO/SUBTOTAL/TOTAL, número y fecha en tabla de cabecera, fecha con año de dos cifras, fila «RETIRADO POR» con cantidad

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **REVISAR**
- Proveedor: FERRETERIA DEL SIL FICTICIA, S.L. · NIF B24555559 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «003424» (OK) · Fecha «17-10-26» → 2026-10-17 (OK)
- Líneas: 2 · ignoradas: «RETIRADO POR: PEDRO G. 1» (Anotación de recogida, no es un artículo)
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, precio, subtotal, descuento, importe
- Validación lineas: OK · 2 líneas de artículo
- Validación totales: FALLO · Base + IVA no coincide con el total impreso
- Incidencia: Validación totales: Base + IVA no coincide con el total impreso

### S03-codigo-con-forma-decimal
Código impreso 8.286,0800 que NO es un precio, cantidades con 4 decimales, fecha en texto, línea sin código

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: MADERAS FICTICIAS DEL BIERZO, S.L.U. · NIF A24777773 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «26/012345» (OK) · Fecha «16 de octubre de 2026» → 2026-10-16 (OK)
- Líneas: 2
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, precio, descuento, importe
- Validación lineas: OK · 2 líneas de artículo

### S04-sin-precios-cantidad-ambigua
Proveedor no registrado, albarán sin precios, «1.000» sin pruebas del formato numérico

- Tipo de PDF: DIGITAL · estado esperado **REVISAR**, obtenido **REVISAR**
- Proveedor: — · NIF B33123456 (NIF_NO_REGISTRADO) · NIF de DAFRICA descartado como emisor: B24000002
- Número «77812» (OK) · Fecha «18/10/2026» → 2026-10-18 (OK)
- Líneas: 3
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad
- Validación lineas: OK · 3 líneas de artículo
- Incidencia: proveedor: NIF B33123456 leído correctamente pero no registrado como proveedor
- Incidencia: 1 línea(s) requieren revisión: 1
  - `lineas.1.cantidad` MARCADO_COMO_ESPERADO · esperado 1000 · obtenido null (AMBIGUO)

### S05-descuadre-precio-por-100-sin-fecha
Importe que no cuadra, precio expresado por 100 unidades sin indicarlo, fecha ausente

- Tipo de PDF: DIGITAL · estado esperado **REVISAR**, obtenido **REVISAR**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500999001» (OK) · Fecha «» → — (VACIO)
- Líneas: 3
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 3 líneas de artículo
- Validación cuadre_lineas: FALLO · Hay líneas cuyo importe no cuadra
- Incidencia: fecha: No se encontró la fecha del albarán
- Incidencia: 2 línea(s) requieren revisión: 1, 3
- Incidencia: Validación cuadre_lineas: Hay líneas cuyo importe no cuadra
  - `cabecera.fecha` MARCADO_COMO_ESPERADO · esperado null · obtenido null (VACIO)
  - `lineas.1.cantidad` MARCADO_COMO_ESPERADO · esperado 2 · obtenido 2 (REVISAR)
  - `lineas.1.precio` MARCADO_COMO_ESPERADO · esperado 10 · obtenido 10 (REVISAR)
  - `lineas.1.importe` MARCADO_COMO_ESPERADO · esperado 25 · obtenido 25 (REVISAR)
  - `lineas.3.cantidad` MARCADO_COMO_ESPERADO · esperado 200 · obtenido 200 (REVISAR)
  - `lineas.3.precio` MARCADO_COMO_ESPERADO · esperado 4.5 · obtenido 4.5 (REVISAR)
  - `lineas.3.importe` MARCADO_COMO_ESPERADO · esperado 9 · obtenido 9 (REVISAR)

### S06-solo-nif-dafrica
El emisor no imprime su NIF: solo aparece el de DAFRICA como destinatario. No debe tomarse como proveedor

- Tipo de PDF: DIGITAL · estado esperado **REVISAR**, obtenido **REVISAR**
- Proveedor: — · NIF — (VACIO) · NIF de DAFRICA descartado como emisor: B24000002
- Número «9001» (OK) · Fecha «14/10/2026» → 2026-10-14 (OK)
- Líneas: 1
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad
- Validación lineas: OK · 1 líneas de artículo
- Incidencia: proveedor: Solo aparece el NIF del destinatario (DAFRICA): el emisor no se puede identificar
  - `cabecera.proveedor_nif` MARCADO_COMO_ESPERADO · esperado null · obtenido null (VACIO)

### S07-multipagina ⚠
Tabla en dos páginas con cabecera repetida y «SUMA Y SIGUE»; total de líneas y base en la última

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **REVISAR**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500777000» (OK) · Fecha «13/10/2026» → 2026-10-13 (OK)
- Líneas: 5
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 5 líneas de artículo
- Validación total_lineas: OK · Impreso 5 / leídas 5
- Validación totales: FALLO · Base + IVA no coincide con el total impreso
- Incidencia: Validación totales: Base + IVA no coincide con el total impreso

### S09-texto-caracter-a-caracter
El PDF posiciona cada carácter por separado (habitual en algunos ERP); títulos abreviados Cód./Artículo/Uds./P.V.P./% Dto/Neto

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500888111» (OK) · Fecha «09/10/2026» → 2026-10-09 (OK)
- Líneas: 2
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, precio, descuento, importe
- Validación lineas: OK · 2 líneas de artículo

### S10-dos-nif-de-terceros
NIF del emisor (no registrado) en el encabezado y NIF de la agencia de transporte (sí registrada) en el pie: el transportista no debe tomarse como emisor

- Tipo de PDF: DIGITAL · estado esperado **REVISAR**, obtenido **REVISAR**
- Proveedor: — · NIF B33123456 (NIF_NO_REGISTRADO) · NIF de DAFRICA descartado como emisor: B24000002
- Número «55001» (OK) · Fecha «10/10/2026» → 2026-10-10 (OK)
- Líneas: 1
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad
- Validación lineas: OK · 1 líneas de artículo
- Incidencia: proveedor: NIF B33123456 leído correctamente pero no registrado como proveedor

### S11-fecha-sin-etiqueta-fila-sin-cantidad-portes
Única fecha sin etiqueta (se propone, no se acepta), artículo con referencia pero sin cantidad, descuento sobre precio neto redondeado, línea de PORTES

- Tipo de PDF: DIGITAL · estado esperado **REVISAR**, obtenido **REVISAR**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500111222» (OK) · Fecha «12/10/2026» → 2026-10-12 (REVISAR)
- Líneas: 3
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 3 líneas de artículo
- Incidencia: fecha: Fecha sin etiqueta «Fecha»: es la única fecha del encabezado, pero no se acepta automáticamente
- Incidencia: 1 línea(s) requieren revisión: 1
  - `cabecera.fecha` MARCADO_COMO_ESPERADO · esperado "2026-10-12" · obtenido "2026-10-12" (REVISAR)
  - `lineas.1.cantidad` MARCADO_COMO_ESPERADO · esperado null · obtenido null (VACIO)

### S12-hueco-vertical-en-tabla
Un artículo aparece muy separado del resto sin rótulo de pie: no puede perderse en silencio

- Tipo de PDF: DIGITAL · estado esperado **REVISAR**, obtenido **REVISAR**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500333444» (OK) · Fecha «11/10/2026» → 2026-10-11 (OK)
- Líneas: 2
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 2 líneas de artículo
- Validación fin_de_tabla: FALLO · Posibles artículos después del final detectado de la tabla: «0000000303 ARTÍCULO C 3,00 5,00 15,00»
- Incidencia: Validación fin_de_tabla: Posibles artículos después del final detectado de la tabla: «0000000303 ARTÍCULO C 3,00 5,00 15,00»
  - LINEA_PERDIDA_BLOQUEADA {"fila_esperada":3,"categoria":"LINEA_PERDIDA_BLOQUEADA"}

### S13-dos-descuentos-columnas-ajenas
Columnas Dto 1 y Dto 2 (cascada), columnas Lote y % IVA no usadas, unidad impresa junto a la cantidad, etiqueta «Número:»

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «2026-A-0099» (OK) · Fecha «08/10/2026» → 2026-10-08 (OK)
- Líneas: 2
- Validación tabla: OK · Columnas: referencia, descripcion, otra, cantidad, precio, descuento, descuento, otra, importe
- Validación lineas: OK · 2 líneas de artículo

### S14-erp-texto-monoespaciado
El ERP escribe la cabecera y cada fila como un único texto con espacios (fuente Courier): las columnas se reparten por posición

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «7700123» (OK) · Fecha «07/10/2026» → 2026-10-07 (OK)
- Líneas: 2
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, precio, importe
- Validación lineas: OK · 2 líneas de artículo

### S08-escaneado
Página que solo contiene una imagen (escaneo): no debe extraerse ningún dato

- Tipo de PDF: ESCANEADO · estado esperado **NO_DIGITAL**, obtenido **NO_DIGITAL**
- Líneas: 0
- Incidencia: PDF escaneado sin capa de texto: requiere OCR (fase P1). No se ha extraído ningún dato.
  - `cabecera.proveedor_nif` MARCADO_COMO_ESPERADO · esperado null · obtenido null (VACIO)
  - `cabecera.numero` MARCADO_COMO_ESPERADO · esperado null · obtenido null (VACIO)
  - `cabecera.fecha` MARCADO_COMO_ESPERADO · esperado null · obtenido null (VACIO)

