/* ============================================================
   driver.js — Driver panel logic (native background GPS)
   ============================================================ */

let isTracking = false;
let watchId    = null;   // Capacitor watcher id (string)
let gpsCount   = 0;
let selBus     = '';
let selTrip    = '';
let gpsBuffer  = [];
let routeStopIndex = 0;
let isFirstFix = true;

// ── Clock ────────────────────────────────────────────────────
setInterval(() => {
  const clockEl = document.getElementById('clock');
  if (clockEl) {
    const n = new Date();
    clockEl.innerText =
      String(n.getHours()).padStart(2,'0') + ':' +
      String(n.getMinutes()).padStart(2,'0');
  }
}, 1000);

// ── Trip / Bus selection ────────────────────────────────────
function onTripChange() {
  selTrip = document.getElementById('tripSelect')?.value || '';
  selBus  = '';
  if (isTracking) stopTracking();
  
  const busSelect = document.getElementById('busSelect');
  if (!busSelect) return;
  
  busSelect.innerHTML = '<option value="">— Select your bus —</option>';
  if (!selTrip) return;
  
  ((typeof SHIFT_BUSES !== 'undefined' && SHIFT_BUSES[selTrip]) || []).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.label;
    busSelect.appendChild(opt);
  });
  
  if (document.getElementById('routeList')) {
    document.getElementById('routeList').innerHTML =
      '<p style="color:#888;font-size:0.85rem">Select your bus to see route</p>';
  }
  if (document.getElementById('nextStop')) document.getElementById('nextStop').innerText  = '—';
  if (document.getElementById('shareLink')) document.getElementById('shareLink').innerText = 'Select a bus to generate link';
}

function onBusChange() {
  selBus = document.getElementById('busSelect')?.value || '';
  routeStopIndex = 0;
  if (!selBus || !selTrip) return;
  
  const stops = (typeof ROUTE_STOPS !== 'undefined' && ROUTE_STOPS[selBus]) || [];
  if (document.getElementById('nextStop')) {
    document.getElementById('nextStop').innerText = stops[stops.length - 1] || '—';
  }
  
  if (document.getElementById('routeList')) {
    document.getElementById('routeList').innerHTML = stops.map((name, i) => `
      <div class="rstop" id="stop-${i}">
        <div class="sdot ${i === 0 ? 'cur' : ''}"></div>
        <div class="sname">${name}</div>
        <div class="sstatus ${i === 0 ? 'here' : ''}">${i === 0 ? '● Here' : 'Upcoming'}</div>
      </div>
    `).join('');
  }
  
  if (document.getElementById('shareLink')) {
    document.getElementById('shareLink').innerText =
      `college-bus-tracker-alpha.vercel.app/index.html?bus=${selBus}`;
  }
}

function toggleTracking() {
  if (!selBus)  { alert('Please select your bus first!');   return; }
  if (!selTrip) { alert('Please select your shift first!'); return; }
  isTracking ? stopTracking() : startTracking();
}

// ── GPS smoothing ───────────────────────────────────────────
function getSmoothedLocation(lat, lng) {
  gpsBuffer.push({ lat, lng });
  if (gpsBuffer.length > 2) gpsBuffer.shift();
  return {
    lat: gpsBuffer.reduce((a, b) => a + b.lat, 0) / gpsBuffer.length,
    lng: gpsBuffer.reduce((a, b) => a + b.lng, 0) / gpsBuffer.length
  };
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(lat1*Math.PI/180) *
               Math.cos(lat2*Math.PI/180) *
               Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function computeStopIndex(lat, lng) {
  const stops = (typeof ROUTE_STOPS !== 'undefined' && ROUTE_STOPS[selBus]) || [];
  if (!stops.length) return routeStopIndex;
  let nearestIdx  = routeStopIndex;
  let nearestDist = Infinity;
  for (let i = routeStopIndex; i < stops.length; i++) {
    const coord = (typeof STOP_COORDS !== 'undefined') ? STOP_COORDS[stops[i]] : null;
    if (!coord) continue;
    const d = getDistance(lat, lng, coord.lat, coord.lng);
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }
  return nearestIdx;
}

function getDb() {
  if (typeof db !== 'undefined' && db) return db;
  try { return firebase.database(); } catch(e) { return null; }
}

// ── Shared position handler — called by native watcher ───────
function handlePosition(location) {
  const rawLat   = location.latitude;
  const rawLng   = location.longitude;
  const heading  = location.bearing  || 0;
  const speed    = location.speed    || 0;
  const accuracy = location.accuracy || 0;

  const gpsValEl = document.getElementById('gpsVal');
  if (gpsValEl) {
    gpsValEl.innerText = accuracy > 100
      ? '⚠️ GPS: ' + Math.round(accuracy) + 'm — Move outdoors'
      : '✅ ' + Math.round(accuracy) + 'm — ' +
        rawLat.toFixed(5) + ', ' + rawLng.toFixed(5) + ' 🔥';
  }

  gpsCount++;
  if (document.getElementById('gpsCount')) {
    document.getElementById('gpsCount').innerText = gpsCount;
  }

  const { lat, lng } = getSmoothedLocation(rawLat, rawLng);

  if (isFirstFix) {
    isFirstFix = false;
    const stops = (typeof ROUTE_STOPS !== 'undefined' && ROUTE_STOPS[selBus]) || [];
    let nearestIdx = 0, nearestDist = Infinity;
    stops.forEach((name, i) => {
      const coord = (typeof STOP_COORDS !== 'undefined') ? STOP_COORDS[name] : null;
      if (!coord) return;
      const d = getDistance(lat, lng, coord.lat, coord.lng);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    });
    routeStopIndex = nearestIdx;
    updateStopProgress(routeStopIndex);
  } else {
    const newIndex = computeStopIndex(lat, lng);
    if (newIndex > routeStopIndex) routeStopIndex = newIndex;
    updateStopProgress(routeStopIndex);
  }

  const database = getDb();
  if (!database) {
    if (gpsValEl) gpsValEl.innerText = '❌ Firebase not ready';
    return;
  }

  // Explicitly setting isActive: true so Student Panel stays ONLINE during calls
  database.ref('liveLocation/' + selBus).set({
    lat, lng,
    heading, speed, accuracy,
    trip:      selTrip,
    stopIndex: routeStopIndex,
    isActive:  true,
    updatedAt: Date.now(),
  }).catch(err => {
    if (gpsValEl) gpsValEl.innerText = '❌ Firebase error: ' + err.message;
  });
}

// ── Native background watcher ────────────────────────────────
async function startWatching() {
  if (watchId) return;

  try {
    const { BackgroundGeolocation } = window.Capacitor.Plugins;

    watchId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'KLS GIT Bus Tracker is sharing your location',
        backgroundTitle:   'Location sharing active',
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,   // metres — fires an update every 5m of movement
      },
      (location, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            if (confirm('Location access is required. Open Settings to allow "Always Allow" location?')) {
              BackgroundGeolocation.openSettings();
            }
          } else {
            const gpsValEl = document.getElementById('gpsVal');
            if (gpsValEl) gpsValEl.innerText = 'GPS Error: ' + error.message;
          }
          return;
        }
        if (location) handlePosition(location);
      }
    );
  } catch (err) {
    const gpsValEl = document.getElementById('gpsVal');
    if (gpsValEl) gpsValEl.innerText = 'GPS init error: ' + err.message;
    watchId = null;
  }
}

async function stopWatching() {
  if (!watchId) return;
  try {
    const { BackgroundGeolocation } = window.Capacitor.Plugins;
    await BackgroundGeolocation.removeWatcher({ id: watchId });
  } catch (err) {}
  watchId = null;
}

// ── Start / Stop tracking ────────────────────────────────────
function startTracking() {
  isTracking     = true;
  isFirstFix     = true;
  gpsBuffer      = [];
  gpsCount       = 0;
  routeStopIndex = 0;

  document.getElementById('bigCircle')?.classList.add('live');
  if (document.getElementById('ctext')) document.getElementById('ctext').innerText = 'SHARING LIVE';
  document.getElementById('badge')?.classList.add('live');
  document.getElementById('bdot')?.classList.add('live');
  if (document.getElementById('btext')) document.getElementById('btext').innerText = 'Location LIVE';
  if (document.getElementById('gpsCount')) document.getElementById('gpsCount').innerText = '0';

  const database = getDb();
  if (database && selBus) {
    // If phone disconnects network during call, set bus inactive on disconnect
    database.ref('liveLocation/' + selBus + '/isActive').onDisconnect().set(false);
  }

  startWatching();
}

function stopTracking() {
  isTracking = false;
  isFirstFix = true;
  gpsBuffer  = [];

  stopWatching();

  const database = getDb();
  if (database && selBus) {
    database.ref('liveLocation/' + selBus + '/isActive').set(false);
  }

  document.getElementById('bigCircle')?.classList.remove('live');
  if (document.getElementById('ctext')) document.getElementById('ctext').innerText = 'TAP TO SHARE';
  document.getElementById('badge')?.classList.remove('live');
  document.getElementById('bdot')?.classList.remove('live');
  if (document.getElementById('btext')) document.getElementById('btext').innerText = 'Location OFF';
  if (document.getElementById('gpsVal')) document.getElementById('gpsVal').innerText = 'Not sharing';
  if (document.getElementById('gpsCount')) document.getElementById('gpsCount').innerText = '0';
  gpsCount = 0;
}

// ── Route progress dots ──────────────────────────────────────
function updateStopProgress(currentIndex) {
  const stops = (typeof ROUTE_STOPS !== 'undefined' && ROUTE_STOPS[selBus]) || [];
  stops.forEach((name, i) => {
    const dot    = document.querySelector(`#stop-${i} .sdot`);
    const status = document.querySelector(`#stop-${i} .sstatus`);
    if (!dot || !status) return;
    if (i < currentIndex) {
      dot.style.background = '#f59e0b';
      status.innerText     = '✓ Passed';
      status.style.color   = '#f59e0b';
    } else if (i === currentIndex) {
      dot.style.background = '#1a73e8';
      status.innerText     = '● Here';
      status.style.color   = '#1a73e8';
    } else {
      dot.style.background = '#ccc';
      status.innerText     = 'Upcoming';
      status.style.color   = '#888';
    }
  });
}