const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const encoder = new TextEncoder();
const corsHeaders = origin => ({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Vary':'Origin'});
const json = (data,status=200,origin='*') => new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...corsHeaders(origin)}});
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64u = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function digestPassword(password,salt) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return b64u(bits);
}
async function sign(payload,secret) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const body=b64u(encoder.encode(JSON.stringify(payload)));
  const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(body));
  return `${body}.${b64u(sig)}`;
}
async function verify(token,secret) {
  try {
    const [body,signature]=token.split('.');
    const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('HMAC',key,fromB64u(signature),encoder.encode(body))) return null;
    const payload=JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return payload.exp>Date.now()/1000?payload:null;
  } catch { return null; }
}
function validEmail(email){return typeof email==='string' && email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
async function authUser(request,env){
  const value=request.headers.get('Authorization')||'';
  if(!value.startsWith('Bearer ')) return null;
  const payload=await verify(value.slice(7),env.JWT_SECRET);
  if(!payload?.sub) return null;
  return await env.DB.prepare('SELECT id,email FROM users WHERE id=?').bind(payload.sub).first();
}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
  const permitted=allowed.includes(origin) || (env.ALLOWED_ORIGIN==='*');
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders(permitted?origin:'null')});
  if(!permitted) return json({error:'Origen no autorizado.'},403,'null');
  const url=new URL(request.url);
  try {
   if(request.method==='GET' && url.pathname==='/api/health') return json({ok:true,service:'AgendaCG'},200,origin);
   if(request.method==='POST' && ['/api/register','/api/login'].includes(url.pathname)){
    const body=await request.json(); const email=String(body.email||'').trim().toLowerCase(); const password=String(body.password||'');
    if(!validEmail(email)) return json({error:'Introduce un correo electrónico válido.'},400,origin);
    if(password.length<10 || password.length>128) return json({error:'La contraseña debe tener entre 10 y 128 caracteres.'},400,origin);
    let user;
    if(url.pathname==='/api/register'){
      const id=crypto.randomUUID(), salt=crypto.getRandomValues(new Uint8Array(16)), hash=await digestPassword(password,salt);
      try { await env.DB.prepare('INSERT INTO users (id,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)').bind(id,email,hash,b64u(salt),new Date().toISOString()).run(); }
      catch { return json({error:'Ya existe una cuenta con ese correo electrónico.'},409,origin); }
      await env.DB.prepare('INSERT INTO agenda_data (user_id,data,updated_at) VALUES (?,?,?)').bind(id,JSON.stringify({events:[],categories:[]}),new Date().toISOString()).run();
      user={id,email};
    } else {
      user=await env.DB.prepare('SELECT id,email,password_hash,password_salt FROM users WHERE email=?').bind(email).first();
      if(!user || await digestPassword(password,fromB64u(user.password_salt))!==user.password_hash) return json({error:'Correo electrónico o contraseña incorrectos.'},401,origin);
    }
    const token=await sign({sub:user.id,exp:Math.floor(Date.now()/1000)+60*60*24*30},env.JWT_SECRET);
    return json({token,user:{email:user.email}},200,origin);
   }
   const user=await authUser(request,env);
   if(!user) return json({error:'Sesión no válida o caducada. Inicia sesión de nuevo.'},401,origin);
   if(request.method==='GET' && url.pathname==='/api/data'){
    const row=await env.DB.prepare('SELECT data,updated_at FROM agenda_data WHERE user_id=?').bind(user.id).first();
    return json({data:row?JSON.parse(row.data):{events:[],categories:[]},updatedAt:row?.updated_at||null},200,origin);
   }
   if(request.method==='PUT' && url.pathname==='/api/data'){
    const body=await request.json();
    if(!body || !Array.isArray(body.events) || !Array.isArray(body.categories)) return json({error:'Formato de agenda no válido.'},400,origin);
    if(body.events.length>20000 || body.categories.length>1000) return json({error:'La agenda supera el límite permitido.'},413,origin);
    const serialized=JSON.stringify({events:body.events,categories:body.categories});
    if(serialized.length>1_500_000) return json({error:'La agenda supera el tamaño máximo permitido.'},413,origin);
    const now=new Date().toISOString();
    await env.DB.prepare('INSERT INTO agenda_data (user_id,data,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(user.id,serialized,now).run();
    return json({ok:true,updatedAt:now},200,origin);
   }
   return json({error:'Ruta no encontrada.'},404,origin);
  } catch(error){ return json({error:'Error interno del servidor.'},500,origin); }
 }
};
