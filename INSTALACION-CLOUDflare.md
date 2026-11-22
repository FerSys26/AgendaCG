# AgendaCG — instalación del almacenamiento en la nube

## Qué incorpora esta versión

- Mantiene el calendario, vistas, etiquetas, formularios, impresión A4 y copias JSON existentes.
- Mantiene IndexedDB como almacenamiento local para que la agenda siga respondiendo con rapidez.
- Añade cuentas personales por correo y contraseña.
- Sincroniza citas y etiquetas con Cloudflare D1 a través de Cloudflare Workers.
- Recupera los datos de la nube después de borrar los datos de navegación o cambiar de teléfono/ordenador: basta con volver a iniciar sesión.
- Comprueba cambios de otros dispositivos al recuperar el foco y aproximadamente cada minuto.
- Añade `privacidad.html` y `condiciones.html`.

**Límite importante:** ninguna web puede conservar datos dentro del almacenamiento local de Chrome después de que el usuario borre todos los datos del sitio. La protección de esta versión consiste en conservar una copia independiente en el servidor. Para recuperar la agenda tras borrar Chrome, el dispositivo debe tener conexión y la persona debe iniciar sesión con su cuenta.

## A. Crear la base de datos D1

1. Entra en el panel de Cloudflare y abre **Workers & Pages → D1 SQL Database**.
2. Crea una base de datos llamada `agendacg-db`.
3. Copia el identificador (Database ID).
4. En la carpeta del proyecto abre `wrangler.toml` y sustituye `SUSTITUIR_POR_EL_ID_REAL_DE_D1` por ese identificador.
5. Sustituye `https://TUUSUARIO.github.io` por el origen exacto de GitHub Pages donde se publica la agenda. No incluyas `/AgendaCG/` ni una barra final. Si usas un dominio propio, utiliza su origen, por ejemplo `https://agenda.midominio.es`.

## B. Instalar Wrangler y crear las tablas

Necesitas Node.js instalado en el ordenador. Abre una terminal en la carpeta `AgendaCG-main` y ejecuta:

```bash
npm install -g wrangler
wrangler login
wrangler d1 execute agendacg-db --remote --file=./schema.sql
```

## C. Crear el secreto y publicar el Worker

Genera una clave aleatoria larga. En macOS/Linux puedes usar:

```bash
openssl rand -base64 48
```

En Windows PowerShell puedes generar una con:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Configúrala como secreto (pega el valor generado cuando Wrangler lo solicite):

```bash
wrangler secret put JWT_SECRET
wrangler deploy
```

Cloudflare mostrará una URL parecida a `https://agendacg-api.TUCUENTA.workers.dev`. Conserva esa dirección.

## D. Conectar la aplicación al Worker

Abre `js/config.js` y sustituye la línea vacía por la URL real:

```js
window.AGENDA_API_URL = 'https://agendacg-api.TUCUENTA.workers.dev';
```

Guarda el archivo y publica todos los archivos del proyecto en GitHub Pages. No publiques contraseñas ni el secreto `JWT_SECRET`; ese secreto solo se configura en Cloudflare.

## E. Comprobar el funcionamiento

1. Abre la dirección HTTPS de AgendaCG.
2. Crea una cuenta con un correo válido y una contraseña de al menos 10 caracteres.
3. Crea una cita y una etiqueta. El pie de página debe indicar que está sincronizado.
4. Cierra la pestaña y vuelve a abrir la agenda. Comprueba que las citas siguen ahí.
5. Abre la agenda en otro navegador o dispositivo, inicia sesión con la misma cuenta y comprueba que aparecen las mismas citas.
6. Crea o modifica una cita en el segundo dispositivo. En el primero debe actualizarse al recuperar el foco o en el siguiente ciclo de sincronización (máximo aproximado de un minuto).
7. En el primer dispositivo, exporta además una copia JSON de prueba.
8. Para simular el borrado, elimina los datos del sitio de AgendaCG en Chrome. Vuelve a abrir la dirección, inicia sesión con la misma cuenta y verifica que se recuperan las citas y etiquetas desde D1.

## Seguridad y privacidad

- Cloudflare Workers limita PBKDF2 a 100.000 iteraciones en su implementación de Web Crypto. Por eso el Worker utiliza ese máximo y no 210.000: superar el límite provoca un fallo criptográfico y puede dejar el formulario mostrando «Conectando…».

- Las contraseñas se procesan con PBKDF2-HMAC-SHA-256, sal aleatoria individual y 100.000 iteraciones. Este es el máximo admitido por el runtime Web Crypto de Cloudflare Workers; un valor superior provoca un error al registrar o verificar la contraseña. No se guardan contraseñas en texto legible.
- Los tokens de sesión tienen una duración de 30 días y se guardan en el almacenamiento local del navegador. Si se borran los datos del navegador, se deberá iniciar sesión otra vez.
- El Worker solo acepta el origen configurado en `ALLOWED_ORIGIN`.
- Cada usuario solo puede consultar y modificar su propio registro.
- No se ha añadido verificación por correo ni recuperación automática de contraseña. Si una persona olvida su contraseña, en esta versión no existe un flujo automático de restablecimiento; no se puede recuperar mediante el desarrollador porque no se almacena la contraseña original.

## Avisos antes de publicar

1. En `privacidad.html` hay que completar el domicilio postal del responsable. Revisar también la información contractual y de transferencias internacionales de Cloudflare conforme a la configuración real de la cuenta.
2. La política de privacidad es una plantilla informativa técnica, no un dictamen jurídico. Debe revisarse antes de ofrecer el servicio a terceros.
3. Las condiciones no eliminan responsabilidades que legalmente no puedan excluirse.
4. Mantén una copia JSON externa de la agenda. La nube reduce el riesgo de pérdida local, pero no sustituye una estrategia de copias de seguridad.
5. Si la aplicación se publica en una ruta de GitHub Pages, el valor `ALLOWED_ORIGIN` sigue siendo únicamente el origen `https://usuario.github.io` (sin la ruta del repositorio).
