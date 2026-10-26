-- 2026-10-26 · Verificación en dos pasos (revisión de seguridad autorizada por el usuario).
-- Quien tiene la verificación activada (factor TOTP verificado) y entra solo con la contraseña
-- (sesión aal1) no tiene NINGÚN permiso: todas las políticas RLS, el almacenamiento y las funciones
-- Edge pasan por tiene_permiso / mis_permisos. Con la sesión verificada (aal2), todo sigue igual.
-- Quien aún no la ha activado no cambia (la web le obliga a activarla al entrar).
-- Perder el móvil: un administrador borra el factor en Supabase (Authentication → Users → el
-- usuario → MFA factors, o `delete from auth.mfa_factors where user_id = '…'`) y la persona vuelve
-- a darse de alta con el QR.
-- Deshacer: volver a crear tiene_permiso sin la primera rama del CASE (la definición anterior es
-- exactamente esta función sin la línea «when public.dos_pasos_pendiente() then false») y
-- `drop function public.dos_pasos_pendiente();`.

create or replace function public.dos_pasos_pendiente()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     and exists (
       select 1 from auth.mfa_factors f
       where f.user_id = auth.uid() and f.status = 'verified'
     );
$$;
revoke execute on function public.dos_pasos_pendiente() from public, anon;
grant execute on function public.dos_pasos_pendiente() to authenticated;

create or replace function public.tiene_permiso(permiso_codigo text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
    select
    case
        -- Verificación en dos pasos activada y sesión sin verificar: ningún permiso.
        when public.dos_pasos_pendiente() then false

        -- Si existe una excepción individual, prevalece sobre el rol.
        when exists (
            select 1
            from public.usuario_permisos up
            join public.permisos p on p.id = up.permiso_id
            where up.usuario_id = auth.uid()
            and p.codigo = permiso_codigo
        )
        then (
            select up.permitido
            from public.usuario_permisos up
            join public.permisos p on p.id = up.permiso_id
            where up.usuario_id = auth.uid()
            and p.codigo = permiso_codigo
            limit 1
        )

        -- ADMIN siempre tiene acceso.
        when exists (
            select 1
            from public.usuario_roles ur
            join public.roles r on r.id = ur.rol_id
            where ur.usuario_id = auth.uid()
            and r.codigo = 'ADMIN'
        )
        then true

        -- Si no, comprobar permisos del rol.
        else exists (
            select 1
            from public.usuario_roles ur
            join public.rol_permisos rp on rp.rol_id = ur.rol_id
            join public.permisos p on p.id = rp.permiso_id
            where ur.usuario_id = auth.uid()
            and p.codigo = permiso_codigo
        )
    end;
$$;
