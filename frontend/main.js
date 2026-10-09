const API_URL = 'http://localhost:5000/api';

// --- State Management ---
let currentState = {
    user: JSON.parse(localStorage.getItem('user')) || null,
    token: localStorage.getItem('token') || null,
    inventory: [],
    requests: [],
    donors: [],
    hospitals: [],
    emergencyDonors: [],
    matchingRequests: [],
    userLocation: null   // { lat, lng } from real GPS
};

// --- Leaflet Map Instances ---
let pubMap = null;
let appMap = null;
let pubUserMarker = null;
let appUserMarker = null;
let pubHospitalMarkers = [];
let appHospitalMarkers = [];

// --- Toast Notification System ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-circle';
    if (type === 'warning') iconClass = 'fa-exclamation-triangle';

    toast.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
    startSystemClock();
    renderAppLayout();
    loadStats();
    loadInventory();
    loadHospitals();
    loadEmergencyDonors();
    startLiveHeartbeat();

    window.addEventListener('resize', () => {
        if (pubMap) pubMap.invalidateSize();
        if (appMap) appMap.invalidateSize();
    });

    // Sidebar Toggle — desktop collapse & mobile slide-in
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebarCloseBtn  = document.getElementById('sidebarCloseBtn');
    const sidebar          = document.getElementById('appSidebar');
    const mainWrapper      = document.querySelector('.app-main-wrapper');

    if (sidebarToggleBtn && sidebar) {
        sidebarToggleBtn.addEventListener('click', () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                // Mobile: slide in
                sidebar.classList.toggle('show');
            } else {
                // Desktop: collapse to icon rail
                sidebar.classList.toggle('collapsed');
                mainWrapper?.classList.toggle('sidebar-collapsed');
            }
        });
    }

    if (sidebarCloseBtn && sidebar) {
        sidebarCloseBtn.addEventListener('click', () => {
            sidebar.classList.remove('show');
        });
    }

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar?.classList.contains('show')) {
            if (!sidebar.contains(e.target) && e.target !== sidebarToggleBtn) {
                sidebar.classList.remove('show');
            }
        }
    });

    // Forms
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
    document.getElementById('publicBloodRequestForm')?.addEventListener('submit', handlePublicRequestSubmit);
    document.getElementById('appDonationForm')?.addEventListener('submit', handleDonationSubmit);
    document.getElementById('adjustStockForm')?.addEventListener('submit', handleAdjustStockSubmit);
});

// --- System Clock ---
function startSystemClock() {
    const clockEl = document.getElementById('systemTimeDisplay');
    if (!clockEl) return;

    const updateClock = () => {
        const now = new Date();
        clockEl.innerText = now.toLocaleTimeString();
    };
    updateClock();
    setInterval(updateClock, 1000);
}

// --- Authorized Fetch Helper ---
async function apiFetch(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (currentState.token) {
        headers['Authorization'] = `Bearer ${currentState.token}`;
    }
    return await fetch(`${API_URL}${endpoint}`, { ...options, headers });
}

// --- Layout Renderer (Public vs App Shell) ---
function renderAppLayout() {
    const publicLayout = document.getElementById('publicLayout');
    const appShell = document.getElementById('appShell');
    const user = currentState.user;

    if (user) {
        publicLayout?.classList.add('hidden');
        appShell?.classList.remove('hidden');

        const avatarEl = document.getElementById('appUserAvatar');
        const nameEl = document.getElementById('appUserName');
        const roleEl = document.getElementById('appUserRole');
        const headerGroup = document.getElementById('headerUserGroup');

        if (avatarEl) avatarEl.innerText = (user.name || user.username).charAt(0).toUpperCase();
        if (nameEl) nameEl.innerText = user.name || user.username;
        if (roleEl) roleEl.innerText = user.role.toUpperCase();
        if (headerGroup) headerGroup.innerText = user.blood_group ? `Group: ${user.blood_group}` : `Role: ${user.role}`;

        document.querySelectorAll('.staff-or-admin').forEach(el => 
            (user.role === 'staff' || user.role === 'admin') ? el.classList.remove('hidden') : el.classList.add('hidden')
        );
        document.querySelectorAll('.admin-only').forEach(el => 
            user.role === 'admin' ? el.classList.remove('hidden') : el.classList.add('hidden')
        );
        document.querySelectorAll('.donor-only').forEach(el => 
            user.role === 'donor' ? el.classList.remove('hidden') : el.classList.add('hidden')
        );

        renderActionBanner(user);
        switchAppPanel('dashboard');
    } else {
        publicLayout?.classList.remove('hidden');
        appShell?.classList.add('hidden');
        showPublicSection('hero');
    }
}

// --- Public Sections ---
function showPublicSection(secId) {
    document.querySelectorAll('.public-section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(`public-${secId}`);
    if (target) target.classList.remove('hidden');
    if (secId === 'hospitals') {
        loadHospitals();
        loadEmergencyDonors();
        // Fix tiles rendering in previously-hidden container
        setTimeout(() => {
            if (pubMap) pubMap.invalidateSize();
            if (appMap) appMap.invalidateSize();
        }, 250);
    }
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
    }
}

// --- App Workspace Panel Navigation ---
function switchAppPanel(panelId) {
    document.querySelectorAll('.workspace-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.menu-link').forEach(l => l.classList.remove('active'));

    const targetPanel = document.getElementById(`panel-${panelId}`);
    const activeLink = document.getElementById(`nav-${panelId}`);
    const pageTitle = document.getElementById('currentPanelTitle');

    if (targetPanel) targetPanel.classList.remove('hidden');
    if (activeLink) activeLink.classList.add('active');

    const titles = {
        'dashboard': 'Dashboard Overview',
        'hospitals': 'Nearby Emergency Hospitals & Donors',
        'inventory': 'Stock Inventory Management',
        'requests': 'Patient Request Queue',
        'donors': 'Donor Directory',
        'matching-requests': 'Urgent Blood Requests Feed'
    };
    if (pageTitle) pageTitle.innerText = titles[panelId] || 'Workspace';

    document.getElementById('appSidebar')?.classList.remove('show');

    loadStats();
    if (panelId === 'hospitals') {
        loadHospitals();
        loadEmergencyDonors();
        // Fix: invalidate map size after the panel becomes visible
        setTimeout(() => {
            if (pubMap) pubMap.invalidateSize();
            if (appMap) appMap.invalidateSize();
        }, 200);
    }
    if (panelId === 'inventory' || panelId === 'dashboard') loadInventory();
    if (panelId === 'requests') loadRequests();
    if (panelId === 'donors') loadDonors();
    if (panelId === 'matching-requests') loadMatchingRequests();
}

// --- Authentication ---
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    try {
        const res = await apiFetch('/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
            currentState.user = data.user;
            currentState.token = data.token;
            localStorage.setItem('user', JSON.stringify(data.user));
            localStorage.setItem('token', data.token);

            showToast(`Welcome back, ${data.user.name || data.user.username}!`, 'success');
            renderAppLayout();
        } else {
            showToast(data.message || 'Login failed', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Network error connecting to server', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('regName').value.trim(),
        blood_group: document.getElementById('regBlood').value,
        phone: document.getElementById('regPhone').value.trim(),
        address: document.getElementById('regAddress').value.trim(),
        username: document.getElementById('regUser').value.trim(),
        password: document.getElementById('regPass').value.trim(),
        role: 'donor'
    };

    try {
        const res = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            showToast(data.message || 'Registration successful! Please login.', 'success');
            switchAuthTab('login');
            document.getElementById('registerForm').reset();
        } else {
            showToast(data.error || 'Registration failed', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error registering account', 'error');
    }
}

function logout() {
    currentState.user = null;
    currentState.token = null;
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    showToast('Signed out successfully.', 'info');
    renderAppLayout();
}

// --- Live Stats & Visual Inventory Health Gauges ---
async function loadStats() {
    try {
        const res = await apiFetch('/stats');
        if (!res.ok) return;
        const stats = await res.json();

        const dashDonors = document.getElementById('dashTotalDonors');
        const dashUnits = document.getElementById('dashTotalUnits');
        const dashPending = document.getElementById('dashPendingRequests');
        const dashApproved = document.getElementById('dashApprovedRequests');

        if (dashDonors) dashDonors.innerText = stats.totalDonors;
        if (dashUnits) dashUnits.innerText = stats.totalUnits;
        if (dashPending) dashPending.innerText = stats.pendingRequests;
        if (dashApproved) dashApproved.innerText = stats.approvedRequests;
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}

async function loadInventory() {
    try {
        const res = await apiFetch('/inventory');
        if (!res.ok) return;
        const data = await res.json();
        currentState.inventory = data;

        renderInventoryGauges('publicInventoryGauges');
        renderInventoryGauges('dashInventoryHealthGauges');
        renderInventoryTable();
    } catch (err) {
        console.error('Error loading inventory:', err);
    }
}

function onGaugeClick(bloodGroup) {
    if (!currentState.user) {
        showPublicSection('hospitals');
        const select = document.getElementById('pubHospitalBloodSelect');
        if (select) select.value = bloodGroup;
        filterPublicHospitalsAndDonors();
        showToast(`Filtered emergency view for blood group ${bloodGroup}`, 'info');
        const section = document.getElementById('public-hospitals');
        if (section) window.scrollTo({ top: section.offsetTop - 70, behavior: 'smooth' });
    } else {
        switchAppPanel('inventory');
        showToast(`Viewing stock inventory for blood group ${bloodGroup}`, 'info');
    }
}

function renderInventoryGauges(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (currentState.inventory.length === 0) {
        container.innerHTML = `<p class="text-dim">Loading stock data...</p>`;
        return;
    }

    const maxCapacity = 50;

    container.innerHTML = currentState.inventory.map(item => {
        const pct = Math.min(100, Math.round((item.units / maxCapacity) * 100));
        
        let fillClass = 'fill-healthy';
        if (item.units < 5) fillClass = 'fill-critical';
        else if (item.units < 12) fillClass = 'fill-warning';
        else if (item.units >= 40) fillClass = 'fill-full';

        return `
            <div class="gauge-item" onclick="onGaugeClick('${item.blood_group}')" title="Click to filter by ${item.blood_group}">
                <div class="gauge-header">
                    <span class="gauge-group-badge">${item.blood_group}</span>
                    <span class="gauge-units"><strong>${item.units}</strong><small>/${maxCapacity} Units</small></span>
                </div>
                <div class="stock-bar-track">
                    <div class="stock-bar-fill ${fillClass}" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    const isStaffOrAdmin = currentState.user && ['staff', 'admin'].includes(currentState.user.role);

    tbody.innerHTML = currentState.inventory.map(item => {
        const pct = Math.min(100, Math.round((item.units / 50) * 100));
        let statusBadge = `<span class="badge badge-approved">Healthy</span>`;
        if (item.units < 5) statusBadge = `<span class="badge badge-rejected">Critical Low</span>`;
        else if (item.units < 12) statusBadge = `<span class="badge badge-pending">Low Stock</span>`;

        return `
            <tr>
                <td><strong style="color:var(--red); font-size:1.1rem;">${item.blood_group}</strong></td>
                <td><strong>${item.units}</strong> Units</td>
                <td>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <div class="stock-bar-track" style="width:100px;">
                            <div class="stock-bar-fill ${item.units < 5 ? 'fill-critical' : 'fill-healthy'}" style="width:${pct}%"></div>
                        </div>
                        <small class="text-dim">${pct}%</small>
                    </div>
                </td>
                <td>${item.last_updated ? new Date(item.last_updated).toLocaleString() : 'N/A'}</td>
                ${isStaffOrAdmin ? `
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="openAdjustStockModal('${item.blood_group}', ${item.units})">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                    </td>
                ` : ''}
            </tr>
        `;
    }).join('');
}

// ============================================================
// === LEAFLET.JS REAL-TIME HOSPITAL MAP ENGINE ===
// ============================================================

// --- Haversine Formula (calculate real distance in km between two lat/lng points) ---
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- GPS Badge UI Update ---
function setGpsBadge(prefix, message, isActive = false) {
    const badge = document.getElementById(`${prefix}GpsBadge`);
    const text  = document.getElementById(`${prefix}GpsStatusText`);
    if (!badge || !text) return;
    text.textContent = message;
    badge.style.color = isActive ? 'var(--green)' : 'var(--text-dark)';
}

// --- Offset hospital coords relative to user GPS using bearing ---
// This makes demo hospitals appear around user at realistic distances
function offsetCoord(lat, lng, distKm, bearingDeg) {
    const R = 6371;
    const d = distKm / R;
    const b = bearingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lng1 = lng * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

// Bearings for 5 hospitals (N, NE, E, SE, SW)
const HOSPITAL_BEARINGS = [0, 72, 144, 216, 288];

// --- Real-Time GPS Acquisition (Browser Geolocation API) ---
function acquireRealTimeGPS(prefix) {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.', 'error');
        return;
    }

    setGpsBadge(prefix, '📡 Acquiring GPS signal...', false);
    setGpsBadge(prefix === 'pub' ? 'app' : 'pub', '📡 Acquiring GPS signal...', false);
    showToast('Requesting real-time GPS location from browser...', 'info');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude: lat, longitude: lng, accuracy } = position.coords;
            currentState.userLocation = { lat, lng };

            const accText = accuracy ? `± ${Math.round(accuracy)}m` : '';
            const statusMsg = `✅ GPS Live: ${lat.toFixed(4)}°, ${lng.toFixed(4)}°  ${accText}`;
            setGpsBadge('pub', statusMsg, true);
            setGpsBadge('app', statusMsg, true);
            showToast(`Real-time GPS acquired! ${accText}`, 'success');

            // Place virtual hospital coords around user's real location
            currentState.hospitals = currentState.hospitals.map((h, idx) => {
                const bearing = HOSPITAL_BEARINGS[idx % HOSPITAL_BEARINGS.length];
                const distKm  = h.distance_km || (idx + 1) * 1.5;
                const { lat: vLat, lng: vLng } = offsetCoord(lat, lng, distKm, bearing);
                return { ...h, lat: vLat, lng: vLng, _virtualGps: true };
            });

            // Remove GPS prompt overlays
            removeMapGpsPrompt('pubHospitalsMap');
            removeMapGpsPrompt('appHospitalsMap');

            // Place user marker on both maps
            placeUserMarker('pub', lat, lng);
            placeUserMarker('app', lat, lng);

            // Re-render with real distances
            renderHospitalsWithDistance(currentState.hospitals);
        },
        (error) => {
            const messages = {
                1: 'Location permission denied. Please allow location access in browser.',
                2: 'Position unavailable. Check your device location settings.',
                3: 'Location request timed out. Try again.'
            };
            const msg = messages[error.code] || 'Unknown GPS error.';
            setGpsBadge('pub', `❌ ${msg}`, false);
            setGpsBadge('app', `❌ ${msg}`, false);
            showToast(msg, 'error');
        },
        { enableHighAccuracy: true, timeout: 14000, maximumAge: 0 }
    );
}

// --- Initialize Leaflet Map (center on user or world view) ---
function initLeafletMap(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    // Start at a general world view; will zoom in after GPS or markers load
    const map = L.map(containerId, {
        center: [20, 0],
        zoom: 2,
        zoomControl: true,
        attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | LifePulse',
        maxZoom: 19,
        crossOrigin: true
    }).addTo(map);

    return map;
}

// --- Place Hospitals as Red Cross Markers on Map ---
function placeHospitalMarkers(mapInstance, markerStore, hospitals) {
    // Remove old markers
    markerStore.forEach(m => mapInstance.removeLayer(m));
    markerStore.length = 0;

    const hospitalIcon = L.divIcon({
        className: '',
        html: `<div style="
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white; width:36px; height:36px;
            border-radius: 50%; display:flex; align-items:center;
            justify-content:center; font-size:16px;
            border: 3px solid white;
            box-shadow: 0 4px 15px rgba(239,68,68,0.7);
            ">
            <i class='fas fa-hospital-symbol'></i>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20]
    });

    hospitals.forEach(h => {
        if (!h.lat || !h.lng) return;

        const distText = currentState.userLocation
            ? `<strong style="color:var(--green)">${haversineDistance(currentState.userLocation.lat, currentState.userLocation.lng, h.lat, h.lng).toFixed(1)} km from you</strong>`
            : `${h.distance_km} km`;

        const popup = L.popup({ maxWidth: 280 }).setContent(`
            <div class="map-popup-card">
                <h4><i class="fas fa-hospital-symbol"></i> ${h.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${h.address}</p>
                <p><i class="fas fa-road"></i> Distance: ${distText}</p>
                <p><i class="fas fa-phone-alt"></i> ${h.phone}</p>
                <p style="color:var(--red);"><i class="fas fa-ambulance"></i> <strong>Emergency: ${h.emergency_contact}</strong></p>
                <div style="margin-top:0.6rem;">
                    <a href="tel:${h.phone}" style="display:inline-block; padding:6px 14px; background:var(--bg-ice-mint); color:var(--text-dark); border:1px solid var(--border); border-radius:6px; text-decoration:none; font-size:0.82rem; margin-right:6px; font-weight:600;">
                        <i class="fas fa-phone-alt"></i> Call
                    </a>
                    <a href="tel:${h.emergency_contact}" style="display:inline-block; padding:6px 14px; background:var(--red); color:#fff; border-radius:6px; text-decoration:none; font-size:0.82rem; font-weight:600;">
                        <i class="fas fa-ambulance"></i> Emergency
                    </a>
                </div>
            </div>
        `);

        const marker = L.marker([h.lat, h.lng], { icon: hospitalIcon })
            .bindPopup(popup)
            .addTo(mapInstance);

        markerStore.push(marker);
    });

    // Fit map bounds to all visible hospital markers
    if (markerStore.length > 0) {
        const group = L.featureGroup(markerStore);
        mapInstance.fitBounds(group.getBounds().pad(0.2));
    }
}

// --- Place User's Own Location Marker ---
function placeUserMarker(prefix, lat, lng) {
    const isApp = (prefix === 'app');
    const mapInstance = isApp ? appMap : pubMap;
    if (!mapInstance) return;

    let markerRef = isApp ? appUserMarker : pubUserMarker;

    const userIcon = L.divIcon({
        className: '',
        html: `<div style="
            background: linear-gradient(135deg, #10b981, #ff001a);
            width:18px; height:18px; border-radius:50%;
            border: 3px solid white;
            box-shadow: 0 0 0 6px rgba(16,185,129,0.25), 0 4px 15px rgba(255,0,26,0.4);
            animation: pulse 1.5s infinite;
        "></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -15]
    });

    if (markerRef) mapInstance.removeLayer(markerRef);

    markerRef = L.marker([lat, lng], { icon: userIcon })
        .bindPopup('<div class="map-popup-card"><h4 style="color:var(--green)">📍 Your Current Location</h4><p>Real-time GPS</p></div>')
        .addTo(mapInstance);

    if (isApp) appUserMarker = markerRef;
    else pubUserMarker = markerRef;

    mapInstance.setView([lat, lng], 13);
}

// --- Re-render hospital cards with real distance from user ---
function renderHospitalsWithDistance(hospitals) {
    if (!currentState.userLocation) {
        renderHospitals('pubHospitalsGrid', hospitals);
        renderHospitals('appHospitalsGrid', hospitals);
        return;
    }

    const { lat: uLat, lng: uLng } = currentState.userLocation;

    const enriched = hospitals.map(h => ({
        ...h,
        realDistKm: (h.lat && h.lng) ? haversineDistance(uLat, uLng, h.lat, h.lng) : null
    })).sort((a, b) => {
        const da = a.realDistKm ?? a.distance_km ?? 999;
        const db = b.realDistKm ?? b.distance_km ?? 999;
        return da - db;
    });

    renderHospitals('pubHospitalsGrid', enriched, true);
    renderHospitals('appHospitalsGrid', enriched, true);

    // Update markers on maps
    if (pubMap) placeHospitalMarkers(pubMap, pubHospitalMarkers, enriched);
    if (appMap) placeHospitalMarkers(appMap, appHospitalMarkers, enriched);
}

// --- Show GPS-prompt overlay on map before location is acquired ---
function showMapGpsPrompt(mapContainerId) {
    const el = document.getElementById(mapContainerId);
    if (!el) return;
    // Inject overlay inside the map container
    const existing = el.querySelector('.map-gps-overlay');
    if (existing) return; // already shown
    const overlay = document.createElement('div');
    overlay.className = 'map-gps-overlay';
    overlay.innerHTML = `
        <div class="map-gps-prompt">
            <i class="fas fa-satellite" style="font-size:2.4rem; color:#a78bfa; margin-bottom:0.8rem;"></i>
            <h4>GPS Location Required</h4>
            <p>Click <strong>"Acquire Real-Time GPS"</strong> above to detect your location and show nearby hospitals on the map.</p>
        </div>
    `;
    el.style.position = 'relative';
    el.appendChild(overlay);
}

function removeMapGpsPrompt(mapContainerId) {
    const overlay = document.querySelector(`#${mapContainerId} .map-gps-overlay`);
    if (overlay) overlay.remove();
}

// --- Hospitals & Emergency Donors ---
async function loadHospitals(locationQuery = '') {
    try {
        const url = locationQuery ? `/hospitals?location=${encodeURIComponent(locationQuery)}` : '/hospitals';
        const res = await apiFetch(url);
        if (!res.ok) return;
        const data = await res.json();
        currentState.hospitals = data;

        // Init Leaflet maps (only once)
        if (!pubMap) pubMap = initLeafletMap('pubHospitalsMap');
        if (!appMap) appMap  = initLeafletMap('appHospitalsMap');

        // If GPS already acquired → place markers; otherwise show prompt overlay
        if (currentState.userLocation) {
            renderHospitalsWithDistance(data);
        } else {
            // Show cards without real distance
            renderHospitals('pubHospitalsGrid', data, false);
            renderHospitals('appHospitalsGrid', data, false);
            // Show GPS prompt overlay on the map (don't snap to Delhi)
            setTimeout(() => {
                showMapGpsPrompt('pubHospitalsMap');
                showMapGpsPrompt('appHospitalsMap');
            }, 300);
        }
    } catch (err) {
        console.error('Error loading hospitals:', err);
    }
}

function renderHospitals(containerId, hospitals, useRealDist = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (hospitals.length === 0) {
        container.innerHTML = `<div class="glass-panel text-center" style="padding:2rem; grid-column:1/-1;"><i class="fas fa-hospital-symbol" style="font-size:2rem; color:var(--text-dim); margin-bottom:0.8rem;"></i><p class="text-dim">No partner hospitals found for this location.</p></div>`;
        return;
    }

    container.innerHTML = hospitals.map((h, idx) => {
        const distKm = (useRealDist && h.realDistKm != null)
            ? h.realDistKm.toFixed(1)
            : (h.distance_km || '?');

        const distColor = parseFloat(distKm) <= 2
            ? 'var(--green)'
            : parseFloat(distKm) <= 5
            ? 'var(--mint-dark)'
            : 'var(--gold)';

        return `
        <div class="hospital-card" style="animation-delay: ${idx * 80}ms;">
            <div>
                <div class="hospital-header">
                    <div class="hospital-title">
                        <h4><i class="fas fa-hospital-symbol" style="color:var(--red);"></i> ${h.name}</h4>
                        <div class="hospital-location">
                            <i class="fas fa-map-marker-alt" style="color:var(--red);"></i> ${h.location}
                        </div>
                    </div>
                    <span class="hospital-distance" style="background:${distColor}15; color:${distColor}; border:1px solid ${distColor}44;">
                        <i class="fas fa-route"></i> ${distKm} km${useRealDist && h.realDistKm != null ? ' (live)' : ''}
                    </span>
                </div>
                <div class="hospital-details">
                    <p><i class="fas fa-map-signs" style="color:var(--mint-dark);"></i> ${h.address}</p>
                    <p><i class="fas fa-phone-alt" style="color:var(--mint-dark);"></i>
                        <strong>General:</strong>
                        <a href="tel:${h.phone}" style="color:var(--text-dark); text-decoration:none; font-weight:600;">${h.phone}</a>
                    </p>
                    <p><i class="fas fa-ambulance" style="color:var(--red);"></i>
                        <strong>Emergency Hotline:</strong>
                        <a href="tel:${h.emergency_contact}" style="color:var(--red); font-weight:700; text-decoration:none; font-size:1rem;">${h.emergency_contact}</a>
                    </p>
                    ${(h.lat && h.lng) ? `<p style="font-size:0.78rem;"><i class="fas fa-crosshairs" style="color:var(--green);"></i>
                        GPS: <span style="color:var(--text-muted);">${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}</span>
                        <a href="https://maps.google.com/?q=${h.lat},${h.lng}" target="_blank" style="margin-left:6px; color:var(--red); font-size:0.78rem; font-weight:600;">
                            <i class="fas fa-external-link-alt"></i> Open in Maps
                        </a>
                    </p>` : ''}
                </div>
            </div>
            <div class="hospital-actions">
                <div class="action-row-top">
                    <a href="tel:${h.phone}" class="btn btn-sm btn-outline" title="Call General Line">
                        <i class="fas fa-phone-alt"></i> Call
                    </a>
                    <a href="tel:${h.emergency_contact}" class="btn btn-sm action-btn-emergency" title="Call Emergency Line">
                        <i class="fas fa-ambulance"></i> Emergency
                    </a>
                    <button class="btn btn-sm action-btn-map" onclick="focusHospitalOnMap('${h.name}', ${h.lat}, ${h.lng})" title="View location on Leaflet map">
                        <i class="fas fa-map-marked-alt"></i> Map
                    </button>
                </div>
                <button class="btn btn-sm btn-accent btn-block" onclick="triggerHospitalRequest('${h.name}')">
                    <i class="fas fa-heartbeat"></i> Request Blood Dispatch
                </button>
            </div>
        </div>
    `}).join('');
}

function focusHospitalOnMap(name, lat, lng) {
    if (!lat || !lng) {
        showToast(`GPS coordinates unavailable for ${name}`, 'warning');
        return;
    }
    const isApp = currentState.user != null;
    const map = isApp ? appMap : pubMap;
    const markers = isApp ? appHospitalMarkers : pubHospitalMarkers;

    if (map) {
        map.setView([lat, lng], 15, { animate: true });
        markers.forEach(m => {
            const pos = m.getLatLng();
            if (Math.abs(pos.lat - lat) < 0.002 && Math.abs(pos.lng - lng) < 0.002) {
                m.openPopup();
            }
        });
        showToast(`Leaflet Map focused on ${name}`, 'info');
        const mapContainer = document.getElementById(isApp ? 'appHospitalsMap' : 'pubHospitalsMap');
        if (mapContainer) {
            window.scrollTo({ top: mapContainer.offsetTop - 70, behavior: 'smooth' });
        }
    }
}

let currentDispatchTarget = null;

function triggerHospitalRequest(hospitalName) {
    const hosp = currentState.hospitals.find(h => h.name === hospitalName) || {
        name: hospitalName,
        phone: '+1 (555) 019-2831',
        emergency_contact: '102 / 911-EXT',
        location: 'Trauma Center'
    };
    
    currentDispatchTarget = hosp;

    const modal = document.getElementById('dispatchModal');
    const modalBody = document.getElementById('dispatchModalBody');
    if (!modal || !modalBody) {
        showToast(`Initiating emergency blood request dispatch to ${hospitalName}`, 'warning');
        if (currentState.user) switchAppPanel('requests');
        else showPublicSection('request-blood');
        return;
    }

    const estDriveMin = hosp.distance_km ? Math.max(3, Math.round((hosp.distance_km / 30) * 60)) : 5;
    const nowStr = new Date().toLocaleString();

    modalBody.innerHTML = `
        <div class="dispatch-header-card" style="background:var(--bg-ice-mint); padding:1rem; border-radius:var(--r-sm); border:1px solid var(--border); margin-bottom:1.2rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <h4 style="color:var(--red); font-size:1.1rem; margin-bottom:0.2rem;"><i class="fas fa-hospital-symbol"></i> ${hosp.name}</h4>
                    <p style="font-size:0.85rem; color:var(--text-muted); margin:0;"><i class="fas fa-map-marker-alt"></i> Zone: ${hosp.location || 'Emergency'}</p>
                </div>
                <span class="badge badge-emergency" style="font-size:0.82rem;"><i class="fas fa-bolt"></i> RED-ALERT DISPATCH</span>
            </div>
        </div>

        <div class="form-row" style="margin-bottom:1.2rem;">
            <div class="form-group mb-0">
                <label><i class="fas fa-tint text-red"></i> Required Blood Group</label>
                <select id="dispatchBloodGroup">
                    <option value="O-">O- (Universal Emergency)</option>
                    <option value="O+">O+</option>
                    <option value="A+">A+</option>
                    <option value="B+">B+</option>
                    <option value="AB+">AB+</option>
                </select>
            </div>
            <div class="form-group mb-0">
                <label><i class="fas fa-cubes text-accent"></i> Dispatch Units</label>
                <input type="number" id="dispatchUnits" min="1" max="10" value="2">
            </div>
        </div>

        <div style="background:#ffffff; border:1px solid var(--border); border-radius:var(--r-sm); padding:1rem; margin-bottom:1.2rem;">
            <div style="display:flex; justify-content:space-between; font-size:0.84rem; margin-bottom:0.4rem;">
                <span style="color:var(--text-dark);"><i class="fas fa-road" style="color:var(--mint-dark);"></i> Distance: <strong>${hosp.distance_km || '1.5'} km</strong></span>
                <span style="color:var(--mint-dark);"><i class="fas fa-car-side"></i> Est. Transit: <strong>~${estDriveMin} mins</strong></span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.84rem;">
                <span style="color:var(--text-dark);"><i class="fas fa-phone-alt" style="color:var(--mint-dark);"></i> Phone: <strong>${hosp.phone}</strong></span>
                <span style="color:var(--red); font-weight:700;"><i class="fas fa-ambulance"></i> Emergency Desk: <strong>${hosp.emergency_contact}</strong></span>
            </div>
        </div>

        <div class="sms-payload-box" style="background:#0f172a; color:#f8fafc; border-radius:var(--r-sm); padding:1rem; font-family:monospace; font-size:0.82rem; border-left:4px solid var(--red);">
            <div style="color:#94a3b8; font-size:0.75rem; margin-bottom:0.4rem; display:flex; justify-content:space-between;">
                <span><i class="fas fa-sms" style="color:var(--red);"></i> GENERATED SMS ALERT PAYLOAD</span>
                <span>${nowStr}</span>
            </div>
            <div id="smsPayloadText">
[PRIORITY DISPATCH] To: ${hosp.emergency_contact} (${hosp.name})
MSG: URGENT BLOOD DISPATCH REQUEST - Group: O- | Units: 2 | Target: ${hosp.name} | Dispatch Ref: LP-DISPATCH-${Math.floor(1000 + Math.random() * 9000)} | Status: TRANSMITTING
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}

function closeDispatchModal() {
    const modal = document.getElementById('dispatchModal');
    if (modal) modal.classList.add('hidden');
}

function confirmEmergencyDispatch() {
    const btn = document.getElementById('confirmDispatchBtn');
    const payload = document.getElementById('smsPayloadText');
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 1/3 Encrypting & Transmitting SMS Alert...`;

    setTimeout(() => {
        btn.innerHTML = `<i class="fas fa-signal"></i> 2/3 Communicating with Trauma Desk...`;
        if (payload) payload.style.borderColor = '#10b981';
    }, 900);

    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-paper-plane"></i> Transmit Emergency Dispatch & SMS Alert`;
        closeDispatchModal();
        showToast(`Emergency dispatch transmitted to ${currentDispatchTarget ? currentDispatchTarget.name : 'Trauma Desk'}! SMS Alert Active.`, 'success');
        if (currentState.user) switchAppPanel('requests');
        else showPublicSection('request-blood');
    }, 2000);
}

// --- Live Heartbeat Auto-Sync (Every 12s) ---
function startLiveHeartbeat() {
    setInterval(async () => {
        try {
            const res = await apiFetch('/inventory');
            if (res.ok) {
                const data = await res.json();
                currentState.inventory = data;
                renderInventoryGauges('publicInventoryGauges');
                renderInventoryGauges('dashInventoryHealthGauges');
                renderInventoryTable();
            }
        } catch (e) {
            // silent catch for seamless UI stability
        }
    }, 12000);
}

async function loadEmergencyDonors(bloodGroup = '', location = '') {
    try {
        let params = [];
        if (bloodGroup) params.push(`blood_group=${encodeURIComponent(bloodGroup)}`);
        if (location) params.push(`location=${encodeURIComponent(location)}`);
        const url = params.length > 0 ? `/donors/emergency?${params.join('&')}` : '/donors/emergency';
        const res = await apiFetch(url);
        if (!res.ok) return;
        const data = await res.json();
        currentState.emergencyDonors = data;
        renderEmergencyDonorsTable('pubEmergencyDonorsTableBody', data);
        renderEmergencyDonorsTable('appEmergencyDonorsTableBody', data);
    } catch (err) {
        console.error('Error loading emergency donors:', err);
    }
}

function renderEmergencyDonorsTable(tbodyId, donors) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (donors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-dim text-center">No emergency donors found matching criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = donors.map(d => `
        <tr>
            <td><strong>${d.name}</strong></td>
            <td><strong style="color:var(--red); font-size:1.1rem;">${d.blood_group}</strong></td>
            <td>${d.address}</td>
            <td><a href="tel:${d.phone}" style="color:var(--red); font-weight:600; text-decoration:none;"><i class="fas fa-phone-alt"></i> ${d.phone || 'N/A'}</a></td>
            <td>${d.last_donation || 'None'}</td>
            <td>
                <a href="tel:${d.phone}" class="btn btn-sm btn-accent"><i class="fas fa-phone-alt"></i> Call Donor</a>
            </td>
        </tr>
    `).join('');
}

function filterPublicHospitalsAndDonors() {
    const loc = document.getElementById('pubHospitalLocInput').value.trim();
    const group = document.getElementById('pubHospitalBloodSelect').value;
    loadHospitals(loc);
    loadEmergencyDonors(group, loc);
}

function filterAppHospitals() {
    const loc = document.getElementById('appHospitalLocInput').value.trim();
    loadHospitals(loc);
}

function filterAppEmergencyDonors() {
    const loc = document.getElementById('appEmergencyDonorLocInput').value.trim();
    const group = document.getElementById('appEmergencyDonorGroupSelect').value;
    loadEmergencyDonors(group, loc);
}

// --- Action Banner ---
function renderActionBanner(user) {
    const titleEl = document.getElementById('bannerTitle');
    const descEl = document.getElementById('bannerDesc');
    const btnGroup = document.getElementById('bannerBtnGroup');
    if (!titleEl || !btnGroup) return;

    if (user.role === 'admin') {
        titleEl.innerText = 'Admin Management Actions';
        descEl.innerText = 'Generate audit logs, oversee inventory levels, or view donor registry';
        btnGroup.innerHTML = `
            <button class="btn btn-primary" onclick="generateReport()"><i class="fas fa-file-invoice"></i> System Audit Report</button>
            <button class="btn btn-outline" onclick="openAdjustStockModal()"><i class="fas fa-sliders-h"></i> Manage Inventory</button>
        `;
    } else if (user.role === 'staff') {
        titleEl.innerText = 'Staff Operations Banner';
        descEl.innerText = 'Review patient queue or update blood group stocks';
        btnGroup.innerHTML = `
            <button class="btn btn-primary" onclick="switchAppPanel('requests')"><i class="fas fa-tasks"></i> Process Request Queue</button>
            <button class="btn btn-outline" onclick="openAdjustStockModal()"><i class="fas fa-sliders-h"></i> Adjust Stock</button>
        `;
    } else {
        titleEl.innerText = 'Donor Action Center';
        descEl.innerText = 'Record your recent donation or view emergency requests for your blood type';
        btnGroup.innerHTML = `
            <button class="btn btn-primary" onclick="openDonationModal()"><i class="fas fa-plus"></i> Record Blood Donation</button>
            <button class="btn btn-outline" onclick="switchAppPanel('matching-requests')"><i class="fas fa-hands-helping"></i> View Matching Requests</button>
        `;
    }
}

// --- Requests & Queue ---
async function handlePublicRequestSubmit(e) {
    e.preventDefault();
    const payload = {
        requester_name: document.getElementById('pubReqPatient').value.trim(),
        blood_group: document.getElementById('pubReqBloodGroup').value,
        units: parseInt(document.getElementById('pubReqUnits').value),
        priority: document.querySelector('input[name="pubPriority"]:checked').value
    };

    try {
        const res = await apiFetch('/requests', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Blood request submitted successfully!', 'success');
            document.getElementById('publicBloodRequestForm').reset();
            loadStats();
        } else {
            showToast(data.error || 'Failed to submit request', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error submitting request', 'error');
    }
}

async function loadRequests() {
    try {
        const res = await apiFetch('/requests');
        if (!res.ok) return;
        const data = await res.json();
        currentState.requests = data;
        renderRequestsTable(data);
    } catch (err) {
        console.error(err);
    }
}

function renderRequestsTable(requests) {
    const tbody = document.getElementById('requestQueueTableBody');
    if (!tbody) return;

    if (requests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-dim text-center">No blood requests in queue.</td></tr>`;
        return;
    }

    const isStaffOrAdmin = currentState.user && ['staff', 'admin'].includes(currentState.user.role);

    tbody.innerHTML = requests.map(req => {
        const isPending = req.status === 'Pending';
        return `
            <tr>
                <td>${new Date(req.request_date).toLocaleDateString()}</td>
                <td><strong>${req.requester_name}</strong></td>
                <td><strong style="color:var(--red); font-size:1.1rem;">${req.blood_group}</strong></td>
                <td>${req.units} Units</td>
                <td><span class="badge badge-${req.priority.toLowerCase()}">${req.priority}</span></td>
                <td><span class="badge badge-${req.status.toLowerCase()}">${req.status}</span></td>
                ${isStaffOrAdmin ? `
                    <td>
                        ${isPending ? `
                            <button class="btn btn-sm btn-primary" onclick="updateRequestStatus(${req.id}, 'Approved')"><i class="fas fa-check"></i> Approve</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="updateRequestStatus(${req.id}, 'Rejected')"><i class="fas fa-times"></i> Reject</button>
                        ` : `<span class="text-dim" style="font-size:0.85rem;">Resolved</span>`}
                    </td>
                ` : ''}
            </tr>
        `;
    }).join('');
}

async function updateRequestStatus(id, status) {
    try {
        const res = await apiFetch(`/requests/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(data.message, 'success');
            loadRequests();
            loadInventory();
            loadStats();
        } else {
            showToast(data.message || data.error, 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error updating request status', 'error');
    }
}

// --- Matching Requests Feed for Donors ---
async function loadMatchingRequests() {
    try {
        const bloodGroup = currentState.user ? currentState.user.blood_group : '';
        const url = bloodGroup ? `/requests/matching?blood_group=${encodeURIComponent(bloodGroup)}` : '/requests/matching';
        const res = await apiFetch(url);
        if (!res.ok) return;
        const data = await res.json();
        currentState.matchingRequests = data;
        renderMatchingRequestsFeed(data);
    } catch (err) {
        console.error(err);
    }
}

function renderMatchingRequestsFeed(requests) {
    const container = document.getElementById('matchingRequestsFeed');
    if (!container) return;

    if (requests.length === 0) {
        container.innerHTML = `<div class="glass-panel text-center" style="padding:2rem; grid-column:1/-1;"><p class="text-dim">No urgent requests matching your blood group currently.</p></div>`;
        return;
    }

    container.innerHTML = requests.map(req => `
        <div class="feed-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                <span class="badge badge-${req.priority.toLowerCase()}">${req.priority}</span>
                <small class="text-dim">${new Date(req.request_date).toLocaleDateString()}</small>
            </div>
            <h4>Patient: ${req.requester_name}</h4>
            <p><strong>Blood Group Needed:</strong> <span style="color:var(--red); font-weight:700;">${req.blood_group}</span></p>
            <p><strong>Units Required:</strong> ${req.units} Units</p>
            <br>
            <button class="btn btn-sm btn-primary btn-block" onclick="openDonationModal()">
                <i class="fas fa-heart"></i> Offer Donation
            </button>
        </div>
    `).join('');
}

// --- Donors Directory ---
async function loadDonors() {
    try {
        const res = await apiFetch('/donors');
        if (!res.ok) return;
        const donors = await res.json();
        currentState.donors = donors;
        renderDonorsTable(donors);
    } catch (err) {
        console.error(err);
    }
}

function renderDonorsTable(donors) {
    const tbody = document.getElementById('donorRegistryTableBody');
    if (!tbody) return;

    if (donors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-dim text-center">No donors registered in system.</td></tr>`;
        return;
    }

    tbody.innerHTML = donors.map(d => `
        <tr>
            <td><strong>${d.name}</strong></td>
            <td><strong style="color:var(--red); font-size:1.1rem;">${d.blood_group}</strong></td>
            <td>${d.phone || 'N/A'}</td>
            <td>${d.address || 'N/A'}</td>
            <td>${d.last_donation || 'None'}</td>
        </tr>
    `).join('');
}

// --- Modals ---
function openDonationModal() {
    document.getElementById('donationModal')?.classList.remove('hidden');
}
function closeDonationModal() {
    document.getElementById('donationModal')?.classList.add('hidden');
}

async function handleDonationSubmit(e) {
    e.preventDefault();
    const units = parseInt(document.getElementById('donationUnitsInput').value) || 1;

    try {
        const res = await apiFetch('/donations', {
            method: 'POST',
            body: JSON.stringify({
                user_id: currentState.user ? currentState.user.id : null,
                units
            })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(data.message, 'success');
            closeDonationModal();
            loadInventory();
            loadStats();
        } else {
            showToast(data.error || data.message, 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error recording donation', 'error');
    }
}

function openAdjustStockModal(group = 'A+', units = 10) {
    const groupSelect = document.getElementById('adjustBloodGroup');
    const unitsInput = document.getElementById('adjustUnitsCount');
    if (groupSelect) groupSelect.value = group;
    if (unitsInput) unitsInput.value = units;
    document.getElementById('adjustStockModal')?.classList.remove('hidden');
}
function closeAdjustStockModal() {
    document.getElementById('adjustStockModal')?.classList.add('hidden');
}

async function handleAdjustStockSubmit(e) {
    e.preventDefault();
    const blood_group = document.getElementById('adjustBloodGroup').value;
    const units = parseInt(document.getElementById('adjustUnitsCount').value);

    try {
        const res = await apiFetch('/inventory/adjust', {
            method: 'POST',
            body: JSON.stringify({ blood_group, units })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(data.message, 'success');
            closeAdjustStockModal();
            loadInventory();
            loadStats();
        } else {
            showToast(data.error || 'Failed to adjust stock', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error updating stock level', 'error');
    }
}

async function generateReport() {
    try {
        showToast('Generating audit report...', 'info');
        const res = await apiFetch('/reports/summary');
        if (!res.ok) return showToast('Failed to load report', 'error');
        const data = await res.json();

        const container = document.getElementById('reportModalBody');
        if (!container) return;

        container.innerHTML = `
            <div style="margin-bottom:1.5rem; padding-bottom:1rem; border-bottom:1px solid var(--glass-border);">
                <p><strong>Report Timestamp:</strong> ${new Date(data.generatedAt).toLocaleString()}</p>
                <p><strong>Registered Donors:</strong> ${data.totalDonors}</p>
                <p><strong>Pending Requests:</strong> ${data.pendingRequestsCount} | <strong>Approved Dispatches:</strong> ${data.approvedRequestsCount}</p>
            </div>

            <h4 style="margin-bottom:0.8rem;">Inventory Capacity Snapshot</h4>
            <table class="data-table" style="margin-bottom:1.5rem;">
                <thead><tr><th>Blood Group</th><th>Stock Units</th><th>Last Updated</th></tr></thead>
                <tbody>
                    ${data.inventory.map(inv => `
                        <tr>
                            <td><strong>${inv.blood_group}</strong></td>
                            <td>${inv.units} Units</td>
                            <td>${inv.last_updated}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <h4 style="margin-bottom:0.8rem;">Recent Blood Requests Audit</h4>
            <table class="data-table">
                <thead><tr><th>Date</th><th>Patient</th><th>Group</th><th>Units</th><th>Priority</th><th>Status</th></tr></thead>
                <tbody>
                    ${data.recentRequests.map(r => `
                        <tr>
                            <td>${new Date(r.request_date).toLocaleDateString()}</td>
                            <td>${r.requester_name}</td>
                            <td><strong>${r.blood_group}</strong></td>
                            <td>${r.units}</td>
                            <td>${r.priority}</td>
                            <td><span class="badge badge-${r.status.toLowerCase()}">${r.status}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        document.getElementById('reportModal')?.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        showToast('Error generating audit report', 'error');
    }
}

function closeReportModal() {
    document.getElementById('reportModal')?.classList.add('hidden');
}

function setLocationFilter(inputId, value, callback) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value;
    // Highlight active pill
    document.querySelectorAll('.loc-pill').forEach(p => p.classList.remove('active'));
    event?.target?.classList?.add?.('active');
    if (typeof callback === 'function') callback();
}

// --- Filters ---
function filterRequestsTable() {
    const query = document.getElementById('requestSearchInput').value.toLowerCase();
    const filtered = currentState.requests.filter(r => 
        r.requester_name.toLowerCase().includes(query) || 
        r.blood_group.toLowerCase().includes(query)
    );
    renderRequestsTable(filtered);
}

function filterDonorsTable() {
    const query = document.getElementById('donorSearchInput').value.toLowerCase();
    const filtered = currentState.donors.filter(d => 
        d.name.toLowerCase().includes(query) || 
        d.blood_group.toLowerCase().includes(query) ||
        (d.phone && d.phone.toLowerCase().includes(query))
    );
    renderDonorsTable(filtered);
}
