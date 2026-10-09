import { SUPABASE_URL, SUPABASE_ANON_KEY, MODO_DEMO } from './config.js';
import { BARRIOS_VEREDAS } from './barrios.js';

let sb = null;
async function cliente() {
  if (MODO_DEMO) return null;
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
  }
  return sb;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Reintenta solo fallas de red/servidor. Es seguro: la inscripción es idempotente por documento.
async function conReintentos(fn, intentos = 4) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const { data, error } = await fn();
      if (!error) return data;
      ultimo = error;
      const status = Number(error.status || error.code);
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) break;
    } catch (e) { ultimo = e; }
    await esperar(800 * 2 ** i + Math.random() * 400);
  }
  throw ultimo || new Error('sin_conexion');
}

// ------------------------------------------------------------------ demo
const demo = (() => {
  const eventos = { cycling: { id: 'cycling', nombre: 'Festival de Indoor Cycling', cupos: 300, reservados: 50, abierto: true },
                    carrera: { id: 'carrera', nombre: 'Carrera de la Mujer', cupos: 800, abierto: false } };
  const nombres = ['María', 'Juan', 'Luisa', 'Andrés', 'Paula', 'Carlos', 'Daniela', 'Santiago', 'Valentina', 'Camila', 'Jorge', 'Natalia', 'Sofía', 'Felipe', 'Laura', 'Diana'];
  const apellidos = ['López', 'Restrepo', 'Gómez', 'Zapata', 'Ochoa', 'Arango', 'Montoya', 'Vélez', 'Cardona', 'Ríos', 'Henao', 'Muñoz'];
  const eps = ['SURA', 'SURA', 'SURA', 'SAVIA SALUD', 'SAVIA SALUD', 'NUEVA EPS', 'SALUD TOTAL', 'SANITAS', 'FOMAG', 'SANIDAD MILITAR', 'POLICIA NACIONAL', 'OTRA: COOSALUD'];
  const tallas = ['S', 'M', 'M', 'M', 'L', 'L', 'XL'];
  let semilla = 7; const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const inicio = Date.now() - 1000 * 60 * 60 * 30;
  const filas = Array.from({ length: 168 }, (_, i) => {
    const edad = Math.round(18 + Math.pow(rnd(), 1.4) * 47);
    return {
      id: 'demo-' + i, evento_id: 'cycling', numero: i + 51, acepta_datos: true, declara_salud: true,
      nombre_completo: `${pick(nombres)} ${pick(apellidos)} ${pick(apellidos)}`,
      tipo_documento: rnd() > 0.06 ? 'Cédula de ciudadanía' : pick(['Cédula de extranjería', 'PPT']),
      numero_documento: String(1000000000 + Math.floor(rnd() * 99999999)), edad,
      telefono: '3' + String(Math.floor(rnd() * 1e9)).padStart(9, '0'),
      contacto_emergencia_nombre: pick(nombres) + ' ' + pick(apellidos),
      contacto_emergencia_telefono: '3' + String(Math.floor(rnd() * 1e9)).padStart(9, '0'),
      correo: `persona${i + 1}@correo.com`,
      barrio_vereda: rnd() > 0.05 ? BARRIOS_VEREDAS[Math.floor(Math.pow(rnd(), 1.8) * BARRIOS_VEREDAS.length)] : 'Otro: Villa Linda',
      eps: pick(eps), talla_camiseta: pick(tallas),
      correo_estado: i > 160 ? 'pendiente' : (i % 41 === 7 ? 'error' : 'enviado'),
      created_at: new Date(inicio + Math.pow(i / 168, 0.6) * 1000 * 60 * 60 * 29).toISOString(),
    };
  });
  return { eventos, filas };
})();

// ------------------------------------------------------------------ público
// Público: solo dice si está abierto o agotado (no expone conteos)
export async function estadoEventos() {
  if (MODO_DEMO) {
    return Object.values(demo.eventos).map((e) => ({ id: e.id, nombre: e.nombre, abierto: e.abierto,
      agotado: demo.filas.filter((f) => f.evento_id === e.id && f.numero > (e.reservados ?? 0)).length >= e.cupos - (e.reservados ?? 0) }));
  }
  const c = await cliente();
  return conReintentos(() => c.rpc('estado_eventos'));
}

export async function inscribir(evento, datos) {
  if (MODO_DEMO) {
    await esperar(700);
    const ev = demo.eventos[evento];
    const doc = String(datos.numero_documento).replace(/[^0-9a-z]/gi, '').toUpperCase();
    const previa = demo.filas.find((f) => f.evento_id === evento && f.numero_documento === doc);
    if (previa) return { ok: false, codigo: 'ya_inscrito' };
    if (!ev.abierto) return { ok: false, codigo: 'cerrado' };
    const res = ev.reservados ?? 0;
    const pub = demo.filas.filter((f) => f.evento_id === evento && f.numero > res);
    const n = pub.length;
    if (n >= ev.cupos - res) return { ok: false, codigo: 'agotado' };
    demo.filas.push({ ...datos, id: 'demo-' + Date.now(), evento_id: evento, numero: Math.max(res, ...pub.map((f) => f.numero)) + 1, numero_documento: doc, correo_estado: 'pendiente', created_at: new Date().toISOString() });
    return { ok: true };
  }
  const c = await cliente();
  return conReintentos(() => c.rpc('inscribir', { p_evento: evento, p: datos }));
}

// Admin: inscribe en un cupo reservado (puestos 1..reservados)
export async function inscribirReservado(evento, datos) {
  if (MODO_DEMO) {
    await esperar(500);
    const ev = demo.eventos[evento];
    const reservados = ev.reservados ?? 50;
    const doc = String(datos.numero_documento).replace(/[^0-9a-z]/gi, '').toUpperCase();
    if (demo.filas.some((f) => f.evento_id === evento && f.numero_documento === doc)) return { ok: false, codigo: 'ya_inscrito' };
    const usados = new Set(demo.filas.filter((f) => f.evento_id === evento).map((f) => f.numero));
    let n = 1; while (n <= reservados && usados.has(n)) n++;
    if (n > reservados) return { ok: false, codigo: 'reservados_llenos' };
    demo.filas.push({ ...datos, id: 'demo-' + Date.now(), evento_id: evento, numero: n, numero_documento: doc, correo_estado: 'pendiente', created_at: new Date().toISOString() });
    return { ok: true, numero: n };
  }
  const c = await cliente();
  return conReintentos(() => c.rpc('inscribir_reservado', { p_evento: evento, p: datos }));
}

// ------------------------------------------------------------------ admin
export async function iniciarSesion(email, password) {
  if (MODO_DEMO) { await esperar(400); return { email }; }
  const c = await cliente();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function sesionActual() {
  if (MODO_DEMO) return null;
  const c = await cliente();
  const { data } = await c.auth.getSession();
  return data.session?.user || null;
}

export async function cerrarSesion() {
  if (MODO_DEMO) return;
  const c = await cliente();
  await c.auth.signOut();
}

export async function esAdmin() {
  if (MODO_DEMO) return true;
  const c = await cliente();
  const { data, error } = await c.rpc('es_admin');
  if (error) throw error;
  return data === true;
}

export async function listarInscripciones(evento) {
  if (MODO_DEMO) return demo.filas.filter((f) => f.evento_id === evento).slice();
  const c = await cliente();
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await c.from('inscripciones').select('*').eq('evento_id', evento)
      .order('numero', { ascending: true }).range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}

// Admin: cupos y estado completo (protegido por RLS)
export async function eventosAdmin() {
  if (MODO_DEMO) return Object.values(demo.eventos).map((e) => ({ ...e }));
  const c = await cliente();
  const { data, error } = await c.from('eventos').select('*');
  if (error) throw error;
  return data;
}

// Admin: reenvía correos pendientes o fallidos (máx. 80 por llamada)
export async function reenviarCorreos(evento) {
  if (MODO_DEMO) {
    await esperar(900);
    let n = 0;
    demo.filas.forEach((f) => { if (f.evento_id === evento && f.correo_estado !== 'enviado') { f.correo_estado = 'enviado'; n++; } });
    return { procesados: n, enviados: n, errores: 0 };
  }
  const c = await cliente();
  const { data, error } = await c.functions.invoke('enviar-confirmacion', { body: { pendientes: true, evento } });
  if (error) throw error;
  return data;
}

export async function cambiarEvento(evento, cambios) {
  if (MODO_DEMO) { Object.assign(demo.eventos[evento], cambios); return; }
  const c = await cliente();
  const { error } = await c.from('eventos').update(cambios).eq('id', evento);
  if (error) throw error;
}

export async function eliminarInscripcion(id) {
  if (MODO_DEMO) { const i = demo.filas.findIndex((f) => f.id === id); if (i >= 0) demo.filas.splice(i, 1); return; }
  const c = await cliente();
  const { error } = await c.from('inscripciones').delete().eq('id', id);
  if (error) throw error;
}