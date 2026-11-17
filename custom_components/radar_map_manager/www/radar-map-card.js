import { RadarMath } from './radar-math.js?v=lite-1';
import { RadarUI } from './radar-ui.js?v=lite-1';
import { RadarRenderer } from './radar-renderer.js?v=lite-1';
import { RadarEditor } from './radar-editor.js?v=lite-1';
const CARD_I18N = {
    "proxy_ok": { "zh": "[RMM VIP] 雷达 {0} 代理认证成功！专属高频点云已通过 HA 隧道激活。", "en": "[RMM VIP] Radar {0} proxy auth successful! Exclusive high-frequency point cloud activated via HA tunnel." },
    "proxy_fail": { "zh": "[RMM VIP] 代理中继连接失败 ({0})，已静默降级为 MQTT 模式。", "en": "[RMM VIP] Proxy relay connection failed ({0}), silently downgraded to MQTT mode." }
};
class RadarMapCardNative extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.math = new RadarMath();
        this.ui = new RadarUI(this.shadowRoot);
        this.renderer = new RadarRenderer(this.math, this.shadowRoot);
        this.editor = new RadarEditor(this, this.shadowRoot, this.math, this.ui, this.renderer);
        this.state = {
            editMode: 'zone',
            editing: false,
            radar: null,
            type: 'include_zones',
            fov_edit_mode: false,
            points: [],
            data: {},
            ts: 0,
            selectedIndex: null,
            selectedPointIndex: null,
            hasUnsavedChanges: false,
            historyStack: [],
            dragState: { isDragging: false },
            layoutChanges: {},
            calibration: { active: false, raw: null, map: null },
            isConnected: true,
            hass: null,
            aspectRatio: 1.0,
            mapGroup: "default",
            isAddingNew: false,
            mousePos: null,
            followZonesEnabled: false,
            followZoneTypes: { hw_detect_zones: true, hw_block_zones: false, hw_stay_zones: false },
            hasHwZoneChanges: false,
            origFollowZonesSnapshot: null
        };
        this.ignoreUpdatesUntil = 0;
        this.isCreated = false;
        this.retryTimer = null;
        this.isRendering = false;
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this.state.aspectRatio = width / height;
                    if (!this.isRendering && this.state.hass) {
                        requestAnimationFrame(() => this.renderer.draw(this.state, this.config, this.state.hass));
                    }
                }
            }
        });
    }
    t(key, arg0 = "") {
        const stored = localStorage.getItem('rmm_panel_lang');
        let isZh;
        if (stored === 'zh' || stored === 'en') {
            isZh = (stored === 'zh');
        } else {
            const lang = (this.state.hass && this.state.hass.language) || 'en';
            isZh = lang.startsWith('zh');
        }
        if (CARD_I18N[key]) {
            let txt = isZh ? CARD_I18N[key].zh : CARD_I18N[key].en;
            return txt.replace("{0}", arg0);
        }
        return key;
    }
    set layout(val) {
        this._ha_layout = val;
    }
    get layout() {
        return this._ha_layout;
    }
    getGridOptions() {
        return { columns: 12, rows: "auto" };
    }
    disconnectedCallback() {
        this.resizeObserver.disconnect();
        if (this.retryTimer) clearInterval(this.retryTimer);
        if (this.wsConnections) {
            Object.values(this.wsConnections).forEach(ws => { if (ws.unsubscribe) ws.unsubscribe(); });
        }
        if (this._authUnsubscribe) {
            this._authUnsubscribe();
            this._authUnsubscribe = null;
        }
        if (this._streamUnsubscribe) {
            this._streamUnsubscribe();
            this._streamUnsubscribe = null;
        }
    }
    static getStubConfig() {
        return { type: "custom:radar-map-card", map_group: "default" };
    }
    getCardSize() {
        return 5;
    }
    setConfig(config) {
        this.config = config;
        this.state.mapGroup = config.map_group || "default";
        if (this.isCreated) return;
        this.ui.render(this.state, this.config);
        this.isCreated = true;
        const root = this.shadowRoot.getElementById('root');
        if (root) this.resizeObserver.observe(root);
        this.initLogic();
        this.startHeartbeat();
    }
    set hass(h) {
        if (this.state.rawHass && this.state.rawHass.connection && h && h.connection && this.state.rawHass.connection !== h.connection) {
            console.log("[RMM] HA Connection changed (Wake up from sleep). Resubscribing...");
            if (this._authUnsubscribe) { this._authUnsubscribe(); this._authUnsubscribe = null; }
            if (this._streamUnsubscribe) { this._streamUnsubscribe(); this._streamUnsubscribe = null; }
            this._streamSubscribing = false;
            this._authListenerAdded = false;
            if (this.wsConnections) {
                Object.values(this.wsConnections).forEach(ws => {
                    if (ws.unsubscribe) { try { ws.unsubscribe(); } catch(e) {} }
                    ws.unsubscribe = null;
                    ws.isConnecting = false;
                });
            }
        }
        this._hass = h;
        this.state.rawHass = h;
        this.state.hass = this.getMockHass(h); 
        // Lite: le notifiche proprietarie di abbinamento sono rimosse.
        if (!this._streamUnsubscribe && !this._streamSubscribing && h && h.connection) {
            this._streamSubscribing = true;
            h.connection.subscribeMessage(
                (message) => { this.handleNewData(message.data); },
                { type: 'rmm/stream' }
            ).then(unsub => {
                this._streamUnsubscribe = unsub;
                this._streamSubscribing = false;
            }).catch(() => {
                this._streamSubscribing = false;
            });
        }
        if (this.isCreated) {
            if (this.state.editMode === 'layout' && !this.state.dragState.isDragging) {
                this.ui.updateLayoutInputs(this.state, h);
            }
            if (this.state.editMode === 'settings') {
                this.ui.updateSettingsInputs(this.state);
            }
            if (!this.isRendering) {
                this.isRendering = true;
                requestAnimationFrame(() => {
                    this.renderer.draw(this.state, this.config, this.state.hass);
                    this.isRendering = false;
                });
            }
            if (!this.isRendering && !this.state.dragState.isDragging) {
                this.ui.updateStatus(this.state, this.config);
            }
        }
    }
    showAutoBlockProgress(totalSec) {
        let hud = this.shadowRoot.getElementById('autoblock-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'autoblock-hud';
            hud.style.cssText = `
                position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
                background: rgba(20, 20, 20, 0.94); border: 1px solid #1976D2; border-radius: 6px;
                padding: 6px 14px; color: #fff; z-index: 100; box-shadow: 0 4px 14px rgba(0,0,0,0.7);
                display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 11px;
                font-family: sans-serif; pointer-events: none; transition: opacity 0.4s ease;
            `;
            hud.innerHTML = `
                <div id="autoblock-hud-text" style="font-weight: bold; color: #64B5F6; white-space: nowrap;"></div>
                <div style="width: 160px; height: 5px; background: #333; border-radius: 3px; overflow: hidden;">
                    <div id="autoblock-hud-bar" style="width: 0%; height: 100%; background: #1976D2; transition: width 0.3s linear;"></div>
                </div>
            `;
            const rootEl = this.shadowRoot.getElementById('root');
            if (rootEl) rootEl.appendChild(hud);
        }
        hud.style.opacity = '1';
        hud.style.display = 'flex';
        const txtEl = hud.querySelector('#autoblock-hud-text');
        const barEl = hud.querySelector('#autoblock-hud-bar');
        const stored = localStorage.getItem('rmm_panel_lang');
        const isZh = (stored === 'zh' || (!stored && this.state.hass?.language?.startsWith('zh')));
        let remaining = totalSec;
        const updateHUD = () => {
            if (txtEl) {
                txtEl.innerText = isZh 
                    ? `⏳ 正在识别环境噪点... ${remaining}s (请保持静止)`
                    : `⏳ Scanning noise... ${remaining}s (Stay clear)`;
            }
            if (barEl) {
                const percent = Math.min(100, Math.round(((totalSec - remaining) / totalSec) * 100));
                barEl.style.width = `${percent}%`;
                barEl.style.background = '#1976D2';
            }
        };
        updateHUD();
        if (this._autoBlockTimer) clearInterval(this._autoBlockTimer);
        this._autoBlockTimer = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                updateHUD();
            } else {
                clearInterval(this._autoBlockTimer);
                this._autoBlockTimer = null;
                if (txtEl) {
                    txtEl.innerText = isZh ? "✅ 自动识别完成！正在同步生成排除区..." : "✅ Auto Learn completed! Syncing...";
                    txtEl.style.color = "#4CAF50";
                }
                if (barEl) {
                    barEl.style.width = '100%';
                    barEl.style.background = '#4CAF50';
                }
                setTimeout(() => {
                    if (hud) hud.style.opacity = '0';
                    setTimeout(() => { if (hud) hud.style.display = 'none'; }, 400);
                }, 2500);
            }
        }, 1000);
    }
    fetchData(force = false) {
        if (force) {
            this.state.hasUnsavedChanges = false;
            this.ignoreUpdatesUntil = 0;
        }
    }
    handleNewData(rawData) {
        if (this.ignoreUpdatesUntil > 0 && Date.now() < this.ignoreUpdatesUntil) return;
        const isFrozen = this.state.calibration && this.state.calibration.active;
        if (!this.state.hasUnsavedChanges && !isFrozen) {
            this.fullRawData = JSON.parse(JSON.stringify(rawData));
            this.state.data = this._adaptV2ToV1(rawData);
            this.state.historyStack = [];
            this.initWebSockets();
            this.state.directFusedTargets = this.state.fused_targets || [];
            const renderMode = this.state.data?.global_config?.target_render_mode || this.config.target_render_mode || 'css';
            if (renderMode === 'canvas' && (this.state.editMode === 'zone' || this.state.editMode === 'settings' || !this.state.editing)) {
                this.renderer.updateFusedTargets(this.state.directFusedTargets);
            }
            this.state.hass = this.getMockHass(this.state.rawHass);
            this.renderer.draw(this.state, this.config, this.state.hass);
            this.ui.updateStatus(this.state, this.config);
        }
    }
    _adaptV2ToV1(v2Data) {
        const mapGroup = this.state.mapGroup;
        const v1Data = {};
        const mapData = (v2Data.maps && v2Data.maps[mapGroup]) || {};
        v1Data.global_zones = mapData.zones || { include_zones: [], exclude_zones: [] };
        v1Data.global_config = mapData.config || { update_interval: 0.1, merge_distance: 0.8 };
        this.state.fused_targets = mapData.targets || []; 
        const allRadars = v2Data.radars || {};
        Object.keys(allRadars).forEach(rName => {
            if (rName === 'fused_targets') return; 
            const rData = allRadars[rName];
            const rGroup = rData.map_group || "default";
            if (rGroup === mapGroup) v1Data[rName] = rData;
        });
        return v1Data;
    }
    // Lite: il solo canale WebSocket e' rmm/stream, da Home Assistant.
    initWebSockets() {}
    connectWS(_radarName) {}
    getMockHass(h) {
        if (!h) return null;
        let mockHass = { ...h, states: { ...h.states } };
        const radars = this.state.data || {};
        let anyWsConnected = false;
        let currentIds = [];
        for (const [rName, rConf] of Object.entries(radars)) {
            if (['global_zones', 'global_config', 'fused_targets'].includes(rName)) continue;
            let wsData = this.state.wsTargets && this.state.wsTargets[rName];
            let sourceTargets = [];
            if (rConf.paused === true) {
                sourceTargets = [];
            } else if (wsData && wsData.connected) {
                sourceTargets = wsData.targets || [];
                anyWsConnected = true;
            } else {
                sourceTargets = rConf.targets || []; 
            }
            for (let i = 1; i <= 5; i++) {
                const prefix = `sensor.${rName.toLowerCase()}_target_${i}`;
                mockHass.states[`${prefix}_x`] = { state: 'unavailable', attributes: { unit_of_measurement: 'mm' } };
                mockHass.states[`${prefix}_y`] = { state: 'unavailable', attributes: { unit_of_measurement: 'mm' } };
            }
            if (!this.state.smoothedTargets) this.state.smoothedTargets = {};
            sourceTargets.forEach(t => {
                const prefix = `sensor.${rName.toLowerCase()}_target_${t.i}`;
                const tid = `ws_${rName}_${t.i}`;
                currentIds.push(tid);
                let smooth_x = t.x;
                let smooth_y = t.y;
                let alpha = 0.4;
                if (this.state.data && this.state.data.global_config && this.state.data.global_config.ema_smoothing_level !== undefined) {
                    alpha = Math.max(0.1, Math.min(1.0, (11 - parseInt(this.state.data.global_config.ema_smoothing_level)) / 10.0));
                }
                if (wsData && wsData.connected) {
                    if (this.state.smoothedTargets[tid]) {
                        smooth_x = this.state.smoothedTargets[tid].x * (1 - alpha) + t.x * alpha;
                        smooth_y = this.state.smoothedTargets[tid].y * (1 - alpha) + t.y * alpha;
                    }
                    this.state.smoothedTargets[tid] = { x: smooth_x, y: smooth_y };
                } else {
                    delete this.state.smoothedTargets[tid];
                }
                mockHass.states[`${prefix}_x`] = { state: smooth_x.toString(), attributes: { unit_of_measurement: 'mm' } };
                mockHass.states[`${prefix}_y`] = { state: smooth_y.toString(), attributes: { unit_of_measurement: 'mm' } };
            });
        }
        if (this.state.fused_targets) {
            let smoothed_fused = [];
            let alpha = 0.4;
            if (this.state.data && this.state.data.global_config && this.state.data.global_config.ema_smoothing_level !== undefined) {
                alpha = Math.max(0.1, Math.min(1.0, (11 - parseInt(this.state.data.global_config.ema_smoothing_level)) / 10.0));
            }
            this.state.fused_targets.forEach(t => {
                const tid = `fused_${t.id}`;
                currentIds.push(tid);
                let smooth_x = t.x;
                let smooth_y = t.y;
                if (this.state.smoothedTargets[tid]) {
                    smooth_x = this.state.smoothedTargets[tid].x * (1 - alpha) + t.x * alpha;
                    smooth_y = this.state.smoothedTargets[tid].y * (1 - alpha) + t.y * alpha;
                }
                this.state.smoothedTargets[tid] = { x: smooth_x, y: smooth_y };
                smoothed_fused.push({ ...t, x: smooth_x, y: smooth_y });
            });
            const mapGroup = this.state.mapGroup || "default";
            const safeMap = mapGroup.toLowerCase().replace(/\s+/g, '_');
            const masterId = `sensor.rmm_${safeMap}_master`;
            let masterEnt = mockHass.states[masterId] || { state: '0', attributes: {} };
            mockHass.states[masterId] = {
                ...masterEnt,
                state: smoothed_fused.length.toString(),
                attributes: {
                    ...masterEnt.attributes,
                    targets: smoothed_fused
                }
            };
        }
        if (this.state.smoothedTargets) {
            Object.keys(this.state.smoothedTargets).forEach(id => { 
                if (!currentIds.includes(id)) delete this.state.smoothedTargets[id]; 
            });
        }
        this.state.using_ws_targets = anyWsConnected;
        return mockHass;
    }
    initLogic() {
        const that = this;
        const callbacks = {
            onModeChange: (mode) => {
                that.state.editMode = mode;
                that.state.points = [];
                that.state.fov_edit_mode = false; 
                that.state.calibration = { active: false, raw: null, map: null }; 
                that.resetSelection(); 
                setTimeout(() => {
                    that.ui.updateStatus(that.state, that.config);
                    if(mode === 'layout') {
                        that.ui.updateRadarList(that.state, that.config);
                        setTimeout(() => {
                            that.ui.updateLayoutInputs(that.state, that._hass);
                            that.renderer.draw(that.state, that.config, that._hass);
                        }, 20); 
                    }
                }, 50);
            },
            onToggleEditMode: () => {
                if (that.state.editing) that.exitEditMode(); 
                else that.enterEditMode(that._hass);
            },
            selectZone: (i, j, z) => {
                that.state.selectedIndex = i;
                that.state.selectedPointIndex = j;
                that.ui.updateStatus(that.state, that.config);
                that.renderer.draw(that.state, that.config, that._hass);
            },
            resetSelection: () => that.resetSelection(),
            deletePoint: (polyIdx, ptIdx) => {
                const list = that._getTargetList(that.state);
                if (list[polyIdx]) {
                    const z = list[polyIdx];
                    const pts = Array.isArray(z) ? z : z.points;
                    if (pts) {
                        pts.splice(ptIdx, 1);
                        that.state.hasUnsavedChanges = true;
                        that.renderer.draw(that.state, that.config, that._hass);
                        that.ui.updateStatus(that.state, that.config);
                    }
                }
            },
            onSaveZoneConfig: async () => {
                that.state.isAddingNew = false;
                that.state.hasUnsavedChanges = false;
                that.state.selectedPointIndex = null;
                const isHwZone = (that.state.editMode === 'layout' && ['hw_detect_zones', 'hw_block_zones', 'hw_stay_zones'].includes(that.state.radar_zone_type));
                const currentRadar = that.state.radar;
                const radarData = (that.state.data && that.state.data[currentRadar]) || {};
                const isExclusiveHw = isHwZone && !!(radarData.capabilities && radarData.auth_passed === true);
                try {
                    if (isExclusiveHw && that._hass && that._hass.connection) {
                        let unsub = null;
                        let timer = null;
                        let resolved = false;
                        let resolveConfirm = null;
                        const confirmPromise = new Promise((resolve) => {
                            resolveConfirm = resolve;
                            timer = setTimeout(() => {
                                if (!resolved) {
                                    resolved = true;
                                    resolve(false);
                                }
                            }, 5000); 
                        });
                        try {
                            unsub = await that._hass.connection.subscribeEvents((event) => {
                                const evRadar = (event.data && (event.data.radar || event.data.radar_name || '')) + '';
                                if (evRadar.toLowerCase() === (currentRadar || '').toLowerCase()) {
                                    if (!resolved) {
                                        resolved = true;
                                        if (timer) clearTimeout(timer);
                                        resolveConfirm(true);
                                    }
                                }
                            }, "rmm_hw_zone_confirmed");
                        } catch (subErr) {
                            console.warn("RMM: subscribeEvents rmm_hw_zone_confirmed failed:", subErr);
                        }
                        await that.saveToBackend(true, currentRadar);
                        that.ui.updateStatus(that.state, that.config);
                        that.renderer.draw(that.state, that.config, that._hass);
                        const ok = await confirmPromise;
                        if (unsub) {
                            try { unsub(); } catch(e) {}
                        }
                        if (ok) {
                            alert(that.editor.t("hw_zone_saved_confirmed"));
                        } else {
                            alert(that.editor.t("hw_zone_saved_unconfirmed"));
                        }
                    } else {
                        await that.saveToBackend();
                        that.ui.updateStatus(that.state, that.config);
                        that.renderer.draw(that.state, that.config, that._hass);
                        alert(that.editor.t("zone_saved"));
                    }
                } catch (err) {
                    console.error("RMM: onSaveZoneConfig failed:", err);
                    alert(that.editor.t("ha_reject") + (err.message || err));
                }
            },
            onToggleFOV: () => { 
                if (that.state.fov_edit_mode && that.state.editMode === 'layout' && (that.state.radar_zone_type === 'hw_detect_zones' || that.state.radar_zone_type === 'hw_block_zones' || that.state.radar_zone_type === 'hw_stay_zones' || that.state.radar_zone_type === 'monitor_zones')) {
                    setTimeout(() => that.saveToBackend(), 100);
                }
                that.state.fov_edit_mode = !that.state.fov_edit_mode; 
                that.ui.updateStatus(that.state, that.config); 
            },
            onDiscardConfig: () => { 
                that.fetchData(true); 
            },
            onTypeChange: (val) => { that.state.type = val; that.resetSelection(); },
            onRadarChange: (val) => { 
                that.state.radar = val; 
                that.resetSelection(); 
                that.state.followZonesEnabled = false; 
                that.state.hasHwZoneChanges = false; 
                that.state.origFollowZonesSnapshot = null; 
                that.ui.updateRadarList(that.state, that.config); 
            },
            onLayoutParamChange: (k, v) => { 
                if(!that.state.layoutChanges) that.state.layoutChanges = {};
                that.state.layoutChanges[k] = v; 
                that.state.hasUnsavedChanges = true;
                that.renderer.draw(that.state, that.config, that._hass); 
            },
            onSaveLayout: async () => {
                if(!that.state.radar) return;
                const r = that.state.data[that.state.radar];
                const newLayout = { ...(r.layout || {}), ...that.state.layoutChanges };
                // La geometria viene salvata localmente, senza scrivere sui controlli ESPHome.
                if (that.state.layoutChanges.z_min !== undefined || that.state.layoutChanges.z_max !== undefined ||
                    newLayout.z_min !== undefined || newLayout.z_max !== undefined) {
                    const zMin = newLayout.z_min !== undefined ? parseFloat(newLayout.z_min) : (that.state.layoutChanges.z_min !== undefined ? parseFloat(that.state.layoutChanges.z_min) : -6.0);
                    const zMax = newLayout.z_max !== undefined ? parseFloat(newLayout.z_max) : (that.state.layoutChanges.z_max !== undefined ? parseFloat(that.state.layoutChanges.z_max) : 6.0);
                    if (!isNaN(zMin) && !isNaN(zMax)) {
                        newLayout.z_min = zMin;
                        newLayout.z_max = zMax;
                    }
                }
                try {
                    const svcPayload = {
                        radar_name: that.state.radar,
                        layout: newLayout,
                        map_group: that.state.mapGroup
                    };
                    if (that.state.followZonesEnabled && that.state.hasHwZoneChanges) {
                        const zonesToSave = {};
                        ['hw_detect_zones', 'hw_block_zones', 'hw_stay_zones'].forEach(zType => {
                            if (r[zType] !== undefined) {
                                zonesToSave[zType] = JSON.parse(JSON.stringify(r[zType]));
                            }
                        });
                        svcPayload.zones = zonesToSave;
                        if (that.fullRawData && that.fullRawData.radars && that.fullRawData.radars[that.state.radar]) {
                            Object.assign(that.fullRawData.radars[that.state.radar], zonesToSave);
                        }
                    }
                    let saveSuccess = false;
                    try {
                        await that._hass.callService('radar_map_manager', 'update_radar_layout', svcPayload);
                        saveSuccess = true;
                    } catch (callErr) {
                        if (callErr && (callErr.code === 3 || (callErr.message && callErr.message.includes('Connection lost')))) {
                            console.warn("RMM: onSaveLayout encountered Connection lost, retrying after 1.5s...", callErr);
                            await new Promise(res => setTimeout(res, 1500));
                            if (that._hass && that._hass.callService) {
                                await that._hass.callService('radar_map_manager', 'update_radar_layout', svcPayload);
                                saveSuccess = true;
                            }
                        } else {
                            throw callErr;
                        }
                    }
                    if (saveSuccess) {
                        that.state.layoutChanges = {};
                        that.state.hasUnsavedChanges = false;
                        that.state.hasHwZoneChanges = false;
                        that.state.origFollowZonesSnapshot = null;
                        that.fetchData(true);
                        alert(that.editor.t("layout_saved"));
                    }
                } catch (err) {
                    console.error("RMM: onSaveLayout failed:", err);
                    alert(that.editor.t("ha_reject") + (err.message || err));
                }
            },
            onCalibrationToggle: () => {
                if (that.state.calibration.active) {
                    that.state.calibration = { active: false, raw: null, map: null };
                } else {
                    if (!that.state.radar) return alert(that.editor.t("sel_radar"));
                    const rName = that.state.radar.toLowerCase();
                    const xEnt = that.state.hass.states[`sensor.${rName}_target_1_x`]; 
                    const yEnt = that.state.hass.states[`sensor.${rName}_target_1_y`]; 
                    let rx = 0, ry = 0;
                    if (xEnt && yEnt && xEnt.state !== 'unavailable' && yEnt.state !== 'unavailable') {
                        rx = parseFloat(xEnt.state); ry = parseFloat(yEnt.state);
                        const unit = xEnt.attributes.unit_of_measurement;
                        if (unit === 'm') { rx *= 1000; ry *= 1000; }
                        else if (unit === 'cm') { rx *= 10; ry *= 10; }
                    } 
                    else {
                        const dEnt = that.state.hass.states[`sensor.${rName}_distance`]; 
                        if (dEnt && dEnt.state !== 'unavailable' && dEnt.state !== 'unknown') {
                            rx = 0; ry = parseFloat(dEnt.state);
                            const unit = dEnt.attributes.unit_of_measurement;
                            if (unit === 'm') ry *= 1000; else if (unit === 'cm') ry *= 10;
                        } else {
                            return alert(that.editor.t("no_t1"));
                        }
                    }
                    const layoutCfg = that.renderer.getRadarConfig(that.state, that.state.radar, that.state.hass); 
                    const currentMapPos = that.math.calculate(layoutCfg, { x: rx, y: ry, z: 0 });
                    that.state.calibration = {
                        active: true, raw: { x: rx, y: ry }, map: { x: currentMapPos.left, y: currentMapPos.top } 
                    };
                }
                that.ui.updateStatus(that.state, that.config);
                that.renderer.draw(that.state, that.config, that._hass);
            }
        };
        this.editor.bindEvents(this.state, this.config, callbacks);
    }
    resetSelection() {
        this.state.selectedIndex = null;
        this.state.selectedPointIndex = null;
        this.state.isAddingNew = false;
        this.ui.updateStatus(this.state, this.config);
            this.renderer.draw(this.state, this.config, this.state.hass);
    }
    _getTargetList(state) {
        if (state.editMode === 'layout') {
            if (!state.radar) return [];
            if (!state.data[state.radar]) state.data[state.radar] = {};
            const type = state.radar_zone_type || 'monitor_zones';
            if (!Array.isArray(state.data[state.radar][type])) {
                state.data[state.radar][type] = [];
            }
            return state.data[state.radar][type];
        } else {
            const type = state.type || 'include_zones';
            if (!state.data.global_zones) state.data.global_zones = { include_zones: [], exclude_zones: [] };
            if (!Array.isArray(state.data.global_zones[type])) {
                state.data.global_zones[type] = [];
            }
            return state.data.global_zones[type];
        }
    }
    async saveToBackend(allowEmpty = false, targetRadar = null) {
        this.ignoreUpdatesUntil = Date.now() + 3000;
        if (!this.fullRawData) {
            console.error("RMM: Cannot save! fullRawData is missing.");
            alert("⚠️ 安全拦截：尚未接收到雷达后端数据流！\n为防止配置被意外清空，已阻止本次保存。\n\n请刷新页面并等待地图加载后再试！");
            return;
        }
        let fullData = JSON.parse(JSON.stringify(this.fullRawData));
        const currentMapGroup = this.state.mapGroup;
        if (!fullData.maps) fullData.maps = {};
        if (!fullData.maps[currentMapGroup]) fullData.maps[currentMapGroup] = {};
        fullData.maps[currentMapGroup].zones = JSON.parse(JSON.stringify(this.state.data.global_zones));
        if (!fullData.radars) fullData.radars = {};
        Object.keys(this.state.data).forEach(key => {
            if (key === 'global_zones' || key === 'global_config' || key === 'fused_targets') return;
            if (!fullData.radars[key]) fullData.radars[key] = { map_group: currentMapGroup };
            if (this.state.data[key].monitor_zones !== undefined) {
                fullData.radars[key].monitor_zones = JSON.parse(JSON.stringify(this.state.data[key].monitor_zones));
            }
            if (this.state.data[key].hw_detect_zones !== undefined) fullData.radars[key].hw_detect_zones = JSON.parse(JSON.stringify(this.state.data[key].hw_detect_zones));
            if (this.state.data[key].hw_block_zones !== undefined)  fullData.radars[key].hw_block_zones  = JSON.parse(JSON.stringify(this.state.data[key].hw_block_zones));
            if (this.state.data[key].hw_stay_zones !== undefined)   fullData.radars[key].hw_stay_zones   = JSON.parse(JSON.stringify(this.state.data[key].hw_stay_zones));
        });
        this.fullRawData = JSON.parse(JSON.stringify(fullData));
        this.state.hasUnsavedChanges = false;
        try {
            const svcData = {
                config_json: JSON.stringify(fullData)
            };
            if (allowEmpty) svcData.allow_empty = true;
            if (targetRadar) svcData.target_radar = targetRadar;
            await this._hass.callService('radar_map_manager', 'import_config', svcData);
            setTimeout(() => {
                this.ignoreUpdatesUntil = 0;
            }, 300);
        } catch (err) {
            console.error("RMM: saveToBackend failed:", err);
            this.ignoreUpdatesUntil = 0;
            throw err;
        }
    }
    enterEditMode(h) {
        this.state.editing = true;
        this.ui.updateRadarList(this.state, this.config);
        this.state.points = [];
        this.state.dragState = { isDragging: false };
        this.ui.updateStatus(this.state, this.config);
        setTimeout(() => this.ui.updateLayoutInputs(this.state, h), 50);
        this.renderer.draw(this.state, this.config, h);
    }
    exitEditMode() {
        this.state.editing = false;
        this.state.points = [];
        this.resetSelection();
        this.ui.updateStatus(this.state, this.config);
        this.renderer.draw(this.state, this.config, this.state.hass);
    }
    startHeartbeat() { 
        if (this.retryTimer) clearInterval(this.retryTimer);
        this.retryTimer = setInterval(() => this.checkConnection(), 5000); 
    }
    checkConnection() {
        if (!this._hass) return;
        const isOk = this._hass.connection && this._hass.connection.connected;
        if (this.state.isConnected !== isOk) {
            this.state.isConnected = isOk;
            this.ui.updateStatus(this.state, this.config);
        }
    }
}
function registerCard() {
    if (!customElements.get('radar-map-card')) {
        customElements.define('radar-map-card', RadarMapCardNative);
        console.info(
            '%c RADAR-MAP-CARD %c Loaded ',
            'color: white; background: #03a9f4; font-weight: 700; padding: 2px 4px; border-radius: 3px 0 0 3px;',
            'color: #03a9f4; background: #e1f5fe; font-weight: 700; padding: 2px 4px; border-radius: 0 3px 3px 0;'
        );
    }
    window.customCards = window.customCards || [];
    const cardDef = {
        type: "radar-map-card",
        name: "Radar Map Card (Radar Map Manager)",
        preview: false, 
        description: "Advanced visual editor and radar map card for millimeter-wave radars, target tracking, and zone management."
    };
    const cardIndex = window.customCards.findIndex(c => c.type === 'radar-map-card');
    if (cardIndex >= 0) {
        window.customCards[cardIndex] = cardDef;
    } else {
        window.customCards.push(cardDef);
    }
}
registerCard();
