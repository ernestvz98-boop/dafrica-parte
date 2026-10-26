-- 2026-10-26 · Revisión de seguridad (autorizada por el usuario).
-- Las dos funciones de trigger de facturas son SECURITY DEFINER y, por los privilegios por defecto,
-- cualquiera (anon, authenticated) podía ejecutarlas. Solo las usa su trigger: PostgreSQL no
-- comprueba EXECUTE al disparar un trigger, así que quitarlo no cambia su funcionamiento.
-- Deshacer: grant execute on function ... to anon, authenticated;
revoke execute on function public.costes_factura_estado_trigger() from public, anon, authenticated;
revoke execute on function public.costes_factura_precios_linea_trigger() from public, anon, authenticated;
