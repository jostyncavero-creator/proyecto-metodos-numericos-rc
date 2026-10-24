'use strict';

let measurements = [];
let voltageChart = null;
let derivativeChart = null;
let latestSummary = [];

const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 6) => Number.isFinite(n) ? Number(n).toFixed(digits) : 'No disponible';
const normalize = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[()]/g, '').replace(/\s+/g, '_');

function setStatus(message, type = '') {
  const el = $('fileStatus');
  el.textContent = message;
  el.className = `status ${type}`.trim();
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length < 3) throw new Error('El CSV debe contener una cabecera y al menos dos filas de datos.');
  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const headers = lines[0].split(delimiter).map(normalize);
  const findIndex = (choices) => headers.findIndex(h => choices.includes(h));
  const phaseIndex = findIndex(['fase', 'phase', 'tipo']);
  const timeIndex = findIndex(['tiempo_s', 'time_s', 'tiempo', 'time', 't_s', 't']);
  const voltageIndex = findIndex(['voltaje_v', 'voltage_v', 'voltaje', 'voltage', 'vc_v', 'vc', 'v']);
  if (phaseIndex < 0 || timeIndex < 0 || voltageIndex < 0) {
    throw new Error('No encuentro las columnas. Usa una cabecera como: fase,tiempo_s,voltaje_V');
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(v => v.trim());
    if (cols.length <= Math.max(phaseIndex, timeIndex, voltageIndex)) continue;
    const phaseText = normalize(cols[phaseIndex]);
    let phase = null;
    if (['carga', 'charge', 'charging'].includes(phaseText)) phase = 'carga';
    if (['descarga', 'discharge', 'discharging'].includes(phaseText)) phase = 'descarga';
    const t = Number(cols[timeIndex]);
    const v = Number(cols[voltageIndex]);
    if (phase && Number.isFinite(t) && Number.isFinite(v) && t >= 0) rows.push({ phase, t, v });
  }
  if (rows.length < 4) throw new Error('No hay suficientes filas válidas. Verifica fase, tiempo y voltaje.');
  const phases = new Set(rows.map(r => r.phase));
  if (!phases.has('carga') || !phases.has('descarga')) {
    throw new Error('El CSV debe contener datos de las dos fases: carga y descarga.');
  }
  rows.sort((a, b) => a.phase.localeCompare(b.phase) || a.t - b.t);
  return rows;
}

function getParams() {
  const R = Number($('resistance').value);
  const Cmicro = Number($('capacitance').value);
  const Vs = Number($('supply').value);
  if (!(R > 0) || !(Cmicro > 0) || !(Vs > 0) || ![R, Cmicro, Vs].every(Number.isFinite)) {
    throw new Error('R, C y Vs deben ser números positivos.');
  }
  const C = Cmicro * 1e-6;
  return { R, Cmicro, C, Vs, tau: R * C };
}

function phaseRows(phase) { return measurements.filter(r => r.phase === phase).sort((a, b) => a.t - b.t); }
function v0ForDischarge(rows) { return rows.length ? rows[0].v : 0; }
function theory(phase, t, p, v0) {
  return phase === 'carga' ? p.Vs * (1 - Math.exp(-t / p.tau)) : v0 * Math.exp(-t / p.tau);
}
function nearestRows(rows, x, count) {
  return [...rows].sort((a, b) => Math.abs(a.t - x) - Math.abs(b.t - x)).slice(0, Math.min(count, rows.length)).sort((a, b) => a.t - b.t);
}
function interpolateLinear(rows, x) {
  const data = [...rows].sort((a, b) => a.t - b.t);
  if (x < data[0].t || x > data[data.length - 1].t) throw new Error('El tiempo de interpolación debe estar dentro del intervalo medido.');
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i], b = data[i + 1];
    if (x >= a.t && x <= b.t) return a.v + (b.v - a.v) * (x - a.t) / (b.t - a.t);
  }
  return data[data.length - 1].v;
}
function lagrange(rows, x, count = 3) {
  const points = nearestRows(rows, x, count);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    let term = points[i].v;
    for (let j = 0; j < points.length; j++) if (j !== i) term *= (x - points[j].t) / (points[i].t - points[j].t);
    sum += term;
  }
  return sum;
}
function newtonInterpolation(rows, x, count = 4) {
  const points = nearestRows(rows, x, count);
  const xs = points.map(p => p.t);
  const coef = points.map(p => p.v);
  for (let j = 1; j < coef.length; j++) {
    for (let i = coef.length - 1; i >= j; i--) {
      const denominator = xs[i] - xs[i - j];
      if (denominator === 0) throw new Error('Hay tiempos repetidos; no se puede interpolar.');
      coef[i] = (coef[i] - coef[i - 1]) / denominator;
    }
  }
  let result = coef[coef.length - 1];
  for (let i = coef.length - 2; i >= 0; i--) result = coef[i] + (x - xs[i]) * result;
  return result;
}
function bisect(f, a, b, tol = 1e-8, maxIter = 200) {
  let fa = f(a), fb = f(b);
  if (fa === 0) return { root: a, iterations: 0 };
  if (fb === 0) return { root: b, iterations: 0 };
  if (fa * fb > 0) throw new Error('Bisección: el intervalo no encierra una raíz. Aumenta el tiempo máximo medido.');
  let mid = (a + b) / 2;
  for (let i = 1; i <= maxIter; i++) {
    mid = (a + b) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tol || Math.abs(b - a) / 2 < tol) return { root: mid, iterations: i };
    if (fa * fm < 0) { b = mid; fb = fm; } else { a = mid; fa = fm; }
  }
  return { root: mid, iterations: maxIter };
}
function newtonRoot(f, df, x, tol = 1e-8, maxIter = 100) {
  for (let i = 1; i <= maxIter; i++) {
    const fx = f(x), dfx = df(x);
    if (!Number.isFinite(fx) || !Number.isFinite(dfx) || Math.abs(dfx) < 1e-12) throw new Error('Newton-Raphson falló: derivada cercana a cero o valor no válido.');
    const next = x - fx / dfx;
    if (!Number.isFinite(next)) throw new Error('Newton-Raphson produjo un valor no válido.');
    if (Math.abs(next - x) < tol) return { root: next, iterations: i };
    x = next;
  }
  return { root: x, iterations: maxIter };
}
function secantRoot(f, x0, x1, tol = 1e-8, maxIter = 100) {
  let f0 = f(x0), f1 = f(x1);
  for (let i = 1; i <= maxIter; i++) {
    const denominator = f1 - f0;
    if (Math.abs(denominator) < 1e-12) throw new Error('Secante falló: denominador demasiado pequeño.');
    const x2 = x1 - f1 * (x1 - x0) / denominator;
    if (!Number.isFinite(x2)) throw new Error('Secante produjo un valor no válido.');
    if (Math.abs(x2 - x1) < tol) return { root: x2, iterations: i };
    x0 = x1; f0 = f1; x1 = x2; f1 = f(x1);
  }
  return { root: x1, iterations: maxIter };
}
function crossingTime(rows, target) {
  const data = [...rows].sort((a, b) => a.t - b.t);
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i], b = data[i + 1];
    if ((a.v - target) === 0) return a.t;
    if ((a.v - target) * (b.v - target) <= 0 && a.v !== b.v) {
      return a.t + (target - a.v) * (b.t - a.t) / (b.v - a.v);
    }
  }
  return null;
}
function derivativeData(rows) {
  const data = [...rows].sort((a, b) => a.t - b.t);
  return data.map((p, i) => {
    let slope;
    if (i === 0) slope = (data[1].v - data[0].v) / (data[1].t - data[0].t);
    else if (i === data.length - 1) slope = (data[i].v - data[i - 1].v) / (data[i].t - data[i - 1].t);
    else slope = (data[i + 1].v - data[i - 1].v) / (data[i + 1].t - data[i - 1].t);
    return { x: p.t, y: slope };
  });
}
function simpson(points, f) {
  // Simpson 1/3 compuesto. Si hay número impar de intervalos, usa trapecio al final.
  // Los datos del Arduino tienen una pequeña variación temporal; por ello, integra cada
  // par de intervalos mediante la fórmula de Simpson para nodos no uniformes.
  const n = points.length - 1;
  if (n < 2) return null;
  let result = 0;
  let i = 0;
  for (; i + 2 <= n; i += 2) {
    const x0 = points[i].t, x1 = points[i + 1].t, x2 = points[i + 2].t;
    const h0 = x1 - x0, h1 = x2 - x1;
    if (!(h0 > 0) || !(h1 > 0)) throw new Error('Los tiempos deben ser estrictamente crecientes para integrar.');
    const y0 = f(points[i]), y1 = f(points[i + 1]), y2 = f(points[i + 2]);
    result += (h0 + h1) / 6 * ((2 - h1 / h0) * y0 + ((h0 + h1) ** 2 / (h0 * h1)) * y1 + (2 - h0 / h1) * y2);
  }
  if (i < n) {
    const h = points[i + 1].t - points[i].t;
    result += h * (f(points[i]) + f(points[i + 1])) / 2;
  }
  return result;
}
function trapezoid(points, f) {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const h = points[i + 1].t - points[i].t;
    sum += h * (f(points[i]) + f(points[i + 1])) / 2;
  }
  return sum;
}
function renderResults(id, rows) { $(id).replaceChildren(...rows); }
function resultRow(label, value) {
  const div = document.createElement('div'); div.className = 'result-row';
  const span = document.createElement('span'); span.textContent = label;
  const strong = document.createElement('strong'); strong.textContent = value;
  div.append(span, strong); return div;
}
function callout(htmlText) { const div = document.createElement('div'); div.className = 'result-callout'; div.textContent = htmlText; return div; }

function drawVoltageChart(p) {
  const charge = phaseRows('carga');
  const discharge = phaseRows('descarga');
  if (!charge.length || !discharge.length) return;
  const v0 = v0ForDischarge(discharge);
  const chargeMax = charge[charge.length - 1].t;
  const dischargeMax = discharge[discharge.length - 1].t;
  const curve = (phase, max, init) => {
    const end = Math.max(0, max);
    const n = Math.min(400, Math.max(30, Math.ceil(end / 0.02)));
    return Array.from({length:n+1}, (_,i) => { const t=end*i/n; return {x:t,y:theory(phase,t,p,init)}; });
  };
  if (voltageChart) voltageChart.destroy();
  voltageChart = new Chart($('voltageChart'), {
    type: 'scatter',
    data: { datasets: [
      {label:'Carga experimental', data:charge.map(r=>({x:r.t,y:r.v})), parsing:false, showLine:true, pointRadius:1.7, borderWidth:1.5},
      {label:'Carga teórica', data:curve('carga',chargeMax,p.Vs), parsing:false, showLine:true, pointRadius:0, borderWidth:2, borderDash:[6,4]},
      {label:'Descarga experimental', data:discharge.map(r=>({x:r.t,y:r.v})), parsing:false, showLine:true, pointRadius:1.7, borderWidth:1.5},
      {label:'Descarga teórica', data:curve('descarga',dischargeMax,v0), parsing:false, showLine:true, pointRadius:0, borderWidth:2, borderDash:[6,4]}
    ]},
    options: {responsive:true, maintainAspectRatio:false, interaction:{mode:'nearest',intersect:false}, plugins:{legend:{position:'bottom'}}, scales:{x:{type:'linear',title:{display:true,text:'Tiempo (s)'}},y:{title:{display:true,text:'Voltaje del capacitor (V)'}}}}
  });
  $('chartNote').textContent = `Carga: ${charge.length} muestras. Descarga: ${discharge.length} muestras. La curva teórica utiliza R=${fmt(p.R,2)} Ω, C=${fmt(p.Cmicro,2)} µF y Vs=${fmt(p.Vs,3)} V.`;
}

function analyze() {
  if (measurements.length === 0) { setStatus('Primero carga un archivo CSV o los datos de ejemplo.', 'error'); return; }
  try {
    const p = getParams();
    $('tauValue').textContent = `${fmt(p.tau, 6)} s`;
    drawVoltageChart(p);
    const phase = $('phaseSelect').value;
    const rows = phaseRows(phase);
    const x = Number($('interpTime').value);
    if (!Number.isFinite(x)) throw new Error('El tiempo de interpolación debe ser numérico.');

    // Interpolation values.
    try {
      const lin = interpolateLinear(rows, x);
      const lag = lagrange(rows, x, 3);
      const newt = newtonInterpolation(rows, x, 4);
      renderResults('interpolationResults', [
        resultRow('Interpolación lineal', `${fmt(lin,5)} V`),
        resultRow('Lagrange local (hasta 3 puntos)', `${fmt(lag,5)} V`),
        resultRow('Newton por diferencias divididas (hasta 4 puntos)', `${fmt(newt,5)} V`),
        callout('Se usan puntos cercanos al tiempo elegido. Evita extrapolar fuera del intervalo medido.')
      ]);
    } catch (e) { renderResults('interpolationResults', [callout(e.message)]); }

    // Root algorithms on the theoretical RC model.
    const discharge = phaseRows('descarga');
    const v0 = v0ForDischarge(discharge);
    const target = phase === 'carga' ? p.Vs * (1 - Math.exp(-1)) : v0 * Math.exp(-1);
    const f = t => theory(phase, t, p, v0) - target;
    const df = t => phase === 'carga' ? (p.Vs / p.tau) * Math.exp(-t/p.tau) : (-v0 / p.tau) * Math.exp(-t/p.tau);
    const maxT = rows[rows.length - 1].t;
    const rootRows = [];
    try {
      const b = bisect(f, 0, maxT);
      rootRows.push(resultRow('Bisección (modelo teórico)', `${fmt(b.root,6)} s · ${b.iterations} iter.`));
    } catch (e) { rootRows.push(resultRow('Bisección', e.message)); }
    try {
      const n = newtonRoot(f, df, Math.min(Math.max(p.tau * 0.5, 1e-6), maxT));
      rootRows.push(resultRow('Newton-Raphson (modelo teórico)', `${fmt(n.root,6)} s · ${n.iterations} iter.`));
    } catch (e) { rootRows.push(resultRow('Newton-Raphson', e.message)); }
    try {
      const s = secantRoot(f, 0, maxT);
      rootRows.push(resultRow('Secante (modelo teórico)', `${fmt(s.root,6)} s · ${s.iterations} iter.`));
    } catch (e) { rootRows.push(resultRow('Secante', e.message)); }
    const tExp = crossingTime(rows, target);
    rootRows.push(resultRow('Cruce experimental (interpolación lineal)', tExp === null ? 'No se encontró el cruce' : `${fmt(tExp,6)} s`));
    if (tExp !== null) rootRows.push(resultRow('Diferencia relativa frente a τ teórica', `${fmt(Math.abs(tExp-p.tau)/p.tau*100,3)} %`));
    rootRows.push(callout(`Voltaje objetivo para ${phase}: ${fmt(target,5)} V. El modelo teórico debe dar aproximadamente τ = ${fmt(p.tau,6)} s.`));
    renderResults('rootResults', rootRows);

    // Numerical derivative, forward/backward at endpoints and central differences in interior.
    const deriv = derivativeData(rows);
    if (derivativeChart) derivativeChart.destroy();
    derivativeChart = new Chart($('derivativeChart'), {type:'scatter',data:{datasets:[{label:`dVc/dt numérica — ${phase}`,data:deriv,parsing:false,showLine:true,pointRadius:1.5,borderWidth:1.6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{x:{type:'linear',title:{display:true,text:'Tiempo (s)'}},y:{title:{display:true,text:'dVc/dt (V/s)'}}}}});
    const mid = deriv[Math.floor(deriv.length/2)];
    const dTheory = phase === 'carga' ? (p.Vs/p.tau)*Math.exp(-mid.x/p.tau) : (-v0/p.tau)*Math.exp(-mid.x/p.tau);
    renderResults('derivativeResults', [
      resultRow('Muestras derivadas', String(deriv.length)),
      resultRow(`Derivada numérica cerca de t = ${fmt(mid.x,3)} s`, `${fmt(mid.y,6)} V/s`),
      resultRow('Derivada teórica en el mismo instante', `${fmt(dTheory,6)} V/s`),
      callout('Se usa diferencia hacia adelante y atrás en los extremos y diferencia central en los puntos interiores.')
    ]);

    // Current magnitude and integration.
    const current = rows.map(r => ({...r, i: phase === 'carga' ? Math.max(0, (p.Vs-r.v)/p.R) : Math.max(0, r.v/p.R)}));
    const trap = trapezoid(current, r => r.i);
    const simp = simpson(current, r => r.i);
    const idealQ = p.C * (phase === 'carga' ? Math.max(0, rows[rows.length-1].v - rows[0].v) : Math.max(0, rows[0].v - rows[rows.length-1].v));
    renderResults('integrationResults', [
      resultRow('Integral por trapecios', `${fmt(trap,8)} C`),
      resultRow('Integral por Simpson 1/3 (con trapecio final si hace falta)', simp === null ? 'Se requieren al menos 3 puntos' : `${fmt(simp,8)} C`),
      resultRow('Estimación Q ≈ C · |ΔV|', `${fmt(idealQ,8)} C`),
      resultRow('Diferencia trapecio vs. Q estimada', idealQ > 0 ? `${fmt(Math.abs(trap-idealQ)/idealQ*100,3)} %` : 'No disponible'),
      callout('La corriente se estima usando la caída de tensión en la resistencia. La comparación Q ≈ C·|ΔV| es aproximada y depende de la capacitancia efectiva.')
    ]);

    latestSummary = [
      ['parametro','valor','unidad'],['R',p.R,'ohm'],['C_nominal',p.Cmicro,'uF'],['Vs',p.Vs,'V'],['tau_teorica',p.tau,'s'],
      ['fase_analizada',phase,''],['tiempo_interpolacion',x,'s']
    ];
    const interpText = $('interpolationResults').innerText;
    const rootText = $('rootResults').innerText;
    const derivativeText = $('derivativeResults').innerText;
    const integrationText = $('integrationResults').innerText;
    latestSummary.push(['interpolacion','',interpText.replace(/\n/g,' | ')]);
    latestSummary.push(['raices','',rootText.replace(/\n/g,' | ')]);
    latestSummary.push(['derivacion','',derivativeText.replace(/\n/g,' | ')]);
    latestSummary.push(['integracion','',integrationText.replace(/\n/g,' | ')]);
    $('exportResults').disabled = false;
    setStatus(`Análisis completado: ${measurements.length} mediciones válidas.`, 'ok');
  } catch (e) {
    setStatus(e.message || 'Ocurrió un error al analizar los datos.', 'error');
  }
}

function renderTable() {
  const tbody = $('dataTable');
  tbody.replaceChildren();
  $('rowCount').textContent = `${measurements.length} mediciones`;
  if (!measurements.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan=3; td.className='muted'; td.textContent='No hay datos cargados.'; tr.append(td); tbody.append(tr); return;
  }
  const shown = measurements.slice(0, 600);
  shown.forEach(r => {
    const tr = document.createElement('tr');
    for (const val of [r.phase, fmt(r.t,5), fmt(r.v,5)]) { const td = document.createElement('td'); td.textContent = val; tr.append(td); }
    tbody.append(tr);
  });
  if (measurements.length > shown.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan=3; td.className='muted'; td.textContent=`Se muestran las primeras ${shown.length} filas; se procesaron ${measurements.length}.`; tr.append(td); tbody.append(tr);
  }
}

function loadText(text, filename = 'archivo CSV') {
  try {
    measurements = parseCSV(text);
    renderTable();
    setStatus(`Archivo leído: ${filename}. Se encontraron ${measurements.length} mediciones.`, 'ok');
    $('exportResults').disabled = true;
    analyze();
  } catch (e) {
    measurements = []; renderTable();
    setStatus(e.message || 'No se pudo leer el archivo.', 'error');
  }
}

function downloadCSV(filename, rows) {
  const text = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + text], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

$('csvFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try { loadText(await file.text(), file.name); } catch { setStatus('No se pudo leer el archivo seleccionado.', 'error'); }
});
$('loadSample').addEventListener('click', async () => {
  try { const response = await fetch('ejemplo_sintetico.csv'); if (!response.ok) throw new Error('No se pudo acceder al ejemplo'); loadText(await response.text(), 'ejemplo_sintetico.csv (sintético)'); }
  catch { setStatus('No se pudo cargar el ejemplo. Descarga el CSV y selecciónalo con el botón de archivo.', 'error'); }
});
$('analyze').addEventListener('click', analyze);
$('phaseSelect').addEventListener('change', () => { if (measurements.length) analyze(); });
$('resistance').addEventListener('change', () => { if (measurements.length) analyze(); });
$('capacitance').addEventListener('change', () => { if (measurements.length) analyze(); });
$('supply').addEventListener('change', () => { if (measurements.length) analyze(); });
$('interpTime').addEventListener('change', () => { if (measurements.length) analyze(); });
$('exportResults').addEventListener('click', () => { if (latestSummary.length) downloadCSV('resumen_analisis_RC.csv', latestSummary); });
$('capacitance').addEventListener('input', () => {
  const R = Number($('resistance').value), C = Number($('capacitance').value);
  if (R > 0 && C > 0) $('tauValue').textContent = `${fmt(R*C*1e-6,6)} s`;
});
$('resistance').addEventListener('input', () => {
  const R = Number($('resistance').value), C = Number($('capacitance').value);
  if (R > 0 && C > 0) $('tauValue').textContent = `${fmt(R*C*1e-6,6)} s`;
});
