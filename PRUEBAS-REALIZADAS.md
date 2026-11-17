# Pruebas realizadas sobre el paquete

Fecha: 17/11/2026

## Correcto

- `node --check` sobre `js/app.js`, `js/cloud.js`, `worker.js` y `sw.js`: sin errores de sintaxis.
- Análisis sintáctico de `index.html`, `privacidad.html` y `condiciones.html`: correcto.
- Ejecución de `schema.sql` con SQLite: crea correctamente las tablas `users` y `agenda_data`.
- Prueba de integración del Worker con un adaptador D1 simulado: registro, inicio de sesión, rechazo de contraseña incorrecta, escritura/lectura autenticada, rechazo de solicitudes sin sesión y rechazo de cuentas duplicadas: correcto.

## Pendiente de verificación en el entorno del titular

No se ha podido publicar ni probar contra la cuenta real de Cloudflare/GitHub Pages del titular porque requiere acceso y configuración de esas cuentas. Antes de dar el servicio por operativo, sigue `INSTALACION-CLOUDflare.md` y ejecuta las pruebas de la sección E con una cuenta real y dos dispositivos.

La prueba de borrado total de datos de Chrome debe hacerse después de desplegar el Worker: elimina los datos del sitio, abre la aplicación, vuelve a iniciar sesión y confirma que recupera las citas desde Cloudflare D1.
