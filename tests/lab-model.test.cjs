const assert=require('assert');

const M=require('../lab-model.js');
const checks=[];
for(const r of M.recipes){const m=M.build(M.defaults(r.id));assert(m.output.cells.length);for(const [i,t] of m.output.cells.entries())if(t){assert(m.inputs[t.s].cells.some(v=>v.id===t.id));const a=M.locate(r.dst,Math.floor(i/m.output.cols),i%m.output.cols,m.p.bits,m.dstGeo);assert(a.byte>=0&&a.byte<m.dstGeo.g*m.dstGeo.h);}checks.push(r.id);}
// Independent physical enumeration: iterate layout blocks and bytes, then compare coordinates.
for(const key of ['K','W','AP','WP'])for(const [g,h] of [[128,64],[256,96],[384,128]]){
 const {lane,rows}=M.layouts[key];let offset=0;const block=[];
 if(key==='K'||key==='AP'){for(let x=0;x<g;x+=lane)for(let y=0;y<h;y+=rows)block.push([x,y]);}
 else{for(let y=0;y<h;y+=rows)for(let x=0;x<g;x+=lane)block.push([x,y]);}
 for(const [x,y] of block)for(let r=0;r<rows;r++)for(let b=0;b<lane;b++)assert.equal(M.address(key,x+b,y+r,g,h),offset++);
 assert.equal(offset,g*h);
}checks.push('Independent byte traversal for K/W/AP/WP across three global shapes');
for(const axis of ['rows','cols'])for(let count=2;count<=5;count++){const p={...M.defaults('f1'),axis,count},m=M.build(p);for(let i=0;i<m.output.cells.length;i++){const y=Math.floor(i/m.output.cols),x=i%m.output.cols,t=m.output.cells[i];assert.equal(t.s,axis==='rows'?Math.floor(y/p.rows):Math.floor(x/p.cols));assert.equal(t.y,y%p.rows);assert.equal(t.x,x%p.cols);}}
checks.push('Concat 2..5 sources on both axes');
for(const r of M.recipes.filter(r=>r.op==='transpose')){const m=M.build(M.defaults(r.id));for(let y=0;y<m.output.rows;y++)for(let x=0;x<m.output.cols;x++){const t=m.output.cells[y*m.output.cols+x];assert.equal(t.y,x);assert.equal(t.x,y);}}checks.push('All transpose routes preserve element coordinates');
for(const order of ['ABC','ACB','BAC','BCA','CAB','CBA']){const p={...M.defaults('f5'),order},m=M.build(p),expected=[];const dims={A:p.depth,B:p.rows,C:p.cols};for(let a=0;a<dims[order[0]];a++)for(let b=0;b<dims[order[1]];b++)for(let c=0;c<dims[order[2]];c++){const coord={[order[0]]:a,[order[1]]:b,[order[2]]:c};expected.push(`0:${(coord.A*p.rows+coord.B)*p.cols+coord.C}`);}assert.deepEqual(m.output.cells.map(t=>t.id),expected);}checks.push('All six 3D permutation orders');
assert.deepEqual(M.build({...M.defaults('gather'),indices:'3,0,3'}).output.cells.filter((_,i)=>i%6===0).map(t=>t.y),[3,0,3]);
assert.throws(()=>M.build({...M.defaults('scatter'),indices:'1,1'}),/冲突/);
assert.throws(()=>M.build({...M.defaults('f4'),sliceX:6}),/起始列/);
const sl=M.build({...M.defaults('f4'),rows:8,cols:8,sliceY:1,sliceX:2,sliceH:3,sliceW:2,rowStep:2,colStep:2});assert.deepEqual(sl.output.cells.map(t=>[t.y,t.x]),[[1,2],[1,4],[3,2],[3,4],[5,2],[5,4]]);
assert.deepEqual(M.packNibbles([1,2,3,4]),[0x21,0x43]);assert.deepEqual(M.ring(6,8,5),[6,7,0,1,2]);
for(const id of ['f2','f3','f6','f7','f8','f9','f10','f11']){const p={...M.defaults(id),srcX:128,srcY:32,dstX:128,dstY:32,srcExtraH:32,dstExtraH:64},m=M.build(p);for(let i=0;i<m.output.cells.length;i++)if(m.output.cells[i]){const a=M.locate(m.recipe.dst,Math.floor(i/m.output.cols),i%m.output.cols,p.bits,m.dstGeo);assert(a.x>=128&&a.y>=32);}}checks.push('Offsets, slice stride, repeat gather, scatter conflicts, INT4 and SWA');
console.log('PASS '+M.recipes.length+' recipes + independent mappings');

