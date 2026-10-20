# Informe de precisión · lector determinista de albaranes

- Corpus: **sintético**
- Versión del extractor: `determinista-p0-1`
- Documentos evaluados: **14**
- Confianza: cada campo lleva una confianza 0–1; por debajo de 0.9 el campo cuenta como marcado para revisión.
- Documentos aceptados automáticamente (AUTO_OK): **7** · AUTO_OK con algún error: **0**
- Estado de documento igual al esperado: **14/14**
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

## Comparación campo a campo

Resultado: **correcto** (valor igual y aceptado), **correcto, a revisar** (igual pero el lector pide revisión), **sin valor, marcado** / **incorrecto, marcado** (el lector no da el valor o lo da mal, pero avisa), **INCORRECTO ACEPTADO** (fallo crítico).

| Documento | Campo | Valor esperado | Valor extraído | Resultado | Confianza | Error detectado por el lector |
|---|---|---|---|---|---:|---|
| S01-cascada-dos-renglones | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | cabecera.numero | 4500123456 | 4500123456 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | cabecera.fecha | 2026-10-15 | 2026-10-15 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.1.referencia | 0001230045 | 0001230045 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.1.descripcion | TUBO PVC EVAC. Ø32 MM 3M | TUBO PVC EVAC. Ø32 MM 3M | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.1.cantidad | 8 | 8 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.1.precio | 3,45 | 3,45 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.1.descuento | 20 / 5 | 20 / 5 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.1.importe | 20,98 | 20,98 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.2.referencia | 0009876500 | 0009876500 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.2.descripcion | CODO 87º PVC Ø32 | CODO 87º PVC Ø32 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.2.cantidad | 12 | 12 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.2.precio | 0,89 | 0,89 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.2.descuento | 20 | 20 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.2.importe | 8,54 | 8,54 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.3.referencia | 7701002003 | 7701002003 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.3.descripcion | CABLE RZ1-K 0,6/1KV 3G2,5 MM2 BOBINA 100 M | CABLE RZ1-K 0,6/1KV 3G2,5 MM2 BOBINA 100 M | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.3.cantidad | 100 | 100 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.3.precio | 1,235 | 1,235 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.3.descuento | — | — | correcto | — |  |
| S01-cascada-dos-renglones | lineas.3.importe | 123,5 | 123,5 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.4.referencia | 0000000007 | 0000000007 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.4.descripcion | MANGUITO UNIÓN Ø32 | MANGUITO UNIÓN Ø32 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.4.cantidad | 1500 | 1500 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.4.precio | 0,12 | 0,12 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.4.descuento | 10 | 10 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.4.importe | 162 | 162 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.5.referencia | 4400123123 | 4400123123 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.5.descripcion | ABRAZADERA ISOFÓNICA M8 | ABRAZADERA ISOFÓNICA M8 | correcto | 0.96 |  |
| S01-cascada-dos-renglones | lineas.5.cantidad | 2 | 2 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.5.precio | 15 | 15 | correcto | 0.99 |  |
| S01-cascada-dos-renglones | lineas.5.descuento | — | — | correcto | — |  |
| S01-cascada-dos-renglones | lineas.5.importe | 30 | 30 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | cabecera.proveedor_nif | B24555559 | B24555559 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | cabecera.numero | 003424 | 003424 | correcto | 0.96 |  |
| S02-subtotal-anotacion-recogida | cabecera.fecha | 2026-10-17 | 2026-10-17 | correcto | 0.96 |  |
| S02-subtotal-anotacion-recogida | lineas.1.referencia | 104578 | 104578 | correcto | 0.96 |  |
| S02-subtotal-anotacion-recogida | lineas.1.descripcion | BROCA SDS PLUS 10X160 | BROCA SDS PLUS 10X160 | correcto | 0.96 |  |
| S02-subtotal-anotacion-recogida | lineas.1.cantidad | 3 | 3 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | lineas.1.precio | 4,95 | 4,95 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | lineas.1.descuento | 10 | 10 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | lineas.1.importe | 13,37 | 13,37 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | lineas.2.referencia | 200011 | 200011 | correcto | 0.96 |  |
| S02-subtotal-anotacion-recogida | lineas.2.descripcion | GUANTE NITRILO T9 | GUANTE NITRILO T9 | correcto | 0.96 |  |
| S02-subtotal-anotacion-recogida | lineas.2.cantidad | 12 | 12 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | lineas.2.precio | 1,1 | 1,1 | correcto | 0.99 |  |
| S02-subtotal-anotacion-recogida | lineas.2.descuento | — | — | correcto | — |  |
| S02-subtotal-anotacion-recogida | lineas.2.importe | 13,2 | 13,2 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | cabecera.proveedor_nif | A24777773 | A24777773 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | cabecera.numero | 26/012345 | 26/012345 | correcto | 0.96 |  |
| S03-codigo-con-forma-decimal | cabecera.fecha | 2026-10-16 | 2026-10-16 | correcto | 0.96 |  |
| S03-codigo-con-forma-decimal | lineas.1.referencia | 8.286,0800 | 8.286,0800 | correcto | 0.96 |  |
| S03-codigo-con-forma-decimal | lineas.1.descripcion | TABLERO OSB 3 18MM 2500X1250 | TABLERO OSB 3 18MM 2500X1250 | correcto | 0.96 |  |
| S03-codigo-con-forma-decimal | lineas.1.cantidad | 4 | 4 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | lineas.1.precio | 21,5 | 21,5 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | lineas.1.descuento | 20 | 20 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | lineas.1.importe | 68,8 | 68,8 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | lineas.2.referencia | — | — | correcto | — |  |
| S03-codigo-con-forma-decimal | lineas.2.descripcion | LISTÓN PINO 45X45 2,5M | LISTÓN PINO 45X45 2,5M | correcto | 0.96 |  |
| S03-codigo-con-forma-decimal | lineas.2.cantidad | 10 | 10 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | lineas.2.precio | 3,2 | 3,2 | correcto | 0.99 |  |
| S03-codigo-con-forma-decimal | lineas.2.descuento | — | — | correcto | — |  |
| S03-codigo-con-forma-decimal | lineas.2.importe | 32 | 32 | correcto | 0.99 |  |
| S04-sin-precios-cantidad-ambigua | cabecera.proveedor_nif | B33123456 | B33123456 | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | cabecera.numero | 77812 | 77812 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | cabecera.fecha | 2026-10-18 | 2026-10-18 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.1.referencia | A-100 | A-100 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.1.descripcion | TORNILLO 4X40 ZINCADO | TORNILLO 4X40 ZINCADO | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.1.cantidad | 1000 | — | marcado (esperado) | 0.15 | «1.000» puede ser un número con miles o con decimales; el formato no está confirmado |
| S04-sin-precios-cantidad-ambigua | lineas.1.precio | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.1.descuento | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.1.importe | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.2.referencia | A-200 | A-200 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.2.descripcion | TACO NYLON 6MM | TACO NYLON 6MM | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.2.cantidad | 5 | 5 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.2.precio | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.2.descuento | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.2.importe | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.3.referencia | A-300 | A-300 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.3.descripcion | ARANDELA M6 | ARANDELA M6 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.3.cantidad | 12 | 12 | correcto | 0.96 |  |
| S04-sin-precios-cantidad-ambigua | lineas.3.precio | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.3.descuento | — | — | correcto | — |  |
| S04-sin-precios-cantidad-ambigua | lineas.3.importe | — | — | correcto | — |  |
| S05-descuadre-precio-por-100-sin-fecha | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S05-descuadre-precio-por-100-sin-fecha | cabecera.numero | 4500999001 | 4500999001 | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | cabecera.fecha | — | — | marcado (esperado) | 0.00 | No se encontró la fecha del albarán |
| S05-descuadre-precio-por-100-sin-fecha | lineas.1.referencia | X0000001 | X0000001 | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.1.descripcion | ARTÍCULO DE PRUEBA 1 | ARTÍCULO DE PRUEBA 1 | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.1.cantidad | 2 | 2 | marcado (esperado) | 0.50 | El cuadre de la línea no se cumple |
| S05-descuadre-precio-por-100-sin-fecha | lineas.1.precio | 10 | 10 | marcado (esperado) | 0.50 | El cuadre de la línea no se cumple |
| S05-descuadre-precio-por-100-sin-fecha | lineas.1.descuento | — | — | correcto | — |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.1.importe | 25 | 25 | marcado (esperado) | 0.50 | El cuadre de la línea no se cumple |
| S05-descuadre-precio-por-100-sin-fecha | lineas.2.referencia | X0000002 | X0000002 | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.2.descripcion | ARTÍCULO DE PRUEBA 2 | ARTÍCULO DE PRUEBA 2 | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.2.cantidad | 3 | 3 | correcto | 0.99 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.2.precio | 5 | 5 | correcto | 0.99 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.2.descuento | 10 | 10 | correcto | 0.99 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.2.importe | 13,5 | 13,5 | correcto | 0.99 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.3.referencia | X0000003 | X0000003 | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.3.descripcion | ARANDELA PLANA M8 (CAJA) | ARANDELA PLANA M8 (CAJA) | correcto | 0.96 |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.3.cantidad | 200 | 200 | marcado (esperado) | 0.50 | El cuadre de la línea no se cumple |
| S05-descuadre-precio-por-100-sin-fecha | lineas.3.precio | 4,5 | 4,5 | marcado (esperado) | 0.50 | El cuadre de la línea no se cumple |
| S05-descuadre-precio-por-100-sin-fecha | lineas.3.descuento | — | — | correcto | — |  |
| S05-descuadre-precio-por-100-sin-fecha | lineas.3.importe | 9 | 9 | marcado (esperado) | 0.50 | El cuadre de la línea no se cumple |
| S06-solo-nif-dafrica | cabecera.proveedor_nif | — | — | marcado (esperado) | 0.00 | Solo aparece el NIF del destinatario (DAFRICA): el emisor no se puede identificar |
| S06-solo-nif-dafrica | cabecera.numero | 9001 | 9001 | correcto | 0.96 |  |
| S06-solo-nif-dafrica | cabecera.fecha | 2026-10-14 | 2026-10-14 | correcto | 0.96 |  |
| S06-solo-nif-dafrica | lineas.1.referencia | Z-1 | Z-1 | correcto | 0.96 |  |
| S06-solo-nif-dafrica | lineas.1.descripcion | SACO CEMENTO 25 KG | SACO CEMENTO 25 KG | correcto | 0.96 |  |
| S06-solo-nif-dafrica | lineas.1.cantidad | 10 | 10 | correcto | 0.96 |  |
| S06-solo-nif-dafrica | lineas.1.precio | — | — | correcto | — |  |
| S06-solo-nif-dafrica | lineas.1.descuento | — | — | correcto | — |  |
| S06-solo-nif-dafrica | lineas.1.importe | — | — | correcto | — |  |
| S07-multipagina | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S07-multipagina | cabecera.numero | 4500777000 | 4500777000 | correcto | 0.96 |  |
| S07-multipagina | cabecera.fecha | 2026-10-13 | 2026-10-13 | correcto | 0.96 |  |
| S07-multipagina | lineas.1.referencia | 0000000101 | 0000000101 | correcto | 0.96 |  |
| S07-multipagina | lineas.1.descripcion | ARTÍCULO UNO | ARTÍCULO UNO | correcto | 0.96 |  |
| S07-multipagina | lineas.1.cantidad | 1 | 1 | correcto | 0.99 |  |
| S07-multipagina | lineas.1.precio | 10 | 10 | correcto | 0.99 |  |
| S07-multipagina | lineas.1.descuento | — | — | correcto | — |  |
| S07-multipagina | lineas.1.importe | 10 | 10 | correcto | 0.99 |  |
| S07-multipagina | lineas.2.referencia | 0000000102 | 0000000102 | correcto | 0.96 |  |
| S07-multipagina | lineas.2.descripcion | ARTÍCULO DOS | ARTÍCULO DOS | correcto | 0.96 |  |
| S07-multipagina | lineas.2.cantidad | 2 | 2 | correcto | 0.99 |  |
| S07-multipagina | lineas.2.precio | 10 | 10 | correcto | 0.99 |  |
| S07-multipagina | lineas.2.descuento | 50 | 50 | correcto | 0.99 |  |
| S07-multipagina | lineas.2.importe | 10 | 10 | correcto | 0.99 |  |
| S07-multipagina | lineas.3.referencia | 0000000103 | 0000000103 | correcto | 0.96 |  |
| S07-multipagina | lineas.3.descripcion | ARTÍCULO TRES | ARTÍCULO TRES | correcto | 0.96 |  |
| S07-multipagina | lineas.3.cantidad | 3 | 3 | correcto | 0.99 |  |
| S07-multipagina | lineas.3.precio | 1 | 1 | correcto | 0.99 |  |
| S07-multipagina | lineas.3.descuento | — | — | correcto | — |  |
| S07-multipagina | lineas.3.importe | 3 | 3 | correcto | 0.99 |  |
| S07-multipagina | lineas.4.referencia | 0000000104 | 0000000104 | correcto | 0.96 |  |
| S07-multipagina | lineas.4.descripcion | ARTÍCULO CUATRO | ARTÍCULO CUATRO | correcto | 0.96 |  |
| S07-multipagina | lineas.4.cantidad | 4 | 4 | correcto | 0.99 |  |
| S07-multipagina | lineas.4.precio | 2,5 | 2,5 | correcto | 0.99 |  |
| S07-multipagina | lineas.4.descuento | — | — | correcto | — |  |
| S07-multipagina | lineas.4.importe | 10 | 10 | correcto | 0.99 |  |
| S07-multipagina | lineas.5.referencia | 0000000105 | 0000000105 | correcto | 0.96 |  |
| S07-multipagina | lineas.5.descripcion | ARTÍCULO CINCO | ARTÍCULO CINCO | correcto | 0.96 |  |
| S07-multipagina | lineas.5.cantidad | 5 | 5 | correcto | 0.99 |  |
| S07-multipagina | lineas.5.precio | 2 | 2 | correcto | 0.99 |  |
| S07-multipagina | lineas.5.descuento | 10 | 10 | correcto | 0.99 |  |
| S07-multipagina | lineas.5.importe | 9 | 9 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | cabecera.numero | 4500888111 | 4500888111 | correcto | 0.96 |  |
| S09-texto-caracter-a-caracter | cabecera.fecha | 2026-10-09 | 2026-10-09 | correcto | 0.96 |  |
| S09-texto-caracter-a-caracter | lineas.1.referencia | CX-0045 | CX-0045 | correcto | 0.96 |  |
| S09-texto-caracter-a-caracter | lineas.1.descripcion | PERFIL OMEGA GALVANIZADO 3M | PERFIL OMEGA GALVANIZADO 3M | correcto | 0.96 |  |
| S09-texto-caracter-a-caracter | lineas.1.cantidad | 25 | 25 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | lineas.1.precio | 2,1 | 2,1 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | lineas.1.descuento | 15 | 15 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | lineas.1.importe | 44,63 | 44,63 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | lineas.2.referencia | CX-0046 | CX-0046 | correcto | 0.96 |  |
| S09-texto-caracter-a-caracter | lineas.2.descripcion | TORNILLO AUTOTALADRANTE 4,2X13 | TORNILLO AUTOTALADRANTE 4,2X13 | correcto | 0.96 |  |
| S09-texto-caracter-a-caracter | lineas.2.cantidad | 500 | 500 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | lineas.2.precio | 0,03 | 0,03 | correcto | 0.99 |  |
| S09-texto-caracter-a-caracter | lineas.2.descuento | — | — | correcto | — |  |
| S09-texto-caracter-a-caracter | lineas.2.importe | 15 | 15 | correcto | 0.99 |  |
| S10-dos-nif-de-terceros | cabecera.proveedor_nif | B33123456 | B33123456 | correcto | — |  |
| S10-dos-nif-de-terceros | cabecera.numero | 55001 | 55001 | correcto | 0.96 |  |
| S10-dos-nif-de-terceros | cabecera.fecha | 2026-10-10 | 2026-10-10 | correcto | 0.96 |  |
| S10-dos-nif-de-terceros | lineas.1.referencia | T-9 | T-9 | correcto | 0.96 |  |
| S10-dos-nif-de-terceros | lineas.1.descripcion | TUERCA M10 | TUERCA M10 | correcto | 0.96 |  |
| S10-dos-nif-de-terceros | lineas.1.cantidad | 40 | 40 | correcto | 0.96 |  |
| S10-dos-nif-de-terceros | lineas.1.precio | — | — | correcto | — |  |
| S10-dos-nif-de-terceros | lineas.1.descuento | — | — | correcto | — |  |
| S10-dos-nif-de-terceros | lineas.1.importe | — | — | correcto | — |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | cabecera.numero | 4500111222 | 4500111222 | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | cabecera.fecha | 2026-10-12 | 2026-10-12 | marcado (esperado) | 0.50 | Fecha sin etiqueta «Fecha»: es la única fecha del encabezado, pero no se acepta automáticamente |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.1.referencia | 0000000201 | 0000000201 | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.1.descripcion | ARTÍCULO SIN CANTIDAD | ARTÍCULO SIN CANTIDAD | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.1.cantidad | — | — | marcado (esperado) | 0.00 | Confianza 0 < 0.9 |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.1.precio | — | — | correcto | — |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.1.descuento | — | — | correcto | — |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.1.importe | — | — | correcto | — |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.2.referencia | 0000000202 | 0000000202 | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.2.descripcion | TORNILLERÍA A GRANEL | TORNILLERÍA A GRANEL | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.2.cantidad | 1000 | 1000 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.2.precio | 3,4567 | 3,4567 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.2.descuento | 20 | 20 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.2.importe | 2765,4 | 2765,4 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.3.referencia | PORTES | PORTES | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.3.descripcion | PORTES ENVÍO | PORTES ENVÍO | correcto | 0.96 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.3.cantidad | 1 | 1 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.3.precio | 12 | 12 | correcto | 0.99 |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.3.descuento | — | — | correcto | — |  |
| S11-fecha-sin-etiqueta-fila-sin-cantidad-portes | lineas.3.importe | 12 | 12 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | cabecera.numero | 4500333444 | 4500333444 | correcto | 0.96 |  |
| S12-hueco-vertical-en-tabla | cabecera.fecha | 2026-10-11 | 2026-10-11 | correcto | 0.96 |  |
| S12-hueco-vertical-en-tabla | lineas.1.referencia | 0000000301 | 0000000301 | correcto | 0.96 |  |
| S12-hueco-vertical-en-tabla | lineas.1.descripcion | ARTÍCULO A | ARTÍCULO A | correcto | 0.96 |  |
| S12-hueco-vertical-en-tabla | lineas.1.cantidad | 1 | 1 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | lineas.1.precio | 5 | 5 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | lineas.1.descuento | — | — | correcto | — |  |
| S12-hueco-vertical-en-tabla | lineas.1.importe | 5 | 5 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | lineas.2.referencia | 0000000302 | 0000000302 | correcto | 0.96 |  |
| S12-hueco-vertical-en-tabla | lineas.2.descripcion | ARTÍCULO B | ARTÍCULO B | correcto | 0.96 |  |
| S12-hueco-vertical-en-tabla | lineas.2.cantidad | 2 | 2 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | lineas.2.precio | 5 | 5 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | lineas.2.descuento | — | — | correcto | — |  |
| S12-hueco-vertical-en-tabla | lineas.2.importe | 10 | 10 | correcto | 0.99 |  |
| S12-hueco-vertical-en-tabla | línea 3 | | | LINEA_PERDIDA_BLOQUEADA | | |
| S13-dos-descuentos-columnas-ajenas | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | cabecera.numero | 2026-A-0099 | 2026-A-0099 | correcto | 0.96 |  |
| S13-dos-descuentos-columnas-ajenas | cabecera.fecha | 2026-10-08 | 2026-10-08 | correcto | 0.96 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.1.referencia | AB-100 | AB-100 | correcto | 0.96 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.1.descripcion | BLOQUE HORMIGÓN 40X20X20 | BLOQUE HORMIGÓN 40X20X20 | correcto | 0.96 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.1.cantidad | 8 | 8 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.1.precio | 1,2 | 1,2 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.1.descuento | 10 / 5 | 10 / 5 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.1.importe | 8,21 | 8,21 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.2.referencia | AB-200 | AB-200 | correcto | 0.96 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.2.descripcion | MORTERO M-7,5 SACO 25KG | MORTERO M-7,5 SACO 25KG | correcto | 0.96 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.2.cantidad | 20 | 20 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.2.precio | 3,1 | 3,1 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.2.descuento | 10 | 10 | correcto | 0.99 |  |
| S13-dos-descuentos-columnas-ajenas | lineas.2.importe | 55,8 | 55,8 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | cabecera.proveedor_nif | B24123457 | B24123457 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | cabecera.numero | 7700123 | 7700123 | correcto | 0.96 |  |
| S14-erp-texto-monoespaciado | cabecera.fecha | 2026-10-07 | 2026-10-07 | correcto | 0.96 |  |
| S14-erp-texto-monoespaciado | lineas.1.referencia | X-1 | X-1 | correcto | 0.96 |  |
| S14-erp-texto-monoespaciado | lineas.1.descripcion | CINTA AISLANTE 19MM | CINTA AISLANTE 19MM | correcto | 0.96 |  |
| S14-erp-texto-monoespaciado | lineas.1.cantidad | 10 | 10 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | lineas.1.precio | 0,85 | 0,85 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | lineas.1.descuento | — | — | correcto | — |  |
| S14-erp-texto-monoespaciado | lineas.1.importe | 8,5 | 8,5 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | lineas.2.referencia | X-22 | X-22 | correcto | 0.96 |  |
| S14-erp-texto-monoespaciado | lineas.2.descripcion | BRIDA NYLON 200X4,8 (BOLSA 100) | BRIDA NYLON 200X4,8 (BOLSA 100) | correcto | 0.96 |  |
| S14-erp-texto-monoespaciado | lineas.2.cantidad | 3 | 3 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | lineas.2.precio | 4,1 | 4,1 | correcto | 0.99 |  |
| S14-erp-texto-monoespaciado | lineas.2.descuento | — | — | correcto | — |  |
| S14-erp-texto-monoespaciado | lineas.2.importe | 12,3 | 12,3 | correcto | 0.99 |  |
| S08-escaneado | cabecera.proveedor_nif | — | — | marcado (esperado) | — | VACIO |
| S08-escaneado | cabecera.numero | — | — | marcado (esperado) | — | VACIO |
| S08-escaneado | cabecera.fecha | — | — | marcado (esperado) | — | VACIO |

## Detalle por documento

### S01-cascada-dos-renglones
Proveedor registrado, descuento 20+5, descripción en dos renglones, miles 1.500,00, NIF de DAFRICA en el recuadro del cliente

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500123456» (OK) · Fecha «15/10/2026» → 2026-10-15 (OK)
- Líneas: 5
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 5 líneas de artículo
- Validación total_lineas: OK · Impreso 5 / leídas 5
- Validación suma_importes: OK · Suma de líneas 345.02 / impreso «345,02»

### S02-subtotal-anotacion-recogida
Columnas ARTÍCULO/SUBTOTAL/TOTAL, número y fecha en tabla de cabecera, fecha con año de dos cifras, fila «RETIRADO POR» con cantidad

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: FERRETERIA DEL SIL FICTICIA, S.L. · NIF B24555559 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «003424» (OK) · Fecha «17-10-26» → 2026-10-17 (OK)
- Líneas: 2 · ignoradas: «RETIRADO POR: PEDRO G. 1» (Anotación del proveedor, no es un artículo)
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, precio, subtotal, descuento, importe
- Validación lineas: OK · 2 líneas de artículo
- Validación total_con_lineas: OK · Suma de líneas 26.57 + IVA 0 % = total «26,57»

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

### S07-multipagina
Tabla en dos páginas con cabecera repetida y «SUMA Y SIGUE»; total de líneas y base en la última

- Tipo de PDF: DIGITAL · estado esperado **AUTO_OK**, obtenido **AUTO_OK**
- Proveedor: SUMINISTROS NORTE FICTICIOS, S.L. · NIF B24123457 (OK) · NIF de DAFRICA descartado como emisor: B24000002
- Número «4500777000» (OK) · Fecha «13/10/2026» → 2026-10-13 (OK)
- Líneas: 5
- Validación tabla: OK · Columnas: referencia, descripcion, cantidad, unidad, precio, descuento, importe
- Validación lineas: OK · 5 líneas de artículo
- Validación total_lineas: OK · Impreso 5 / leídas 5
- Validación suma_importes: OK · Suma de líneas 42 / impreso «42,00»

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

