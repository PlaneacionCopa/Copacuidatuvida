-- =====================================================================
--  Copa Cuida Tu Vida · Plataforma de inscripciones
--  Ejecutar completo en Supabase → SQL Editor → New query → Run
--  (Se puede volver a ejecutar sin perder datos)
-- =====================================================================

create extension if not exists pgcrypto;
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no disponible: el correo automático quedará desactivado';
end $$;

-- ---------------------------------------------------------------------
-- 1. Eventos (cupos y estado abierto/cerrado)
-- ---------------------------------------------------------------------
create table if not exists public.eventos (
  id          text primary key,
  nombre      text not null,
  cupos       int  not null check (cupos > 0),
  abierto     boolean not null default false,
  created_at  timestamptz not null default now()
);

insert into public.eventos (id, nombre, cupos, abierto) values
  ('cycling', 'Festival de Indoor Cycling', 250, true),
  ('carrera', 'Carrera de la Mujer',        800, false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Inscripciones
--    "numero" es solo el orden interno de llegada (no se muestra al público)
-- ---------------------------------------------------------------------
create table if not exists public.inscripciones (
  id                            uuid primary key default gen_random_uuid(),
  evento_id                     text not null references public.eventos(id),
  numero                        int  not null,
  acepta_datos                  boolean not null check (acepta_datos),
  declara_salud                 boolean not null check (declara_salud),
  nombre_completo               text not null check (char_length(nombre_completo) between 5 and 120),
  tipo_documento                text not null check (tipo_documento in ('Cédula de ciudadanía','Cédula de extranjería','PPT','Otro')),
  numero_documento              text not null check (numero_documento ~ '^[0-9A-Z]{4,20}$'),
  edad                          int  not null check (edad between 18 and 100),
  telefono                      text not null check (telefono ~ '^[0-9]{7,10}$'),
  contacto_emergencia_nombre    text not null check (char_length(contacto_emergencia_nombre) between 3 and 120),
  contacto_emergencia_telefono  text not null check (contacto_emergencia_telefono ~ '^[0-9]{7,10}$'),
  correo                        text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(correo) <= 120),
  barrio_vereda                 text not null check (char_length(barrio_vereda) between 2 and 80),
  eps                           text not null check (char_length(eps) between 2 and 80),
  talla_camiseta                text not null check (talla_camiseta in ('S','M','L','XL')),
  correo_estado                 text not null default 'pendiente' check (correo_estado in ('pendiente','enviado','error')),
  correo_enviado_at             timestamptz,
  correo_error                  text,
  created_at                    timestamptz not null default now(),
  unique (evento_id, numero_documento),
  unique (evento_id, numero)
);

-- Si la tabla ya existía de la versión anterior, agrega las columnas de correo
alter table public.inscripciones add column if not exists correo_estado text not null default 'pendiente';
alter table public.inscripciones add column if not exists correo_enviado_at timestamptz;
alter table public.inscripciones add column if not exists correo_error text;

create index if not exists inscripciones_evento_fecha  on public.inscripciones (evento_id, created_at);
create index if not exists inscripciones_correo_estado on public.inscripciones (evento_id, correo_estado);

-- ---------------------------------------------------------------------
-- 3. Administradores (correos autorizados para el panel)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);
-- Agrega aquí los correos de las administradoras (en minúscula):
-- insert into public.admins (email) values ('admin1@ejemplo.com'), ('admin2@ejemplo.com');

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where email = lower(auth.jwt() ->> 'email'));
$$;

-- ---------------------------------------------------------------------
-- 4. Configuración del correo automático (privada: nadie la puede leer vía API)
-- ---------------------------------------------------------------------
create table if not exists public.config_correo (
  id              int primary key default 1 check (id = 1),
  function_url    text,
  webhook_secret  text
);
insert into public.config_correo (id) values (1) on conflict (id) do nothing;
-- Se completa después de publicar la función de correo (ver README):
-- update public.config_correo set function_url = 'https://TU-PROYECTO.supabase.co/functions/v1/enviar-confirmacion', webhook_secret = 'UNA-CLAVE-LARGA';

-- ---------------------------------------------------------------------
-- 5. Seguridad (RLS): el público NO puede leer ni escribir tablas directo
-- ---------------------------------------------------------------------
alter table public.eventos       enable row level security;
alter table public.inscripciones enable row level security;
alter table public.admins        enable row level security;
alter table public.config_correo enable row level security;

drop policy if exists admin_lee_eventos         on public.eventos;
drop policy if exists admin_edita_eventos       on public.eventos;
drop policy if exists admin_lee_inscripciones   on public.inscripciones;
drop policy if exists admin_borra_inscripciones on public.inscripciones;

create policy admin_lee_eventos   on public.eventos for select to authenticated using (public.es_admin());
create policy admin_edita_eventos on public.eventos for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy admin_lee_inscripciones   on public.inscripciones for select to authenticated using (public.es_admin());
create policy admin_borra_inscripciones on public.inscripciones for delete to authenticated using (public.es_admin());
-- Sin políticas de insert: solo se inscribe a través de la función public.inscribir()
-- config_correo no tiene políticas: solo la base de datos la puede leer

-- ---------------------------------------------------------------------
-- 6. Estado público de los eventos: solo abierto / agotado (sin conteos)
-- ---------------------------------------------------------------------
drop function if exists public.estado_eventos();
create function public.estado_eventos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'nombre', e.nombre, 'abierto', e.abierto,
           'agotado', (select count(*) from public.inscripciones i where i.evento_id = e.id) >= e.cupos
         ) order by e.id), '[]'::jsonb)
  from public.eventos e;
$$;

-- ---------------------------------------------------------------------
-- 7. Inscripción ATÓMICA con control de cupos
--    El "for update" sobre el evento hace que las inscripciones simultáneas
--    entren en fila: nunca se supera el número de cupos.
--    No devuelve número, nombre ni cupos restantes.
-- ---------------------------------------------------------------------
create or replace function public.inscribir(p_evento text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev     public.eventos;
  v_doc    text;
  v_count  int;
  v_num    int;
begin
  v_doc := upper(regexp_replace(coalesce(p->>'numero_documento', ''), '[^0-9A-Za-z]', '', 'g'));

  if coalesce(p->>'acepta_datos', '') <> 'true' or coalesce(p->>'declara_salud', '') <> 'true' then
    return jsonb_build_object('ok', false, 'codigo', 'sin_autorizacion');
  end if;

  -- Bloquea el evento: las inscripciones se procesan una por una
  select * into v_ev from public.eventos where id = p_evento for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'evento_no_existe');
  end if;

  if exists (select 1 from public.inscripciones where evento_id = p_evento and numero_documento = v_doc) then
    return jsonb_build_object('ok', false, 'codigo', 'ya_inscrito');
  end if;

  if not v_ev.abierto then
    return jsonb_build_object('ok', false, 'codigo', 'cerrado');
  end if;

  select count(*), coalesce(max(numero), 0) + 1 into v_count, v_num
    from public.inscripciones where evento_id = p_evento;

  if v_count >= v_ev.cupos then
    return jsonb_build_object('ok', false, 'codigo', 'agotado');
  end if;

  insert into public.inscripciones (
    evento_id, numero, acepta_datos, declara_salud, nombre_completo, tipo_documento,
    numero_documento, edad, telefono, contacto_emergencia_nombre, contacto_emergencia_telefono,
    correo, barrio_vereda, eps, talla_camiseta
  ) values (
    p_evento, v_num, true, true,
    btrim(regexp_replace(p->>'nombre_completo', '\s+', ' ', 'g')),
    p->>'tipo_documento',
    v_doc,
    (p->>'edad')::int,
    regexp_replace(coalesce(p->>'telefono', ''), '\D', '', 'g'),
    btrim(p->>'contacto_emergencia_nombre'),
    regexp_replace(coalesce(p->>'contacto_emergencia_telefono', ''), '\D', '', 'g'),
    lower(btrim(p->>'correo')),
    btrim(p->>'barrio_vereda'),
    btrim(p->>'eps'),
    p->>'talla_camiseta'
  );

  return jsonb_build_object('ok', true);
exception
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'codigo', 'datos_invalidos');
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Correo automático: al guardar una inscripción se encola el envío.
--    pg_net lo manda DESPUÉS de confirmar la inscripción (no la frena)
--    y si algo falla la inscripción se guarda igual.
-- ---------------------------------------------------------------------
create or replace function public.encolar_correo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg public.config_correo;
begin
  select * into cfg from public.config_correo where id = 1;
  if cfg.function_url is null or cfg.webhook_secret is null then
    return new;
  end if;
  begin
    perform net.http_post(
      url     := cfg.function_url,
      body    := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', cfg.webhook_secret),
      timeout_milliseconds := 15000
    );
  exception when others then
    null; -- el correo queda "pendiente" y se puede reenviar desde el panel
  end;
  return new;
end;
$$;

drop trigger if exists trg_encolar_correo on public.inscripciones;
create trigger trg_encolar_correo after insert on public.inscripciones
  for each row execute function public.encolar_correo();

-- ---------------------------------------------------------------------
-- 9. Permisos
-- ---------------------------------------------------------------------
revoke all on function public.inscribir(text, jsonb) from public;
revoke all on function public.estado_eventos()       from public;
revoke all on function public.encolar_correo()       from public;
grant execute on function public.inscribir(text, jsonb) to anon, authenticated;
grant execute on function public.estado_eventos()       to anon, authenticated;
grant execute on function public.es_admin()             to authenticated;
