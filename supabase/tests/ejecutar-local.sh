#!/bin/sh
# Prueba la propuesta del 2026-10-28 en un Postgres LOCAL (nunca en producción).
#   PGHOST=<carpeta del socket> PGPORT=55432 sh supabase/tests/ejecutar-local.sh
set -e
cd "$(dirname "$0")/.."
P="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists prueba_dafrica" -c "create database prueba_dafrica"
for f in tests/supabase-simulado.sql migraciones/20261021_lector_referencias_confirmadas.sql migraciones/20261021_lector_obras_y_tarifas.sql \
         migraciones/20261026_stel_cola.sql tests/revision_autorizacion.sql; do
  $P -d prueba_dafrica -f "$f"
done
