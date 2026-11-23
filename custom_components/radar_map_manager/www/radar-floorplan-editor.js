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
                    <label>Strumento
                    <select id="fp-tool">
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
                      <option value="select">Seleziona / sposta</option>
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
                    <button id="fp-apply-item">Applica misure</button>
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
                  <p class="fp-help">Pareti, porte e finestre: clicca il punto iniziale e quello finale. Mobili: un clic per inserirli. Seleziona / sposta per trascinare.</p>
                </div>
                <div class="fp-stage">
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
        $('fp-tool').addEventListener('change', (ev) => {
            this.tool = ev.target.value; this.anchor = null; this.selected = -1;
            this.renderEditor();
        });
        $('fp-snap').addEventListener('change', (ev) => { this.grid = ev.target.checked; this.renderEditor(); });
        $('fp-resize').addEventListener('click', () => this.resizeRoom());
        $('fp-undo').addEventListener('click', () => this.undo());
        $('fp-delete').addEventListener('click', () => this.removeSelected());
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
                if (x < 0 || y < 0 || w < .1 || h < .1 || x+w > width+.001 || y+h > height+.001) continue;
                result.items.push({kind:item.kind,x,y,w,h});
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
        if (this.saved) this.drawShapes(layer, this.saved, true, false);
    }
    open() {
        this.mount();
        if (this.opened) return;
        if (this.host.state.editing) this.host.exitEditMode();
        this.opened = true; this.dirty = false; this.selected = -1;
        this.anchor = null; this.history = []; this.drag = null;
        this.draft = this._clone(this.saved || {width:10,height:4,items:[]});
        this.tool = 'wall';
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
        this.snapshot();
        const sx = w / this.draft.width, sy = h / this.draft.height;
        for (const item of this.draft.items) {
            if (SEGMENTS.has(item.kind)) {
                item.x1 *= sx; item.x2 *= sx; item.y1 *= sy; item.y2 *= sy;
            } else {
                item.x *= sx; item.w *= sx; item.y *= sy; item.h *= sy;
            }
        }
        this.draft.width = w; this.draft.height = h;
        this.draft = this._normalize(this.draft);
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
        if (ev.button !== 0 || !this.opened) return;
        const pos = this.svgPoint(ev);
        if (!pos) return;
        if (this.tool === 'select') {
            const node = ev.target.closest('[data-fp-index]');
            this.selected = node ? Number(node.dataset.fpIndex) : -1;
            if (this.selected >= 0 && this.selected < this.draft.items.length) {
                this.drag = {
                    index: this.selected, start: pos,
                    original: this._clone(this.draft.items[this.selected]),
                    moved: false,
                };
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
            this.status('Mobile aggiunto. Usa Seleziona / sposta per spostarlo.');
        }
        this.renderEditor();
    }
    pointerMove(ev) {
        if (!this.drag || this.tool !== 'select') return;
        const pos = this.svgPoint(ev);
        if (!pos) return;
        const deltaX = pos.x - this.drag.start.x;
        const deltaY = pos.y - this.drag.start.y;
        if (!this.drag.moved && (Math.abs(deltaX)>0.02 || Math.abs(deltaY)>0.02)) {
            this.snapshot(); this.drag.moved = true;
        }
        if (!this.drag.moved) return;
        const item = this.draft.items[this.drag.index], orig = this.drag.original;
        if (SEGMENTS.has(item.kind)) {
            const dx=this._limit(deltaX,-Math.min(orig.x1,orig.x2),
                this.draft.width-Math.max(orig.x1,orig.x2));
            const dy=this._limit(deltaY,-Math.min(orig.y1,orig.y2),
                this.draft.height-Math.max(orig.y1,orig.y2));
            item.x1=this._round(orig.x1+dx); item.x2=this._round(orig.x2+dx);
            item.y1=this._round(orig.y1+dy); item.y2=this._round(orig.y2+dy);
        } else {
            item.x=this._round(this._limit(orig.x+deltaX,0,this.draft.width-orig.w));
            item.y=this._round(this._limit(orig.y+deltaY,0,this.draft.height-orig.h));
        }
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
    applyItemValues() {
        const item=this.draft.items[this.selected];
        if (!item) return;
        const keys=SEGMENTS.has(item.kind)?['x1','y1','x2','y2']:['x','y','w','h'];
        const controls=['fp-item-x','fp-item-y','fp-item-w','fp-item-h'];
        const next={...item};
        for(let i=0;i<4;i++) next[keys[i]]=this._num(this.$(controls[i]).value,NaN);
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
            } else {
                const [label]=FURNITURE[item.kind];
                const x=item.x*sx,y=item.y*sy,w=item.w*sx,h=item.h*sy;
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
        this.$('fp-save').disabled=!this.dirty && !!this.saved;
        const item=plan.items[this.selected], box=this.$('fp-selection');
        box.classList.toggle('fp-hidden',!item);
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
