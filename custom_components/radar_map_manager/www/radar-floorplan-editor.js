// Local-only floorplan editor. Geometry is saved through the HA integration,
// never sent to a radar or an external service.
const NS = 'http://www.w3.org/2000/svg';
const SEGMENTS = new Set(['wall', 'door', 'window']);
const FURNITURE = {
    sofa: ['Divano', 2.0, 0.9, '#5f86be'],
    table: ['Tavolo', 1.8, 0.9, '#c5a46d'],
    kitchen: ['Cucina', 2.2, 0.65, '#6daca5'],
    chair: ['Sedia', 0.5, 0.5, '#b08e66'],
    bed: ['Letto', 2.0, 1.6, '#9d82c3'],
    cabinet: ['Mobile', 1.2, 0.55, '#a58974'],
    desk: ['Scrivania', 1.2, 0.65, '#a788c3'],
    other: ['Elemento', 1.0, 0.6, '#8896a5'],
};

export class RadarFloorplanEditor {
    constructor(host, root) {
        this.host = host;
        this.root = root;
        this.saved = null;
        this.draft = null;
        this.opened = false;
        this.dirty = false;
        this.selected = -1;
        this.anchor = null;
        this.history = [];
        this.tool = 'wall';
        this.grid = true;
        this.drag = null;
        this.displaySignature = '';
    }

    mount() {
        const btn = this.root.getElementById('btn-floorplan-editor');
        if (!btn || this.dialog) return;
        btn.addEventListener('click', () => this.open());
        const dialog = document.createElement('dialog');
        dialog.id = 'rmm-floorplan-dialog';
        dialog.innerHTML = `
            <style>
                #rmm-floorplan-dialog {
                    border: 1px solid #344154; border-radius: 17px; padding: 0;
                    background: #151e2a; color: #eaf0f7; width: min(1150px, 96vw);
                    height: min(870px, 92vh); max-width: none; max-height: none;
                    box-shadow: 0 26px 100px #000b; font: 14px/1.4 system-ui, sans-serif;
                    overflow: hidden;
                }
                #rmm-floorplan-dialog::backdrop { background: #020913b8; backdrop-filter: blur(5px); }
                #rmm-floorplan-dialog * { box-sizing: border-box; }
                #rmm-floorplan-dialog .fp-shell { display: grid; grid-template-rows: auto 1fr; height: 100%; }
                #rmm-floorplan-dialog .fp-top { display: flex; align-items: center; gap: 12px;
                    justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid #354458; }
                #rmm-floorplan-dialog .fp-top strong { font-size: 17px; }
                #rmm-floorplan-dialog .fp-body { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 0; }
                #rmm-floorplan-dialog .fp-tools { padding: 14px; overflow-y: auto; border-right: 1px solid #354458;
                    background: #192637; display: flex; flex-direction: column; gap: 12px; }
                #rmm-floorplan-dialog fieldset { border: 1px solid #3d4d60; border-radius: 10px; padding: 9px; margin: 0; }
                #rmm-floorplan-dialog legend { font-weight: 700; padding: 0 5px; color: #bad5f5; font-size: 12px; }
                #rmm-floorplan-dialog label { display: block; font-size: 12px; color: #c4d1e3; margin-bottom: 6px; }
                #rmm-floorplan-dialog input, #rmm-floorplan-dialog select { background: #101a27;
                    color: #fff; border: 1px solid #53667e; border-radius: 7px; padding: 7px;
                    max-width: 100%; height: auto; min-height: 34px; font-size: 14px; flex: initial; }
                #rmm-floorplan-dialog input[type=number] { width: 100%; }
                #rmm-floorplan-dialog select { width: 100%; }
                #rmm-floorplan-dialog .fp-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
                #rmm-floorplan-dialog button { background: #30445e; color: #e9f4ff; border: 1px solid #56708a;
                    border-radius: 8px; padding: 8px 10px; cursor: pointer; }
                #rmm-floorplan-dialog button:focus-visible, #rmm-floorplan-dialog input:focus-visible,
                #rmm-floorplan-dialog select:focus-visible { outline: 2px solid #74d8f3; outline-offset: 1px; }
                #rmm-floorplan-dialog button:hover { background: #446487; }
                #rmm-floorplan-dialog button:disabled { opacity: .4; cursor: not-allowed; }
                #rmm-floorplan-dialog .fp-primary { background: #087f9e; border-color: #25b6d3; font-weight: 700; }
                #rmm-floorplan-dialog .fp-danger { background: #713747; border-color: #b76578; }
                #rmm-floorplan-dialog .fp-actions { display: flex; flex-wrap: wrap; gap: 6px; }
                #rmm-floorplan-dialog .fp-select-main { width: 100%; display: flex;
                    justify-content: center; gap: 9px; align-items: center; font-weight: 750;
                    font-size: 14px; padding: 11px 8px; border: 2px solid #64cce8;
                    background: #184c65; }
                #rmm-floorplan-dialog .fp-select-main.active { background: #0a819f;
                    box-shadow: inset 0 0 0 1px #9be7f6; }
                #rmm-floorplan-dialog .fp-tool-note { color: #b7d6e3; font-size: 11px; margin: 0; }
                #rmm-floorplan-dialog .fp-handle { cursor: nwse-resize; }
                #rmm-floorplan-dialog .fp-rotate-handle { cursor: grab; }
                #rmm-floorplan-dialog .fp-item-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
                #rmm-floorplan-dialog .fp-item-buttons button { padding: 7px 4px; }
                #rmm-floorplan-dialog .fp-quick-toolbar { display: flex; gap: 8px;
                    flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
                #rmm-floorplan-dialog .fp-quick-toolbar button { min-height: 33px; }
                #rmm-floorplan-dialog .fp-quick-toolbar .active { background: #0a819f;
                    border-color: #71e7ff; }
                #rmm-floorplan-dialog .fp-stage { position: relative; min-width: 0; min-height: 0;
                    display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px;
                    background: radial-gradient(circle at 50% 25%, #243750, #101825 75%); }
                #rmm-floorplan-dialog .fp-stage-scroller { flex: 1; min-height: 0; min-width: 0;
                    width: 100%; display: flex; justify-content: center; align-items: center; overflow: auto; }
                #rmm-floorplan-dialog .fp-canvas { width: 100%; max-height: 100%; overflow: visible;
                    background: #101b28; border-radius: 5px; touch-action: none; cursor: crosshair;
                    box-shadow: 0 0 0 1px #4b637d, 0 10px 28px #0007; }
                #rmm-floorplan-dialog .fp-status { font-size: 12px; text-align: center; min-height: 35px;
                    color: #a5cbdd; }
                #rmm-floorplan-dialog .fp-help { font-size: 12px; color: #9db6ca; margin: 0; }
                #rmm-floorplan-dialog .fp-hidden { display: none !important; }
                #rmm-floorplan-dialog .fp-readout { font-variant-numeric: tabular-nums; font-size: 12px; color: #d8e5f1; }
                @media(max-width: 750px) {
                    #rmm-floorplan-dialog .fp-body { grid-template-columns: 1fr; grid-template-rows: minmax(0, auto) minmax(180px, 1fr); }
                    #rmm-floorplan-dialog .fp-tools { max-height: 37vh; border-right: 0; border-bottom: 1px solid #354458; }
                    #rmm-floorplan-dialog .fp-stage { padding: 10px; }
                }
            </style>
            <div class="fp-shell">
              <div class="fp-top">
                <div><strong>Editor piantina</strong><div class="fp-help">Stanze e arredi · nessun radar richiesto</div></div>
                <div class="fp-actions">
                    <button class="fp-primary" id="fp-save">Salva in Home Assistant</button>
                    <button id="fp-close">Chiudi</button>
                </div>
              </div>
              <div class="fp-body">
                <div class="fp-tools">
                  <fieldset>
                    <legend>Dimensioni stanza</legend>
                    <div class="fp-pair">
                      <label>Lunghezza (m)<input id="fp-width" type="number" min="1" max="100" step="0.1"></label>
                      <label>Larghezza (m)<input id="fp-height" type="number" min="1" max="100" step="0.1"></label>
                    </div>
                    <button id="fp-resize">Applica dimensioni</button>
                  </fieldset>
                  <fieldset>
                    <legend>Disegno</legend>
                    <button id="fp-select-mode" class="fp-select-main" type="button" aria-pressed="false">✥ Seleziona e sposta</button>
                    <p class="fp-tool-note">Scegli un elemento: trascina per spostarlo, usa le maniglie per cambiarne forma o orientamento.</p>
                    <label>Strumento
                    <select id="fp-tool">
                      <option value="select">Seleziona / sposta</option>
                      <option value="wall">Parete</option>
                      <option value="door">Porta</option>
                      <option value="window">Finestra</option>
                      <option value="sofa">Divano</option>
                      <option value="table">Tavolo</option>
                      <option value="kitchen">Cucina</option>
                      <option value="chair">Sedia</option>
                      <option value="bed">Letto</option>
                      <option value="cabinet">Mobile</option>
                      <option value="desk">Scrivania</option>
                      <option value="other">Altro</option>
                    </select></label>
                    <label><input id="fp-snap" type="checkbox" checked> Griglia e aggancio ogni 10 cm</label>
                    <div class="fp-actions">
                      <button id="fp-undo">Annulla ultima modifica</button>
                      <button id="fp-delete" class="fp-danger">Elimina selezionato</button>
                    </div>
                  </fieldset>
                  <fieldset id="fp-selection" class="fp-hidden">
                    <legend>Elemento selezionato</legend>
                    <div class="fp-pair">
                      <label id="fp-label-x">X (m)<input id="fp-item-x" type="number" min="0" step="0.1"></label>
                      <label id="fp-label-y">Y (m)<input id="fp-item-y" type="number" min="0" step="0.1"></label>
                      <label id="fp-label-w">Larghezza (m)<input id="fp-item-w" type="number" min="0.1" step="0.1"></label>
                      <label id="fp-label-h">Profondità (m)<input id="fp-item-h" type="number" min="0.1" step="0.1"></label>
                    </div>
                    <label id="fp-label-rotation" class="fp-hidden">Rotazione (gradi)
                      <input id="fp-item-rotation" type="number" min="0" max="359" step="1" value="0">
                    </label>
                    <button id="fp-apply-item">Applica misure</button>
                    <div class="fp-item-buttons" style="margin-top:7px">
                      <button id="fp-turn-left" type="button">↶ Ruota −90°</button>
                      <button id="fp-turn-right" type="button">↷ Ruota +90°</button>
                      <button id="fp-duplicate" type="button">Duplica</button>
                      <button id="fp-delete-quick" class="fp-danger" type="button">Elimina</button>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Salvataggi</legend>
                    <div class="fp-actions">
                      <button id="fp-export">Esporta JSON</button>
                      <button id="fp-import">Importa JSON</button>
                      <input id="fp-import-file" type="file" accept=".json,application/json" class="fp-hidden">
                    </div>
                    <button id="fp-clear" class="fp-danger">Rimuovi tutti gli elementi</button>
                  </fieldset>
                  <p class="fp-help">Pareti, porte e finestre: due clic. Mobili: un clic per aggiungerli, poi passa automaticamente a Seleziona. Trascina il corpo per spostare, il quadratino per ridimensionare, il cerchio per ruotare. Tutte le misure sono in metri.</p>
                </div>
                <div class="fp-stage">
                  <div class="fp-quick-toolbar">
                    <button id="fp-stage-select" type="button">✥ Seleziona / sposta</button>
                    <button id="fp-stage-left" type="button">↶ 90°</button>
                    <button id="fp-stage-right" type="button">↷ 90°</button>
                    <button id="fp-stage-delete" type="button">Elimina</button>
                  </div>
                  <div class="fp-readout" id="fp-meters"></div>
                  <div class="fp-stage-scroller">
                      <svg id="fp-svg" class="fp-canvas" viewBox="0 0 10 4" aria-label="Piantina modificabile"></svg>
                  </div>
                  <div class="fp-status" id="fp-status" role="status">Disegna gli elementi della stanza.</div>
                </div>
              </div>
            </div>
        `;
        this.root.appendChild(dialog);
        this.dialog = dialog;
        const $ = (id) => dialog.querySelector('#' + id);
        this.$ = $;
        $('fp-close').addEventListener('click', () => this.close());
        $('fp-save').addEventListener('click', () => this.save());
        $('fp-tool').addEventListener('change', (ev) => this.setTool(ev.target.value));
        $('fp-select-mode').addEventListener('click', () => {
            this.setTool('select');
            this.status('Seleziona un elemento, poi trascinalo o usa le maniglie.');
        });
        $('fp-stage-select').addEventListener('click', () => this.setTool('select'));
        $('fp-stage-left').addEventListener('click', () => this.rotateSelected(-90));
        $('fp-stage-right').addEventListener('click', () => this.rotateSelected(90));
        $('fp-stage-delete').addEventListener('click', () => this.removeSelected());
        $('fp-snap').addEventListener('change', (ev) => { this.grid = ev.target.checked; this.renderEditor(); });
        $('fp-resize').addEventListener('click', () => this.resizeRoom());
        $('fp-undo').addEventListener('click', () => this.undo());
        $('fp-delete').addEventListener('click', () => this.removeSelected());
        $('fp-delete-quick').addEventListener('click', () => this.removeSelected());
        $('fp-turn-left').addEventListener('click', () => this.rotateSelected(-90));
        $('fp-turn-right').addEventListener('click', () => this.rotateSelected(90));
        $('fp-duplicate').addEventListener('click', () => this.duplicateSelected());
        $('fp-apply-item').addEventListener('click', () => this.applyItemValues());
        $('fp-clear').addEventListener('click', () => {
            if (!this.draft.items.length || !window.confirm('Rimuovere tutti gli elementi della piantina?')) return;
            this.snapshot(); this.draft.items = []; this.selected = -1; this.renderEditor();
        });
        $('fp-export').addEventListener('click', () => this.export());
        $('fp-import').addEventListener('click', () => $('fp-import-file').click());
        $('fp-import-file').addEventListener('change', (ev) => this.importFile(ev));
        const svg = $('fp-svg');
        svg.addEventListener('pointerdown', (ev) => this.pointerDown(ev));
        svg.addEventListener('pointermove', (ev) => this.pointerMove(ev));
        svg.addEventListener('pointerup', (ev) => this.pointerUp(ev));
        svg.addEventListener('pointercancel', () => { this.drag = null; });
        dialog.addEventListener('cancel', (ev) => { ev.preventDefault(); this.close(); });
        dialog.addEventListener('close', () => { this.opened = false; this.anchor = null; this.drag = null; });
        this.renderOverlay();
    }

    _clone(plan) { return JSON.parse(JSON.stringify(plan)); }
    _round(value) { return Math.round(value * 100) / 100; }
    _limit(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
    _num(value, fallback) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }
    _angle(item) { return this._num(item.rotation, 0); }
    _normAngle(deg) { return this._round(((deg % 360) + 360) % 360); }
    _furnitureBounds(item) {
        const theta = this._angle(item) * Math.PI / 180;
        const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
        const halfX = (item.w*c + item.h*s)/2;
        const halfY = (item.w*s + item.h*c)/2;
        return {cx:item.x+item.w/2, cy:item.y+item.h/2, halfX, halfY};
    }
    _fitsFurniture(item, width, height) {
        if (!Number.isFinite(item.x) || !Number.isFinite(item.y) ||
            !Number.isFinite(item.w) || !Number.isFinite(item.h) ||
            item.w < .1 || item.h < .1 || item.x < -.001 || item.y < -.001 ||
            item.x+item.w > width+.001 || item.y+item.h > height+.001) return false;
        const b=this._furnitureBounds(item);
        return b.cx-b.halfX >= -.001 && b.cy-b.halfY >= -.001 &&
            b.cx+b.halfX <= width+.001 && b.cy+b.halfY <= height+.001;
    }
    _fitRotatedPosition(item, angle) {
        const next={...item,rotation:this._normAngle(angle)};
        const b=this._furnitureBounds(next), width=this.draft.width, height=this.draft.height;
        const left=Math.max(b.halfX,next.w/2), right=width-left;
        const top=Math.max(b.halfY,next.h/2), bottom=height-top;
        if (left>right+.001 || top>bottom+.001) return null;
        const cx=this._limit(b.cx,left,right);
        const cy=this._limit(b.cy,top,bottom);
        next.x=this._round(cx-next.w/2); next.y=this._round(cy-next.h/2);
        return this._fitsFurniture(next,width,height)?next:null;
    }
    setTool(tool) {
        if (tool!=='select' && !SEGMENTS.has(tool) && !Object.hasOwn(FURNITURE,tool)) return;
        this.tool=tool;
        this.anchor=null;
        if (tool!=='select') this.selected=-1;
        if (this.dialog) this.$('fp-tool').value=tool;
        this.renderEditor();
    }
    _normalize(plan) {
        if (!plan || typeof plan !== 'object') return {width: 10, height: 4, items: []};
        const width = this._limit(this._num(plan.width, 10), 1, 100);
        const height = this._limit(this._num(plan.height, 4), 1, 100);
        const result = { width, height, items: [] };
        if (!Array.isArray(plan.items)) return result;
        for (const item of plan.items.slice(0, 120)) {
            if (!item || typeof item !== 'object') continue;
            if (SEGMENTS.has(item.kind)) {
                const values = ['x1','y1','x2','y2'].map(k => this._num(item[k], NaN));
                if (!values.every(Number.isFinite)) continue;
                const [x1,y1,x2,y2] = values;
                if (x1 < 0 || x2 < 0 || y1 < 0 || y2 < 0 || x1 > width || x2 > width ||
                    y1 > height || y2 > height || Math.hypot(x2-x1,y2-y1) < .05) continue;
                result.items.push({kind:item.kind,x1,y1,x2,y2});
            } else if (Object.hasOwn(FURNITURE, item.kind)) {
                const values = ['x','y','w','h'].map(k => this._num(item[k], NaN));
                if (!values.every(Number.isFinite)) continue;
                const [x,y,w,h] = values;
                const rawAngle=item.rotation===undefined?0:this._num(item.rotation,NaN);
                if (!Number.isFinite(rawAngle) || rawAngle < -360 || rawAngle > 360) continue;
                const rotation=this._normAngle(rawAngle);
                const next={kind:item.kind,x,y,w,h};
                if (rotation) next.rotation=rotation;
                if (!this._fitsFurniture(next,width,height)) continue;
                result.items.push(next);
            }
        }
        return result;
    }
    setFloorplan(plan) {
        const signature = JSON.stringify(plan || null);
        if (signature === this.displaySignature) return;
        this.displaySignature = signature;
        this.saved = plan ? this._normalize(plan) : null;
        this.renderOverlay();
    }
    renderOverlay() {
        const layer = this.root.getElementById('floorplan-layer');
        if (!layer) return;
        layer.replaceChildren();
        if (this.saved) {
            layer.setAttribute('viewBox',`0 0 ${this.saved.width} ${this.saved.height}`);
            this.drawShapes(layer, this.saved, false, false);
        }
    }
    open() {
        this.mount();
        if (this.opened) return;
        if (this.host.state.editing) this.host.exitEditMode();
        this.opened = true; this.dirty = false; this.selected = -1;
        this.anchor = null; this.history = []; this.drag = null;
        this.draft = this._clone(this.saved || {width:10,height:4,items:[]});
        this.tool = this.draft.items.length ? 'select' : 'wall';
        this.$('fp-tool').value = this.tool;
        this.$('fp-width').value = this.draft.width;
        this.$('fp-height').value = this.draft.height;
        this.$('fp-status').textContent = 'Inizia disegnando una parete con due clic.';
        this.dialog.showModal();
        this.renderEditor();
    }
    close(force = false) {
        if (!this.opened) return;
        if (!force && this.dirty && !window.confirm('Chiudere senza salvare le modifiche?')) return;
        this.opened = false;
        this.dialog.close();
    }
    snapshot() {
        this.history.push(this._clone(this.draft));
        if (this.history.length > 30) this.history.shift();
        this.dirty = true;
    }
    undo() {
        if (!this.history.length) return;
        this.draft = this.history.pop();
        this.selected = -1; this.anchor = null; this.dirty = true;
        this.$('fp-width').value = this.draft.width;
        this.$('fp-height').value = this.draft.height;
        this.renderEditor();
    }
    resizeRoom() {
        const w = this._num(this.$('fp-width').value, NaN);
        const h = this._num(this.$('fp-height').value, NaN);
        if (!(w >= 1 && w <= 100 && h >= 1 && h <= 100)) {
            this.status('Inserisci dimensioni comprese fra 1 e 100 metri.', true); return;
        }
        const proposed=this._clone(this.draft);
        const sx = w / proposed.width, sy = h / proposed.height;
        for (const item of proposed.items) {
            if (SEGMENTS.has(item.kind)) {
                item.x1 *= sx; item.x2 *= sx; item.y1 *= sy; item.y2 *= sy;
            } else {
                item.x *= sx; item.w *= sx; item.y *= sy; item.h *= sy;
            }
        }
        proposed.width=w;proposed.height=h;
        const normalized=this._normalize(proposed);
        if (normalized.items.length!==proposed.items.length) {
            this.status('Le nuove dimensioni farebbero uscire alcuni mobili dalla stanza. Spostali prima di ridimensionare.',true);
            return;
        }
        this.snapshot();this.draft=normalized;
        this.selected = -1; this.anchor = null;
        this.renderEditor(); this.status('Dimensioni aggiornate. Gli elementi sono stati ridimensionati.');
    }
    svgPoint(ev) {
        const svg = this.$('fp-svg');
        const transform = svg.getScreenCTM();
        if (!transform) return null;
        const local = svg.createSVGPoint();
        local.x = ev.clientX; local.y = ev.clientY;
        const pos = local.matrixTransform(transform.inverse());
        const snap = (n) => this.grid ? Math.round(n*10)/10 : this._round(n);
        return {
            x: this._round(this._limit(snap(pos.x),0,this.draft.width)),
            y: this._round(this._limit(snap(pos.y),0,this.draft.height)),
        };
    }
    pointerDown(ev) {
        if ((ev.pointerType === 'mouse' && ev.button !== 0) || !this.opened) return;
        const pos = this.svgPoint(ev);
        if (!pos) return;
        if (this.tool === 'select') {
            const node = ev.target.closest('[data-fp-index]');
            this.selected = node ? Number(node.dataset.fpIndex) : -1;
            if (this.selected >= 0 && this.selected < this.draft.items.length) {
                this.drag = {
                    index: this.selected, start: pos,
                    original: this._clone(this.draft.items[this.selected]),
                    mode: ev.target.closest('[data-fp-handle]')?.dataset.fpHandle || 'move',
                    moved: false,
                };
                if (!SEGMENTS.has(this.drag.original.kind)) {
                    const b=this._furnitureBounds(this.drag.original);
                    this.drag.center={x:b.cx,y:b.cy};
                    this.drag.startAngle=Math.atan2(pos.y-b.cy,pos.x-b.cx)*180/Math.PI;
                }
                this.$('fp-svg').setPointerCapture(ev.pointerId);
            } else this.drag = null;
            this.renderEditor();
            return;
        }
        if (this.draft.items.length >= 120) { this.status('Limite di 120 elementi raggiunto.',true); return; }
        if (SEGMENTS.has(this.tool)) {
            if (!this.anchor) {
                this.anchor = pos;
                this.status('Clicca il punto finale della parete / apertura.');
            } else {
                if (Math.hypot(pos.x-this.anchor.x,pos.y-this.anchor.y)<.05) {
                    this.status('Scegli due punti distanti almeno 5 cm.',true); return;
                }
                this.snapshot();
                this.draft.items.push({kind:this.tool, x1:this.anchor.x,y1:this.anchor.y,x2:pos.x,y2:pos.y});
                this.anchor = null;
                this.status('Elemento aggiunto. Puoi disegnarne un altro.');
            }
        } else if (Object.hasOwn(FURNITURE,this.tool)) {
            const [,fw,fh] = FURNITURE[this.tool];
            const w=Math.min(fw,this.draft.width), h=Math.min(fh,this.draft.height);
            this.snapshot();
            this.draft.items.push({kind:this.tool,x:this._round(this._limit(pos.x-w/2,0,this.draft.width-w)),
                y:this._round(this._limit(pos.y-h/2,0,this.draft.height-h)),w,h});
            this.selected=this.draft.items.length-1;
            this.tool='select';
            this.$('fp-tool').value='select';
            this.status('Mobile selezionato: trascinalo, usa la maniglia quadrata o imposta le misure.');
        }
        this.renderEditor();
    }
    pointerMove(ev) {
        if (!this.drag || this.tool !== 'select') return;
        const pos = this.svgPoint(ev);
        if (!pos) return;
        const deltaX = pos.x - this.drag.start.x;
        const deltaY = pos.y - this.drag.start.y;
        const orig=this.drag.original;
        let next={...orig};
        if (SEGMENTS.has(orig.kind)) {
            if (this.drag.mode==='start') {
                next.x1=pos.x; next.y1=pos.y;
            } else if (this.drag.mode==='end') {
                next.x2=pos.x; next.y2=pos.y;
            } else {
                const dx=this._limit(deltaX,-Math.min(orig.x1,orig.x2),
                    this.draft.width-Math.max(orig.x1,orig.x2));
                const dy=this._limit(deltaY,-Math.min(orig.y1,orig.y2),
                    this.draft.height-Math.max(orig.y1,orig.y2));
                next.x1=this._round(orig.x1+dx); next.x2=this._round(orig.x2+dx);
                next.y1=this._round(orig.y1+dy); next.y2=this._round(orig.y2+dy);
            }
            if (Math.hypot(next.x2-next.x1,next.y2-next.y1)<.05) return;
        } else if (this.drag.mode==='rotate') {
            const current=Math.atan2(pos.y-this.drag.center.y,pos.x-this.drag.center.x)*180/Math.PI;
            let rotation=this._angle(orig)+current-this.drag.startAngle;
            if (this.grid) rotation=Math.round(rotation/15)*15;
            next=this._fitRotatedPosition(orig,rotation);
            if (!next) return;
        } else if (this.drag.mode==='resize') {
            const t=this._angle(orig)*Math.PI/180,c=Math.cos(t),s=Math.sin(t);
            const localX=deltaX*c+deltaY*s;
            const localY=-deltaX*s+deltaY*c;
            const snap=(n)=>this.grid?Math.round(n*10)/10:this._round(n);
            next.w=snap(Math.max(.1,orig.w+2*localX));
            next.h=snap(Math.max(.1,orig.h+2*localY));
            const centerX=orig.x+orig.w/2,centerY=orig.y+orig.h/2;
            next.x=this._round(centerX-next.w/2); next.y=this._round(centerY-next.h/2);
            if (!this._fitsFurniture(next,this.draft.width,this.draft.height)) return;
        } else {
            const b=this._furnitureBounds(orig);
            const minX=Math.max(b.halfX,orig.w/2),minY=Math.max(b.halfY,orig.h/2);
            const cx=this._limit(b.cx+deltaX,minX,this.draft.width-minX);
            const cy=this._limit(b.cy+deltaY,minY,this.draft.height-minY);
            next.x=this._round(cx-orig.w/2);
            next.y=this._round(cy-orig.h/2);
            if (!this._fitsFurniture(next,this.draft.width,this.draft.height)) return;
        }
        if (JSON.stringify(next)===JSON.stringify(this.draft.items[this.drag.index])) return;
        if (!this.drag.moved) { this.snapshot(); this.drag.moved=true; }
        this.draft.items[this.drag.index]=next;
        this.renderEditor();
    }
    pointerUp(ev) {
        if (!this.drag) return;
        if (this.$('fp-svg').hasPointerCapture(ev.pointerId))
            this.$('fp-svg').releasePointerCapture(ev.pointerId);
        this.drag=null;
        this.renderEditor();
    }
    removeSelected() {
        if (this.selected < 0 || !this.draft.items[this.selected]) return;
        this.snapshot(); this.draft.items.splice(this.selected,1);
        this.selected=-1; this.renderEditor();
    }
    rotateSelected(deg) {
        const item=this.draft.items[this.selected];
        if (!item) return;
        let next={...item};
        if (SEGMENTS.has(item.kind)) {
            const t=deg*Math.PI/180,c=Math.cos(t),s=Math.sin(t);
            const mx=(item.x1+item.x2)/2,my=(item.y1+item.y2)/2;
            for (const end of ['1','2']) {
                const x=item['x'+end]-mx,y=item['y'+end]-my;
                next['x'+end]=this._round(mx+x*c-y*s);
                next['y'+end]=this._round(my+x*s+y*c);
            }
        } else {
            next=this._fitRotatedPosition(item,this._angle(item)+deg);
        }
        if (!next || this._normalize({width:this.draft.width,height:this.draft.height,items:[next]}).items.length!==1) {
            this.status('Non c’è spazio per ruotare l’elemento entro i confini della stanza.',true);
            return;
        }
        this.snapshot();this.draft.items[this.selected]=next;
        this.renderEditor();this.status('Elemento ruotato.');
    }
    duplicateSelected() {
        const item=this.draft.items[this.selected];
        if (!item || this.draft.items.length>=120) return;
        let next=null;
        for (const offset of [.3,-.3,.1,-.1]) {
            const candidate={...item};
            if (SEGMENTS.has(item.kind)) {
                candidate.x1+=offset;candidate.x2+=offset;
                candidate.y1+=offset;candidate.y2+=offset;
            } else {
                candidate.x=this._round(candidate.x+offset);
                candidate.y=this._round(candidate.y+offset);
            }
            const valid=this._normalize({width:this.draft.width,height:this.draft.height,items:[candidate]});
            if (valid.items.length) {next=valid.items[0];break;}
        }
        if (!next) {this.status('Sposta prima l’oggetto: non c’è spazio per duplicarlo.',true);return;}
        this.snapshot();this.draft.items.push(next);this.selected=this.draft.items.length-1;
        this.setTool('select');this.status('Copia selezionata. Trascinala nella posizione desiderata.');
    }
    applyItemValues() {
        const item=this.draft.items[this.selected];
        if (!item) return;
        const keys=SEGMENTS.has(item.kind)?['x1','y1','x2','y2']:['x','y','w','h'];
        const controls=['fp-item-x','fp-item-y','fp-item-w','fp-item-h'];
        const next={...item};
        for(let i=0;i<4;i++) next[keys[i]]=this._num(this.$(controls[i]).value,NaN);
        if (!SEGMENTS.has(item.kind)) {
            const angle=this._num(this.$('fp-item-rotation').value,NaN);
            if (!Number.isFinite(angle)||angle<-360||angle>360) {
                this.status('La rotazione deve essere compresa tra 0° e 359°.',true);return;
            }
            next.rotation=this._normAngle(angle);
        }
        const tmp=this._normalize({width:this.draft.width,height:this.draft.height,items:[next]});
        if (tmp.items.length!==1) { this.status('Misure non valide o fuori stanza.',true); return; }
        this.snapshot(); this.draft.items[this.selected]=tmp.items[0];
        this.renderEditor(); this.status('Misure applicate.');
    }
    status(message, bad=false) {
        if (!this.dialog) return;
        const s=this.$('fp-status'); s.textContent=message; s.style.color=bad?'#ffa3ae':'#a5cbdd';
    }
    _svg(parent,tag,attributes={}) {
        const el=document.createElementNS(NS,tag);
        for(const [key,val] of Object.entries(attributes)) el.setAttribute(key,String(val));
        parent.appendChild(el); return el;
    }
    drawShapes(svg,plan,percent,selectable) {
        const sx=percent?100/plan.width:1, sy=percent?100/plan.height:1;
        const stroke={ 'vector-effect':'non-scaling-stroke', 'stroke-linecap':'round' };
        this._svg(svg,'rect',{
            x:0,y:0,width:plan.width*sx,height:plan.height*sy,
            fill:percent?'rgba(18,32,48,.10)':'#1a2c3e',stroke:'#a6bdd3',
            'stroke-width':'3', 'vector-effect':'non-scaling-stroke',
        });
        plan.items.forEach((item,index)=>{
            const sel=selectable && index===this.selected;
            const group=this._svg(svg,'g',selectable?{'data-fp-index':index}:{}); 
            const common=sel?{'stroke':'#ffe39c','stroke-width':'6'}:{};
            if (SEGMENTS.has(item.kind)) {
                const colors={wall:'#e1e9f5',door:'#f2bb68',window:'#67d7e6'};
                const line=this._svg(group,'line',{
                    x1:item.x1*sx,y1:item.y1*sy,x2:item.x2*sx,y2:item.y2*sy,
                    ...stroke,stroke:colors[item.kind],'stroke-width':item.kind==='wall'?6:4,
                    ...common,
                });
                if (selectable) line.style.cursor='move';
                if (selectable) {
                    const hit=this._svg(group,'line',{
                        x1:item.x1*sx,y1:item.y1*sy,x2:item.x2*sx,y2:item.y2*sy,
                        stroke:'transparent','stroke-width':22,'vector-effect':'non-scaling-stroke',
                        'pointer-events':'stroke',
                    });
                    hit.style.cursor='move';
                    if(sel) for(const end of [1,2]) {
                        const handle=this._svg(group,'circle',{
                            cx:item['x'+end]*sx,cy:item['y'+end]*sy,r:.10,
                            fill:'#f8d27c',stroke:'#173047','stroke-width':2,
                            'vector-effect':'non-scaling-stroke',
                            'data-fp-handle':end===1?'start':'end',
                        });
                        handle.style.cursor='crosshair';
                    }
                }
            } else {
                const [label]=FURNITURE[item.kind];
                const x=item.x*sx,y=item.y*sy,w=item.w*sx,h=item.h*sy;
                const angle=this._angle(item);
                if (angle) group.setAttribute('transform',
                    `rotate(${angle} ${x+w/2} ${y+h/2})`);
                const rect=this._svg(group,'rect',{
                    x,y,width:w,height:h,rx:Math.min(w,h)*.08,
                    fill:FURNITURE[item.kind][3], 'fill-opacity':'.70',
                    stroke:sel?'#ffe39c':'#dce9f5','stroke-width':sel?4:2,
                    'vector-effect':'non-scaling-stroke',
                });
                if (selectable) rect.style.cursor='move';
                // Text is created with textContent; no labels are interpreted as HTML.
                if (!percent) {
                    const t=this._svg(group,'text',{
                        x:x+w/2,y:y+h/2,'text-anchor':'middle','dominant-baseline':'middle',
                        'font-size':Math.min(.22,h*.32),fill:'#fff','pointer-events':'none',
                    });
                    t.textContent=label;
                }
                if (sel) {
                    const corner=this._svg(group,'rect',{
                        x:x+w-.095,y:y+h-.095,width:.19,height:.19,rx:.025,
                        fill:'#ffe39c',stroke:'#24344e','stroke-width':2,
                        'vector-effect':'non-scaling-stroke',
                        'data-fp-handle':'resize',
                    });
                    corner.style.cursor='nwse-resize';
                    const turn=this._svg(group,'circle',{
                        cx:x+w/2,cy:y+.12,r:.115,fill:'#46bed7',stroke:'#183149',
                        'stroke-width':2,'vector-effect':'non-scaling-stroke',
                        'data-fp-handle':'rotate',
                    });
                    turn.style.cursor='grab';
                }
            }
        });
    }
    renderEditor() {
        if (!this.opened) return;
        const svg=this.$('fp-svg'), plan=this.draft;
        svg.replaceChildren();
        svg.setAttribute('viewBox',`0 0 ${plan.width} ${plan.height}`);
        svg.style.aspectRatio=`${plan.width} / ${plan.height}`;
        svg.style.cursor=this.tool==='select'?'grab':'crosshair';
        if (this.grid) {
            for(let x=0.5;x<plan.width && x<100;x+=.5)
                this._svg(svg,'line',{x1:x,y1:0,x2:x,y2:plan.height,stroke:'#68829d',
                    'stroke-width':.55,'stroke-opacity':'.4','vector-effect':'non-scaling-stroke','pointer-events':'none'});
            for(let y=.5;y<plan.height && y<100;y+=.5)
                this._svg(svg,'line',{x1:0,y1:y,x2:plan.width,y2:y,stroke:'#68829d',
                    'stroke-width':.55,'stroke-opacity':'.4','vector-effect':'non-scaling-stroke','pointer-events':'none'});
        }
        this.drawShapes(svg,plan,false,true);
        if (this.anchor) {
            this._svg(svg,'circle',{cx:this.anchor.x,cy:this.anchor.y,r:.065,fill:'#ffe39c',
                'pointer-events':'none'});
        }
        this.$('fp-meters').textContent=`${plan.width} × ${plan.height} m · ${plan.items.length} elementi · ${this.host.state.mapGroup||'default'}`;
        this.$('fp-undo').disabled=!this.history.length;
        this.$('fp-delete').disabled=this.selected<0;
        this.$('fp-stage-delete').disabled=this.selected<0;
        this.$('fp-stage-left').disabled=this.selected<0;
        this.$('fp-stage-right').disabled=this.selected<0;
        this.$('fp-stage-select').classList.toggle('active',this.tool==='select');
        this.$('fp-select-mode').classList.toggle('active',this.tool==='select');
        this.$('fp-select-mode').setAttribute('aria-pressed',String(this.tool==='select'));
        this.$('fp-save').disabled=!this.dirty && !!this.saved;
        const item=plan.items[this.selected], box=this.$('fp-selection');
        box.classList.toggle('fp-hidden',!item);
        this.$('fp-duplicate').disabled=!item || plan.items.length>=120;
        this.$('fp-turn-left').disabled=!item;
        this.$('fp-turn-right').disabled=!item;
        this.$('fp-label-rotation').classList.toggle('fp-hidden',!item||SEGMENTS.has(item.kind));
        if (item) {
            const seg=SEGMENTS.has(item.kind);
            const keys=seg?['x1','y1','x2','y2']:['x','y','w','h'];
            const ids=['fp-item-x','fp-item-y','fp-item-w','fp-item-h'];
            const labels=seg?['X inizio (m)','Y inizio (m)','X fine (m)','Y fine (m)']:
                ['X (m)','Y (m)','Larghezza (m)','Profondità (m)'];
            for(let i=0;i<4;i++) {
                this.$(ids[i]).value=this._round(item[keys[i]]);
                this.$(['fp-label-x','fp-label-y','fp-label-w','fp-label-h'][i]).firstChild.textContent=labels[i];
            }
            if(!seg) this.$('fp-item-rotation').value=this._round(this._angle(item));
        }
    }
    async save() {
        if (!this.host._hass?.callService) { this.status('Home Assistant non connesso.',true); return; }
        const payload=this._normalize(this.draft);
        if (payload.items.length !== this.draft.items.length) {
            this.status('Alcuni elementi hanno misure non valide: correggili prima di salvare.',true); return;
        }
        const btn=this.$('fp-save'); btn.disabled=true;
        this.status('Salvataggio della piantina in Home Assistant…');
        try {
            await this.host._hass.callService('radar_map_manager','update_floorplan',{
                map_group:this.host.state.mapGroup||'default', floorplan:payload,
            });
            this.dirty=false; this.setFloorplan(payload);
            this.status('Piantina salvata.');
            this.close(true);
        } catch(error) {
            btn.disabled=false;
            this.status('Salvataggio non riuscito: '+String(error),true);
        }
    }
    export() {
        const blob=new Blob([JSON.stringify(this._normalize(this.draft),null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;a.download='piantina-'+(this.host.state.mapGroup||'default')+'.json';
        this.root.appendChild(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    async importFile(ev) {
        const file=ev.target.files?.[0];ev.target.value='';
        if (!file) return;
        if (file.size>150000) {this.status('File JSON troppo grande.',true);return;}
        try {
            const parsed=JSON.parse(await file.text());
            if (!parsed || !Array.isArray(parsed.items) || !(Number(parsed.width)>=1)
                || !(Number(parsed.height)>=1)) throw Error('Formato non valido');
            const clean=this._normalize(parsed);
            if (clean.items.length!==parsed.items.length)
                throw Error('Elementi o misure non supportati');
            this.snapshot();
            this.draft=clean;this.selected=-1;this.anchor=null;
            this.$('fp-width').value=clean.width;this.$('fp-height').value=clean.height;
            this.renderEditor();this.status('Piantina importata. Premi Salva.');
        } catch(error){this.status('Importazione non riuscita: '+String(error),true);}
    }
}
