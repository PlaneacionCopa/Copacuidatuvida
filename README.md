# Copa Cuida Tu Vida · Plataforma de inscripciones

Alcaldía de Copacabana · Secretaría de Salud. Menú de eventos, formulario de Indoor Cycling (250 cupos), correo de confirmación y panel de administración con gráficas y descarga en Excel. Diseño según el Manual de Identidad Visual 2024–2027 (escudo, azul #21294C, Montserrat y Poppins).

```
index.html                Menú con las 2 tarjetas (Cycling abierta, Carrera próximamente)
ciclismo.html             Formulario en 2 pasos + confirmación + cupos agotados / ya inscrito
admin.html                Panel: login, métricas, gráficas, tabla, Excel, correos, abrir/cerrar
assets/config.js          ← aquí van la URL y la llave pública de Supabase
assets/barrios.js         Barrios/veredas y EPS
assets/escudo.png         Escudo tomado del manual de identidad
supabase/schema.sql       Base de datos, control de cupos, seguridad y disparador del correo
supabase/functions/enviar-confirmacion/   Función que envía el correo
pruebas/carga-k6.js       Prueba de carga
```

Mientras `assets/config.js` no tenga los datos reales, todo funciona en **modo demostración** con datos ficticios.

## Qué ve el público
- No se muestra número de inscripción ni cuántos cupos quedan. Solo “Inscripciones abiertas”, “Cupos agotados” o “Inscripciones cerradas”.
- Si un documento ya está inscrito, se le indica sin mostrar ningún dato de esa inscripción.
- El orden de llegada se guarda internamente (columna **Orden** del panel) para la asignación de bicicletas.

## Puesta en marcha

### 1. Supabase
1. Crea un proyecto en supabase.com (región **East US**).
2. **SQL Editor → New query**: pega todo `supabase/schema.sql` y presiona **Run**.
3. Agrega los correos de las administradoras (en minúscula):
   ```sql
   insert into public.admins (email) values ('admin1@ejemplo.com'), ('admin2@ejemplo.com');
   ```
4. **Authentication → Users → Add user → Create new user**: crea cada administradora con su correo y contraseña (marca *Auto Confirm User*).
5. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up*.
6. **Project Settings → API**: copia *Project URL* y la *anon public key* en `assets/config.js`.

### 2. Publicar en Vercel
Proyecto estático (sin build). El link público es la raíz del dominio y el panel queda en `/admin`.

### 3. Correo de confirmación (Brevo)
1. Crea una cuenta gratuita en **brevo.com**.
2. **Senders, domains & dedicated IPs → Domains**: agrega y verifica el dominio desde el que se enviará (ideal: copacabana.gov.co o un subdominio; lo configura quien administre el dominio, son unos registros DNS). Luego en **Senders** crea el remitente, ej. `inscripciones@copacabana.gov.co`.
   - Si no hay acceso al dominio, se puede verificar un correo suelto como remitente, pero los correos llegarán más a spam (sobre todo si es Gmail).
3. **SMTP & API → API Keys**: crea una llave.
4. Publica la función (con la CLI de Supabase, desde esta carpeta):
   ```
   supabase functions deploy enviar-confirmacion --no-verify-jwt
   ```
5. **Edge Functions → Secrets**, agrega:
   - `BREVO_API_KEY` = la llave de Brevo
   - `EMAIL_FROM` = el remitente verificado, ej. `inscripciones@copacabana.gov.co`
   - `EMAIL_FROM_NAME` = `Copa Cuida Tu Vida` (opcional)
   - `WEBHOOK_SECRET` = una clave larga inventada
   - `SITE_URL` = el link público de Vercel (para mostrar el escudo en el correo)
6. En **SQL Editor** conecta la base de datos con la función:
   ```sql
   update public.config_correo
     set function_url = 'https://TU-PROYECTO.supabase.co/functions/v1/enviar-confirmacion',
         webhook_secret = 'LA-MISMA-CLAVE-LARGA';
   ```
7. Haz una inscripción de prueba con tu correo.

Cómo funciona: la inscripción se guarda primero y la persona ve la confirmación de inmediato. El correo sale después, en segundo plano; si el proveedor está saturado reintenta solo. Si falla (por ejemplo, por el límite diario), queda como **Error** o **Pendiente** en el panel y se reenvía con el botón **Reenviar correos pendientes** (80 por clic).

> El plan gratuito de Brevo permite **300 correos al día** (Cycling: todos el mismo día; Carrera de 1.000: unos 4 días reenviando los pendientes cada día). En el plan gratuito los correos llevan el pie “Sent with Brevo”.

### 4. Prueba de carga (antes de abrir)
Sigue las instrucciones dentro de `pruebas/carga-k6.js`. Resultado esperado: exactamente 250 inscripciones correctas y el resto “agotado”, sin errores.

## Cómo protege los cupos
- La función `inscribir()` bloquea el evento, cuenta y guarda en una sola transacción: aunque cientos de personas envíen al mismo tiempo, nunca se pasa de 250.
- El número de documento es único por evento.
- El público no puede leer ni modificar la tabla (RLS). Solo los correos en `admins` ven los datos.
- Si la conexión falla, el formulario reintenta solo y conserva lo escrito.

## Operación
- **Abrir / cerrar inscripciones**: interruptor en el panel.
- **Cambiar cupos**: `update eventos set cupos = 300 where id = 'cycling';`
- **Eliminar una inscripción** (libera el cupo): papelera en la tabla del panel.
- **Habilitar la Carrera**: cuando tengamos sus preguntas se crea su formulario y se activa la tarjeta.
- En el plan gratuito, Supabase pausa proyectos sin actividad por 7 días: entra al proyecto antes de abrir inscripciones.
