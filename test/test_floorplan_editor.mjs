// Run with: node test/test_floorplan_editor.mjs
import assert from 'node:assert/strict';
import { RadarFloorplanEditor } from '../custom_components/radar_map_manager/www/radar-floorplan-editor.js';

const room = {
    width: 10, height: 4,
    items: [{kind:'sofa',x:1,y:1,w:2,h:1}],
};

function editorWith(plan) {
    const editor = new RadarFloorplanEditor({state:{mapGroup:'default'}},{});
    editor.opened = true;
    editor.tool = 'select';
    editor.draft = JSON.parse(JSON.stringify(plan));
    editor.renderEditor = () => {};
    editor.status = () => {};
    editor.snapshot = () => { editor.dirty = true; };
    editor.svgPoint = (ev) => ({x: ev.clientX, y: ev.clientY});
    const svg = {
        setPointerCapture() {},
        hasPointerCapture() {return true;},
        releasePointerCapture() {},
    };
    editor.$ = (id) => id === 'fp-svg' ? svg : { value: '' };
    return editor;
}

function point(x,y,index=0,handle='move') {
    return {
        pointerType:'mouse',button:0,pointerId:1,clientX:x,clientY:y,
        target:{closest(selector) {
            if (selector === '[data-fp-index]') return {dataset:{fpIndex:String(index)}};
            if (selector === '[data-fp-handle]' && handle !== 'move')
                return {dataset:{fpHandle:handle}};
            return null;
        }},
    };
}

const moved=editorWith(room);
moved.pointerDown(point(2,1.5));
moved.pointerMove(point(3,1.5));
moved.pointerUp(point(3,1.5));
assert.equal(moved.draft.items[0].x,2);

const resized=editorWith(room);
resized.pointerDown(point(3,2,0,'resize'));
resized.pointerMove(point(3.3,2.2));
resized.pointerUp(point(3.3,2.2));
assert.ok(resized.draft.items[0].w>2);
assert.ok(resized.draft.items[0].h>1);

const rotated=editorWith(room);
rotated.pointerDown(point(2,1.12,0,'rotate'));
rotated.pointerMove(point(2.5,1.5));
rotated.pointerUp(point(2.5,1.5));
assert.equal(rotated.draft.items[0].rotation,90);
assert.equal(rotated._normalize(rotated.draft).items.length,1);
rotated.rotateSelected(90);
assert.equal(rotated.draft.items[0].rotation,180);
rotated.duplicateSelected();
assert.equal(rotated.draft.items.length,2);
assert.equal(rotated.draft.items[1].rotation,180);

const line=editorWith({width:10,height:4,items:[{kind:'wall',x1:1,y1:1,x2:3,y2:1}]});
line.pointerDown(point(3,1,0,'end'));
line.pointerMove(point(3.5,1.5));
line.pointerUp(point(3.5,1.5));
assert.equal(line.draft.items[0].x2,3.5);
assert.equal(line.draft.items[0].y2,1.5);

assert.equal(editorWith(room)._normalize({width:10,height:4,items:[
    {kind:'sofa',x:0,y:0,w:2,h:1,rotation:45},
]}).items.length,0);

console.log('Floorplan editor movement, resize, rotation, duplication: OK');
