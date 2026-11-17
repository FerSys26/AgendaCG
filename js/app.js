
const DB_NAME = "AgendaCGLocal";
const DB_VERSION = 1;
const STORE_NAME = "agenda";
const RECORD_KEY = "principal";
const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MONTHS_CAP = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const WEEKDAYS = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
const WEEKDAYS_SHORT = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const DEFAULT_CATEGORIES = []; // La agenda comienza vacía, sin etiquetas precargadas.

let events = [];
let categories = [];
let currentView = "day";
let anchorDate = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12);
let toastTimer = null;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d,12); };
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const mondayOf = d => addDays(startOfDay(d), -((d.getDay()+6)%7));
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const categoryFor = id => categories.find(c => c.id === id) || {name:"Sin etiqueta", color:"#8996a5"};
const sortedEvents = list => [...list].sort((a,b) => (a.date+(a.start||"99:99")).localeCompare(b.date+(b.start||"99:99")));
const dateLabel = d => `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;


// Nombre del día de la semana con la primera letra en mayúscula.
const weekdayName = d =>
    WEEKDAYS[(d.getDay() + 6) % 7].charAt(0).toUpperCase() +
    WEEKDAYS[(d.getDay() + 6) % 7].slice(1);

// Fecha completa sin repetir el año en cada extremo del periodo.
const printDatePart = d =>
    `${weekdayName(d)}, ${pad(d.getDate())} de ${MONTHS_CAP[d.getMonth()]}`;

// Texto del encabezado según el tipo de vista.
function periodDescription(start, end) {
    if (currentView === "day") {
        return `${weekdayName(start)}, ${pad(start.getDate())} de ${MONTHS_CAP[start.getMonth()]} de ${start.getFullYear()}`;
    }

    if (currentView === "year") {
        return `Resumen del año ${start.getFullYear()}`;
    }

    if (start.getMonth() === end.getMonth() &&
        start.getFullYear() === end.getFullYear()) {
        return `Del ${printDatePart(start)} al ${printDatePart(end)} de ${end.getFullYear()}`;
    }

    if (start.getFullYear() === end.getFullYear()) {
        return `Del ${printDatePart(start)} al ${printDatePart(end)} de ${end.getFullYear()}`;
    }

    return `Del ${printDatePart(start)} de ${start.getFullYear()} al ${printDatePart(end)} de ${end.getFullYear()}`;
}


const timeLabel = e => e.start ? (e.end ? `${e.start} – ${e.end}` : e.start) : "Sin hora";

function openAgendaDatabase() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('Este navegador no permite almacenamiento local.')); return; }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento.'));
    });
}

async function readStoredAgenda() {
    const db = await openAgendaDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        request.onsuccess = () => { const value = request.result; db.close(); resolve(value || {events:[], categories:[]}); };
        request.onerror = () => { db.close(); reject(request.error); };
    });
}

async function writeStoredAgenda(data) {
    const db = await openAgendaDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, RECORD_KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('No se pudieron guardar los datos.')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Se canceló el guardado.')); };
    });
}

async function loadData() {
    try {
        let data = await readStoredAgenda();
        events = Array.isArray(data.events) ? data.events : [];
        categories = Array.isArray(data.categories) ? data.categories : [];
        render();
        if (window.AgendaCloud) {
            try {
                const result = await window.AgendaCloud.init(data);
                if (result && result.data) {
                    events = Array.isArray(result.data.events) ? result.data.events : [];
                    categories = Array.isArray(result.data.categories) ? result.data.categories : [];
                    if (result.authenticated) await writeStoredAgenda(result.data);
                    render();
                }
            } catch (syncError) {
                console.error('AgendaCG: sincronización inicial no disponible:', syncError);
                showToast('No se pudo conectar con la nube. Se mantienen los datos locales.');
            }
        }
    } catch (error) {
        events = []; categories = [];
        $('calendarView').innerHTML = `<div class="empty-state"><strong>No se pudo abrir la agenda</strong>${escapeHtml(error.message)}<br>Comprueba que has abierto AgendaCG desde su dirección de instalación.</div>`;
    }
}

async function saveData() {
    const data = {events, categories, updatedAt:new Date().toISOString()};
    await writeStoredAgenda(data);
    if (window.AgendaCloud) await window.AgendaCloud.save(data);
}

function eventMatchesSearch(event) {
    const query = ($('searchInput')?.value || '').trim().toLocaleLowerCase('es');
    if (!query) return true;
    const category = categoryFor(event.categoryId).name;
    return [event.title, event.location, event.notes, category].some(value => String(value || '').toLocaleLowerCase('es').includes(query));
}

function filteredEvents(list) { return list.filter(eventMatchesSearch); }

function showToast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}


// Ventana de confirmación personalizada de Agenda CG.
function askAgendaConfirmation(message) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");

        overlay.style.cssText = `
            position:fixed;
            inset:0;
            background:rgba(15,25,40,.55);
            display:flex;
            align-items:center;
            justify-content:center;
            padding:20px;
            z-index:10000;
        `;

        const dialog = document.createElement("div");
        dialog.style.cssText = `
            width:100%;
            max-width:420px;
            background:white;
            border-radius:14px;
            padding:25px;
            box-shadow:0 15px 45px rgba(0,0,0,.25);
            font-family:inherit;
            color:#263445;
        `;

        const title = document.createElement("h2");
        title.textContent = "Agenda CG";
        title.style.cssText = `
            margin:0 0 18px;
            font-size:21px;
            color:#2865a8;
        `;

        const text = document.createElement("p");
        text.textContent = message;
        text.style.cssText = `
            margin:0 0 25px;
            line-height:1.6;
            font-size:15px;
        `;

        const buttons = document.createElement("div");
        buttons.style.cssText = `
            display:flex;
            justify-content:flex-end;
            gap:10px;
        `;

        const cancel = document.createElement("button");
        cancel.textContent = "Cancelar";
        cancel.style.cssText = `
            padding:10px 18px;
            border:1px solid #cbd3dc;
            border-radius:7px;
            background:#f4f6f8;
            color:#344054;
            cursor:pointer;
            font-size:14px;
        `;

        const accept = document.createElement("button");
        accept.textContent = "Eliminar";
        accept.style.cssText = `
            padding:10px 18px;
            border:0;
            border-radius:7px;
            background:#c83c43;
            color:white;
            cursor:pointer;
            font-size:14px;
            font-weight:600;
        `;

        buttons.append(cancel, accept);
        dialog.append(title, text, buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        function finish(result) {
            document.removeEventListener("keydown", handleKey);
            overlay.remove();
            resolve(result);
        }

        function handleKey(event) {
            if (event.key === "Escape") finish(false);
            if (event.key === "Enter") finish(true);
        }

        cancel.addEventListener("click", () => finish(false));
        accept.addEventListener("click", () => finish(true));

        overlay.addEventListener("click", event => {
            if (event.target === overlay) finish(false);
        });

        document.addEventListener("keydown", handleKey);

        cancel.focus();
    });
}


function periodRange() {
    if (currentView === "day") return [anchorDate, anchorDate];
    if (currentView === "week") { const s=mondayOf(anchorDate); return [s,addDays(s,6)]; }
    if (currentView === "fortnight") { const s=mondayOf(anchorDate); return [s,addDays(s,13)]; }
    if (currentView === "month") return [new Date(anchorDate.getFullYear(),anchorDate.getMonth(),1,12),new Date(anchorDate.getFullYear(),anchorDate.getMonth()+1,0,12)];
    return [new Date(anchorDate.getFullYear(),0,1,12),new Date(anchorDate.getFullYear(),11,31,12)];
}

function eventsInRange(start,end) {
    const a=dateKey(start), b=dateKey(end);
    return sortedEvents(filteredEvents(events.filter(e => e.date >= a && e.date <= b)));
}

function setView(view) {
    currentView = view;
    document.querySelectorAll(".view-tab").forEach(b => b.classList.toggle("active",b.dataset.view===view));
    render();
}

function navigate(direction) {
    if (currentView==="day") anchorDate=addDays(anchorDate,direction);
    else if (currentView==="week") anchorDate=addDays(anchorDate,direction*7);
    else if (currentView==="fortnight") anchorDate=addDays(anchorDate,direction*14);
    else if (currentView==="month") anchorDate=new Date(anchorDate.getFullYear(),anchorDate.getMonth()+direction,1,12);
    else anchorDate=new Date(anchorDate.getFullYear()+direction,anchorDate.getMonth(),1,12);
    render();
}

function updatePeriodTitle(start,end) {
    if (currentView==="day") $("periodTitle").textContent=dateLabel(start);
    else if (currentView==="year") $("periodTitle").textContent=String(start.getFullYear());
    else if (start.getMonth()===end.getMonth() && start.getFullYear()===end.getFullYear())
        $("periodTitle").textContent=`${start.getDate()}–${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
    else $("periodTitle").textContent=`${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

function render() {
    const [start,end]=periodRange();
    const list=eventsInRange(start,end);
    updatePeriodTitle(start,end);
    $("periodCount").textContent=list.length;
    $("categoryCount").textContent=categories.length;
    const upcoming=sortedEvents(events.filter(e => e.date+(e.start||"99:99") >= dateKey(new Date())+pad(new Date().getHours())+":"+pad(new Date().getMinutes())))[0];
    $("nextEvent").textContent=upcoming ? `${upcoming.title} · ${dateLabel(parseDate(upcoming.date))}` : "Sin citas próximas";
    $("legend").innerHTML=categories.map(c=>`<span class="legend-item"><i class="legend-dot" style="background:${escapeHtml(c.color)}"></i>${escapeHtml(c.name)}</span>`).join("");
    
const headings = {
    day: "Agenda diaria",
    week: "Agenda semanal",
    fortnight: "Agenda quincenal",
    month: "Agenda mensual",
    year: "Agenda anual"
};

$("viewHeading").textContent = headings[currentView];

// Mostrar el periodo completo en el encabezado.
// Este texto también aparecerá en la impresión A4.
$("viewDescription").textContent = periodDescription(start, end);

    if(currentView==="day") renderDay(list);
    else if(currentView==="week") renderWeek(start,7);
    else if(currentView==="fortnight") renderWeek(start,14);
    else if(currentView==="month") renderMonth(start);
    else renderYear(start.getFullYear());
}

function renderDay(list) {
    if(!list.length){
        $("calendarView").innerHTML=`<div class="empty-state"><strong>No tienes citas para este día</strong>Disfruta del tiempo libre o añade una nueva cita.<br><br><button class="button button-primary no-print" onclick="openNewEvent('${dateKey(anchorDate)}')">＋ Añadir cita</button></div>`;
        return;
    }
    $("calendarView").innerHTML=`<div class="day-list">${list.map(eventCard).join("")}</div>`;
}

function eventCard(e) {
    const c=categoryFor(e.categoryId);
    return `<article class="event-card" style="--event-color:${escapeHtml(c.color)}">
        <div class="event-time">${escapeHtml(timeLabel(e))}</div><div class="event-stripe"></div>
        <div class="event-main"><h3 class="event-title">${escapeHtml(e.title)}</h3>
            <div class="event-meta"><span>${escapeHtml(c.name)}</span>${e.location?`<span>⌖ ${escapeHtml(e.location)}</span>`:""}</div>
            ${e.notes?`<div class="event-notes">${escapeHtml(e.notes)}</div>`:""}
        </div>
        <div class="event-actions no-print"><button class="mini-button" onclick="editEvent('${e.id}')">Editar</button><button class="mini-button" onclick="deleteEvent('${e.id}')">Eliminar</button></div>
    </article>`;
}

function renderWeek(start,count) {
    const days=Array.from({length:count},(_,i)=>addDays(start,i));
    $("calendarView").innerHTML=`<div class="week-grid" style="grid-template-columns:repeat(${count===14?7:count},minmax(0,1fr))">${days.map(d=>{
        const key=dateKey(d), dayEvents=filteredEvents(events.filter(e=>e.date===key)).sort((a,b)=>(a.start||"99:99").localeCompare(b.start||"99:99"));
        return `<div class="week-column"><div class="week-day-head"><span>${WEEKDAYS_SHORT[(d.getDay()+6)%7]}</span><strong class="${key===dateKey(anchorDate)?"selected":""}">${d.getDate()}</strong></div>
        ${dayEvents.map(e=>{const c=categoryFor(e.categoryId);return `<button class="week-event no-print" style="--event-color:${escapeHtml(c.color)}" onclick="editEvent('${e.id}')" title="${escapeHtml(e.title)}"><b>${escapeHtml(e.start||"Sin hora")}</b>${escapeHtml(e.title)}</button><div class="week-event print-only" style="--event-color:${escapeHtml(c.color)}"><b>${escapeHtml(e.start||"Sin hora")}</b>${escapeHtml(e.title)}</div>`}).join("")}
        ${dayEvents.length?"":'<div class="small-note">Sin citas</div>'}
        </div>`;
    }).join("")}</div>`;
}

function renderMonth(first) {
    const year=first.getFullYear(), month=first.getMonth(), offset=(new Date(year,month,1).getDay()+6)%7;
    const daysInMonth=new Date(year,month+1,0).getDate();
    const total=Math.ceil((offset+daysInMonth)/7)*7;
    let html='<div class="month-grid">'+WEEKDAYS_SHORT.map(d=>`<div class="month-weekday">${d}</div>`).join("");
    for(let i=0;i<total;i++){
        const date=addDays(new Date(year,month,1,12),i-offset), key=dateKey(date), inMonth=date.getMonth()===month;
        const dayEvents=sortedEvents(filteredEvents(events.filter(e=>e.date===key)));
        html+=`<div class="month-cell ${inMonth?"":"outside"} ${key===dateKey(new Date())?"today":""}" onclick="selectDate('${key}')">
            <div class="month-day-number"><span>${date.getDate()}</span>${dayEvents.length?`<span>${dayEvents.length}</span>`:""}</div>
            ${dayEvents.slice(0,3).map(e=>{const c=categoryFor(e.categoryId);return `<div class="month-event" style="--event-color:${escapeHtml(c.color)}">${e.start?escapeHtml(e.start)+" ":""}${escapeHtml(e.title)}</div>`}).join("")}
            ${dayEvents.length>3?`<div class="more-events">+${dayEvents.length-3} más</div>`:""}
        </div>`;
    }
    $("calendarView").innerHTML=html+"</div>";
}

function renderYear(year) {
    $("calendarView").innerHTML=`<div class="year-grid">${MONTHS_CAP.map((name,m)=>{
        const first=new Date(year,m,1,12), offset=(first.getDay()+6)%7, days=new Date(year,m+1,0).getDate();
        let cells=WEEKDAYS_SHORT.map(d=>`<span>${d[0]}</span>`).join("");
        for(let i=0;i<offset;i++) cells+="<span></span>";
        for(let d=1;d<=days;d++){
            const key=dateKey(new Date(year,m,d,12)), has=filteredEvents(events.filter(e=>e.date===key)).length>0;
            cells+=`<button class="${has?"has-events":""} ${key===dateKey(anchorDate)?"selected":""} ${key===dateKey(new Date())?"today":""}" onclick="selectDate('${key}')" title="${has?"Tiene citas":""}">${d}</button>`;
        }
        return `<section class="year-month"><h3>${name}</h3><div class="year-days">${cells}</div></section>`;
    }).join("")}</div>`;
}

function selectDate(key) {
    anchorDate=parseDate(key);
    setView("day");
}

function openNewEvent(date=dateKey(anchorDate)) {
    $("eventForm").reset();
    $("eventId").value="";
    $("eventModalTitle").textContent="Nueva cita";
    $("eventDate").value=date;
    populateCategorySelect();
    $("eventModal").classList.remove("hidden");
    $("eventTitle").focus();
}

function populateCategorySelect(selected) {
    $("eventCategory").innerHTML='<option value="">Sin etiqueta</option>'+categories.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
    if(selected) $("eventCategory").value=selected;
}

function editEvent(id) {
    const e=events.find(x=>x.id===id);
    if(!e)return;
    $("eventForm").reset();
    $("eventId").value=e.id;
    $("eventModalTitle").textContent="Editar cita";
    $("eventTitle").value=e.title;
    $("eventDate").value=e.date;
    $("eventStart").value=e.start||"";
    $("eventEnd").value=e.end||"";
    $("eventLocation").value=e.location||"";
    $("eventNotes").value=e.notes||"";
    populateCategorySelect(e.categoryId);
    $("eventModal").classList.remove("hidden");
}

async function deleteEvent(id) {
    const e=events.find(x=>x.id===id);
    if(!e)return;
    if (!await askAgendaConfirmation(
        `¿Estás seguro de que deseas eliminar la cita "${e.title}"?`
    )) return;
    events=events.filter(x=>x.id!==id);
    try{
        await saveData();
        render();
        showToast("Cita eliminada.");
    }catch(err){
        showToast(err.message);
    }
}

$("eventForm").addEventListener("submit",async ev=>{
    ev.preventDefault();
    const id=$("eventId").value||`evt-${Date.now()}-${Math.random().toString(16).slice(2,7)}`;
    const start=$("eventStart").value, end=$("eventEnd").value;
    if(start&&end&&end<start){
        showToast("La hora de finalización debe ser posterior al inicio.");
        return;
    }
    const item={
        id,
        title:$("eventTitle").value.trim(),
        date:$("eventDate").value,
        categoryId:$("eventCategory").value||"",
        start,
        end,
        location:$("eventLocation").value.trim(),
        notes:$("eventNotes").value.trim()
    };
    if(!item.title||!item.date){
        showToast("Indica al menos el título y la fecha.");
        return;
    }
    const idx=events.findIndex(x=>x.id===id);
    if(idx>=0)events[idx]=item;
    else events.push(item);
    try{
        await saveData();
        anchorDate=parseDate(item.date);
        currentView="day";
        $("eventModal").classList.add("hidden");
        render();
        showToast(idx>=0?"Cita actualizada.":"Cita guardada.");
    }catch(err){
        showToast(err.message);
    }
});

function openCategories() {
    renderCategoryList();
    $("categoriesModal").classList.remove("hidden");
}

function renderCategoryList() {
    $("categoryList").innerHTML=categories.length
        ? categories.map(c=>`<div class="category-row"><i class="category-swatch" style="background:${escapeHtml(c.color)}"></i><strong>${escapeHtml(c.name)}</strong><div class="category-row-actions"><button class="mini-button" onclick="editCategory('${c.id}')">Editar</button><button class="mini-button" onclick="deleteCategory('${c.id}')">Eliminar</button></div></div>`).join("")
        : '<div class="empty-state">Todavía no hay etiquetas.</div>';
}

function resetCategoryForm() {
    $("categoryForm").reset();
    $("categoryId").value="";
    $("categoryColor").value="#3975bd";
    $("categorySaveBtn").textContent="Añadir";
    $("categoryCancelBtn").classList.add("hidden");
}

function editCategory(id) {
    const c=categories.find(x=>x.id===id);
    if(!c)return;
    $("categoryId").value=id;
    $("categoryName").value=c.name;
    $("categoryColor").value=c.color;
    $("categorySaveBtn").textContent="Guardar";
    $("categoryCancelBtn").classList.remove("hidden");
    $("categoryName").focus();
}

async function deleteCategory(id) {
    const c=categories.find(x=>x.id===id);
    if(!c)return;
    if(events.some(e=>e.categoryId===id)){
        showToast("No puedes eliminarla: está asignada a una o varias citas.");
        return;
    }
    if (!await askAgendaConfirmation(
        `¿Estás seguro de que deseas eliminar la etiqueta "${c.name}"?`
    )) return;
    categories=categories.filter(x=>x.id!==id);
    try{
        await saveData();
        renderCategoryList();
        render();
        showToast("Etiqueta eliminada.");
    }catch(err){
        showToast(err.message);
    }
}

$("categoryForm").addEventListener("submit",async ev=>{
    ev.preventDefault();
    const name=$("categoryName").value.trim();
    if(!name)return;
    const id=$("categoryId").value;
    if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase()&&c.id!==id)){
        showToast("Ya existe una etiqueta con ese nombre.");
        return;
    }
    if(id){
        const c=categories.find(x=>x.id===id);
        c.name=name;
        c.color=$("categoryColor").value;
    }else{
        categories.push({id:`cat-${Date.now()}`,name,color:$("categoryColor").value});
    }
    try{
        await saveData();
        resetCategoryForm();
        renderCategoryList();
        render();
        showToast("Etiqueta guardada.");
    }catch(err){
        showToast(err.message);
    }
});

$("categoryCancelBtn").addEventListener("click",resetCategoryForm);
document.querySelectorAll(".view-tab").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
$("prevBtn").addEventListener("click",()=>navigate(-1));
$("nextBtn").addEventListener("click",()=>navigate(1));
$("todayBtn").addEventListener("click",()=>{anchorDate=startOfDay(new Date());render();});
$("newEventBtn").addEventListener("click",()=>openNewEvent());
$("manageCategoriesBtn").addEventListener("click",openCategories);
$("printBtn").addEventListener("click",()=>window.print());
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).classList.add("hidden")));
document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.add("hidden");}));


// Búsqueda instantánea en todas las vistas.
$('searchInput').addEventListener('input', render);
$('clearSearchBtn').addEventListener('click', () => { $('searchInput').value=''; render(); $('searchInput').focus(); });

// Copias de seguridad locales: el archivo JSON puede guardarse fuera del teléfono.
$('backupBtn').addEventListener('click', () => $('backupModal').classList.remove('hidden'));
$('exportBackupBtn').addEventListener('click', async () => {
    try {
        const data = await readStoredAgenda();
        const backup = {format:'AgendaCG-Backup', version:1, createdAt:new Date().toISOString(), events:data.events||[], categories:data.categories||[]};
        const blob = new Blob([JSON.stringify(backup,null,2)], {type:'application/json;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href=url; link.download=`AgendaCG-copia-${dateKey(new Date())}.json`;
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        showToast('Copia de seguridad preparada.');
    } catch (error) { showToast(error.message || 'No se pudo exportar la copia.'); }
});
$('importBackupInput').addEventListener('change', async event => {
    const file=event.target.files?.[0];
    if(!file) return;
    try {
        const backup=JSON.parse(await file.text());
        if(!backup || backup.format!=='AgendaCG-Backup' || !Array.isArray(backup.events) || !Array.isArray(backup.categories)) throw new Error('El archivo no es una copia válida de AgendaCG.');
        if(!await askAgendaConfirmation('La restauración reemplazará todas las citas y etiquetas actuales de este teléfono. ¿Deseas continuar?')) return;
        events=backup.events; categories=backup.categories;
        await saveData(); render(); $('backupModal').classList.add('hidden');
        showToast('Copia restaurada correctamente.');
    } catch(error) { showToast(error.message || 'No se pudo restaurar la copia.'); }
    finally { event.target.value=''; }
});

window.openNewEvent=openNewEvent;
window.editEvent=editEvent;
window.deleteEvent=deleteEvent;
window.editCategory=editCategory;
window.deleteCategory=deleteCategory;
window.selectDate=selectDate;

window.AgendaStorage = {read: readStoredAgenda, write: writeStoredAgenda};
window.addEventListener('agendacloudready', async event => {
    const data = event.detail || {events:[],categories:[]};
    events = Array.isArray(data.events) ? data.events : [];
    categories = Array.isArray(data.categories) ? data.categories : [];
    try { await writeStoredAgenda(data); } catch (error) { console.error(error); }
    render();
    showToast('Agenda recuperada y sincronizada.');
});
loadData();
