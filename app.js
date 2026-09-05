(() => {
  const lines = window.SHANGHAI_RAIL_LINES || [];
  const osmApi = 'https://api.openstreetmap.org/api/0.6';
  const shanghaiMetroNetworkRelation = 6799988;
  const home = { center: [31.225, 121.49], zoom: 9.6 };

  const map = L.map('map', {
    center: home.center,
    zoom: home.zoom,
    minZoom: 8,
    maxZoom: 18,
    preferCanvas: true
  });

  L.maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/liberty'
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
    else networkStatus.textContent = `已载入 ${ready} 条线路 · OSM 真实轨道几何`;
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
        stationsLoaded: false,
        seenWayIds: new Set()
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
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function osmName(element) {
    const tags = element?.tags || {};
    return tags['name:zh-Hans'] || tags['name:zh'] || tags.name || tags['name:en'] || '';
  }

  function relationFromPayload(data, relationId) {
    return (data?.elements || []).find(
      (element) => element.type === 'relation' && Number(element.id) === Number(relationId)
    );
  }

  function routePayloadToGeoJSON(state, data, routeId) {
    const elements = Array.isArray(data?.elements) ? data.elements : [];
    const relation = relationFromPayload(data, routeId);
    if (!relation) return { geojson: null, stops: [] };

    const nodes = new Map();
    const ways = new Map();
    for (const element of elements) {
      if (element.type === 'node') nodes.set(element.id, element);
      else if (element.type === 'way') ways.set(element.id, element);
    }

    const features = [];
    const stops = [];

    for (const member of relation.members || []) {
      const role = String(member.role || '').toLowerCase();

      if (member.type === 'way') {
        if (role.includes('platform') || role.includes('stop')) continue;
        if (state.seenWayIds.has(member.ref)) continue;
        const way = ways.get(member.ref);
        if (!way?.nodes?.length) continue;
        const coordinates = way.nodes
          .map((nodeId) => nodes.get(nodeId))
          .filter((node) => Number.isFinite(node?.lon) && Number.isFinite(node?.lat))
          .map((node) => [node.lon, node.lat]);
        if (coordinates.length < 2) continue;
        state.seenWayIds.add(member.ref);
        features.push({
          type: 'Feature',
          properties: { wayId: member.ref },
          geometry: { type: 'LineString', coordinates }
        });
      }

      if (member.type === 'node' && (role.startsWith('stop') || role.startsWith('platform'))) {
        const node = nodes.get(member.ref);
        if (!Number.isFinite(node?.lat) || !Number.isFinite(node?.lon)) continue;
        stops.push({
          name: osmName(node),
          lat: node.lat,
          lon: node.lon
        });
      }
    }

    return {
      geojson: features.length ? { type: 'FeatureCollection', features } : null,
      stops
    };
  }

  function drawGeometry(state, geojson) {
    if (!geojson?.features?.length) return false;

    const halo = L.geoJSON(geojson, {
      pane: 'railHalo',
      style: {
        color: '#fff',
        weight: 9,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }
    });
    const rail = L.geoJSON(geojson, {
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
    const data = await getJson(`${osmApi}/relation/${routeId}/full.json`, 35000);
    const parsed = routePayloadToGeoJSON(state, data, routeId);
    if (!parsed.geojson) return false;
    state.routeIds.push(routeId);
    state.stops.push(...parsed.stops);
    return drawGeometry(state, parsed.geojson);
  }

  async function loadMaster(state, masterId) {
    const data = await getJson(`${osmApi}/relation/${masterId}.json`, 20000);
    const relation = relationFromPayload(data, masterId);
    const childRouteIds = [...new Set(
      (relation?.members || [])
        .filter((member) => member.type === 'relation')
        .map((member) => member.ref)
        .filter(Boolean)
    )];

    if (!childRouteIds.length) return loadRoute(state, masterId);

    let drawn = false;
    for (let i = 0; i < childRouteIds.length; i += 2) {
      const results = await Promise.allSettled(
        childRouteIds.slice(i, i + 2).map((routeId) => loadRoute(state, routeId))
      );
      drawn = results.some((result) => result.status === 'fulfilled' && result.value) || drawn;
    }
    return drawn;
  }

  function normalizeRef(value) {
    const text = String(value || '').trim();
    const number = text.match(/(?:Line\s*)?(\d{1,2})/i)?.[1];
    if (number) return number;
    if (/pujiang/i.test(text) || text.includes('浦江')) return 'pujiang';
    return text.toLowerCase();
  }

  async function discoverMetroRouteMasters() {
    const discovered = new Map();
    try {
      const data = await getJson(
        `${osmApi}/relation/${shanghaiMetroNetworkRelation}/full.json`,
        25000
      );
      for (const element of data?.elements || []) {
        if (element.type !== 'relation' || element.id === shanghaiMetroNetworkRelation) continue;
        const tags = element.tags || {};
        if (tags.type !== 'route_master' && !tags.route_master) continue;
        const ref = normalizeRef(tags.ref || tags.name || tags['name:en']);
        if (ref && !discovered.has(ref)) discovered.set(ref, element.id);
      }
    } catch (error) {
      console.warn('Shanghai Metro route-master discovery failed', error);
    }
    return discovered;
  }

  async function loadLine(line, discoveredMasters) {
    const state = states.get(line.id);
    try {
      let drawn = false;
      const discoveredId = discoveredMasters.get(normalizeRef(line.id));
      const masterId = discoveredId || line.routeMasterId;

      if (masterId) drawn = await loadMaster(state, masterId);
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
      if (stationMode) loadStations(state);
    } catch (error) {
      console.warn(`${line.name} load failed`, error);
      state.status = 'error';
      state.button.classList.add('has-error');
      state.button.title = `${line.name}：OSM 数据暂时不可用`;
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
          icon: L.divIcon({
            className: 'rail-station-icon',
            html: '<span></span>',
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5]
          })
        }).addTo(stationLayer);
        entry = { name: stop.name || '', marker, lineIds: new Set() };
        stations.set(key, entry);
      }
      entry.lineIds.add(state.line.id);
      updateStation(entry);
    }
  }

  function loadStations(state) {
    if (state.stationsLoaded || state.status !== 'ready') return;
    state.stationsLoaded = true;
    registerStops(state, state.stops);
  }

  async function enableStations() {
    stationLayer.addTo(map);
    stationToggle.textContent = '车站载入中…';
    const ready = [...states.values()].filter((state) => state.status === 'ready');
    ready.forEach(loadStations);
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
    const discoveredMasters = await discoverMetroRouteMasters();
    for (let i = 0; i < lines.length; i += 3) {
      await Promise.allSettled(
        lines.slice(i, i + 3).map((line) => loadLine(line, discoveredMasters))
      );
    }
    updateStatus();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.03), { maxZoom: 9.8 });
  })();
})();
