'use strict';
(() => {
  const M=window.CP_LAB_MODEL, $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n).toLocaleString('en-US');
  const options=(items,value)=>items.map(([v,t])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`).join('');
  const num=(key,label,value,min=0,max=256,step=1)=>`<label>${label}<input data-lab-field="${key}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  const select=(key,label,value,items)=>`<label>${label}<select data-lab-field="${key}">${options(items,value)}</select></label>`;
  let config=M.defaults('f1'),model=null,step=0,selected=0,source=0,srcPage=0,dstPage=0,timer=null,mode='operations',observer=null;
  const layoutChoices=Object.entries(M.layouts).map(([k,v])=>[k,v.name]);
  const opNames={copy:'搬运 / 布局变换',transpose:'二维转置',concat:'拼接',slice:'切片',permute:'三维换轴',gather:'按索引读',scatter:'按索引写'};
  function catalog(){
    return `<select id="cp-operation" aria-label="选择 CP 功能">${[['11 项新增功能',r=>r.feature],['搬运与折叠 / 逆折叠',r=>!r.feature&&r.op==='copy'],['转置与 AW / INT4',r=>!r.feature&&r.op==='transpose'],['gather / scatter',r=>!r.feature&&['gather','scatter'].includes(r.op)]].map(([name,filter])=>`<optgroup label="${name}">${options(M.recipes.filter(filter).map(r=>[r.id,r.title]),config.id)}</optgroup>`).join('')}</select>`;
  }
  function shell(kind='operations',id){
    mode=kind;const allowed=M.recipes.some(r=>r.id===id);if(allowed)config=M.defaults(id);
    if(kind==='layouts'&&!allowed)config=M.defaults('fold-k');
    return `<section class="lab-intro"><div><span class="eyebrow">CP DATA PLAYGROUND · ${M.recipes.length} 个可选场景</span><h2>${kind==='layouts'?'同一份数据，怎样存在内存里？':'自己改参数，看每个元素去了哪里'}</h2><p>${kind==='layouts'?'折叠改变物理顺序，转置改变逻辑行列。K 对应 Act，W 对应 Wgt；参数布局另用 AP / WP 标记。':'覆盖已有搬运路径与 11 项新增方案。先选功能，再调参数，点击任一元素追踪它的来源和地址。'}</p></div><span class="lab-model-tag">坐标模型<br>不是 RTL 波形</span></section>
      <div class="sim-top-select"><label>我要演示的功能${catalog()}</label><a id="cp-detail-link" class="btn" href="#features">查看方案说明 ↗</a></div>
      <div class="sim-presets"><span>试试这些场景</span><button data-sim-preset="small">小矩阵看定义</button><button data-sim-preset="block">完整块看折叠</button><button data-sim-preset="offset">global &gt; box + 非零起点</button>${kind==='layouts'?'<button data-sim-recipe="f6">Linear → 转置 → K</button><button data-sim-recipe="transpose-w">Linear → 转置 → W</button>':''}</div>
      ${kind==='layouts'?`<section class="sim-panel layout-lesson"><div class="sim-panel-head"><div><small>先用同一个 16 行 × 128B 矩阵对照</small><h3>K 和 W 的差别在块间顺序</h3></div><select id="layout-order" aria-label="选择块顺序"><option value="K">K / Act</option><option value="W">W / Wgt</option></select></div><div id="layout-order-view"></div></section>`:''}
      <div class="sim-workspace"><aside class="sim-settings"><div id="sim-controls"></div><div class="sim-key"><b>读图方法</b><p>颜色跟着源元素走。灰色是未写区域；选中元素有深色边框。画布可点选，下方小格可逐个核对。</p><p>演示矩阵按元素计数；地址和 global_G 按字节。参数模式固定为 32bit 元素。</p></div></aside><div class="sim-main"><div id="sim-error" role="alert"></div><div id="sim-results"></div></div></div>`;
  }
  function controls(){
    const r=M.recipes.find(x=>x.id===config.id),p=config,para=/P/.test(r.src+r.dst);
    $('#sim-controls').innerHTML=`<div class="sim-control-title"><strong>01 / 输入数据</strong><button data-sim-action="reset" class="text-link">重置</button></div><div class="sim-fields">${num('rows',r.op==='permute'?'B 轴长度':'每份输入行数',p.rows,1,128)}${num('cols',r.op==='permute'?'C 轴长度':'每行元素数',p.cols,1,256)}${select('bits','每元素位宽',p.bits,(para?[32]:r.bits?[4]:[8,16,32]).map(b=>[b,b+' bit']))}${r.op==='permute'?num('depth','A 轴长度',p.depth,1,8):''}</div>
      ${r.op==='concat'?`<div class="sim-control-title"><strong>02 / 拼几份，往哪拼</strong></div><div class="sim-fields">${num('count','输入份数',p.count,2,5)}${select('axis','拼接方向',p.axis,[['rows','上下接：行方向'],['cols','左右接：列方向']])}</div><p class="small muted">每份输入使用相同尺寸、不同颜色和独立 base。输入份数 N 对应 N 段拼接；实际 child 数可能更多。</p>`:''}
      ${['gather','scatter'].includes(r.op)?`<div class="sim-control-title"><strong>02 / 索引控制</strong></div><label class="sim-index-label">${r.op==='gather'?'要读取的源行号':'每个源行要写到的目的行号'}<textarea id="sim-indices" data-lab-field="indices" rows="3">${esc(p.indices)}</textarea></label><div class="sim-inline-actions"><button data-sim-indices="reverse">反序</button><button data-sim-indices="even">隔行</button><button data-sim-indices="repeat">重复索引</button></div><p class="small muted">gather 允许重复读取；scatter 重复目标会产生写冲突，本模型明确拒绝。</p>`:''}
      ${r.op==='slice'?`<div class="sim-control-title"><strong>02 / 取哪一块</strong></div><div class="sim-fields">${num('sliceY','起始行',p.sliceY)}${num('sliceX','起始列',p.sliceX)}${num('sliceH','取出行数',p.sliceH,1)}${num('sliceW','取出列数',p.sliceW,1)}${num('rowStep','行步长',p.rowStep,1,16)}${num('colStep','列步长',p.colStep,1,16)}</div>`:''}
      ${r.op==='permute'?`<div class="sim-control-title"><strong>02 / 新的轴顺序</strong></div><div class="sim-fields wide">${select('order','输入 ABC → 输出',p.order,['ABC','ACB','BAC','BCA','CAB','CBA'].map(x=>[x,x]))}</div>`:''}
      <details class="sim-advanced" ${config.id==='stride'?'open':''}><summary>global / box / 起点与行距</summary><p>global_G 自动向上对齐 128B；折叠 global_H 补到完整 block。起点的 ISA 合法性需另外检查。</p><div class="sim-fields">${num('srcX','源 X 偏移 / B',p.srcX,0,2048,32)}${num('srcY','源 Y 偏移 / 行',p.srcY,0,256,8)}${num('dstX','目的 X 偏移 / B',p.dstX,0,2048,32)}${num('dstY','目的 Y 偏移 / 行',p.dstY,0,256,8)}${num('srcPad','源行尾留白 / B',p.srcPad,0,1024,128)}${num('dstPad','目的行尾留白 / B',p.dstPad,0,1024,128)}${num('srcExtraH','源 global 额外行',p.srcExtraH,0,256,32)}${num('dstExtraH','目的 global 额外行',p.dstExtraH,0,256,32)}</div></details>`;
  }
  function pipeline(r){
    const names=[M.layouts[r.src].name,r.op==='gather'?'gather 选择源':r.src!=='L'?'按源布局取数':'取源数据',r.op==='transpose'?'交换行列':r.op==='permute'?'交换逻辑轴':r.op==='concat'?'改变目标起点':r.op==='slice'?'保留选区':'保持元素顺序',r.dst==='L'?(r.op==='scatter'?'scatter 选择目的':'按行写回'):'按 '+r.dst+' 组织片段',M.layouts[r.dst].name];
    return `<div class="sim-flow">${names.map((n,i)=>`<span><small>0${i+1}</small>${esc(n)}</span>`).join('<i>→</i>')}</div>`;
  }
  function rebuild(){
    stop();try{model=M.build(config);}catch(e){model=null;$('#sim-error').innerHTML=`<div class="error-text">${esc(e.message)}</div>`;$('#sim-results').innerHTML='';return;}
    $('#sim-error').innerHTML='';const r=model.recipe;step=model.steps.length;selected=0;source=0;srcPage=dstPage=0;
    const detail=$('#cp-detail-link');detail.href=r.feature?'#feature/'+r.feature:'#baseline';detail.textContent=r.feature?'查看第 '+r.feature+' 项方案 ↗':'查看已有能力与边界 ↗';
    $('#sim-results').innerHTML=`<div class="sim-status"><span class="badge ${r.status.includes('已有')?'green':'amber'}">${esc(r.status)}</span><span>${esc(opNames[r.op])} · ${config.bits}bit</span></div>${pipeline(r)}
      <section class="sim-transport"><div class="sim-play-buttons"><button data-sim-action="first" aria-label="回到开头">↤</button><button data-sim-action="prev" aria-label="上一步">←</button><button data-sim-action="play" class="sim-play">▶ 播放</button><button data-sim-action="next" aria-label="下一步">→</button><button data-sim-action="last" aria-label="显示结果">↦</button></div><label class="sim-progress">教学步骤 <input id="sim-step" type="range" min="0" max="${model.steps.length}" value="${step}"><output id="sim-step-label"></output></label><label class="sim-speed">速度<select id="sim-speed"><option value="1000">慢</option><option value="550" selected>正常</option><option value="180">快</option></select></label><p id="sim-step-caption" aria-live="polite"></p></section>
      <div class="sim-matrices"><section class="sim-panel"><div class="sim-panel-head"><div><small>SOURCE / 逻辑视图</small><h3>源数据 <span>${model.inputs[0].rows} × ${model.inputs[0].cols}</span></h3></div>${model.inputs.length>1?`<select id="sim-source" aria-label="选择输入">${options(model.inputs.map((_,i)=>[i,'输入 '+String.fromCharCode(65+i)]),source)}</select>`:`<span class="badge">${r.src}</span>`}</div><canvas id="sim-source-canvas" tabindex="0" role="img" aria-label="源矩阵。点击元素，或使用下面的坐标输入追踪。"></canvas><div id="sim-source-grid" class="sim-detail-grid"></div></section>
      <section class="sim-panel"><div class="sim-panel-head"><div><small>DESTINATION / 逻辑视图</small><h3>目的数据 <span>${model.output.rows} × ${model.output.cols}${model.shape?' / '+model.shape.join(' × '):''}</span></h3></div><span class="badge">${r.dst}</span></div><canvas id="sim-dest-canvas" tabindex="0" role="img" aria-label="目的矩阵。点击元素查看其源坐标和地址。"></canvas><div id="sim-dest-grid" class="sim-detail-grid"></div></section></div>
      <section class="sim-inspector"><div class="sim-panel-head"><h3>追踪一个元素</h3><div class="sim-coordinate"><label>目的行<input id="sim-pick-y" type="number" min="0" max="${model.output.rows-1}" value="0"></label><label>目的列<input id="sim-pick-x" type="number" min="0" max="${model.output.cols-1}" value="0"></label></div></div><div id="sim-inspect-content"></div></section>
      <div class="sim-memory-heading"><div><span class="eyebrow">PHYSICAL MEMORY / 按地址顺序</span><h3>逻辑位置之外，再看真实存放顺序</h3></div><span>每张小卡 = 256B 地址窗口；灰色间隔仍然存在。</span></div><div class="sim-memories"><section class="sim-panel"><h3>源 · ${esc(M.layouts[r.src].name)}</h3><div id="sim-src-memory"></div></section><section class="sim-panel"><h3>目的 · ${esc(M.layouts[r.dst].name)}</h3><div id="sim-dst-memory"></div></section></div>
      <section class="sim-panel sim-beat-panel"><div class="sim-panel-head"><h3>选中元素所在的目的 128B 拍</h3><span id="sim-beat-label"></span></div><div id="sim-beat" class="sim-beat"></div><p>每格 1B。灰格不属于本次有效写入；INT4 的一格可含两个半字节。byte strobe 控制整字节，不能单独选择高低四位。</p></section>
      <details class="sim-explain" open><summary>这次给后级什么，代码要动哪里？</summary><div id="sim-command"></div></details>
      <details class="sim-explain"><summary>地址公式与本次 global</summary><div id="sim-formulas"></div></details>
      <div id="sim-warnings" class="sim-warning-list">${model.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>
      <div class="sim-export"><span>有效数据 ${fmt(model.bytes)}B · 单遍有效读写约 ${fmt(model.bytes*2)}B；不含索引、过取和启动成本。</span><button class="btn" data-sim-action="export">导出当前映射 JSON</button></div>`;
    renderCommand();renderFormulas();paint();
  }
  function color(t,alpha=1){return `hsla(${[157,220,34,280,355][t.s]},${48+(t.x%5)*5}%,${34+(t.y%8)*4+(t.x%3)*3}%,${alpha})`;}
  function selectedToken(){return model?.output.cells[selected];}
  function drawCanvas(id,a,isDst){
    const c=$(id);if(!c)return;const w=Math.max(180,c.clientWidth),h=240,dpr=window.devicePixelRatio||1;c.width=w*dpr;c.height=h*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
    const margin=18,scale=Math.min((w-margin*2)/a.cols,(h-margin*2)/a.rows),ox=(w-a.cols*scale)/2,oy=(h-a.rows*scale)/2;c._grid={scale,ox,oy,rows:a.rows,cols:a.cols};
    ctx.fillStyle='#f6f8fa';ctx.fillRect(0,0,w,h);const token=selectedToken();
    a.cells.forEach((t,i)=>{const y=Math.floor(i/a.cols),x=i%a.cols,done=!isDst||(model.assigned.get(i)??Infinity)<step;ctx.fillStyle=t?color(t,done?1:.12):'#e8edf0';ctx.fillRect(ox+x*scale+.4,oy+y*scale+.4,Math.max(.5,scale-.8),Math.max(.5,scale-.8));});
    a.cells.forEach((t,i)=>{if(t&&token&&t.id===token.id){ctx.strokeStyle='#112c29';ctx.lineWidth=2;ctx.strokeRect(ox+(i%a.cols)*scale,oy+Math.floor(i/a.cols)*scale,Math.max(2,scale),Math.max(2,scale));}});
    ctx.fillStyle='#72818e';ctx.font='10px system-ui';ctx.fillText('0',Math.max(0,ox-12),Math.max(12,oy-3));ctx.fillText('列 →',w-35,14);ctx.fillText('行 ↓',2,h-4);
  }
  function detailGrid(id,a,y,x,isDst){
    const y0=Math.max(0,Math.min(y-1,a.rows-4)),x0=Math.max(0,Math.min(x-2,a.cols-6)),nr=Math.min(4,a.rows),nc=Math.min(6,a.cols),token=selectedToken();
    let html=`<p>局部放大：行 ${y0}—${y0+nr-1}，列 ${x0}—${x0+nc-1} <span>点击格子追踪</span></p><div style="grid-template-columns:repeat(${nc},minmax(0,1fr))">`;
    for(let r=y0;r<y0+nr;r++)for(let col=x0;col<x0+nc;col++){const i=r*a.cols+col,t=a.cells[i],done=!isDst||(model.assigned.get(i)??Infinity)<step;html+=`<button class="sim-element ${t&&token&&t.id===token.id?'picked':''} ${!done?'pending':''}" data-sim-cell="${i}" data-sim-side="${isDst?'dst':'src'}" style="--cell:${t?color(t):'#e8edf0'}" title="${esc(t?.label||'未写：保留目的原数据')}；显示坐标 (${r},${col})">${t?esc(t.label):'保留'}</button>`;}
    $(id).innerHTML=html+'</div>';
  }
  function paint(){
    if(!model||!$('#sim-results'))return;
    const t=selectedToken(),out=model.output,y=Math.floor(selected/out.cols),x=selected%out.cols;
    $('#sim-step').value=step;$('#sim-step-label').textContent=step+' / '+model.steps.length;
    $('#sim-step-caption').textContent=step===0?'尚未执行：准备源、目的描述符。':model.steps[step-1].label+(step===model.steps.length?' · 演示完成':'');
    $('#sim-pick-y').value=y;$('#sim-pick-x').value=x;
    drawCanvas('#sim-source-canvas',model.inputs[source],false);drawCanvas('#sim-dest-canvas',out,true);
    detailGrid('#sim-source-grid',model.inputs[source],t?.s===source?t.y:0,t?.s===source?t.x:0,false);detailGrid('#sim-dest-grid',out,y,x,true);
    inspect();memory('src');memory('dst');beat();
  }
  function inspect(){
    const t=selectedToken();if(!t){$('#sim-inspect-content').innerHTML='<p>这个目的位置未被选中，应该保留原数据，不产生有效写入。</p>';return;}
    const r=model.recipe,y=Math.floor(selected/model.output.cols),x=selected%model.output.cols,a=M.locate(r.src,t.y,t.x,config.bits,model.srcGeo),b=M.locate(r.dst,y,x,config.bits,model.dstGeo),dest=model.destinations.get(t.id)||[];
    $('#sim-inspect-content').innerHTML=`<div class="sim-trace"><div><small>来源 · 输入 ${String.fromCharCode(65+t.s)}</small><strong>${esc(t.label)}</strong><span>${r.src}：base_${String.fromCharCode(65+t.s)} + ${fmt(a.byte)}B${config.bits===4?' / '+(a.bit?'高':'低')+' 4bit':''}</span></div><b>→</b><div><small>目的逻辑坐标</small><strong>D[${y},${x}]</strong><span>${r.dst}：base_D + ${fmt(b.byte)}B${config.bits===4?' / '+(b.bit?'高':'低')+' 4bit':''}</span></div><b>→</b><div><small>目的总线位置</small><strong>beat ${b.beat} · lane ${b.lane}</strong><span>元素 ${config.bits}bit · 128B 拍按地址对齐</span></div></div><p class="small muted">${dest.length>1?`这个源元素被使用 ${dest.length} 次（gather 允许重复读）。`:'元素值不改变，坐标和/或物理地址改变。'} ${(model.assigned.get(selected)??Infinity)<step?'当前步骤已写入。':'当前步骤尚未写入。'}</p>`;
  }
  function memory(side){
    const isSrc=side==='src',blocks=M.physicalBlocks(model,side,source),page=isSrc?srcPage:dstPage,per=12,pages=Math.max(1,Math.ceil(blocks.length/per)),t=selectedToken();
    const a=isSrc?model.inputs[source]:model.output,layout=isSrc?model.recipe.src:model.recipe.dst,geo=isSrc?model.srcGeo:model.dstGeo;
    let selectedBlock=-1;if(t&&(!isSrc||t.s===source))selectedBlock=M.locate(layout,isSrc?t.y:Math.floor(selected/a.cols),isSrc?t.x:selected%a.cols,config.bits,geo).block;
    const html=blocks.slice(page*per,page*per+per).map(b=>{const token=a.cells[b.indices[0]],done=b.indices.filter(i=>isSrc||(model.assigned.get(i)??Infinity)<step).length;
      const bytes=new Map();b.indices.forEach(i=>{const pos=M.locate(layout,Math.floor(i/a.cols),i%a.cols,config.bits,geo);for(let k=0;k<Math.max(1,config.bits/8);k++)bytes.set(pos.byte%256+k,{t:a.cells[i],done:isSrc||(model.assigned.get(i)??Infinity)<step});});
      const mini=`<svg class="sim-block-mini" viewBox="0 0 128 32" role="img" aria-label="这个 256B 窗口的逐字节分布"><rect width="128" height="32" fill="#e7ede9"/>${[...bytes].map(([i,v])=>`<rect x="${i%32*4}" y="${Math.floor(i/32)*4}" width="3.7" height="3.7" fill="${color(v.t,v.done?1:.2)}"/>`).join('')}</svg>`;
      return `<button data-sim-block="${b.indices[0]}" data-sim-side="${side}" class="sim-block ${b.id===selectedBlock?'picked':''}" style="--cell:${color(token)};--fill:${done/b.indices.length*100}%"><small>块 ${b.id} · +${fmt(b.id*256)}B</small><strong>${layout==='L'?'连续地址窗':`y${b.minY} / x${b.minX}`}</strong>${mini}<span>${fmt(b.count*config.bits/8)}B 有效${b.count*config.bits/8<256?' · 部分块':''}</span></button>`;}).join('');
    $(`#sim-${side}-memory`).innerHTML=`<p class="sim-geo">G=${geo.g}B · H=${geo.h} 行 · 起点 (${geo.x}B, ${geo.y})</p><div class="sim-blocks">${html}</div><div class="sim-memory-pages"><button data-sim-page="${side}" data-delta="-1" ${page===0?'disabled':''}>←</button><span>${page+1} / ${pages} · ${blocks.length} 个含有效数据的窗口</span><button data-sim-page="${side}" data-delta="1" ${page+1>=pages?'disabled':''}>→</button></div>`;
  }
  function beat(){
    const t=selectedToken();if(!t){$('#sim-beat').innerHTML='';$('#sim-beat-label').textContent='此处无有效写入';return;}
    const y=Math.floor(selected/model.output.cols),x=selected%model.output.cols,pos=M.locate(model.recipe.dst,y,x,config.bits,model.dstGeo),base=pos.beat*128,lanes=Array.from({length:128},()=>[]);
    model.output.cells.forEach((a,i)=>{if(!a)return;const p=M.locate(model.recipe.dst,Math.floor(i/model.output.cols),i%model.output.cols,config.bits,model.dstGeo);for(let k=0;k<Math.max(1,config.bits/8);k++)if(p.byte+k>=base&&p.byte+k<base+128)lanes[p.byte+k-base].push({t:a,i,bit:p.bit});});
    $('#sim-beat-label').textContent=`base_D + ${fmt(base)}B`;
    $('#sim-beat').innerHTML=lanes.map((items,i)=>`<button class="sim-byte ${items.some(v=>v.i===selected)?'picked':''}" ${items.length?`data-sim-cell="${items[0].i}" data-sim-side="dst"`:''} style="background:${items.length?color(items[0].t,(model.assigned.get(items[0].i)??Infinity)<step?1:.15):'#edf0f2'};color:${items.length&&(model.assigned.get(items[0].i)??Infinity)<step?'#fff':'#87968d'}" title="lane ${i}：${esc(items.map(v=>v.t.label+(config.bits===4?(v.bit?' 高4bit':' 低4bit'):'')).join(' / ')||'不写，strobe=0')}">${i}</button>`).join('');
  }
  function renderCommand(){
    const r=model.recipe,f=window.CP_DATA.features.find(f=>f.id===r.feature),p=config;
    let desc=`src_layout=${r.src}; dst_layout=${r.dst}\nbox_src=(${p.cols} elements, ${p.rows} rows)\nsrc_global=(G=${model.srcGeo.g}B, H=${model.srcGeo.h}); src_start=(${model.srcGeo.x}B, ${model.srcGeo.y})\ndst_global=(G=${model.dstGeo.g}B, H=${model.dstGeo.h}); dst_start=(${model.dstGeo.x}B, ${model.dstGeo.y})\nT=${+(r.op==='transpose')}; gather=${+(r.op==='gather')}; scatter=${+(r.op==='scatter')}; data_width=${p.bits}`;
    if(r.op==='concat')desc+='\n'+model.steps.map(s=>s.label+'；source 使用独立 base/global').join('\n');
    if(['gather','scatter'].includes(r.op))desc+='\n教学行号 index=['+p.indices+']；下发前换算为规格元素偏移';
    if(r.op==='slice')desc+=`\nsrc_local_start=(${p.sliceX},${p.sliceY}); selected_box=(${p.sliceW},${p.sliceH}); step=(${p.colStep},${p.rowStep})`;
    if(r.op==='permute')desc+=`\n父操作 order=${p.order}，逐 plane 发 copy / transpose；本行不是单条可直接下发的 ISA`;
    $('#sim-command').innerHTML=`<p>${f?esc(f.summary):r.op==='transpose'?'复用 cp_trans / cp_ctrl 的转置与写侧；K/Act 写出扩展和已有 W/Wgt 路径状态不同。':'已有 cp_core 计算几何，rd_ctrl 取数和重排，wr_ctrl 按地址写出；以所选路径的支持状态为准。'}</p><pre>${esc(desc)}</pre><p>${f?esc(f.changes.map(x=>x[0]+'：'+x[1]).join('；')):'配置计算应在命令阶段分拍完成；逐拍路径保留寄存边界，不把乘法、布局地址和宽数据选择串成一条长组合链。'}</p><p class="small muted">字段是语义展示，不是可直接送入 RTL 的完整描述符。${r.op==='permute'?'换轴的 child 数由具体轴顺序、连续性和最小粒度决定。':'动画行步骤也不等于 child 数。'}</p>`;
  }
  function renderFormulas(){
    $('#sim-formulas').innerHTML=['src','dst'].map(side=>{const l=side==='src'?model.recipe.src:model.recipe.dst,g=side==='src'?model.srcGeo:model.dstGeo;return `<h4>${side==='src'?'源':'目的'} · ${esc(M.layouts[l].name)}</h4><p>${esc(M.layouts[l].detail)}</p><pre>offset_B = ${M.layouts[l].formula}\nG=${g.g}B; H=${g.h}; X=start_X + floor(col×${config.bits}/8); Y=start_Y + row</pre>`;}).join('')+'<p>base 为独立存储区起点。global 来自实际布局，不能用 box 宽高替代。折叠只换物理地址；没有 transpose 的时候，D[y,x] 仍来自 A[y,x]。</p>';
  }
  function stop(){if(timer)clearInterval(timer);timer=null;const b=$('[data-sim-action="play"]');if(b)b.textContent='▶ 播放';}
  function followStep(){if(step>0){selected=model.steps[step-1].indices[0];const t=selectedToken();if(t)source=t.s;if($('#sim-source'))$('#sim-source').value=source;}paint();}
  function play(){if(timer){stop();return;}if(!model)return;if(step>=model.steps.length)step=0;const b=$('[data-sim-action="play"]');b.textContent='Ⅱ 暂停';paint();timer=setInterval(()=>{if(!model||!$('#sim-step')){stop();return;}step++;followStep();if(step>=model.steps.length)stop();},Number($('#sim-speed').value));}
  function pick(i,side){if(!model)return;if(side==='src'){const t=model.inputs[source].cells[i],found=t&&model.destinations.get(t.id);if(!found?.length){$('#sim-inspect-content').innerHTML=`<p>${esc(t?.label)} 未被这个操作选中，不会写入目的。选择高亮区域中的元素继续追踪。</p>`;return;}selected=found[0];}else selected=i;const t=selectedToken();if(t)source=t.s;if($('#sim-source'))$('#sim-source').value=source;paint();}
  function preset(name){const id=config.id,r=M.recipes.find(r=>r.id===id);config=M.defaults(id);
    if(name==='block'||name==='offset'){
      config.rows=/P/.test(r.src+r.dst)?64:32;config.cols=/P/.test(r.src+r.dst)?32:64;
      if(['gather','scatter'].includes(r.op))config.indices=Array.from({length:32},(_,i)=>31-i).join(', ');
      if(r.op==='slice'){config.sliceY=8;config.sliceX=8;config.sliceH=8;config.sliceW=16;}
      if(r.op==='permute'){config.rows=4;config.cols=8;}
    }else{config.rows=/P/.test(r.src+r.dst)?8:4;config.cols=/P/.test(r.src+r.dst)?4:6;}
    if(name==='offset'&&id!=='bulk'){config.srcX=128;config.srcY=32;config.dstX=128;config.dstY=32;config.srcExtraH=32;config.dstExtraH=64;config.srcPad=128;config.dstPad=256;}
    controls();rebuild();
  }
  function selectRecipe(id){config=M.defaults(id);const s=$('#cp-operation');if(s)s.value=id;controls();rebuild();history.replaceState(null,'','#lab/'+mode+'/'+id);}

  function updateLayoutOrder(){
    const k=$('#layout-order').value,blocks=Array.from({length:8},(_,i)=>({r:Math.floor(i/4),c:i%4,id:i})),order=k==='K'?[0,4,1,5,2,6,3,7]:[0,1,2,3,4,5,6,7];
    $('#layout-order-view').innerHTML=`<div class="layout-comparison"><div><p>逻辑 block 网格 · 每块 8 行 × 32B</p><div class="layout-block-map">${blocks.map(b=>`<span style="--block:hsl(${145+b.id*25},38%,48%)"><strong>B${b.id}</strong><small>band ${b.r} / ch ${b.c}</small><b>第 ${order.indexOf(b.id)+1} 块写入</b></span>`).join('')}</div></div><div><p>物理内存 · 从低地址到高地址</p><div class="layout-order-strip">${order.map((id,i)=>`<span style="--block:hsl(${145+id*25},38%,48%)"><strong>B${id}</strong><small>+${i*256}B</small></span>`).join('')}</div><p>${k==='K'?'K：先放完 ch0 的上下两个块，再放 ch1。换 channel 跨 H×32B。':'W：先放完 band0 的四个块，再放 band1。换 band 跨 G×8B。'}<br>逻辑 B0—B7 的位置没有变；改变的是它们在物理内存中的先后顺序。</p></div></div>`;
  }

  // Standalone nibble experiment: low nibble is the earlier logical element.
  function int4(){return `<section class="lab-intro"><div><span class="eyebrow">BIT-LEVEL VIEW</span><h2>8bit bank 读出后，怎么变成两行 INT4？</h2><p>先完整读出字节，再用固定连线取低 / 高四位。把相邻两行的同一半字节打包，得到转置后的两个字节序列。</p></div><span class="lab-model-tag">逐 bit 演示</span></section><section class="sim-panel"><div class="lab-controls"><label>演示源行数<select id="nibble-rows"><option>4</option><option selected>8</option><option>16</option><option>128</option></select></label><label>数据种子<input id="nibble-seed" type="number" min="0" max="15" value="1"></label><label>目的布局<select id="nibble-layout"><option value="L">Linear</option><option value="W">W / Wgt 折叠</option></select></label></div><div id="nibble-view"></div></section><a class="btn" href="#lab/operations/int4-w" style="margin-top:16px">进入完整矩阵：INT4 转置 + Wgt 折叠 →</a>`;}
  function updateInt4(){
    const rows=Number($('#nibble-rows').value),seed=Number($('#nibble-seed').value),layout=$('#nibble-layout').value;
    if(!Number.isInteger(seed)||seed<0||seed>15){$('#nibble-view').innerHTML='<p class="error-text">种子应为 0—15 的整数。</p>';return;}
    const low=Array.from({length:rows},(_,i)=>(seed+3*i)%16),high=Array.from({length:rows},(_,i)=>(seed+5*i+7)%16),a=M.packNibbles(low),b=M.packNibbles(high),hex=n=>n.toString(16).toUpperCase();
    const byteHTML=(hi,lo,label)=>`<span class="nibble-byte" title="${esc(label)}"><b class="nibble-high">${hex(hi)}</b><b class="nibble-low">${hex(lo)}</b><small>0x${hex(hi*16+lo).padStart(2,'0')}</small></span>`;
    $('#nibble-view').innerHTML=`<div class="nibble-caption">输入 ${rows} 个字节 = ${rows*2} 个 INT4；约定低四位放逻辑列 0，高四位放逻辑列 1。</div><div class="nibble-flow"><div><h3>源字节 [高 | 低]</h3><div class="nibble-bytes">${low.map((l,i)=>byteHTML(high[i],l,`源行 ${i}`)).join('')}</div></div><div class="nibble-wire"><span>取 bit[3:0] → 按行配对</span><span>取 bit[7:4] → 按行配对</span></div><div><h3>转置后的目标第 0 行 · ${rows/2}B</h3><div class="nibble-bytes">${a.map((v,i)=>byteHTML(v>>4,v&15,`{A[${i*2+1}][0], A[${i*2}][0]}`)).join('')}</div><h3>转置后的目标第 1 行 · ${rows/2}B</h3><div class="nibble-bytes">${b.map((v,i)=>byteHTML(v>>4,v&15,`{A[${i*2+1}][1], A[${i*2}][1]}`)).join('')}</div></div></div><div class="sim-equation">out0[j] = { src[2j+1][3:0], src[2j][3:0] }<br>out1[j] = { src[2j+1][7:4], src[2j][7:4] }</div><p>${rows===128?'正是前面讨论的 128B → 两份 64B：数据总量仍为 128B。':'把源行数切到 128，就能看到 128B 分成两份 64B。'} 固定拆位 / 拼位本身是连线；是否需要寄存器，由读延迟、写口吞吐和反压决定，不能据此断言完全不需要暂存。</p><p>${layout==='W'?'写 Wgt 时，还要按 8 行 × 32B 的目标块顺序组织。这里的两条转置行并不构成完整 Wgt 块；不能直接当成两条独立 128B 写出。完整矩阵实验可以看 W 地址映射。':'写 Linear 时两行通常具有不同的行地址。能否合成一个 128B 写请求，要看行距、地址连续性和写端接口。'} strobe 不能替代半字节选择。</p>`;
  }
  function swa(){return `<section class="lab-intro"><div><span class="eyebrow">SLIDING WINDOW ADDRESS</span><h2>SWA：到环尾以后，从环头继续</h2><p>数据顺序保持不变，地址在边界处回卷。这里按等大小行槽演示，实际字段单位需要按 ISA 换算。</p></div></section><section class="sim-panel"><div class="lab-controls"><label>作用端<select id="ring-side"><option value="read">读侧 SWA</option><option value="write">写侧 SWA</option></select></label><label>环内行槽数<input id="ring-size" type="number" value="8" min="2" max="32"></label><label>起始槽<input id="ring-start" type="number" value="6" min="0" max="31"></label><label>搬运行数<input id="ring-count" type="number" value="5" min="1" max="32"></label><label>每行 / B<input id="ring-pitch" type="number" value="128" min="128" step="128"></label></div><div id="ring-view"></div></section><div class="callout amber" style="margin-top:16px">环起点 / 大小 / base 范围检查必须保留。gather/scatter 与 SWA 的原有组合限制仍然生效；此演示不代表允许任意叠加。</div>`;}
  function updateSwa(){
    try{const size=Number($('#ring-size').value),start=Number($('#ring-start').value),count=Number($('#ring-count').value),pitch=Number($('#ring-pitch').value),side=$('#ring-side').value,order=M.ring(start,size,count);if(!Number.isSafeInteger(pitch)||pitch<128||pitch%128||pitch>65536)throw Error('每行字节数使用 128—65536 范围内的 128B 倍数。');
      $('#ring-view').innerHTML=`<div class="ring-map">${Array.from({length:size},(_,i)=>`<div class="ring-slot ${order.includes(i)?'active':''}"><strong>槽 ${i}</strong><span>+${fmt(i*pitch)}B</span><small>${order.includes(i)?'第 '+(order.indexOf(i)+1)+' 次'+(side==='read'?'读':'写'):'不访问'}</small></div>`).join('')}</div><div class="ring-order">${order.map((v,i)=>`<span class="${i&&v<order[i-1]?'wrapped':''}">${i&&v<order[i-1]?'↩ 回卷 ':''}${v}</span>`).join('<i>→</i>')}</div><p>${side==='read'?'源地址按这个顺序读取，目的行连续写出。':'源行连续读取，目的地址按这个顺序写入。'} ${start+count>size?'本次跨过环尾，拆成尾段和头段。':'本次没有越过环尾。'}</p><pre>slot(i) = (start + i) % ring_size\naddress(i) = ring_base + slot(i) × row_pitch\n${order.map((v,i)=>`i=${i} → ring_base + ${v*pitch}B`).join('\n')}</pre>`;
    }catch(e){$('#ring-view').innerHTML=`<p class="error-text">${esc(e.message)}</p>`;}
  }
  function paths(){return `<section class="lab-intro"><div><span class="eyebrow">CONTROL & DATA PATH</span><h2>同一个 CP，命令和数据怎么走？</h2><p>选择 local / remote / DLB 路径，再观察请求、返回和写端阻塞。下面是握手机制模型，不模拟 RTL 内部的精确延迟。</p></div></section><section class="sim-panel"><div class="lab-controls"><label>路径<select id="path-kind"><option value="local">CP_L1：Local L1 → Local L1</option><option value="remote">CP_L1：Remote L1 → Local L1</option><option value="dlb">CP_DLB：LPDDR → L2 / SoC Mem</option><option value="trans">CP_L1：转置路径</option></select></label><label>读返回延迟<select id="path-latency"><option>1</option><option selected>3</option><option>6</option></select></label><label>写端 ready<select id="path-ready"><option value="yes">始终 ready</option><option value="stall">每 4 拍停 2 拍</option></select></label><label>可保留返回的槽数<select id="path-slots"><option>1</option><option selected>4</option><option>8</option></select></label></div><div id="path-view"></div></section>`;}
  function handshake(latency,slots,stall){
    let sent=0,returned=0,written=0;const pending=[],fifo=[],trace=[];for(let cycle=0;cycle<150&&written<8;cycle++){
      const ready=!stall||cycle%4<2;let rd='—',ret='—',wr='—';
      if(fifo.length&&ready){wr='D'+fifo.shift();written++;}
      if(pending.length&&pending[0].due===cycle){const q=pending.shift();fifo.push(q.id);ret='D'+q.id;returned++;}
      if(sent<8&&pending.length+fifo.length<slots){rd='R'+sent;pending.push({id:sent,due:cycle+latency});sent++;}
      trace.push({cycle,rd,ret,wr,ready,used:pending.length+fifo.length,held:fifo.length?'D'+fifo[0]:'—'});
    }return {trace,written,returned,sent};
  }
  function updatePaths(){
    const k=$('#path-kind').value,lat=Number($('#path-latency').value),slots=Number($('#path-slots').value),stall=$('#path-ready').value==='stall',result=handshake(lat,slots,stall);
    const names=k==='trans'?['cp_cmd_decode','cp_l1 / cp_trans','cp_ctrl → agu / kfold_rd','trans 双 bank','cp_wfold_wr → Local L1']:k==='dlb'?['cp_cmd_decode','cp_dlb / cp_core','MIF 读 SoC Mem','rd_ctrl → wr_ctrl','MIF 写 SoC Mem']:['cp_cmd_decode','cp_l1 / cp_legacy','cp_core → rd_ctrl',k==='remote'?'MIF 读 Remote L1':'Local L1 读','wr_ctrl → Local L1'];
    $('#path-view').innerHTML=`<div class="sim-flow">${names.map((n,i)=>`<span><small>0${i+1}</small>${n}</span>`).join('<i>→</i>')}</div><p>${k==='remote'?'remote 是源数据位于另一个 L1，经 MIF 读取；目的仍是本地 L1。不能由此推断 CP_L1 有任意远端写口。':k==='dlb'?'DLB 在这里指 SoC Mem 搬运路径。cp_dlb 复用 core / rd_ctrl / wr_ctrl，主要负责外部存储之间的线性搬运。':k==='trans'?'控制模块产生地址和调度；数据通过重排 / 转置缓存和写端流水流动。各模块不是三条互不相关的并行功能。':'local 是当前 TMA 所连接的本地 L1。普通路径由 core 配置地址，rd_ctrl / wr_ctrl 配合流水执行。'}</p><div class="sim-path-metrics"><span><b>${result.trace.length}</b> 教学模型拍数</span><span><b>8</b> 返回并写出的数据拍</span><span><b>${slots}</b> 预留槽，包含在途请求</span></div><div class="sim-trace-scroll"><table class="matrix-table"><thead><tr><th>拍</th><th>发读请求</th><th>读返回</th><th>写 ready</th><th>写握手</th><th>待写队首</th><th>在途 + 缓存占用</th></tr></thead><tbody>${result.trace.map(t=>`<tr><td>${t.cycle}</td><td>${t.rd}</td><td>${t.ret}</td><td>${t.ready?'1':'0'}</td><td>${t.wr}</td><td>${t.held}</td><td>${t.used} / ${slots}</td></tr>`).join('')}</tbody></table></div><p>本模型在发读请求时就占一个槽，写握手后释放。只有一个槽时读延迟越大，气泡越明显；增加槽数可以覆盖在途延迟，但不能消除持续写反压。</p><p class="small muted">这不是“当前 RTL 已有上述 credit 逻辑”的结论。模型未包含独立 AW / B 通道、乱序返回、错误与实际 SRAM 端口冲突；最后 W 完成也不自动等于所有写响应已返回。CP_L1 / CP_DLB 并发能力仍按当前规格和仲裁实现检查。</p>`;
  }
  function mount(kind,id){stop();if(observer){observer.disconnect();observer=null;}if(kind==='operations'||kind==='layouts'){mode=kind;controls();rebuild();observer=new ResizeObserver(()=>{if(model){drawCanvas('#sim-source-canvas',model.inputs[source],false);drawCanvas('#sim-dest-canvas',model.output,true);}});observer.observe($('#sim-results'));if(kind==='layouts')updateLayoutOrder();}if(kind==='int4')updateInt4();if(kind==='swa')updateSwa();if(kind==='paths')updatePaths();}
  function dispose(){stop();if(observer)observer.disconnect();observer=null;}
  document.addEventListener('change',e=>{
    const el=e.target;if(el.id==='cp-operation')selectRecipe(el.value);
    if(el.matches('[data-lab-field]')){const k=el.dataset.labField,v=['axis','indices','order'].includes(k)?el.value:Number(el.value);if(config[k]!==v){config[k]=v;rebuild();}}
    if(el.id==='sim-source'){source=Number(el.value);srcPage=0;paint();}
    if(el.id==='sim-pick-y'||el.id==='sim-pick-x'){const y=Number($('#sim-pick-y').value),x=Number($('#sim-pick-x').value);if(Number.isInteger(y)&&Number.isInteger(x)&&y>=0&&y<model.output.rows&&x>=0&&x<model.output.cols)pick(y*model.output.cols+x,'dst');}
    if(el.id.startsWith('nibble-'))updateInt4();if(el.id.startsWith('ring-'))updateSwa();if(el.id.startsWith('path-'))updatePaths();
    if(el.id==='layout-order')updateLayoutOrder();
    if(el.id==='sim-speed'&&timer){stop();play();}
  });
  document.addEventListener('input',e=>{if(e.target.id==='sim-step'&&model){stop();step=Number(e.target.value);followStep();}});
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-lab-field]')){e.preventDefault();e.target.blur();}});
  document.addEventListener('click',e=>{
    const p=e.target.closest('[data-sim-preset]');if(p)preset(p.dataset.simPreset);
    const recipe=e.target.closest('[data-sim-recipe]');if(recipe)selectRecipe(recipe.dataset.simRecipe);
    const index=e.target.closest('[data-sim-indices]');if(index){const n=Math.min(config.rows,32);config.indices=Array.from({length:index.dataset.simIndices==='even'?Math.ceil(n/2):n},(_,i)=>index.dataset.simIndices==='reverse'?n-1-i:index.dataset.simIndices==='even'?i*2:0).join(', ');controls();rebuild();}
    const cell=e.target.closest('[data-sim-cell]');if(cell)pick(Number(cell.dataset.simCell),cell.dataset.simSide);
    const block=e.target.closest('[data-sim-block]');if(block)pick(Number(block.dataset.simBlock),block.dataset.simSide);
    const pg=e.target.closest('[data-sim-page]');if(pg){if(pg.dataset.simPage==='src')srcPage+=Number(pg.dataset.delta);else dstPage+=Number(pg.dataset.delta);memory(pg.dataset.simPage);}
    const canvas=e.target.closest('#sim-source-canvas,#sim-dest-canvas');if(canvas&&model){const r=canvas.getBoundingClientRect(),g=canvas._grid,x=Math.floor((e.clientX-r.left-g.ox)/g.scale),y=Math.floor((e.clientY-r.top-g.oy)/g.scale);if(x>=0&&x<g.cols&&y>=0&&y<g.rows)pick(y*g.cols+x,canvas.id.includes('source')?'src':'dst');}
    const a=e.target.closest('[data-sim-action]');if(!a)return;const action=a.dataset.simAction;
    if(action==='reset'){config=M.defaults(config.id);controls();rebuild();return;}if(action==='play'){play();return;}if(!model)return;
    if(['first','prev','next','last'].includes(action)){stop();step=action==='first'?0:action==='last'?model.steps.length:Math.max(0,Math.min(model.steps.length,step+(action==='next'?1:-1)));followStep();}
    if(action==='export'){const data={notice:'CP 坐标教学模型，不是 RTL 仿真或完整 ISA 描述符',config,srcGlobal:model.srcGeo,dstGlobal:model.dstGeo,outputShape:[model.output.rows,model.output.cols],mapping:model.output.cells.map((t,i)=>t?{src:t.label,dst:[Math.floor(i/model.output.cols),i%model.output.cols],srcAddress:M.locate(model.recipe.src,t.y,t.x,config.bits,model.srcGeo),dstAddress:M.locate(model.recipe.dst,Math.floor(i/model.output.cols),i%model.output.cols,config.bits,model.dstGeo)}:null)};const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=u;link.download='CP-'+config.id+'-mapping.json';link.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  });
  window.CP_LAB={shell,int4,swa,paths,mount,dispose,handshake,getState:()=>({config,model,step})};
})();
