/* Pure coordinate model. No RTL timing or hardware acceptance is inferred. */
'use strict';
(function(root){
  const layouts={
    L:{name:'Linear 线性',lane:1,rows:1,formula:'Y × G + X',detail:'按行存放。读完有效行宽，再按真实 G 跳到下一行。'},
    K:{name:'K / Act 折叠',lane:32,rows:8,formula:'floor(X/32) × H × 32 + Y × 32 + X%32',detail:'每行切成 32B；同一 channel 的各行片段连续。先沿 Y，再换 channel。完整块 8 行 × 32B。'},
    W:{name:'W / Wgt 折叠',lane:32,rows:8,formula:'floor(Y/8) × G × 8 + floor(X/32) × 256 + Y%8 × 32 + X%32',detail:'每 8 行组成一个 band，band 内按 32B channel 存放。先换 channel，再换 8 行 band。'},
    AP:{name:'Act 参数折叠',lane:8,rows:32,formula:'floor(X/8) × H × 8 + Y × 8 + X%8',detail:'每行切成 8B，按 channel 优先存放。完整块 32 行 × 8B；16 行片段可拼 128B。'},
    WP:{name:'Wgt 参数折叠',lane:8,rows:32,formula:'floor(Y/32) × G × 32 + floor(X/8) × 256 + Y%32 × 8 + X%8',detail:'每 32 行组成一个 band，band 内按 8B channel 存放。和 Act 参数的块内顺序相同，块间顺序不同。'}
  };
  const recipes=[];
  function add(id,title,op,src,dst,status='已有基线',feature=0,extra={}){recipes.push({id,title,op,src,dst,status,feature,...extra});}
  add('copy','普通线性搬运','copy','L','L');
  add('fold-k','Linear → K / Act 折叠','copy','L','K');
  add('fold-w','Linear → W / Wgt 折叠','copy','L','W');
  add('unfold-k','K / Act 逆折叠 → Linear','copy','K','L');
  add('unfold-w','W / Wgt 逆折叠 → Linear','copy','W','L');
  add('copy-k','K / Act 同布局搬运','copy','K','K');
  add('copy-w','W / Wgt 同布局搬运','copy','W','W','同布局机制 · 验收待核对');
  add('copy-ap','Act 参数同布局搬运','copy','AP','AP');
  add('copy-wp','Wgt 参数同布局搬运','copy','WP','WP','同布局机制 · 验收待核对');
  add('aw','AW：K 折叠 → 转置 → W 折叠','transpose','K','W','已有路径 · 具体配置需回归');
  add('transpose','普通二维转置','transpose','L','L');
  add('transpose-w','Linear 转置 → Wgt 折叠','transpose','L','W');
  add('transpose-wp','Linear 转置 → Wgt 参数折叠','transpose','L','WP');
  add('gather','Linear gather','gather','L','L');
  add('gather-k','Linear gather → Act 折叠','gather','L','K');
  add('gather-w','Linear gather → Wgt 折叠','gather','L','W');
  add('scatter','Linear scatter','scatter','L','L');
  add('scatter-k','Act 逆折叠 → scatter','scatter','K','L');
  add('scatter-w','Wgt 逆折叠 → scatter','scatter','W','L');
  add('f1','01 · Linear concat 拼接','concat','L','L','新增方案',1);
  add('f2','02 · ActFold 同布局 concat','concat','K','K','新增方案',2);
  add('f3','03 · ActPara 同布局 concat','concat','AP','AP','新增方案',3);
  add('f4','04 · Linear slice 切片','slice','L','L','新增方案',4);
  add('f5','05 · 三维 permute 换轴','permute','L','L','新增方案',5);
  add('f6','06 · Linear 转置 → Act 折叠','transpose','L','K','新增方案',6);
  add('f7','07 · Linear 转置 → Act 参数折叠','transpose','L','AP','新增方案',7);
  add('f8','08 · gather → Wgt 参数折叠','gather','L','WP','新增方案',8);
  add('f9','09 · gather → Act 参数折叠','gather','L','AP','新增方案',9);
  add('f10','10 · Act 参数逆折叠 → scatter','scatter','AP','L','新增方案',10);
  add('f11','11 · Wgt 参数逆折叠 → scatter','scatter','WP','L','新增方案',11);
  add('fold-ap','普通 Linear → Act 参数折叠','copy','L','AP','公共参数模式 · 待补齐');
  add('fold-wp','普通 Linear → Wgt 参数折叠','copy','L','WP','公共参数模式 · 待补齐');
  add('unfold-ap','Act 参数逆折叠 → Linear','copy','AP','L','公共参数模式 · 待补齐');
  add('unfold-wp','Wgt 参数逆折叠 → Linear','copy','WP','L','公共参数模式 · 待补齐');
  add('k-transpose-k','K 折叠 → 转置 → K 折叠','transpose','K','K','组合扩展 · 待实现');
  add('stride','stride：行距大于有效行宽','copy','L','L','复用行距 · 非独立新增数据通路');
  add('bulk','bulk：连续字节区间搬运','copy','L','L','语义演示 · 指令定义待确认');
  add('int4','INT4 普通转置','transpose','L','L','INT4 设计演示 · 待 RTL 验收',0,{bits:4});
  add('int4-w','INT4 转置 → Wgt 折叠','transpose','L','W','INT4 设计演示 · 待 RTL 验收',0,{bits:4});
  const ceil=(v,q)=>Math.ceil(v/q)*q;
  function address(layout,x,y,g,h){
    if(![x,y,g,h].every(Number.isSafeInteger)||x<0||y<0||g<=0||h<=0||x>=g||y>=h)throw Error('坐标必须是 global 内的非负整数。');
    const l=layouts[layout];if(!l)throw Error('未知布局');
    if(g%l.lane||h%l.rows)throw Error('折叠 global 必须容纳完整 block。');
    if(layout==='L')return y*g+x;
    if(layout==='K'||layout==='AP')return Math.floor(x/l.lane)*h*l.lane+y*l.lane+x%l.lane;
    return Math.floor(y/l.rows)*g*l.rows+Math.floor(x/l.lane)*256+(y%l.rows)*l.lane+x%l.lane;
  }
  function locate(layout,row,col,bits,geo){
    const bit=col*bits, x=geo.x+Math.floor(bit/8),y=geo.y+row;
    const byte=address(layout,x,y,geo.g,geo.h);
    return {byte,bit:bit%8,x,y,beat:Math.floor(byte/128),lane:byte%128,block:Math.floor(byte/256)};
  }
  function defaults(id){
    const r=recipes.find(r=>r.id===id)||recipes[0],para=/P/.test(r.src+r.dst);
    return {id:r.id,rows:para?32:r.src==='L'&&r.dst==='L'?4:16,cols:para?4:r.src==='L'&&r.dst==='L'?6:64,bits:r.bits|| (para?32:8),count:3,axis:'rows',indices:'3, 0, 2, 1',order:'ACB',depth:2,sliceY:1,sliceX:1,sliceH:2,sliceW:3,rowStep:1,colStep:1,srcX:0,srcY:0,dstX:0,dstY:0,srcPad:128,dstPad:128,srcExtraH:0,dstExtraH:0};
  }
  function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)throw Error(`${label}应为 ${min}—${max} 的整数。`);return v;}
  function build(p){
    const recipe=recipes.find(r=>r.id===p.id);if(!recipe)throw Error('请选择功能');
    const rows=integer(p.rows,1,128,'行数'),cols=integer(p.cols,1,256,'列数'),bits=p.bits;
    if(![4,8,16,32].includes(bits))throw Error('元素宽度只能是 4/8/16/32bit。');
    if(/P/.test(recipe.src+recipe.dst)&&bits!==32)throw Error('此演示的参数元素固定为 32bit；8B 片段包含 2 个元素。');
    const count=recipe.op==='concat'?integer(p.count,2,5,'输入份数'):1;
    const depth=recipe.op==='permute'?integer(p.depth,1,8,'A 轴长度'):1;
    const inputs=Array.from({length:count},(_,s)=>({rows:rows*depth,cols,cells:Array.from({length:rows*depth*cols},(_,i)=>({id:`${s}:${i}`,s,y:Math.floor(i/cols),x:i%cols,label:`${String.fromCharCode(65+s)}[${depth>1?Math.floor(i/(rows*cols))+',':''}${Math.floor(i/cols)%rows},${i%cols}]`}))}));
    let outRows=rows,outCols=cols,cells=[],steps=[],shape=null;
    const addRowStep=(y,label)=>steps.push({label,indices:Array.from({length:outCols},(_,x)=>y*outCols+x)});
    if(recipe.op==='concat'){
      if(!['rows','cols'].includes(p.axis))throw Error('请选择拼接轴');
      outRows=p.axis==='rows'?rows*count:rows;outCols=p.axis==='cols'?cols*count:cols;
      cells=Array(outRows*outCols).fill(null);
      inputs.forEach((a,s)=>{const indices=[];a.cells.forEach((t,i)=>{const y=t.y+(p.axis==='rows'?s*rows:0),x=t.x+(p.axis==='cols'?s*cols:0),j=y*outCols+x;cells[j]=t;indices.push(j);});steps.push({label:`child ${s+1}：输入 ${String.fromCharCode(65+s)} → dst_start(${p.axis==='cols'?s*cols:0}, ${p.axis==='rows'?s*rows:0})`,indices});});
    }else if(recipe.op==='transpose'){
      outRows=cols;outCols=rows;cells=Array(outRows*outCols);
      inputs[0].cells.forEach(t=>cells[t.x*outCols+t.y]=t);
      for(let y=0;y<outRows;y++)addRowStep(y,`源第 ${y} 列 → 目的第 ${y} 行，然后按 ${recipe.dst} 地址写出`);
    }else if(recipe.op==='gather'||recipe.op==='scatter'){
      const parts=String(p.indices).trim().split(/[\s,，]+/);
      if(parts.length>128||parts.some(v=>!/^\d+$/.test(v)))throw Error('索引请输入 1—128 个非负整数，用逗号分隔。');
      const ind=parts.map(Number);if(ind.some(v=>!Number.isSafeInteger(v)||v>=128))throw Error('教学索引范围为 0—127 行。');
      if(recipe.op==='gather'){
        if(ind.some(v=>v>=rows))throw Error(`gather 源只有 ${rows} 行，索引必须小于 ${rows}。`);
        outRows=ind.length;cells=ind.flatMap(y=>inputs[0].cells.slice(y*cols,(y+1)*cols));
        ind.forEach((v,y)=>addRowStep(y,`index[${y}]=${v}：源行 ${v} → 目的行 ${y}`));
      }else{
        if(new Set(ind).size!==ind.length)throw Error('scatter 重复目的索引会冲突；RTL 写入顺序契约未定义，演示拒绝此配置。');
        if(ind.length>rows)throw Error('scatter 索引数量不能多于源行数。');
        outRows=Math.max(rows,...ind.map(x=>x+1));cells=Array(outRows*cols).fill(null);
        ind.forEach((v,y)=>{for(let x=0;x<cols;x++)cells[v*cols+x]=inputs[0].cells[y*cols+x];addRowStep(v,`index[${y}]=${v}：源行 ${y} → 目的行 ${v}；其他行不写`);});
      }
    }else if(recipe.op==='slice'){
      const sy=integer(p.sliceY,0,rows-1,'起始行'),sx=integer(p.sliceX,0,cols-1,'起始列');
      outRows=integer(p.sliceH,1,128,'取出行数');outCols=integer(p.sliceW,1,256,'取出列数');
      const rs=integer(p.rowStep,1,16,'行步长'),cs=integer(p.colStep,1,16,'列步长');
      if(sy+(outRows-1)*rs>=rows||sx+(outCols-1)*cs>=cols)throw Error('切片越过源边界，请减小尺寸、起点或步长。');
      for(let y=0;y<outRows;y++){for(let x=0;x<outCols;x++)cells.push(inputs[0].cells[(sy+y*rs)*cols+sx+x*cs]);addRowStep(y,`源行 ${sy+y*rs}，从列 ${sx} 每隔 ${cs} 个元素取数`);}
    }else if(recipe.op==='permute'){
      if(!['ABC','ACB','BAC','BCA','CAB','CBA'].includes(p.order))throw Error('无效轴顺序');
      const dims={A:depth,B:rows,C:cols},order=p.order.split(''),target=order.map(x=>dims[x]);
      outRows=target[0]*target[1];outCols=target[2];cells=Array(outRows*outCols);shape=target;
      inputs[0].cells.forEach(t=>{const pos={A:Math.floor(t.y/rows),B:t.y%rows,C:t.x},dst=order.map(k=>pos[k]);cells[(dst[0]*target[1]+dst[1])*target[2]+dst[2]]=t;});
      for(let y=0;y<outRows;y++)addRowStep(y,`${p.order} 展平行 ${y}：按新轴顺序放置元素`);
    }else{
      cells=[...inputs[0].cells];for(let y=0;y<outRows;y++)addRowStep(y,`逻辑行 ${y} 保持不变：按 ${recipe.src} 读，按 ${recipe.dst} 写`);
    }
    if(cells.length>65536)throw Error('演示最多显示 65536 个元素，请缩小尺寸。');
    const geo=(side,r,c,layout)=>{
      const x=integer(p[side+'X'],0,2048,'X 字节偏移'),y=integer(p[side+'Y'],0,256,'Y 行偏移'),pad=integer(p[side+'Pad'],0,1024,'行尾留白'),extra=integer(p[side+'ExtraH'],0,256,'global 额外行');
      if(bits>=8&&x%(bits/8))throw Error('X 字节偏移必须对齐一个完整元素，不能把元素切开。');
      const l=layouts[layout],width=Math.ceil(c*bits/8);
      return {x,y,g:recipe.id==='bulk'?width:ceil(x+width+pad,128),h:recipe.id==='bulk'?r:ceil(y+r+extra,l.rows)};
    };
    if(recipe.id==='bulk'&&(p.srcX||p.srcY||p.dstX||p.dstY))throw Error('bulk 演示使用连续区间，起点用 base 表达；这里请保持 box 偏移为 0。');
    const srcGeo=geo('src',inputs[0].rows,cols,recipe.src),dstGeo=geo('dst',outRows,outCols,recipe.dst);
    const assigned=new Map();steps.forEach((s,k)=>s.indices.forEach(i=>assigned.set(i,k)));
    const destinations=new Map();cells.forEach((t,i)=>{if(t){if(!destinations.has(t.id))destinations.set(t.id,[]);destinations.get(t.id).push(i);}});
    const warnings=['这里验证元素映射；动画每步不是一个 RTL 时钟。小尺寸可用于理解，不表示通过 CP 对齐与合法性检查。'];
    if(recipe.op==='concat'&&recipe.src!=='L'){
      const l=layouts[recipe.src];if(p.axis!=='rows')warnings.push('列方向拼接仅展示数学结果；当前提案第一版限定 HW 行方向，不能直接下发。');
      if(rows%l.rows)warnings.push(`当前 ${rows} 行跨完整 ${l.rows} 行块；第一版折叠 concat 不支持该拼接缝。`);
    }
    if(recipe.op==='slice'&&p.colStep>1)warnings.push('列步长 > 1 不是原行级 gather；需要额外元素选择，超出第一版矩形 slice。');
    if(recipe.op==='gather'||recipe.op==='scatter')warnings.push('这里输入的是“行号”，便于观察。RTL 索引为元素偏移：线性行号需换算为行号 × global_G / 元素字节数；INT4 则每字节含 2 个元素。');
    if(recipe.id==='bulk')warnings.push('bulk 在功能表中尚无完整指令契约；本页仅演示连续区间原样复制，不做折叠或转置。');
    if(recipe.id==='stride')warnings.push('规格当前使用 global_size 表达实际行距；不是新增一个 stride 字段就能生效。');
    if(recipe.op==='permute')warnings.push('画面把前两轴展平成行，仅用于展示。正式子指令要保留 plane 跨度，不能把有 padding 的高维张量直接压平。');
    if(bits===4&&(cols%2||outCols%2))warnings.push('当前存在奇数个 INT4 元素的行尾：最后一个字节只有半字节有效。普通 byte strobe 无法保护另半字节，RTL 需限制配置或增加专门处理。');
    const valid=cells.filter(Boolean).length;
    return {recipe,p,inputs,output:{rows:outRows,cols:outCols,cells},srcGeo,dstGeo,steps,assigned,destinations,warnings,shape,bytes:valid*bits/8};
  }
  function physicalBlocks(model,side='dst',source=0){
    const isSrc=side==='src',a=isSrc?model.inputs[source]:model.output,geo=isSrc?model.srcGeo:model.dstGeo,layout=isSrc?model.recipe.src:model.recipe.dst;
    const blocks=new Map();a.cells.forEach((t,i)=>{if(!t)return;const y=Math.floor(i/a.cols),x=i%a.cols,pos=locate(layout,y,x,model.p.bits,geo);
      if(!blocks.has(pos.block))blocks.set(pos.block,{id:pos.block,first:pos.byte,minY:y,minX:x,count:0,indices:[]});const b=blocks.get(pos.block);b.first=Math.min(b.first,pos.byte);b.count++;b.indices.push(i);
    });return [...blocks.values()].sort((a,b)=>a.id-b.id);
  }
  function ring(start,size,count){integer(size,2,32,'环大小');integer(start,0,size-1,'起点');integer(count,1,size,'数量');return Array.from({length:count},(_,i)=>(start+i)%size);}
  function packNibbles(values){if(values.length%2)throw Error('打包需要偶数个元素');return Array.from({length:values.length/2},(_,i)=>(values[2*i]&15)|((values[2*i+1]&15)<<4));}
  const api={layouts,recipes,defaults,build,address,locate,physicalBlocks,ring,packNibbles,ceil};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CP_LAB_MODEL=api;
})(typeof window!=='undefined'?window:globalThis);
