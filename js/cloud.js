/* AgendaCG - sincronización privada con Cloudflare Worker.
   La agenda continúa usando IndexedDB como copia local de trabajo. */
(() => {
  const TOKEN_KEY = 'agendacg_session_v1';
  const API_URL = window.AGENDA_API_URL || '';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let initialized = false;
  let syncing = false;
  let remoteUpdatedAt = null;

  function status(message, kind='info') {
    const el = document.getElementById('cloudStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = kind;
  }
  async function request(path, options={}) {
    if (!API_URL) throw new Error('Falta configurar la dirección del servidor de AgendaCG.');
    const headers = {'Content-Type':'application/json', ...(options.headers||{})};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_URL.replace(/\/$/,'')}${path}`, {...options, headers});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Error del servidor (${response.status}).`);
    return body;
  }
  function showAuth() {
    document.getElementById('accountModal')?.classList.remove('hidden');
    status('Inicia sesión para proteger y recuperar tus citas.', 'warning');
  }
  function hideAuth() { document.getElementById('accountModal')?.classList.add('hidden'); }
  function setMode(mode) {
    document.getElementById('authMode').value = mode;
    document.getElementById('accountTitle').textContent = mode === 'register' ? 'Crear cuenta personal' : 'Acceder a AgendaCG';
    document.getElementById('authSubmit').textContent = mode === 'register' ? 'Crear cuenta y sincronizar' : 'Iniciar sesión';
    document.getElementById('authSwitch').textContent = mode === 'register' ? 'Ya tengo una cuenta' : 'Crear una cuenta';
    document.getElementById('authMessage').textContent = '';
  }
  async function authenticate(mode, email, password) {
    const result = await request(mode === 'register' ? '/api/register' : '/api/login', {
      method:'POST', body:JSON.stringify({email, password})
    });
    token = result.token;
    localStorage.setItem(TOKEN_KEY, token);
    return result;
  }
  async function remoteGet() { return request('/api/data'); }
  async function remotePut(data) { return request('/api/data', {method:'PUT', body:JSON.stringify(data)}); }

  async function init(localData) {
    if (initialized) return {data:localData, authenticated:!!token};
    if (!API_URL) {
      status('Modo local: configura el servidor para activar la protección en la nube.', 'warning');
      initialized = true;
      return {data:localData, authenticated:false};
    }
    if (!token) {
      initialized = true;
      status('Modo local: tus citas se guardan en este dispositivo. Accede a tu cuenta si quieres sincronizarlas en la nube.', 'info');
      hideAuth();
      return {data:localData, authenticated:false};
    }
    try {
      const remote = await remoteGet();
      const cloudData = remote.data || {events:[], categories:[]};
      remoteUpdatedAt = remote.updatedAt || null;
      const localHasData = (localData.events||[]).length || (localData.categories||[]).length;
      const cloudHasData = (cloudData.events||[]).length || (cloudData.categories||[]).length;
      let chosen = cloudData;
      if (!cloudHasData && localHasData) {
        await remotePut(localData);
        chosen = localData;
      }
      initialized = true;
      hideAuth(); status('Agenda sincronizada y protegida en la nube.', 'success');
      const accountButton=document.getElementById('logoutBtn'); if(accountButton) accountButton.textContent='Cerrar sesión';
      return {data:chosen, authenticated:true};
    } catch (error) {
      if (/401|sesión|token/i.test(error.message)) {
        token=''; localStorage.removeItem(TOKEN_KEY); initialized=true; hideAuth();
        status('Tu sesión ha caducado. La agenda sigue disponible en este dispositivo; accede de nuevo para sincronizar.', 'warning');
        return {data:localData, authenticated:false};
      }
      status(`No se pudo sincronizar: ${error.message}`, 'error');
      throw error;
    }
  }
  async function save(data) {
    if (!API_URL || !token) {
      if (API_URL) status('Cambios guardados en este dispositivo. Accede a tu cuenta para sincronizarlos en la nube.', 'info');
      return false;
    }
    if (syncing) throw new Error('Hay otra sincronización en curso. Espera un momento.');
    syncing = true;
    try {
      const result = await remotePut(data);
      remoteUpdatedAt = result.updatedAt || remoteUpdatedAt;
      status('Guardado local y sincronizado en la nube.', 'success');
      return true;
    } catch (error) {
      status(`Guardado local; pendiente de sincronizar: ${error.message}`, 'error');
      throw new Error(`Los datos se han guardado en este dispositivo, pero no en la nube. ${error.message}`);
    } finally { syncing=false; }
  }

  async function refresh() {
    if (!API_URL || !token || !initialized || syncing) return;
    try {
      const remote = await remoteGet();
      if (remote.updatedAt && remote.updatedAt !== remoteUpdatedAt) {
        remoteUpdatedAt = remote.updatedAt;
        window.dispatchEvent(new CustomEvent('agendacloudready', {detail:remote.data || {events:[],categories:[]}}));
        status('Agenda actualizada desde otro dispositivo.', 'success');
      }
    } catch (error) { status(`Sincronización temporalmente no disponible: ${error.message}`, 'warning'); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setMode('login');
    window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.getElementById('continueLocalBtn')?.addEventListener('click', () => {
      hideAuth();
      status('Modo local: tus citas se guardan en este navegador y dispositivo. Usa Copias de seguridad para conservar una copia.', 'info');
    });
    document.getElementById('authSwitch')?.addEventListener('click', () => {
      setMode(document.getElementById('authMode').value === 'login' ? 'register' : 'login');
    });
    document.getElementById('authForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const mode=document.getElementById('authMode').value;
      const email=document.getElementById('authEmail').value.trim().toLowerCase();
      const password=document.getElementById('authPassword').value;
      const message=document.getElementById('authMessage');
      const button=document.getElementById('authSubmit');
      button.disabled=true; message.textContent='Conectando…';
      try {
        await authenticate(mode,email,password);
        initialized=false;
        const local=await window.AgendaStorage.read();
        const result=await init(local);
        if (result.authenticated) {
          const accountButton=document.getElementById('logoutBtn'); if(accountButton) accountButton.textContent='Cerrar sesión';
          hideAuth();
          window.dispatchEvent(new CustomEvent('agendacloudready',{detail:result.data}));
        }
      } catch(error) { message.textContent=error.message; }
      finally { button.disabled=false; }
    });
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      if (token) {
        token=''; localStorage.removeItem(TOKEN_KEY); initialized=false;
        status('Sesión cerrada. Tus citas permanecen guardadas en este dispositivo.', 'info');
        document.getElementById('logoutBtn').textContent='Acceder / sincronizar';
      } else {
        setMode('login');
        showAuth();
      }
    });
  });
  window.AgendaCloud={init,save,showAuth,status,refresh,get authenticated(){return !!token;}};
})();
