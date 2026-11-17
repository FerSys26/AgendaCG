# AgendaCG

Agenda personal de Claudio González. Conserva el calendario y la experiencia de la versión original, con almacenamiento local IndexedDB y sincronización remota opcional mediante Cloudflare Workers + D1.

## Para publicar

1. Sigue `INSTALACION-CLOUDflare.md` para crear D1 y desplegar el Worker.
2. Configura la URL del Worker en `js/config.js`.
3. Publica el contenido de esta carpeta en GitHub Pages bajo HTTPS.
4. Antes de ofrecer el servicio a terceros, completa el domicilio del responsable en `privacidad.html` y revisa la política para la configuración real de Cloudflare.

La sincronización remota no queda activa hasta desplegar y configurar el Worker. Sin esa configuración, la agenda funciona en modo local y sigue expuesta a que Chrome elimine el almacenamiento del sitio.
