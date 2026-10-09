import { iniciarSesion, sesionActual, cerrarSesion, esAdmin, listarInscripciones, eventosAdmin, cambiarEvento, eliminarInscripcion, reenviarCorreos } from './api.js';
import { MODO_DEMO, ADMIN_DOMINIO } from './config.js';

const $ = (id) => document.getElementById(id);
if (MODO_DEMO) $('demo').classList.remove('hidden');

const NOMBRES = { cycling: 'Indoor Cycling', carrera: 'Carrera Copa Modo Rosa' };
const PAGINAS = { cycling: 'ciclismo.html', carrera: 'carrera.html' };
const RANGOS = [[18, 25], [26, 35], [36, 45], [46, 55], [56, 65], [66, 120]];
const rangoDe = (e) => { const r = RANGOS.find(([a, b]) => e >= a && e <= b); return r ? (r[1] > 100 ? `${r[0]}+` : `${r[0]}–${r[1]}`) : '—'; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

let evento = 'cycling';
let filas = [];
let estado = null;
const graficas = {};

// Un puesto es reservado si está al inicio (1..reservados) o al final (después de cupos)
const esReservado = (f) => f.numero <= (estado?.reservados ?? 0) || f.numero > (estado?.cupos ?? Infinity);

// ---------------- sesión ----------------
async function entrar() {
  try {
    if (!(await esAdmin())) {
      await cerrarSesion();
      return errorLogin('Este usuario no está autorizado como administrador.');
    }
    $('vista-login').classList.add('hidden');
    $('vista-panel').classList.remove('hidden');
    $('btn-salir').classList.remove('hidden');
    await cargar();
    setInterval(() => { if (!document.hidden) cargar(); }, 30000);
  } catch (e) {
    errorLogin('No se pudo verificar el acceso. Intenta de nuevo.');
  }
}
function errorLogin(msg) { const a = $('login-error'); a.innerHTML = `<span>${esc(msg)}</span>`; a.classList.remove('hidden'); }

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = 'Ingresando…';
  const usuario = $('email').value.trim().toLowerCase();
  const correo = usuario.includes('@') ? usuario : `${usuario}@${ADMIN_DOMINIO}`;
  try { await iniciarSesion(correo, $('password').value); await entrar(); }
  catch { errorLogin('Usuario o contraseña incorrectos.'); }
  finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
});
$('btn-salir').addEventListener('click', async () => { await cerrarSesion(); location.reload(); });
sesionActual().then((u) => { if (u) entrar(); });

// ---------------- datos ----------------
async function cargar() {
  const [f, est] = await Promise.all([listarInscripciones(evento), eventosAdmin()]);
  filas = f;
  estado = est.find((e) => e.id === evento);
  document.querySelectorAll('.solo-carrera').forEach((el) => el.classList.toggle('hidden', evento !== 'carrera'));
  $('btn-reservado').href = `${PAGINAS[evento]}?reservado=1`;
  pintarMetricas();
  pintarGraficas();
  pintarTabla();
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', async () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  evento = b.dataset.evento;
  $('titulo-evento').textContent = NOMBRES[evento];
  $('buscar').value = '';
  await cargar();
}));
$('btn-refrescar').addEventListener('click', cargar);

// ---------------- métricas ----------------
function pintarMetricas() {
  const resIni = estado?.reservados ?? 0;
  const resFin = estado?.reservados_final ?? 0;
  const reservados = resIni + resFin;
  const total = estado?.cupos ?? 0;
  const cupos = Math.max(total - resIni, 0);                     // cupos para el público
  const n = filas.filter((f) => !esReservado(f)).length;         // inscritos del público
  const nRes = filas.length - n;                                 // cupos reservados ya usados
  $('m-inscritos').textContent = `${n} / ${cupos}`;
  const rangos = [resIni ? `1 a ${resIni}` : '', resFin ? `${total + 1} a ${total + resFin}` : ''].filter(Boolean).join(' y ');
  $('m-reservados').textContent = reservados
    ? `Reservados: ${nRes} de ${reservados} usados (puestos ${rangos}) · el público se inscribe del ${resIni + 1} al ${total}`
    : '';
  $('btn-reservado').classList.toggle('hidden', !reservados);
  $('btn-reservado').textContent = nRes < reservados ? `Inscribir cupo reservado (${reservados - nRes} libres)` : 'Reservados completos';
  $('m-barra').style.width = (cupos ? Math.min(100, Math.round((n / cupos) * 100)) : 0) + '%';
  $('m-quedan').textContent = Math.max(cupos - n, 0);
  $('m-edad').textContent = filas.length ? Math.round(filas.reduce((s, f) => s + f.edad, 0) / filas.length) + ' años' : '—';
  const ultima = filas.reduce((m, f) => (f.created_at > m ? f.created_at : m), '');
  $('m-ultima').textContent = ultima ? fecha(ultima) : '—';
  const enviados = filas.filter((f) => f.correo_estado === 'enviado').length;
  const faltan = filas.length - enviados;
  $('m-correos').textContent = filas.length ? `${enviados} / ${filas.length}` : '—';
  $('btn-correos').textContent = faltan ? `Reenviar correos pendientes (${faltan})` : 'Correos al día';
  $('btn-correos').disabled = !faltan;
  $('sw-abierto').checked = !!estado?.abierto;
  $('estado-txt').textContent = n >= cupos && cupos ? 'Cupos agotados: el formulario muestra el mensaje de cierre automáticamente.'
    : estado?.abierto ? 'El formulario público está recibiendo inscripciones.' : 'El formulario público está cerrado.';
}

$('sw-abierto').addEventListener('change', async (e) => {
  const abrir = e.target.checked;
  if (!confirm(abrir ? '¿Abrir las inscripciones al público?' : '¿Cerrar las inscripciones? Nadie más podrá inscribirse hasta que las vuelvas a abrir.')) {
    e.target.checked = !abrir; return;
  }
  try { await cambiarEvento(evento, { abierto: abrir }); await cargar(); }
  catch { alert('No se pudo cambiar el estado.'); e.target.checked = !abrir; }
});

// ---------------- gráficas ----------------
const VERDE = '#21294c', VERDE_SUAVE = 'rgba(33,41,76,.10)', TINTA = '#5a6178', REJILLA = '#eceef3';
Chart.defaults.font.family = "'Poppins', Arial, sans-serif";
Chart.defaults.color = TINTA;

function contar(clave) {
  const m = new Map();
  for (const f of filas) { const k = clave(f); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

function barras(id, labels, datos, horizontal = false) {
  graficas[id]?.destroy();
  graficas[id] = new Chart($(id), {
    type: 'bar',
    data: { labels, datasets: [{ data: datos, backgroundColor: VERDE, hoverBackgroundColor: '#009fe3', borderRadius: 4, borderSkipped: 'start', maxBarThickness: 30 }] },
    options: {
      indexAxis: horizontal ? 'y' : 'x', maintainAspectRatio: false, animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed[horizontal ? 'x' : 'y']} inscritos (${filas.length ? Math.round((c.parsed[horizontal ? 'x' : 'y'] / filas.length) * 100) : 0}%)` } } },
      scales: {
        [horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: REJILLA }, border: { display: false } },
        [horizontal ? 'y' : 'x']: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 12 } } },
      },
    },
  });
}

function pintarGraficas() {
  // Edad
  const edad = contar((f) => rangoDe(f.edad));
  const etiquetasEdad = RANGOS.map(([a, b]) => (b > 100 ? `${a}+` : `${a}–${b}`));
  barras('g-edad', etiquetasEdad, etiquetasEdad.map((l) => edad.get(l) || 0));

  // Barrio (todos, ordenados)
  const barrio = [...contar((f) => f.barrio_vereda.startsWith('Otro:') ? 'Otro' : f.barrio_vereda)].sort((a, b) => b[1] - a[1]);
  const topB = barrio.slice(0, 20);
  const restoB = barrio.slice(20).reduce((s, [, v]) => s + v, 0);
  if (restoB) topB.push(['Demás barrios', restoB]);
  barras('g-barrio', topB.map((x) => x[0]), topB.map((x) => x[1]), true);

  // EPS (normalizada a mayúsculas iniciales)
  const eps = [...contar((f) => (f.eps.startsWith('OTRA') ? 'OTRA' : f.eps.trim().toUpperCase()))].sort((a, b) => b[1] - a[1]);
  const topE = eps.slice(0, 12);
  const restoE = eps.slice(12).reduce((s, [, v]) => s + v, 0);
  if (restoE) topE.push(['Otras', restoE]);
  barras('g-eps', topE.map((x) => x[0]), topE.map((x) => x[1]), true);

  // Carrera: distancia y género
  if (evento === 'carrera') {
    const dist = contar((f) => f.distancia || '—');
    barras('g-distancia', ['5K', '10K'], ['5K', '10K'].map((d) => dist.get(d) || 0));
    const gen = contar((f) => f.genero || '—');
    barras('g-genero', ['Mujer', 'Hombre', 'Otro'], ['Mujer', 'Hombre', 'Otro'].map((g) => gen.get(g) || 0));
  }

  // Talla
  const talla = contar((f) => f.talla_camiseta);
  barras('g-talla', ['S', 'M', 'L', 'XL'], ['S', 'M', 'L', 'XL'].map((t) => talla.get(t) || 0));

  // Tipo documento
  const tipos = ['Cédula de ciudadanía', 'Cédula de extranjería', 'PPT', 'Otro'];
  const doc = contar((f) => f.tipo_documento);
  barras('g-doc', ['C.C.', 'C.E.', 'PPT', 'Otro'], tipos.map((t) => doc.get(t) || 0));

  // Tiempo (acumulado por hora o por día)
  graficas['g-tiempo']?.destroy();
  const orden = filas.map((f) => new Date(f.created_at).getTime()).sort((a, b) => a - b);
  let labels = [], datos = [];
  if (orden.length) {
    const span = orden.at(-1) - orden[0];
    const paso = span > 1000 * 60 * 60 * 72 ? 864e5 : 36e5;
    const inicio = Math.floor(orden[0] / paso) * paso;
    let i = 0;
    for (let t = inicio; t <= orden.at(-1) + paso; t += paso) {
      while (i < orden.length && orden[i] < t + paso) i++;
      labels.push(new Date(t).toLocaleString('es-CO', paso === 864e5 ? { day: 'numeric', month: 'short', timeZone: 'America/Bogota' } : { day: 'numeric', month: 'short', hour: 'numeric', timeZone: 'America/Bogota' }));
      datos.push(i);
    }
  }
  graficas['g-tiempo'] = new Chart($('g-tiempo'), {
    type: 'line',
    data: { labels, datasets: [{ data: datos, borderColor: VERDE, backgroundColor: VERDE_SUAVE, fill: true, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25 }] },
    options: {
      maintainAspectRatio: false, animation: { duration: 300 }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y} inscritos acumulados` } } },
      scales: {
        y: { beginAtZero: true, suggestedMax: (estado?.cupos ?? 0) - (estado?.reservados ?? 0), ticks: { precision: 0 }, grid: { color: REJILLA }, border: { display: false } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
      },
    },
  });
}

// ---------------- tabla ----------------
function filtradas() {
  const q = $('buscar').value.trim().toLowerCase();
  if (!q) return filas;
  return filas.filter((f) => [f.nombre_completo, f.numero_documento, f.barrio_vereda, f.correo, f.telefono, f.eps].some((v) => String(v).toLowerCase().includes(q)));
}

function pintarTabla() {
  const lista = filtradas().slice().sort((a, b) => b.numero - a.numero);
  $('conteo-tabla').textContent = `${lista.length} de ${filas.length} registros`;
  $('tbody').innerHTML = lista.map((f) => `<tr>
    <td class="num">${f.numero}${esReservado(f) ? ' <span class="chip pendiente" title="Cupo reservado">R</span>' : ''}</td><td>${esc(fecha(f.created_at))}</td><td>${esc(f.nombre_completo)}</td><td>${esc(f.tipo_documento)}</td>
    <td>${esc(f.numero_documento)}</td><td>${f.edad}</td><td>${esc(f.telefono)}</td><td>${esc(f.contacto_emergencia_nombre)}</td>
    <td>${esc(f.contacto_emergencia_telefono)}</td><td>${esc(f.correo)}</td><td>${esc(f.barrio_vereda)}</td><td>${esc(f.eps)}</td>
    ${evento === 'carrera' ? `<td>${esc(f.genero || '')}</td><td>${esc(f.distancia || '')}</td>` : ''}
    <td>${esc(f.talla_camiseta)}</td>
    <td><span class="chip ${esc(f.correo_estado)}" title="${esc(f.correo_error || '')}">${({ enviado: 'Enviado', pendiente: 'Pendiente', error: 'Error' })[f.correo_estado] || '—'}</span></td>
    <td><button class="btn-x" data-id="${esc(f.id)}" data-nombre="${esc(f.nombre_completo)}" title="Eliminar inscripción" aria-label="Eliminar inscripción">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
    </button></td></tr>`).join('') || '<tr><td colspan="17" style="text-align:center;padding:28px;color:var(--muted)">Sin inscripciones todavía.</td></tr>';
}
$('buscar').addEventListener('input', pintarTabla);

$('tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('.btn-x');
  if (!b) return;
  if (!confirm(`¿Eliminar la inscripción de ${b.dataset.nombre}? Se liberará su cupo. Esta acción no se puede deshacer.`)) return;
  try { await eliminarInscripcion(b.dataset.id); await cargar(); }
  catch { alert('No se pudo eliminar.'); }
});

// ---------------- correos ----------------
$('btn-correos').addEventListener('click', async () => {
  const btn = $('btn-correos');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await reenviarCorreos(evento);
    alert(`Correos enviados: ${r.enviados} de ${r.procesados}.` + (r.errores ? ` Con error: ${r.errores} (pasa el cursor sobre "Error" en la tabla para ver el motivo).` : '') + (r.procesados === 80 ? ' Quedan más: vuelve a presionar el botón.' : ''));
  } catch {
    alert('No se pudieron reenviar los correos. Revisa la configuración de la función de correo.');
  }
  await cargar();
});

// ---------------- Excel ----------------
$('btn-excel').addEventListener('click', () => {
  if (!window.XLSX) return alert('No se pudo cargar el generador de Excel. Revisa tu conexión.');
  const datos = filas.slice().sort((a, b) => a.numero - b.numero).map((f) => ({
    'Orden de inscripción': f.numero,
    'Tipo de cupo': esReservado(f) ? 'Reservado' : 'Público',
    'Fecha de inscripción': new Date(f.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    'Nombres y apellidos': f.nombre_completo,
    'Tipo de documento': f.tipo_documento,
    'Número de documento': f.numero_documento,
    'Edad': f.edad,
    'Rango de edad': rangoDe(f.edad),
    'Número de contacto': f.telefono,
    'Contacto de emergencia': f.contacto_emergencia_nombre,
    'Número de emergencia': f.contacto_emergencia_telefono,
    'Correo electrónico': f.correo,
    'Barrio/Vereda': f.barrio_vereda,
    'EPS': f.eps,
    ...(evento === 'carrera' ? { 'Género': f.genero || '', 'Distancia': f.distancia || '' } : {}),
    'Talla camiseta': f.talla_camiseta,
    'Autoriza datos': f.acepta_datos ? 'SI' : 'NO',
    'Declara salud': f.declara_salud ? 'SI' : 'NO',
    'Correo de confirmación': ({ enviado: 'Enviado', pendiente: 'Pendiente', error: 'Error' })[f.correo_estado] || '',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  ws['!cols'] = Object.keys(datos[0] || {}).map((k) => ({ wch: Math.max(10, Math.min(34, k.length + 4)) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws, 'Inscritos');

  const resumen = [['Resumen', NOMBRES[evento]], ['Inscritos', filas.length], ['Cupos público', (estado?.cupos ?? 0) - (estado?.reservados ?? 0)], ['Reservados al inicio', estado?.reservados ?? 0], ['Reservados al final', estado?.reservados_final ?? 0], ['Inscritos en reservados', filas.filter(esReservado).length], []];
  const bloque = (titulo, mapa) => { resumen.push([titulo, 'Cantidad']); [...mapa].sort((a, b) => b[1] - a[1]).forEach((r) => resumen.push(r)); resumen.push([]); };
  bloque('Rango de edad', contar((f) => rangoDe(f.edad)));
  bloque('Barrio/Vereda', contar((f) => f.barrio_vereda));
  if (evento === 'carrera') {
    bloque('Distancia', contar((f) => f.distancia || ''));
    bloque('Género', contar((f) => f.genero || ''));
  }
  bloque('Talla camiseta', contar((f) => f.talla_camiseta));
  bloque('EPS', contar((f) => f.eps));
  const ws2 = XLSX.utils.aoa_to_sheet(resumen);
  ws2['!cols'] = [{ wch: 34 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');

  const hoy = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }).replace(/\//g, '-');
  XLSX.writeFile(wb, `inscritos-${evento}-${hoy}.xlsx`);
});