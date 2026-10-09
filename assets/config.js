// =====================================================================
//  CONFIGURACIÓN
//  Supabase → Project Settings → API
//  (La "anon public key" es pública por diseño; la seguridad la da RLS)
// =====================================================================
export const SUPABASE_URL = 'https://evkcsqlfaoyizjmcntne.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2a2NzcWxmYW95aXpqbWNudG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMjYyMjcsImV4cCI6MjEwNjkwMjIyN30.R4981w-OCNgOQ2Anx6UdZeGcBQov_m23VV650B9Bsxk';

// Dominio que se agrega al usuario del panel de administración.
// Ej: si el correo es camilo.madrigal@copacabana.gov.co, aquí va 'copacabana.gov.co'
// y en el panel se entra solo con "camilo.madrigal".
export const ADMIN_DOMINIO = 'copacabana.gov.co';

// Mientras los valores de Supabase no estén configurados, la plataforma
// funciona en MODO DEMOSTRACIÓN con datos ficticios (nada se guarda).
export const MODO_DEMO = SUPABASE_URL.includes('TU-PROYECTO');

export const EVENTOS = {
  cycling: {
    id: 'cycling',
    titulo: 'Festival de Indoor Cycling',
    fecha: '17 de octubre de 2026',
    hora: '5:30 p. m.',
    lugar: 'Unidad Deportiva IDEM',
    pagina: 'ciclismo.html',
  },
  carrera: {
    id: 'carrera',
    titulo: 'Carrera de la Mujer',
    fecha: 'Próximamente',
    pagina: null,
  },
}; 