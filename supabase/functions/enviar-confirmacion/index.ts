// =====================================================================
//  Función de correo de confirmación · Supabase Edge Function
//
//  La llaman:
//   1) La base de datos, automáticamente al guardar cada inscripción
//      (cabecera x-webhook-secret).
//   2) El panel de administración, para reenviar pendientes o fallidos
//      (sesión de una administradora).
//
//  Variables (Supabase → Edge Functions → Secrets):
//   BREVO_API_KEY    llave de API de brevo.com (SMTP & API → API Keys)
//   EMAIL_FROM       correo remitente verificado en Brevo, ej: inscripciones@copacabana.gov.co
//   EMAIL_FROM_NAME  (opcional) nombre del remitente, por defecto "Copa Cuida Tu Vida"
//   WEBHOOK_SECRET   la misma clave guardada en public.config_correo
//   SITE_URL         dirección pública de la plataforma, ej: https://copacuidatuvida.vercel.app
//   EMAIL_REPLY_TO   (opcional) correo de contacto para respuestas
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? '';
const EMAIL_FROM_NAME = Deno.env.get('EMAIL_FROM_NAME') ?? 'Copa Cuida Tu Vida';
const EMAIL_REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') ?? '';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';
const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EVENTOS: Record<string, { titulo: string; filas: [string, string][]; nota: string }> = {
  cycling: {
    titulo: 'Festival de Indoor Cycling',
    filas: [
      ['Fecha', 'Sábado 17 de octubre de 2026'],
      ['Hora', '5:30 p. m.'],
      ['Lugar', 'Unidad Deportiva IDEM'],
      ['Duración', '2 horas'],
    ],
    nota: `Recuerda llegar con ropa cómoda e hidratación. 
    Bicicletas: se asignan en el orden de inscripción.
`,
  },
  carrera: {
    titulo: 'Carrera de la Mujer',
    filas: [],
    nota: 'Próximamente te compartiremos las indicaciones para el día del evento.',
  },
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function plantilla(r: Record<string, any>) {
  const ev = EVENTOS[r.evento_id] ?? EVENTOS.cycling;
  const primerNombre = esc(String(r.nombre_completo).split(' ')[0]);
  const filas = [...ev.filas, ['Talla de camiseta Sujeta a Disponibilidad de talla', r.talla_camiseta]]
    .map(([k, v]) => `<tr><td style="padding:8px 0;color:#5a6178;font-size:14px;border-bottom:1px solid #eceef3">${esc(k)}</td>
      <td style="padding:8px 0;color:#21294c;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #eceef3">${esc(v)}</td></tr>`).join('');
  const logo = SITE_URL
    ? `<img src="${SITE_URL}/assets/escudo.png" width="44" height="59" alt="Escudo de Copacabana" style="display:block;border:0">`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f2f3f7;font-family:Poppins,Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe2ea">
  <tr><td style="padding:18px 24px;border-bottom:1px solid #eceef3">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px">${logo}</td>
      <td style="border-left:2px solid #21294c;padding-left:12px;font-family:Montserrat,Arial,sans-serif;font-weight:800;font-size:17px;line-height:1.05;color:#111">Alcaldía de<br>Copacabana
        <div style="margin-top:4px;display:inline-block;background:#21294c;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">Secretaría de Salud</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#21294c;padding:28px 24px;color:#ffffff">
    <div style="font-family:Montserrat,Arial,sans-serif;font-style:italic;font-weight:600;color:#f6a821;font-size:14px;letter-spacing:.5px">Copa Cuida Tu Vida</div>
    <div style="font-family:Montserrat,Arial,sans-serif;font-weight:800;font-size:24px;line-height:1.2;margin-top:6px">¡Tu inscripción quedó registrada!</div>
  </td></tr>
  <tr><td style="height:4px;font-size:0;line-height:0;background:#f8e000;background:linear-gradient(90deg,#f8e000 0 25%,#2d9542 25% 50%,#bf0310 50% 75%,#009fe3 75%)">&nbsp;</td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 14px;color:#21294c;font-size:15px;line-height:1.6">Hola ${primerNombre},</p>
    <p style="margin:0 0 18px;color:#3c4257;font-size:15px;line-height:1.6">Recibimos tu inscripción al <b>${esc(ev.titulo)}</b> de la estrategia Copa Cuida Tu Vida de la Secretaría de Salud de Copacabana.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">${filas}</table>
    <p style="margin:0;padding:14px 16px;background:#f2f3f7;border-radius:10px;color:#3c4257;font-size:14px;line-height:1.55">${esc(ev.nota)}</p>
  </td></tr>
  <tr><td style="padding:16px 24px 22px;color:#8a90a3;font-size:12px;line-height:1.5;border-top:1px solid #eceef3">
    Recibes este correo porque te inscribiste en la plataforma Copa Cuida Tu Vida. Tus datos son tratados conforme a la Ley 1581 de 2012.
  </td></tr>
</table></td></tr></table></body></html>`;
  const texto = `Hola ${String(r.nombre_completo).split(' ')[0]},\n\nRecibimos tu inscripción al ${ev.titulo} de Copa Cuida Tu Vida (Secretaría de Salud de Copacabana).\n\n` +
    [...ev.filas, ['Talla de camiseta', r.talla_camiseta]].map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${ev.nota}\n\nAlcaldía de Copacabana`;
  return { asunto: `Inscripción registrada · ${ev.titulo}`, html, texto };
}

async function enviarUno(id: string, forzar = false) {
  const { data: r, error } = await db.from('inscripciones').select('*').eq('id', id).maybeSingle();
  if (error || !r) return { id, estado: 'no_existe' };
  if (r.correo_estado === 'enviado' && !forzar) return { id, estado: 'ya_enviado' };

  const { asunto, html, texto } = plantilla(r);
  let ultimoError = '';
  for (let intento = 0; intento < 6; intento++) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM },
          to: [{ email: r.correo, name: String(r.nombre_completo).slice(0, 70) }],
          subject: asunto, htmlContent: html, textContent: texto,
          tags: ['copa-cuida-tu-vida', r.evento_id],
          ...(EMAIL_REPLY_TO ? { replyTo: { email: EMAIL_REPLY_TO } } : {}),
        }),
      });
      if (res.ok) {
        await db.from('inscripciones').update({ correo_estado: 'enviado', correo_enviado_at: new Date().toISOString(), correo_error: null }).eq('id', id);
        return { id, estado: 'enviado' };
      }
      ultimoError = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) break; // error definitivo (correo inválido, remitente no verificado, límite diario…)
    } catch (e) {
      ultimoError = String(e).slice(0, 300);
    }
    await esperar(700 * (intento + 1) + Math.random() * 500); // espera y reintenta (límite de envíos por segundo)
  }
  await db.from('inscripciones').update({ correo_estado: 'error', correo_error: ultimoError }).eq('id', id);
  return { id, estado: 'error', detalle: ultimoError };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);
  if (!BREVO_API_KEY || !EMAIL_FROM) return json({ error: 'Faltan BREVO_API_KEY o EMAIL_FROM' }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }

  // 1) Llamado automático desde la base de datos
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') === WEBHOOK_SECRET) {
    if (!body.id) return json({ error: 'sin id' }, 400);
    return json(await enviarUno(String(body.id)));
  }

  // 2) Llamado desde el panel: debe ser una administradora
  const auth = req.headers.get('Authorization') ?? '';
  const usuario = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: esAdmin } = await usuario.rpc('es_admin');
  if (esAdmin !== true) return json({ error: 'no autorizado' }, 401);

  let ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (body.pendientes && body.evento) {
    const { data } = await db.from('inscripciones').select('id').eq('evento_id', body.evento)
      .in('correo_estado', ['pendiente', 'error']).order('numero').limit(80);
    ids = (data ?? []).map((x) => x.id);
  }
  const resultados = [];
  for (const id of ids.slice(0, 80)) {
    resultados.push(await enviarUno(id, body.forzar === true));
    await esperar(550); // respeta el límite del proveedor de correo
  }
  return json({
    procesados: resultados.length,
    enviados: resultados.filter((r) => r.estado === 'enviado').length,
    errores: resultados.filter((r) => r.estado === 'error').length,
    resultados,
  });
});

export { plantilla, enviarUno };
