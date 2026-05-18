// =============================================
// UQBAR · Dashboard BSC Geoma · script.js
// =============================================

// ---- CONFIGURACIÓN SUPABASE ----
const SUPABASE_URL = 'https://jlhpptidvwjibysncdcy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_v0gGjzywFYQpHASpZ5J0Gw_CYuA2_bY';
const CLIENT_NAME  = 'Geoma';
const TOTAL_SEMANAS = 26;

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- FÓRMULAS (descripción para el modal) ----
const FORMULAS = {
  'Relación ingresos vs gastos operativos': 'Ingresos cobrados ÷ gastos operativos · Meta: > 1.2 (ideal 1.3)',
  'Tasa de captación de clientes': 'Clientes activos nuevos ÷ total de clientes activos · Meta: > 0.2 (ideal 0.4)',
  'Tasa de ingresos por canales nuevos': 'Ingresos por canal nuevo ÷ ingresos totales · Meta: > 0.15 (ideal 0.25)',
  'Dependencia de ingresos (top 2 clientes)': 'Ingresos top 2 clientes ÷ ingresos totales · Meta: < 40% (ideal < 30%)',
  'Horas semanales del dueño en tareas delegables': 'Horas/semana del dueño en tareas administrativas o delegables · Meta: < 20 hrs (ideal < 8)',
  'Capacidad de cobro a tiempo': 'Facturas cobradas en plazo ÷ facturas totales emitidas · Meta: > 0.8 (ideal 0.9)',
  'Procesos documentados': 'Número de procesos con pasos, manuales o flujogramas · Meta: > 5 (ideal > 10)',
  'Empleados certificados en segmentos nuevos': 'Empleados con certificación ÷ total empleados · Meta: > 0.07 (ideal 0.12)',
  'Reuniones diarias realizadas': 'Días con reunión realizada ÷ días laborales del mes · Meta: > 0.7 (ideal 0.8)',
};

// ---- INDICADORES INVERTIDOS (menor = mejor) ----
const INVERTIDOS = [
  'Dependencia de ingresos (top 2 clientes)',
  'Horas semanales del dueño en tareas delegables',
];

// ---- COLORES GANTT por fase ----
const FASE_COLORS = {
  1: 'rgba(184,160,240,0.25)',
  2: 'rgba(95,212,160,0.2)',
  3: 'rgba(240,192,96,0.2)',
  4: 'rgba(240,112,112,0.18)',
};

// ---- ESTADO LOCAL ----
let clienteId = null;
let fechaInicio = null;
let kpiAbierto = null;
let iniciativasData = [];

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  setFechaHoy();
  init();
});

async function init() {
  try {
    await cargarCliente();
    await Promise.all([
      cargarBSC(),
      cargarIniciativas(),
    ]);
  } catch (e) {
    console.error('Error init:', e);
  }
}

// ---- FECHA HOY ----
function setFechaHoy() {
  const hoy = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('fecha-hoy').textContent =
    hoy.toLocaleDateString('es-MX', opts);
}

// ---- CLIENTE ----
async function cargarCliente() {
  const { data, error } = await db
    .from('clientes')
    .select('id, fecha_inicio')
    .eq('nombre', CLIENT_NAME)
    .single();

  if (error) throw error;
  clienteId = data.id;
  fechaInicio = new Date(data.fecha_inicio + 'T00:00:00');
}

// ---- SEMANA ACTUAL ----
function semanaActual() {
  const hoy = new Date();
  const diff = hoy - fechaInicio;
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(dias / 7) + 1);
}

function faseActual(sem) {
  if (sem <= 4)  return 1;
  if (sem <= 12) return 2;
  if (sem <= 20) return 3;
  return 4;
}

function semanaAFecha(sem) {
  const d = new Date(fechaInicio);
  d.setDate(d.getDate() + (sem - 1) * 7);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

// ---- BSC ----
async function cargarBSC() {
  const { data: perspectivas } = await db
    .from('perspectivas')
    .select('id, nombre, orden')
    .eq('cliente_id', clienteId)
    .order('orden');

  const { data: objetivos } = await db
    .from('objetivos')
    .select('id, perspectiva_id, descripcion, orden')
    .order('orden');

  const { data: indicadores } = await db
    .from('indicadores')
    .select('id, objetivo_id, nombre, unidad, meta, frecuencia')
    .eq('activo', true);

  // Última medición por indicador
  const indicadorIds = indicadores.map(i => i.id);
  const { data: mediciones } = await db
    .from('mediciones')
    .select('indicador_id, valor_real, fecha, nota, created_at')
    .in('indicador_id', indicadorIds)
    .order('created_at', { ascending: false });

  // Agrupar última medición (la más reciente por created_at)
  const ultimaMedicion = {};
  mediciones.forEach(m => {
    if (!ultimaMedicion[m.indicador_id] ||
        new Date(m.created_at) > new Date(ultimaMedicion[m.indicador_id].created_at)) {
      ultimaMedicion[m.indicador_id] = m;
    }
  });

  renderBSC(perspectivas, objetivos, indicadores, ultimaMedicion);
}

function calcularSemaforo(indicador, valor) {
  if (valor === null || valor === undefined) return 'sin-dato';
  const invertido = INVERTIDOS.includes(indicador.nombre);
  const meta = indicador.meta;

  if (invertido) {
    if (valor <= meta * 0.7) return 'verde';
    if (valor <= meta)       return 'amarillo';
    return 'rojo';
  } else {
    if (indicador.unidad === '%') {
      if (valor <= meta * 0.7) return 'rojo';
      if (valor < meta)        return 'amarillo';
      return 'verde';
    }
    if (valor >= meta)        return 'verde';
    if (valor >= meta * 0.8)  return 'amarillo';
    return 'rojo';
  }
}

function renderBSC(perspectivas, objetivos, indicadores, ultimaMedicion) {
  const container = document.getElementById('bsc-container');
  container.innerHTML = '';

  let totalVerde = 0, totalAmarillo = 0, totalRojo = 0, totalSinDato = 0;

  perspectivas.forEach(p => {
    const objsPersp = objetivos.filter(o => o.perspectiva_id === p.id);
    const indsPersp = indicadores.filter(ind =>
      objsPersp.some(o => o.id === ind.objetivo_id)
    );

    const block = document.createElement('div');
    block.className = 'perspectiva-block';

    // Header perspectiva
    const header = document.createElement('div');
    header.className = 'perspectiva-header';
    header.innerHTML = `
      <div class="perspectiva-dot"></div>
      <span class="perspectiva-nombre">${p.nombre}</span>
      <span class="perspectiva-stats">${indsPersp.length} indicador${indsPersp.length !== 1 ? 'es' : ''}</span>
    `;
    block.appendChild(header);

    const kpiList = document.createElement('div');
    kpiList.className = 'kpi-list';

    indsPersp.forEach(ind => {
      const obj = objsPersp.find(o => o.id === ind.objetivo_id);
      const med = ultimaMedicion[ind.id];
      const valor = med ? med.valor_real : null;
      const semaforo = calcularSemaforo(ind, valor);

      if (semaforo === 'verde')    totalVerde++;
      else if (semaforo === 'amarillo') totalAmarillo++;
      else if (semaforo === 'rojo')     totalRojo++;
      else totalSinDato++;

      const colores = {
        verde: 'var(--verde)',
        amarillo: 'var(--amarillo)',
        rojo: 'var(--rojo)',
        'sin-dato': 'var(--gris)',
      };
      const color = colores[semaforo];

      const item = document.createElement('div');
      item.className = 'kpi-item';
      item.style.setProperty('--semaforo-color', color);
      item.setAttribute('data-id', ind.id);
      item.setAttribute('data-nombre', ind.nombre);
      item.setAttribute('data-meta', ind.meta);
      item.setAttribute('data-unidad', ind.unidad || '');
      item.setAttribute('data-perspectiva', p.nombre);
      item.setAttribute('data-objetivo', obj?.descripcion || '');

      const valorDisplay = valor !== null
        ? `${parseFloat(valor).toLocaleString('es-MX', { maximumFractionDigits: 2 })} <small style="font-size:0.5em;color:var(--text-dimmer)">${ind.unidad || ''}</small>`
        : '';

      item.innerHTML = `
        <div class="kpi-info">
          <div class="kpi-nombre">${ind.nombre}</div>
          <div class="kpi-objetivo">${obj?.descripcion || ''}</div>
        </div>
        <span class="kpi-frecuencia">${ind.frecuencia}</span>
        <div class="kpi-valor ${valor === null ? 'sin-dato' : ''}" style="color:${color}">
          ${valor !== null ? valorDisplay : '— sin dato'}
        </div>
        <div class="kpi-meta">
          Meta: ${INVERTIDOS.includes(ind.nombre) ? '<' : '>'} ${ind.meta} ${ind.unidad || ''}
          ${med ? `<br><span style="opacity:0.6">${new Date(med.fecha + 'T00:00:00').toLocaleDateString('es-MX', {day:'numeric',month:'short'})}</span>` : ''}
        </div>
        <div class="semaforo-badge ${semaforo}"></div>
      `;

      item.addEventListener('click', () => abrirModal(ind, obj, p, med));
      kpiList.appendChild(item);
    });

    block.appendChild(kpiList);
    container.appendChild(block);
  });

  // Summary
  document.getElementById('sum-verde').textContent = totalVerde;
  document.getElementById('sum-amarillo').textContent = totalAmarillo;
  document.getElementById('sum-rojo').textContent = totalRojo;
  document.getElementById('sum-sindata').textContent = totalSinDato;
}

// ---- INICIATIVAS ----
async function cargarIniciativas() {
  const { data, error } = await db
    .from('iniciativas')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('orden');

  if (error) throw error;
  iniciativasData = data;
  renderIniciativas();
  renderRoadmap();
}

function getFase(semInicio) {
  if (semInicio <= 4)  return 1;
  if (semInicio <= 12) return 2;
  if (semInicio <= 20) return 3;
  return 4;
}

function renderIniciativas() {
  const container = document.getElementById('iniciativas-container');
  container.innerHTML = '';

  const completadas = iniciativasData.filter(i => i.completada).length;
  document.getElementById('sum-iniciativas').textContent =
    `${completadas}/${iniciativasData.length}`;

  iniciativasData.forEach(ini => {
    const fase = getFase(ini.semana_inicio);
    const card = document.createElement('div');
    card.className = `iniciativa-card${ini.completada ? ' completada' : ''}`;
    card.dataset.id = ini.id;

    const inicio = semanaAFecha(ini.semana_inicio);
    const fin    = semanaAFecha(ini.semana_inicio + ini.semanas_duracion - 1);

    card.innerHTML = `
      <div class="iniciativa-check">
        <span class="iniciativa-check-icon">✓</span>
      </div>
      <div class="iniciativa-body">
        <div class="iniciativa-fase">Fase ${fase}</div>
        <div class="iniciativa-nombre">${ini.nombre}</div>
        <div class="iniciativa-meta">Sem ${ini.semana_inicio} → Sem ${ini.semana_inicio + ini.semanas_duracion - 1} · ${inicio} – ${fin}</div>
        ${ini.completada && ini.fecha_completada
          ? `<div class="iniciativa-fecha">✓ Completada ${new Date(ini.fecha_completada + 'T00:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})}</div>`
          : ''}
      </div>
    `;

    card.addEventListener('click', () => toggleIniciativa(ini.id, !ini.completada));
    container.appendChild(card);
  });
}

async function toggleIniciativa(id, completada) {
  const hoy = new Date().toISOString().split('T')[0];
  const { error } = await db
    .from('iniciativas')
    .update({
      completada,
      fecha_completada: completada ? hoy : null,
    })
    .eq('id', id);

  if (error) { showToast('Error al guardar ✕'); return; }

  const idx = iniciativasData.findIndex(i => i.id === id);
  iniciativasData[idx].completada = completada;
  iniciativasData[idx].fecha_completada = completada ? hoy : null;

  renderIniciativas();
  renderRoadmap();
  showToast(completada ? '✓ Iniciativa completada' : 'Iniciativa reabierta');
}

// ---- ROADMAP ---- 
function renderRoadmap() {
  const semActual = semanaActual();
  const pct = Math.min(100, ((semActual - 1) / (TOTAL_SEMANAS - 1)) * 100);
  const faseAct = faseActual(semActual);

  // Progress bar
  document.getElementById('roadmap-progress').style.width = `${pct}%`;

  // Needle
  const needle = document.getElementById('roadmap-needle');
  needle.style.left = `${pct}%`;
  document.getElementById('needle-label').textContent = `Sem ${semActual}`;

  // Fase activa
  document.querySelectorAll('.phase').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.phase) === faseAct);
  });

  // Gantt
  const gantt = document.getElementById('roadmap-gantt');
  gantt.innerHTML = '';

  iniciativasData.forEach(ini => {
    const fase = getFase(ini.semana_inicio);
    const left = ((ini.semana_inicio - 1) / (TOTAL_SEMANAS - 1)) * 100;
    const width = (ini.semanas_duracion / TOTAL_SEMANAS) * 100;

    const row = document.createElement('div');
    row.className = 'gantt-row';

    const label = document.createElement('div');
    label.className = 'gantt-label';
    label.textContent = ini.nombre;
    label.title = ini.nombre;

    const track = document.createElement('div');
    track.className = 'gantt-track';

    const bar = document.createElement('div');
    bar.className = `gantt-bar${ini.completada ? ' completada' : ''}`;
    bar.style.left = `${left}%`;
    bar.style.width = `${Math.max(width, 2)}%`;
    bar.style.background = ini.completada
      ? 'rgba(95,212,160,0.3)'
      : FASE_COLORS[fase] || 'rgba(184,160,240,0.2)';
    bar.style.borderLeft = `2px solid ${ini.completada ? 'var(--verde)' : 'rgba(184,160,240,0.5)'}`;

    track.appendChild(bar);

    const check = document.createElement('span');
    check.className = `gantt-check${ini.completada ? ' done' : ''}`;
    check.textContent = ini.completada ? '✓' : '○';
    check.title = ini.completada ? 'Completada' : 'Marcar como completada';
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleIniciativa(ini.id, !ini.completada);
    });

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(check);
    gantt.appendChild(row);
  });
}

// ---- MODAL ----
function abrirModal(ind, obj, perspectiva, medActual) {
  kpiAbierto = ind;

  document.getElementById('modal-tag').textContent = perspectiva.nombre;
  document.getElementById('modal-title').textContent = ind.nombre;
  document.getElementById('modal-formula').textContent =
    FORMULAS[ind.nombre] || `Meta: ${ind.meta} ${ind.unidad || ''}`;
  document.getElementById('modal-unit').textContent = ind.unidad || '';
  document.getElementById('modal-valor').value = '';
  document.getElementById('modal-nota').value = '';

  const invertido = INVERTIDOS.includes(ind.nombre);
  document.getElementById('modal-meta-text').textContent =
    `Meta: ${invertido ? 'menor a' : 'mayor a'} ${ind.meta} ${ind.unidad || ''}${medActual ? ` · Último registro: ${parseFloat(medActual.valor_real).toLocaleString('es-MX', {maximumFractionDigits:2})} ${ind.unidad || ''} (${new Date(medActual.fecha + 'T00:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'})})` : ' · Sin registros previos'}`;

  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('modal-valor').focus(), 100);
}

function cerrarModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  kpiAbierto = null;
}

document.getElementById('modal-close').addEventListener('click', cerrarModal);
document.getElementById('modal-cancel').addEventListener('click', cerrarModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) cerrarModal();
});

document.getElementById('modal-save').addEventListener('click', async () => {
  if (!kpiAbierto) return;
  const valorStr = document.getElementById('modal-valor').value.trim();
  if (valorStr === '') { showToast('Ingresa un valor'); return; }

  const valor = parseFloat(valorStr);
  if (isNaN(valor)) { showToast('Valor inválido'); return; }

  const nota = document.getElementById('modal-nota').value.trim();
  const hoy = new Date().toISOString().split('T')[0];

  const { error } = await db.from('mediciones').insert({
    indicador_id: kpiAbierto.id,
    valor_real: valor,
    fecha: hoy,
    nota: nota || null,
  });

  if (error) { showToast('Error al guardar ✕'); return; }

  showToast('✓ Medición guardada');
  cerrarModal();
  await cargarBSC();
});

// ---- TOAST ----
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
