(() => {
  const lines = window.SHANGHAI_RAIL_LINES || [];
  const apiBase = 'https://openstreetmap.tools/public_transport_geojson/api';
  const home = { center: [31.225, 121.49], zoom: 9.6 };

  const map = L.map('map', {
    center: home.center,
    zoom: home.zoom,
    minZoom: 8,
    maxZoom: 18,
    preferCanvas: true
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  map.createPane('railHalo');
  map.getPane('railHalo').style.zIndex = 410;
  map.createPane('railLine');
  map.getPane('railLine').style.zIndex = 420;
  map.createPane('railStation');
  map.getPane('railStation').style.zIndex = 430;

  const states = new Map();
  const stationLayer = L.layerGroup();
  const stations = new Map();
  const bounds = L.latLngBounds();
  let stationMode = false;
  let toastTimer;

  const lineList = document.getElementById('line-list');
  const networkStatus = document.getElementById('network-status');
  const stationToggle = document.getElementById('station-toggle');
  const homeButton = document.getElementById('home-button');
  const toggleAll = document.getElementById('toggle-all');
  const toast = document.getElementById('toast');

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function readableText(hex) {
    const raw = hex.replace('#', '');
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.68 ? '#202124' : '#fff';
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function updateStatus() {
    const all = [...states.values()];
    const ready = all.filter((state) => state.status === 'ready').length;
    const loading = all.filter((state) => state.status === 'loading').length;
    const pending = all.filter((state) => state.status === 'pending').length;
    const failed = all.filter((state) => state.status === 'error').length;

    if (loading) networkStatus.textContent = `正在载入 ${ready}/${lines.length - pending} 条线路…`;
    else if (failed) networkStatus.textContent = `已载入 ${ready} 条，${failed} 条暂时失败`;
    else if (pending) networkStatus.textContent = `已载入 ${ready} 条 · ${pending} 条待补数据`;
    else networkStatus.textContent = `已载入 ${ready} 条线路 · OSM 地理几何`;
  }

  function buildButtons() {
    for (const line of lines) {
      const item = document.createElement('div');
      item.className = 'line-item';
      item.dataset.category = line.category;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'line-button is-loading';
      button.title = line.name;
      button.innerHTML = `
        <span class="line-badge" style="background:${line.color};color:${readableText(line.color)}">${escapeHtml(line.badge || line.id)}</span>
        <span class="line-name">${escapeHtml(line.name)}</span>
      `;

      const state = {
        line,
        item,
        button,
        group: L.layerGroup().addTo(map),
        visible: true,
        status: 'loading',
        routeIds: [],
        stops: [],
        stationsLoaded: false
      };

      button.addEventListener('click', () => {
        state.visible = !state.visible;
        button.classList.toggle('is-hidden', !state.visible);
        if (state.visible) state.group.addTo(map);
        else map.removeLayer(state.group);
        updateToggleAllLabel();
      });

      item.appendChild(button);
      lineList.appendChild(item);
      states.set(line.id, state);
    }
  }

  function updateToggleAllLabel() {
    toggleAll.textContent = [...states.values()].some((state) => state.visible) ? '全部隐藏' : '全部显示';
  }

  async function getJson(url, timeout = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function drawGeometry(state, geojson) {
    if (!geojson?.features?.length) return false;
    const collection = {
      type: 'FeatureCollection',
      features: geojson.features.filter((feature) => ['LineString', 'MultiLineString'].includes(feature?.geometry?.type))
    };
    if (!collection.features.length) return false;

    const halo = L.geoJSON(collection, {
      pane: 'railHalo',
      style: {
        color: '#fff',
        weight: 9,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }
    });
    const rail = L.geoJSON(collection, {
      pane: 'railLine',
      style: {
        color: state.line.color,
        weight: 5.6,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round'
      }
    });

    halo.addTo(state.group);
    rail.addTo(state.group);
    const railBounds = rail.getBounds();
    if (railBounds.isValid()) bounds.extend(railBounds);
    return true;
  }

  async function loadRoute(state, routeId) {
    const data = await getJson(`${apiBase}/route/${routeId}`);
    state.routeIds.push(routeId, ...(data.other_directions || []).map((route) => route.id));
    state.stops.push(...(data.stops || []));
    return drawGeometry(state, data.geojson);
  }

  async function loadMaster(state, masterId) {
    try {
      const data = await getJson(`${apiBase}/route_master/${masterId}`);
      const routes = Array.isArray(data.routes) ? data.routes : [];
      let drawn = false;
      for (const route of routes) {
        if (route.id) state.routeIds.push(route.id);
        drawn = drawGeometry(state, route.geojson) || drawn;
      }
      if (!drawn) throw new Error('empty route master');
      return true;
    } catch (masterError) {
      return loadRoute(state, masterId);
    }
  }

  async function loadLine(line) {
    const state = states.get(line.id);
    try {
      let drawn = false;
      if (line.routeMasterId) drawn = await loadMaster(state, line.routeMasterId);
      else if (line.routeId) drawn = await loadRoute(state, line.routeId);
      else {
        state.status = 'pending';
        state.button.classList.remove('is-loading');
        state.button.title = `${line.name}：待补 OSM relation`;
        updateStatus();
        return;
      }

      if (!drawn) throw new Error('no geometry');
      state.status = 'ready';
      state.button.classList.remove('has-error');
      if (stationMode) await loadStations(state);
    } catch (error) {
      console.warn(`${line.name} load failed`, error);
      state.status = 'error';
      state.button.classList.add('has-error');
      state.button.title = `${line.name}：数据源暂时不可用`;
    } finally {
      state.button.classList.remove('is-loading');
      updateStatus();
    }
  }

  function stationKey(stop) {
    const name = String(stop.name || '').trim();
    return name || `${Number(stop.lat).toFixed(5)},${Number(stop.lon).toFixed(5)}`;
  }

  function popupHtml(entry) {
    const badges = [...entry.lineIds]
      .map((id) => states.get(id)?.line)
      .filter(Boolean)
      .map((line) => `<span class="station-line-badge" style="background:${line.color};color:${readableText(line.color)}">${escapeHtml(line.name)}</span>`)
      .join('');
    return `<div class="station-popup"><strong>${escapeHtml(entry.name || '车站')}</strong><div class="station-lines">${badges}</div></div>`;
  }

  function updateStation(entry) {
    const transfer = entry.lineIds.size > 1;
    entry.marker.setIcon(L.divIcon({
      className: `rail-station-icon${transfer ? ' is-transfer' : ''}`,
      html: '<span></span>',
      iconSize: [15, 15],
      iconAnchor: [7.5, 7.5]
    }));
    entry.marker.bindPopup(popupHtml(entry), { closeButton: false, offset: [0, -3] });
  }

  function registerStops(state, stops) {
    for (const stop of stops) {
      const lat = Number(stop.lat);
      const lon = Number(stop.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = stationKey(stop);
      let entry = stations.get(key);
      if (!entry) {
        const marker = L.marker([lat, lon], {
          pane: 'railStation',
          keyboard: false,
          icon: L.divIcon({ className: 'rail-station-icon', html: '<span></span>', iconSize: [15, 15], iconAnchor: [7.5, 7.5] })
        }).addTo(stationLayer);
        entry = { name: stop.name || '', marker, lineIds: new Set() };
        stations.set(key, entry);
      }
      entry.lineIds.add(state.line.id);
      updateStation(entry);
    }
  }

  async function loadStations(state) {
    if (state.stationsLoaded || state.status !== 'ready') return;
    state.stationsLoaded = true;
    registerStops(state, state.stops);
    for (const routeId of [...new Set(state.routeIds)].slice(0, 6)) {
      try {
        const data = await getJson(`${apiBase}/route/${routeId}`, 22000);
        registerStops(state, data.stops || []);
      } catch (error) {
        console.warn(`${state.line.name} station data failed`, error);
      }
    }
  }

  async function enableStations() {
    stationLayer.addTo(map);
    stationToggle.textContent = '车站载入中…';
    const ready = [...states.values()].filter((state) => state.status === 'ready');
    for (let i = 0; i < ready.length; i += 2) {
      await Promise.allSettled(ready.slice(i, i + 2).map(loadStations));
    }
    stationToggle.textContent = '车站标注';
    showToast(`已整理 ${stations.size} 个车站标注`);
  }

  buildButtons();

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('is-active'));
      chip.classList.add('is-active');
      const filter = chip.dataset.filter;
      for (const state of states.values()) {
        state.item.classList.toggle('is-filtered', filter !== 'all' && state.line.category !== filter);
      }
    });
  });

  toggleAll.addEventListener('click', () => {
    const shouldShow = ![...states.values()].some((state) => state.visible);
    for (const state of states.values()) {
      state.visible = shouldShow;
      state.button.classList.toggle('is-hidden', !shouldShow);
      if (shouldShow) state.group.addTo(map);
      else map.removeLayer(state.group);
    }
    updateToggleAllLabel();
  });

  stationToggle.addEventListener('click', async () => {
    stationMode = !stationMode;
    stationToggle.setAttribute('aria-pressed', String(stationMode));
    if (stationMode) await enableStations();
    else map.removeLayer(stationLayer);
  });

  homeButton.addEventListener('click', () => {
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.03), { maxZoom: 9.8, animate: true });
    else map.setView(home.center, home.zoom, { animate: true });
  });

  (async () => {
    for (let i = 0; i < lines.length; i += 3) {
      await Promise.allSettled(lines.slice(i, i + 3).map(loadLine));
    }
    updateStatus();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.03), { maxZoom: 9.8 });
  })();
})();
