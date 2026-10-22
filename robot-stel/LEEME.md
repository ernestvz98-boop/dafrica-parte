# Robot de STEL Order (solo lectura)

Aprobado por el usuario el 2026-10-22 **solo para revisar**: por ahora el robot no modifica nada en STEL.

- `guardia.js`: toda petición del navegador pasa por aquí. Solo GET/HEAD/OPTIONS; en la entrada,
  además, el POST de inicio de sesión. Cualquier otra (guardar, borrar, cambiar) se cancela antes de
  salir. Pruebas: `pruebas/robot-stel.test.js`.
- `explorar.js`: paso 1. Entra con `STEL_WEB_USUARIO` y `STEL_WEB_CLAVE` (variables del entorno,
  nunca en el chat ni en el repositorio), no pulsa botones y deja capturas e informe en una carpeta
  fuera del repositorio. Sirve para construir el paso 2 (lista de obras y obra de cada albarán de
  compra), que se guardará en Supabase para el lector.

Requisitos para ponerlo en marcha (los decide el usuario):
1. Un usuario de STEL solo de consulta para el robot, si STEL lo permite.
2. `STEL_WEB_USUARIO` y `STEL_WEB_CLAVE` en los ajustes del entorno de Claude Code (Editar → variables).
3. Permiso en Claude Code para ejecutar `node robot-stel/…` (el sistema de seguridad de la sesión
   bloquea por defecto la navegación automática en STEL).
