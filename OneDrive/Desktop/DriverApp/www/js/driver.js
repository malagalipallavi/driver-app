let isTracking = false;
let watchId    = null;
let gpsCount   = 0;
let selBus     = '';
let selTrip    = '';
let gpsBuffer  = [];
let routeStopIndex = 0;

setInterval(() => {
  const n = new Date();
  document.getElementById('clock').innerText =
    String(n.getHours()).padStart(2,'0') + ':' +
    String(n.getMinutes()).padStart(2,'0');
}, 1000);

setInterval(() => {
  if (isTracking && !watchId) startWatching();
}, 3000);

function onTripChange() {
  selTrip = document.getElementById('tripSelect').value;
  selBus  = '';
  if (isTracking) stopTracking();
  const busSelect = document.getElementById('busSelect');
  busSelect.innerHTML = '<option value="">— Select your bus —</option>';
  if (!selTrip) return;
  (SHIFT_BUSES[selTrip] || []).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.label;
    busSelect.appendChild(opt);
  });
  document.getElementById('routeList').innerHTML =
    '<p style="color:#888;font-size:0.85rem">Select your bus to see route</p>';
  document.getElementById('nextStop').innerText  = '—';
  document.getElementById('shareLink').innerText = 'Select a bus to generate link';
}

function onBusChange() {
  selBus = document.getElementById('busSelect').value;
  routeStopIndex = 0;
  if (!selBus || !selTrip) return;
  const stops = ROUTE_STOPS[selBus] || [];
  document.getElementById('nextStop').innerText = stops[stops.length - 1] || '—';
  document.getElementById('routeList').innerHTML = stops.map((name, i) => `
    <div class="rstop" id="stop-${i}">
      <div class="sdot ${i === 0 ? 'cur' : ''}"></div>
      <div class="sname">${name}</div>
      <div class="sstatus ${i === 0 ? 'here' : ''}">${i === 0 ? '● Here' : 'Upcoming'}</div>
    </div>
  `).join('');
  document.getElementById('shareLink').innerText =
    `college-bus-tracker-alpha.vercel.app/index.html?bus=${selBus}`;
}

function toggleTracking() {
  if (!selBus)  { alert('Please select your bus first!');   return; }
  if (!selTrip) { alert('Please select your shift first!'); return; }
  isTracking ? stopTracking() : startTracking();
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    if (wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', async () => {
      wakeLock = null;
      if (isTracking) await requestWakeLock();
    });
  } catch (err) {}
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isTracking) {
    await requestWakeLock();
    if (!watchId) startWatching();
  }
});

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
  const stops = ROUTE_STOPS[selBus] || [];
  if (!stops.length) return routeStopIndex;

  // Find nearest stop from current position
  let nearestIdx  = routeStopIndex;
  let nearestDist = Infinity;

  // Only look forward from current index — never go back
  for (let i = routeStopIndex; i < stops.length; i++) {
    const coord = STOP_COORDS[stops[i]];
    if (!coord) continue;
    const d = getDistance(lat, lng, coord.lat, coord.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx  = i;
    }
  }

  return nearestIdx;
}

function getDb() {
  if (typeof db !== 'undefined') return db;
  try { return firebase.database(); } catch(e) { return null; }
}

let isFirstFix = true;

function startWatching() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: rawLat, longitude: rawLng, heading, speed, accuracy } = pos.coords;

      document.getElementById('gpsVal').innerText = accuracy > 100
        ? '⚠️ GPS: ' + Math.round(accuracy) + 'm — Move outdoors'
        : '✅ ' + Math.round(accuracy) + 'm — ' +
          rawLat.toFixed(5) + ', ' + rawLng.toFixed(5);

      gpsCount++;
      document.getElementById('gpsCount').innerText = gpsCount;

      const { lat, lng } = getSmoothedLocation(rawLat, rawLng);

      if (isFirstFix) {
        isFirstFix = false;
        // On first fix scan ALL stops to find nearest
        const stops = ROUTE_STOPS[selBus] || [];
        let nearestIdx = 0, nearestDist = Infinity;
        stops.forEach((name, i) => {
          const coord = STOP_COORDS[name];
          if (!coord) return;
          const d = getDistance(lat, lng, coord.lat, coord.lng);
          if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        });
        routeStopIndex = nearestIdx;
        updateStopProgress(routeStopIndex);
      } else {
        // After first fix — only look forward
        const newIndex = computeStopIndex(lat, lng);
        if (newIndex > routeStopIndex) {
          routeStopIndex = newIndex;
        }
        updateStopProgress(routeStopIndex);
      }

      const database = getDb();
      if (!database) {
        document.getElementById('gpsVal').innerText = '❌ Firebase not ready';
        return;
      }

      database.ref('liveLocation/' + selBus).set({
        lat, lng,
        heading:   heading  || 0,
        speed:     speed    || 0,
        accuracy,
        trip:      selTrip,
        stopIndex: routeStopIndex,
        updatedAt: Date.now(),
      }).catch(err => {
        document.getElementById('gpsVal').innerText =
          '❌ Firebase error: ' + err.message;
      });
    },
    err => {
      document.getElementById('gpsVal').innerText = 'GPS Error: ' + err.message;
      watchId = null;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function startTracking() {
  isTracking     = true;
  isFirstFix     = true;
  gpsBuffer      = [];
  gpsCount       = 0;
  routeStopIndex = 0;

  document.getElementById('bigCircle').classList.add('live');
  document.getElementById('ctext').innerText    = 'SHARING LIVE';
  document.getElementById('badge').classList.add('live');
  document.getElementById('bdot').classList.add('live');
  document.getElementById('btext').innerText    = 'Location LIVE';
  document.getElementById('gpsCount').innerText = '0';

  requestWakeLock();

  const database = getDb();
  if (database) {
    database.ref('liveLocation/' + selBus).onDisconnect().cancel();
  }

  startWatching();
}

function stopTracking() {
  isTracking = false;
  isFirstFix = true;
  gpsBuffer  = [];
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  const database = getDb();
  if (database) {
    database.ref('liveLocation/' + selBus + '/isActive').set(false);
  }
  document.getElementById('bigCircle').classList.remove('live');
  document.getElementById('ctext').innerText    = 'TAP TO SHARE';
  document.getElementById('badge').classList.remove('live');
  document.getElementById('bdot').classList.remove('live');
  document.getElementById('btext').innerText    = 'Location OFF';
  document.getElementById('gpsVal').innerText   = 'Not sharing';
  document.getElementById('gpsCount').innerText = '0';
  gpsCount = 0;
}

function updateStopProgress(currentIndex) {
  const stops = ROUTE_STOPS[selBus] || [];
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