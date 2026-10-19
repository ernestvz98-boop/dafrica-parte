-- PROPUESTA (no aplicada). Modelo para crear albaranes en STEL con trazabilidad.
-- Revisar y aprobar antes de aplicarla como migración.

-- Proveedores: NIF leído del PDF → proveedor STEL.
create table if not exists public.stel_proveedores (
  nif text primary key check (nif ~ '^[A-Z0-9]{9}$'),
  account_id bigint not null,
  nombre text,
  verificado_en timestamptz not null default now()
);

-- Artículos: (proveedor, referencia impresa) → artículo STEL, con trazabilidad de su origen.
create table if not exists public.stel_articulos (
  id bigserial primary key,
  account_id bigint not null,                  -- proveedor STEL
  proveedor_nif text,
  referencia_proveedor text not null,          -- literal impreso
  referencia_canonica text not null,           -- mayúsculas sin signos
  descripcion_original text,
  descripcion_normalizada text,
  unidad text,
  codigo_barras text,
  item_id bigint,                              -- null mientras está en revisión
  estado text not null check (estado in ('existente','mapeado','creado_automaticamente','revision_articulo')),
  via text,                                    -- referencia | codigo_barras | descripcion | alta_nueva | manual
  candidatos bigint[],                         -- artículos posibles cuando hay revisión
  origen text not null default 'lector_pdf',
  documento_origen_id uuid references public.coste_documentos(id),  -- albarán que provocó el alta
  creado_en timestamptz not null default now(),
  verificado_en timestamptz not null default now(),
  unique (account_id, referencia_canonica),
  check (estado = 'revision_articulo' or item_id is not null)
);

-- Ciclo de vida del albarán en STEL y vinculación con la obra.
create table if not exists public.albaranes_stel (
  documento_id uuid primary key references public.coste_documentos(id) on delete restrict,
  estado text not null check (estado in ('pendiente_creacion_stel','creado_stel',
    'pendiente_vincular_obra','obra_vinculada','error')),
  clave_idempotencia text not null unique,     -- NIF|n.º albarán|fecha: evita duplicados en STEL
  stel_id bigint unique,
  stel_full_reference text,
  obra_id uuid references public.obras(id),
  intentos int not null default 0,
  ultimo_error text,
  creado_stel_en timestamptz,
  obra_vinculada_en timestamptz,
  actualizado_en timestamptz not null default now(),
  check (estado not in ('creado_stel','pendiente_vincular_obra','obra_vinculada') or stel_id is not null),
  check (estado not in ('pendiente_vincular_obra','obra_vinculada') or obra_id is not null)
);

-- Trazabilidad de precios por línea.
alter table public.coste_lineas
  add column if not exists estado_precio text check (estado_precio in ('precio_confirmado','precio_resuelto','precio_pendiente')),
  add column if not exists precio_original numeric,
  add column if not exists precio_utilizado numeric,
  add column if not exists fuente_precio text check (fuente_precio in ('documento','pedido_compra','articulo_stel','factura_original')),
  add column if not exists fuente_documento text,
  add column if not exists fecha_resolucion_precio timestamptz,
  add column if not exists stel_item_id bigint,
  add column if not exists estado_articulo text check (estado_articulo in ('existente','mapeado','creado_automaticamente','revision_articulo'));

-- Acceso: solo funciones del servidor (service_role); la web lee a través de RPC/vistas con permisos.
alter table public.stel_proveedores enable row level security;
alter table public.stel_articulos enable row level security;
alter table public.albaranes_stel enable row level security;
