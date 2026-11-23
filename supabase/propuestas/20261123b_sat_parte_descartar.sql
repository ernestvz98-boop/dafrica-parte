-- DAFRICA SAT · el técnico descarta un parte que NO ha enviado (usuario, 2026-11-23: el primer parte real se creó dos veces
-- para el mismo cliente; con «Seguir con el parte…» le quedaban dos borradores). Solo su propio parte, en BORRADOR o FIRMADO
-- (sin enviar: no ha llegado a STEL ni a la oficina). Se borra el parte (firmas, archivos y versiones van en cascada) y, si el
-- aviso no tiene más partes, vuelve a ASIGNADO o, si lo creó el propio técnico desde el teléfono, queda ANULADO.
-- Repetirlo no falla (idempotente: la cola del teléfono puede reintentar).
create or replace function public.sat_parte_descartar(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sat_partes; a public.sat_avisos; v_otros integer;
begin
  perform public.sat_exigir('sat.tecnico');
  select * into r from public.sat_partes where id = p_id for update;
  if not found then return jsonb_build_object('descartado', true, 'ya_no_existia', true); end if;
  if r.tecnico_id <> auth.uid() then raise exception 'parte_de_otro_tecnico' using errcode = '42501'; end if;
  if r.estado not in ('BORRADOR', 'FIRMADO') then raise exception 'parte_no_descartable: %', r.estado; end if;
  if exists (select 1 from public.sat_stel_operaciones where parte_id = p_id) or exists (select 1 from public.sat_facturas where parte_id = p_id) then
    raise exception 'parte_con_stel';
  end if;
  delete from public.sat_partes where id = p_id;
  select count(*) into v_otros from public.sat_partes where aviso_id = r.aviso_id;
  select * into a from public.sat_avisos where id = r.aviso_id for update;
  if found and v_otros = 0 and a.estado in ('NUEVO', 'ASIGNADO', 'EN_CURSO') then
    update public.sat_avisos set estado = case when a.origen = 'LLAMADA_TECNICO' and a.tecnico_id = auth.uid() then 'ANULADO' else 'ASIGNADO' end,
      actualizado_en = now() where id = a.id returning * into a;
  end if;
  perform public.sat_auditar('PARTE_DESCARTADO', 'parte', p_id, jsonb_build_object('codigo', r.codigo, 'aviso', a.codigo, 'aviso_estado', a.estado));
  return jsonb_build_object('descartado', true, 'codigo', r.codigo, 'aviso_estado', a.estado);
end $$;
revoke all on function public.sat_parte_descartar(uuid) from public, anon;
grant execute on function public.sat_parte_descartar(uuid) to authenticated;
