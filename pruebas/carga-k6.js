// =====================================================================
//  Prueba de carga · simula cientos de personas inscribiéndose a la vez
//
//  0) IMPORTANTE: si ya configuraste el correo, desactívalo durante la prueba
//     para no enviar cientos de correos a direcciones falsas:
//       update config_correo set function_url = null;   (al terminar vuelve a ponerla)
//  1) En Supabase (SQL Editor) crea un evento de PRUEBA con 250 cupos:
//       insert into eventos (id, nombre, cupos, abierto) values ('prueba', 'Prueba de carga', 250, true);
//  2) Instala k6 (https://k6.io) y ejecuta:
//       k6 run -e URL=https://TU-PROYECTO.supabase.co -e KEY=TU-ANON-KEY pruebas/carga-k6.js
//  3) Resultado esperado: exactamente 250 "ok" y el resto "agotado", sin errores.
//     Verifica en SQL:  select count(*), count(distinct numero), max(numero) from inscripciones where evento_id = 'prueba';
//  4) Limpia al terminar:
//       delete from inscripciones where evento_id = 'prueba'; delete from eventos where id = 'prueba';
// =====================================================================
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const ok = new Counter('inscritos_ok');
const agotado = new Counter('respuesta_agotado');
const otros = new Counter('respuesta_otra');

export const options = {
  scenarios: {
    apertura: {
      executor: 'ramping-arrival-rate',
      startRate: 20, timeUnit: '1s', preAllocatedVUs: 300, maxVUs: 800,
      stages: [
        { target: 150, duration: '20s' },  // todos llegan al abrir
        { target: 150, duration: '40s' },  // pico sostenido (~6.000 intentos/min)
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const id = `${__VU}${__ITER}${Date.now() % 100000}`.slice(-12);
  const body = JSON.stringify({
    p_evento: __ENV.EVENTO || 'prueba',
    p: {
      acepta_datos: true, declara_salud: true,
      nombre_completo: `Persona Prueba ${id}`, tipo_documento: 'Cédula de ciudadanía',
      numero_documento: id, edad: 18 + (__ITER % 50), telefono: '3001234567',
      contacto_emergencia_nombre: 'Contacto Prueba', contacto_emergencia_telefono: '3109876543',
      correo: `prueba${id}@correo.com`, barrio_vereda: 'La Veta', eps: 'Sura', talla_camiseta: 'M',
    },
  });
  const res = http.post(`${__ENV.URL}/rest/v1/rpc/inscribir`, body, {
    headers: { 'Content-Type': 'application/json', apikey: __ENV.KEY, Authorization: `Bearer ${__ENV.KEY}` },
  });
  check(res, { 'respuesta 200': (r) => r.status === 200 });
  if (res.status === 200) {
    const r = res.json();
    if (r.ok) ok.add(1); else if (r.codigo === 'agotado') agotado.add(1); else otros.add(1);
  }
}
