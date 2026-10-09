import { estadoEventos, inscribir, inscribirReservado, sesionActual, esAdmin } from './api.js';
import { MODO_DEMO } from './config.js';
import { BARRIOS_VEREDAS, EPS } from './barrios.js';

// Configuración del evento: viene de <body data-evento="…" data-titulo="…" data-archivo="…" data-compartir="…">
const CFG = document.body.dataset;
const EVENTO = CFG.evento;
const TITULO = CFG.titulo;
const $ = (id) => document.getElementById(id);
const form = $('form');
if (MODO_DEMO) $('demo').classList.remove('hidden');

// ---------- opciones ----------
$('barrio').innerHTML = '<option value="">Selecciona…</option>' +
  [...BARRIOS_VEREDAS].sort((a, b) => a.localeCompare(b, 'es'))
    .map((b) => `<option>${b}</option>`).join('') + '<option value="__otro">Otro</option>';
$('eps').innerHTML = '<option value="">Selecciona…</option>' + EPS.map((e) => `<option>${e}</option>`).join('');
$('barrio').addEventListener('change', () => $('campo-otro').classList.toggle('hidden', $('barrio').value !== '__otro'));
$('eps').addEventListener('change', () => $('campo-eps-otra').classList.toggle('hidden', $('eps').value !== 'OTRA'));

// ---------- vistas ----------
function mostrar(vista) {
  for (const v of ['vista-form', 'vista-ok', 'vista-cerrado']) $(v).classList.toggle('hidden', v !== vista);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const ICONO_INFO = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';
function aviso(tipo) {
  const ico = $('cerrado-ico');
  ico.classList.toggle('info', tipo === 'ya_inscrito');
  if (tipo === 'ya_inscrito') {
    ico.innerHTML = ICONO_INFO;
    $('cerrado-titulo').textContent = 'Ya tienes una inscripción';
    $('cerrado-texto').textContent = `Este número de documento ya está inscrito en ${TITULO}, así que no es necesario volver a hacerlo. Si tienes dudas sobre tu inscripción, comunícate con la Secretaría de Salud de Copacabana.`;
  } else if (tipo === 'cerrado') {
    $('cerrado-titulo').textContent = 'Inscripciones cerradas';
    $('cerrado-texto').textContent = `Las inscripciones para ${TITULO} no están habilitadas en este momento. Mantente pendiente de las redes de la Alcaldía de Copacabana.`;
  } else {
    $('cerrado-titulo').textContent = 'Cupos agotados';
    $('cerrado-texto').textContent = `Los cupos para ${TITULO} ya fueron asignados. ¡Gracias por tu interés en cuidar tu vida! Te invitamos a estar pendiente de las redes de la Alcaldía de Copacabana para conocer las próximas actividades de Copa Cuida Tu Vida.`;
  }
  mostrar('vista-cerrado');
}

// ---------- modo cupo reservado (solo administradoras) ----------
// Se abre desde el panel: <página>?reservado=1
const MODO_RESERVADO = new URLSearchParams(location.search).has('reservado');
let reservadoListo = false;
if (MODO_RESERVADO) {
  const banner = document.createElement('div');
  banner.className = 'alerta aviso';
  banner.id = 'banner-reservado';
  banner.innerHTML = '<span>Verificando sesión de administradora…</span>';
  $('panel-form').insertBefore(banner, $('panel-form').querySelector('.pasos'));
  (async () => {
    try {
      const ok = MODO_DEMO || ((await sesionActual()) && (await esAdmin()));
      if (!ok) throw new Error();
      reservadoListo = true;
      banner.innerHTML = '<span><b>Modo cupo reservado.</b> Esta inscripción toma el primer puesto libre de los cupos reservados, no descuenta cupos del público y funciona aunque el formulario esté cerrado.</span>';
    } catch {
      banner.className = 'alerta error';
      banner.innerHTML = '<span>Para inscribir cupos reservados primero inicia sesión en el <a href="admin.html">panel de administración</a> en este mismo navegador.</span>';
    }
  })();
}

// ---------- estado del evento (sin mostrar conteos) ----------
(async () => {
  if (MODO_RESERVADO) return;
  try {
    const ev = (await estadoEventos()).find((e) => e.id === EVENTO);
    if (ev && (ev.agotado || !ev.abierto)) aviso(ev.agotado ? 'agotado' : 'cerrado');
  } catch { /* sin conexión momentánea: el envío lo vuelve a validar */ }
})();

// ---------- validación ----------
const soloDigitos = (s) => String(s || '').replace(/\D/g, '');
const valor = (n) => (form.elements[n]?.value ?? '').trim();
const radio = (n) => form.querySelector(`input[name="${n}"]:checked`)?.value || '';

function marcar(campo, malo) {
  form.querySelector(`[data-campo="${campo}"]`)?.classList.toggle('error', malo);
  return !malo;
}
form.addEventListener('input', (e) => {
  e.target.closest('[data-campo]')?.classList.remove('error');
  $('alerta').classList.add('hidden');
});
form.addEventListener('change', (e) => {
  e.target.closest('[data-campo]')?.classList.remove('error');
  if (['acepta_datos', 'declara_salud'].includes(e.target.name)) $('bloqueo').classList.add('hidden');
});

function validarPaso1() {
  const a = radio('acepta_datos'), s = radio('declara_salud');
  const ok = marcar('acepta_datos', !a) & marcar('declara_salud', !s);
  if (!ok) return false;
  const bloqueo = $('bloqueo');
  if (a === 'no') {
    bloqueo.innerHTML = '<span>Por la Ley 1581 de 2012, sin tu autorización para el tratamiento de datos personales no es posible realizar la inscripción. Si deseas participar, selecciona <b>Sí</b>.</span>';
    bloqueo.classList.remove('hidden'); return false;
  }
  if (s === 'no') {
    bloqueo.innerHTML = '<span>Por tu seguridad, solo pueden participar personas que declaren estar en condiciones de salud adecuadas para la actividad física. Si tienes dudas, consulta con tu médico.</span>';
    bloqueo.classList.remove('hidden'); return false;
  }
  return true;
}

function validarPaso2() {
  const r = [];
  const nombre = valor('nombre_completo').replace(/\s+/g, ' ');
  r.push(marcar('nombre_completo', nombre.length < 5 || nombre.split(' ').length < 2));
  r.push(marcar('tipo_documento', !valor('tipo_documento')));
  const doc = valor('numero_documento').replace(/[^0-9a-z]/gi, '');
  r.push(marcar('numero_documento', doc.length < 4 || doc.length > 20));
  const edad = Number(valor('edad'));
  r.push(marcar('edad', !Number.isInteger(edad) || edad < 18 || edad > 100));
  const tel = soloDigitos(valor('telefono'));
  r.push(marcar('telefono', tel.length < 7 || tel.length > 10));
  r.push(marcar('contacto_emergencia_nombre', valor('contacto_emergencia_nombre').length < 3));
  const telE = soloDigitos(valor('contacto_emergencia_telefono'));
  r.push(marcar('contacto_emergencia_telefono', telE.length < 7 || telE.length > 10 || telE === tel));
  r.push(marcar('correo', !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(valor('correo'))));
  const barrio = valor('barrio');
  r.push(marcar('barrio', !barrio));
  if (barrio === '__otro') r.push(marcar('barrio_otro', valor('barrio_otro').length < 2));
  const eps = valor('eps');
  r.push(marcar('eps', !eps));
  if (eps === 'OTRA') r.push(marcar('eps_otra', valor('eps_otra').length < 2));
  r.push(marcar('talla_camiseta', !radio('talla_camiseta')));
  if ($('campo-genero')) r.push(marcar('genero', !radio('genero')));
  if ($('campo-distancia')) r.push(marcar('distancia', !radio('distancia')));
  const ok = r.every(Boolean);
  if (!ok) form.querySelector('.campo.error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return ok;
}

function irPaso(n) {
  $('paso1').classList.toggle('hidden', n !== 1);
  $('paso2').classList.toggle('hidden', n !== 2);
  $('p2').classList.toggle('on', n === 2);
  $('paso-txt').textContent = n === 1 ? 'Paso 1 de 2 · Autorizaciones' : 'Paso 2 de 2 · Tus datos';
  $('panel-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (n === 2) setTimeout(() => $('nombre_completo').focus({ preventScroll: true }), 350);
}
$('btn-continuar').addEventListener('click', () => { if (validarPaso1()) irPaso(2); });
$('btn-atras').addEventListener('click', () => irPaso(1));

// ---------- envío ----------
let enviando = false;
function alerta(html, tipo = 'error') {
  const a = $('alerta');
  a.className = `alerta ${tipo}`;
  a.innerHTML = `<span>${html}</span>`;
  a.classList.remove('hidden');
  a.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (enviando) return;
  if (!validarPaso1()) return irPaso(1);
  if (!validarPaso2()) return;

  const datos = {
    acepta_datos: true,
    declara_salud: true,
    nombre_completo: valor('nombre_completo').replace(/\s+/g, ' '),
    tipo_documento: valor('tipo_documento'),
    numero_documento: valor('numero_documento').replace(/[^0-9a-z]/gi, '').toUpperCase(),
    edad: Number(valor('edad')),
    telefono: soloDigitos(valor('telefono')),
    contacto_emergencia_nombre: valor('contacto_emergencia_nombre'),
    contacto_emergencia_telefono: soloDigitos(valor('contacto_emergencia_telefono')),
    correo: valor('correo').toLowerCase(),
    barrio_vereda: valor('barrio') === '__otro' ? `Otro: ${valor('barrio_otro')}` : valor('barrio'),
    eps: valor('eps') === 'OTRA' ? `OTRA: ${valor('eps_otra').toUpperCase()}` : valor('eps'),
    talla_camiseta: radio('talla_camiseta'),
  };
  if ($('campo-genero')) datos.genero = radio('genero');
  if ($('campo-distancia')) datos.distancia = radio('distancia');

  const btn = $('btn-enviar');
  enviando = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando…';
  $('alerta').classList.add('hidden');

  try {
    if (MODO_RESERVADO && !reservadoListo) return alerta('Debes iniciar sesión en el panel de administración para usar los cupos reservados.');
    const r = MODO_RESERVADO ? await inscribirReservado(EVENTO, datos) : await inscribir(EVENTO, datos);
    if (r.ok) return confirmar(datos, r.numero);
    switch (r.codigo) {
      case 'reservados_llenos': return alerta('Ya se usaron todos los cupos reservados.');
      case 'no_autorizado': return alerta('Tu sesión no tiene permisos de administradora. Vuelve a iniciar sesión en el panel.');
      case 'ya_inscrito': return aviso('ya_inscrito');
      case 'agotado': return aviso('agotado');
      case 'cerrado': return aviso('cerrado');
      case 'sin_autorizacion': irPaso(1); return alerta('Debes aceptar las dos autorizaciones para continuar.');
      case 'datos_invalidos': return alerta('Algún dato no es válido. Revisa el formulario e intenta de nuevo.');
      default: return alerta('No pudimos completar la inscripción. Intenta de nuevo.');
    }
  } catch {
    alerta('Hay mucha demanda en este momento o tu conexión falló. <b>Tus datos siguen aquí</b>: espera unos segundos y presiona <b>Enviar inscripción</b> otra vez.', 'aviso');
  } finally {
    enviando = false;
    btn.disabled = false;
    btn.textContent = 'Enviar inscripción';
  }
});

// ---------- confirmación ----------
function confirmar(d, numeroReservado) {
  if (MODO_RESERVADO) {
    $('ok-nombre').textContent = d.nombre_completo;
    $('ok-doc').textContent = d.numero_documento;
    $('ok-talla').textContent = d.talla_camiseta;
    $('ok-correo').textContent = d.correo;
    if ($('ok-distancia')) $('ok-distancia').textContent = d.distancia;
    document.querySelector('#ticket .top h2').textContent = `Cupo reservado N.º ${numeroReservado}`;
    const otra = document.createElement('a');
    otra.className = 'btn'; otra.href = location.pathname + '?reservado=1'; otra.textContent = 'Inscribir otro cupo reservado';
    const acc = document.querySelector('#vista-ok .acciones');
    acc.innerHTML = ''; acc.appendChild(otra);
    const volver = document.createElement('a');
    volver.className = 'btn sec'; volver.href = 'admin.html'; volver.textContent = 'Volver al panel';
    acc.appendChild(volver);
    return mostrar('vista-ok');
  }
  $('ok-nombre').textContent = d.nombre_completo;
  const doc = String(d.numero_documento);
  $('ok-doc').textContent = '•'.repeat(Math.max(doc.length - 4, 2)) + doc.slice(-4);
  $('ok-talla').textContent = d.talla_camiseta;
  $('ok-correo').textContent = d.correo;
  if ($('ok-distancia')) $('ok-distancia').textContent = d.distancia;
  const url = location.href.split('?')[0].split('#')[0];
  const txt = `${CFG.compartir} Inscríbete aquí: ${url}`;
  $('btn-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(txt);
  mostrar('vista-ok');
}

$('btn-descargar').addEventListener('click', async () => {
  const btn = $('btn-descargar');
  if (!window.html2canvas) return alert('Toma una captura de pantalla para guardar tu comprobante.');
  btn.disabled = true;
  try {
    const canvas = await window.html2canvas($('ticket'), { backgroundColor: '#f2f3f7', scale: 2 });
    const a = document.createElement('a');
    a.download = `inscripcion-${CFG.archivo}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch {
    alert('No se pudo generar la imagen. Toma una captura de pantalla.');
  } finally { btn.disabled = false; }
});