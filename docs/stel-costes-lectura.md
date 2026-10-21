# Consulta económica de STEL para el cerebro DAFRICA

Función nueva e independiente: `stel-costes-lectura`. No cambia las funciones,
pantallas o pruebas del lector. Las llamadas externas a STEL son exclusivamente GET.

## Datos y límites

- `productos`: precio de compra de la ficha, referencia, descripción y modificación.
  No equivale a una compra histórica ni se usa como precio de venta.
- `facturas`: cabeceras y líneas de facturas de compra, fecha, cantidad, precio base,
  descuentos, impuesto y moneda.
- `albaranes`: mismas evidencias desde entregas, como referencia provisional.
- No devuelve cuentas bancarias, comentarios privados, direcciones o claves.
- Un precio o unidad ausente queda `null`. Cero sigue siendo cero.
- El neto calculado aplica descuentos sucesivos de línea y documento, solo si constan
  ambos. Debe contrastarse con redondeos, gastos y factura original. No prueba que
  la factura esté contablemente validada.
- Página de 1 a 50 registros (25 por defecto); hasta 500 líneas por documento con
  indicador explícito de integridad. Los límites no se ocultan como respuestas completas.
- La paginación se ordena por ID. Continuar desde `siguiente` hasta página vacía y
  comprobar IDs ya recibidos: páginas cortas o cambios de datos no prueban exhaustividad.
- Fechas de inicio/fin se envían en UTC a los filtros publicados por STEL.

## Autenticación

La verificación automática de JWT del gateway se sustituye **solo en esta función
nueva** por validación explícita en el handler. No hay acceso anónimo a los datos.

1. Usuario web: Bearer de Supabase Auth validado mediante `/auth/v1/user` y permiso
   actual `costes.ver` obtenido con su contexto mediante `mis_permisos`.
2. Backend autorizado: capacidad aleatoria de 256 bits, de un uso y duración máxima
   de cinco minutos. Se guarda solo su hash SHA-256 en `cerebro_stel_consultas`.
   El registro contiene la consulta permitida: el portador no puede sustituirla.
   Una actualización condicional reclama la capacidad de forma atómica y borra
   el hash antes de consultar STEL. Reenvíos y carreras no repiten la consulta.

El backend que emite la capacidad ya debe tener acceso administrativo a la base de
datos. Ni `anon` ni `authenticated` pueden emitirla ni leer el registro. RLS activada,
sin políticas para esos roles y con sus privilegios revocados. Solo el servidor con
`service_role` y el administrador de base de datos acceden al registro privado.
Las claves existentes permanecen exclusivamente en los secretos del servidor.

El registro guarda la respuesta proyectada y el código de error, sin tokens ni claves.
Se usa como evidencia de consultas, no como contabilidad ni catálogo sincronizado.
Su retención debe revisarse antes de una carga periódica de gran volumen; las
capacidades caducan automáticamente, aunque el resultado privado siga registrado.

## Contrato de consulta de usuario

POST con JSON de claves permitidas:

```json
{"recurso":"productos","inicio":0,"limite":25}
```

También: `referencia` exacta (referencia de artículo o referencia completa de documento),
`desde` y `hasta` en formato calendario para documentos, o `id` positivo para detalle.
El detalle por ID no admite paginación ni filtros adicionales. No se admiten URLs,
rutas arbitrarias ni instrucciones de escritura en STEL.

Para el backend se envía únicamente `consulta_id` con su capacidad en Authorization.
El administrador conserva el resultado mediante el registro, sin copiarlo al repositorio.

## Validación

`node --test pruebas/stel-costes-lectura.test.js` cubre autorización, capacidades,
reenvíos, acceso anónimo, filtros, precios ausentes/cero, compra frente a venta,
descuentos, integridad de páginas/documentos y exclusión de campos privados.
Las pruebas usan exclusivamente datos sintéticos.

Antes del uso económico, comprobar una lectura real y registrar su cobertura.
No se deben subir precios reales, referencias de documentos ni datos de proveedor al repo público.

Validación del 21/10/2026: la función nueva devolvió una muestra de artículos con
precio de compra y otra de facturas con fecha, moneda, líneas y precios. Se comprobó
el rechazo HTTP 401 sin identificación y los privilegios denegados de la tabla para
`anon` y `authenticated`. La muestra no acredita que el catálogo entero esté leído;
las unidades de compra siguen pendientes donde STEL no las proporciona.
El aviso informativo de RLS sin políticas en esta tabla es intencional: los usuarios
no acceden a los registros backend y sus privilegios están revocados.

## Fuentes técnicas

- STEL API y esquema OpenAPI: https://app.stelorder.com/app/indexapi.html
- Supabase, autenticación de funciones: https://supabase.com/docs/guides/functions/auth-headers

## Despliegue y reversión

La SQL de la tabla se conserva en `supabase/propuestas/cerebro_stel_consultas_lectura.sql`.
El despliegue contiene solo `index.ts` y `handler.mjs`, con la configuración de
autenticación indicada. No precisa paquetes externos ni cambios en tablas actuales.

Para desactivar el acceso backend, revocar o caducar sus capacidades y retirar esta
función específica. Para revocar acceso web, retirar `costes.ver` al usuario afectado.
No hace falta modificar el lector ni sus funciones compartidas.
