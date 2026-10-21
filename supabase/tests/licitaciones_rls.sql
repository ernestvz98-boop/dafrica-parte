-- Ejecutar con el conector administrativo. Todas las filas de prueba se revierten.
begin;
select set_config('test.licitaciones_admin', (
  select ur.usuario_id::text from public.usuario_roles ur join public.roles r on r.id=ur.rol_id
  where r.codigo='ADMIN' limit 1
), true);
insert into public.licitaciones_ejecuciones(clave_ejecucion,fecha_local)
values ('prueba-transaccional-licitaciones',current_date);
-- La restricción impide dar por finalizada una ejecución sin fecha final.
do $$ begin
  begin
    update public.licitaciones_ejecuciones set estado='FALLIDO'
    where clave_ejecucion='prueba-transaccional-licitaciones';
    raise exception 'Se aceptó una ejecución final sin fecha';
  exception when check_violation then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.licitaciones_admin'),true);
do $$ begin
  if not exists(select 1 from public.licitaciones_ejecuciones where clave_ejecucion='prueba-transaccional-licitaciones')
  then raise exception 'El administrador autorizado no puede leer'; end if;
  if has_table_privilege(current_user,'public.licitaciones_ejecuciones','INSERT,UPDATE,DELETE')
  then raise exception 'El navegador tiene permisos de escritura'; end if;
  begin
    insert into public.licitaciones_ejecuciones(clave_ejecucion,fecha_local) values ('prueba-escritura-prohibida',current_date);
    raise exception 'Se aceptó una escritura desde authenticated';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
  if exists(select 1 from public.licitaciones_ejecuciones)
  then raise exception 'Un usuario sin permiso puede leer informes'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.licitaciones_ejecuciones;
    raise exception 'anon puede leer informes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Permisos y restricciones comprobados; datos de prueba revertidos' as resultado;
