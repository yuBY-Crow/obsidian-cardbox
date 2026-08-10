import esbuild from 'esbuild';
// 用 stub 替换 obsidian 依赖，直接测纯逻辑
const stub = `export class Notice{constructor(){}}
export class TFile{}
export const App={};`;
const r = await esbuild.build({
  entryPoints: ['src/utils/canvas.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{
    name: 'stub',
    setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
    },
  }],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const { sendCardsToCanvas, readCanvasCardPaths } = mod;

function card(id, color) {
  return { id, path:`Cards/${id}.md`, tags:[], created:Date.now(), updated:Date.now(),
    children:[], bodyLinks:[], archived:false, pinned:false, color, snippet:'', searchText:'', hasTaskList:false, mtime:Date.now() };
}
let created = null;
const app = {
  vault: {
    getAbstractFileByPath: () => null,
    create: async (path, content) => { created = { path, content }; return { path, basename: 'x', extension:'canvas' }; },
    read: async () => created.content,
    modify: async (f, c) => { created.content = c; },
  },
};
const cards = [card('a','red'), card('b'), card('c','purple'), card('d'), card('e')];
await sendCardsToCanvas(app, cards, { folder:'Cards', ensureFolder: async()=>{} });
const data = JSON.parse(created.content);

let pass=0, fail=0;
const t=(n,c)=>{ if(c) pass++; else { fail++; console.log('FAIL:',n); } };
t('has nodes array', Array.isArray(data.nodes) && data.nodes.length===5);
t('has edges array', Array.isArray(data.edges));
t('all nodes type file', data.nodes.every(n=>n.type==='file'));
t('file paths correct', data.nodes.every(n=>/^Cards\/[a-e]\.md$/.test(n.file)));
t('unique 16-hex ids', new Set(data.nodes.map(n=>n.id)).size===5 && data.nodes.every(n=>/^[0-9a-f]{16}$/.test(n.id)));
t('has numeric geometry', data.nodes.every(n=>[n.x,n.y,n.width,n.height].every(v=>typeof v==='number')));
t('red mapped to 1', data.nodes.find(n=>n.file.includes('a')).color==='1');
t('purple mapped to 6', data.nodes.find(n=>n.file.includes('c')).color==='6');
t('no color key when uncolored', data.nodes.find(n=>n.file.includes('b')).color===undefined);
// 无重叠检测
const boxes = data.nodes.map(n=>({x1:n.x,y1:n.y,x2:n.x+n.width,y2:n.y+n.height}));
let overlap=false;
for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const A=boxes[i],B=boxes[j];
  if(A.x1<B.x2&&B.x1<A.x2&&A.y1<B.y2&&B.y1<A.y2) overlap=true;
}
t('nodes do not overlap', !overlap);

// 追加到已有白板：应去重且不重叠
const activeCanvas = { path:'Cards/x.canvas', basename:'x', extension:'canvas' };
await sendCardsToCanvas(app, [card('a','red'), card('f')], { folder:'Cards', activeCanvas, ensureFolder: async()=>{} });
const d2 = JSON.parse(created.content);
t('append dedupes existing', d2.nodes.filter(n=>n.file==='Cards/a.md').length===1);
t('append added new node', d2.nodes.some(n=>n.file==='Cards/f.md'));
t('append total6', d2.nodes.length===6);
const newNode = d2.nodes.find(n=>n.file==='Cards/f.md');
const maxOldBottom = Math.max(...data.nodes.map(n=>n.y+n.height));
t('appended below existing', newNode.y >= maxOldBottom);

// 反向读取排序（上到下、左到右）
const paths = await readCanvasCardPaths(app, activeCanvas);
t('read returns md paths', paths.length===6 && paths.every(p=>p.endsWith('.md')));
const expectedOrder = d2.nodes.slice().sort((a,b)=>a.y-b.y||a.x-b.x).map(n=>n.file);
t('read order matches visual', JSON.stringify(paths)===JSON.stringify(expectedOrder));

// ===== 分层排布 + 连线（graph 模式）=====
// 结构：root → m1, m2；m1 → leaf。层级0/1/2 各一行。
// ===== 单种子「居中布局」：左入右出、双链上下 =====
// 结构：root（种子）→ m1, m2（出链）；x1, x2 → root（入链）；bi ↔ root（双链）
const root = card('root','blue');
const m1 = card('m1');
const m2 = card('m2','green');
const leaf = card('leaf');      // m1 的出链 → 右侧第二列
const x1 = card('x1');
const x2 = card('x2');
const bi = card('bi');
const graph = {
  nodes: [
    { card: root, depth: 0, via: 'seed' },
    { card: m1, depth: 1, via: 'outgoing' },
    { card: m2, depth: 1, via: 'outgoing' },
    { card: leaf, depth: 2, via: 'outgoing' },
    { card: x1, depth: 1, via: 'incoming' },
    { card: x2, depth: 1, via: 'incoming' },
    { card: bi, depth: 1, via: 'both' },
  ],
  edges: [
    { fromId: 'root', toId: 'm1' },
    { fromId: 'root', toId: 'm2' },
    { fromId: 'm1', toId: 'leaf' },
    { fromId: 'x1', toId: 'root' },
    { fromId: 'x2', toId: 'root' },
    { fromId: 'bi', toId: 'root' },
    { fromId: 'root', toId: 'bi' },
  ],
};
created = null;
const app2 = {
  vault: {
    getAbstractFileByPath: () => null,
    create: async (path, content) => { created = { path, content }; return { path, basename:'g', extension:'canvas' }; },
    read: async () => created.content,
    modify: async (f, c) => { created.content = c; },
  },
};
await sendCardsToCanvas(app2, [root,m1,m2,leaf,x1,x2,bi], { folder:'Cards', ensureFolder: async()=>{}, graph });
const g = JSON.parse(created.content);

t('居中布局 7 个节点', g.nodes.length===7);
// 双向引用对（root↔bi）合并为一条双向边，其余 5 条单向边（7 条原始边 - 1 合并）
t('居中布局 6 条边（5 单向 + 1 双向）', g.edges.length===6, g.edges.length);
t('边字段完整', g.edges.every(e=>e.id&&e.fromNode&&e.toNode&&e.toEnd==='arrow'));

const at = (f) => g.nodes.find(n=>n.file===`Cards/${f}.md`);
const cx = (n) => n.x + n.width/2;
t('种子位于正中（x=0）', at('root').x===0);
t('出链在种子右侧', cx(at('m1')) > cx(at('root')) && cx(at('m2')) > cx(at('root')));
t('入链在种子左侧', cx(at('x1')) < cx(at('root')) && cx(at('x2')) < cx(at('root')));
t('层级越深越靠右', cx(at('leaf')) > cx(at('m1')));
t('出链同层同列', at('m1').x === at('m2').x);
t('入链同层同列', at('x1').x === at('x2').x);
t('双链与种子同列', cx(at('bi')) === cx(at('root')));
t('双链在种子上方或下方', at('bi').y !== at('root').y);
t('上下间距大于节点高', Math.abs(at('bi').y - at('root').y) > at('root').height);

// 双链边：双向箭头 + 颜色
const biEdges = g.edges.filter(e=>e.fromEnd==='arrow');
t('双向边只有一条', biEdges.length===1);
t('双向边带颜色', biEdges[0].color==='5' || typeof biEdges[0].color==='string');
t('双向边两端是 root 与 bi', (()=>{
  const from=biEdges[0].fromNode, to=biEdges[0].toNode;
  const fs=g.nodes.find(n=>n.id===from)?.file, ts=g.nodes.find(n=>n.id===to)?.file;
  return (fs==='Cards/root.md'&&ts==='Cards/bi.md')||(fs==='Cards/bi.md'&&ts==='Cards/root.md');
})());

// 自定义双链颜色生效
created = null;
await sendCardsToCanvas(app2, [root,m1,m2,leaf,x1,x2,bi], { folder:'Cards', ensureFolder: async()=>{}, graph, bidirectionalColor:'6' });
const gC = JSON.parse(created.content);
t('自定义双链颜色生效', gC.edges.find(e=>e.fromEnd==='arrow').color==='6');

// 几何方向：横向为主时用 right/left 侧
const rightEdge = g.edges.find(e=>g.nodes.find(n=>n.id===e.fromNode).file==='Cards/root.md'
  && g.nodes.find(n=>n.id===e.toNode).file==='Cards/m1.md');
t('出链边用 right→left', rightEdge && rightEdge.fromSide==='right' && rightEdge.toSide==='left');

t('颜色仍映射', at('root').color==='5' && at('m2').color==='4');
t('无色节点不带 color 键', at('m1').color===undefined);

// 居中布局下节点仍不可重叠
const gboxes = g.nodes.map(n=>({x1:n.x,y1:n.y,x2:n.x+n.width,y2:n.y+n.height}));
let goverlap=false;
for(let i=0;i<gboxes.length;i++)for(let j=i+1;j<gboxes.length;j++){
  const A=gboxes[i],B=gboxes[j];
  if(A.x1<B.x2&&B.x1<A.x2&&A.y1<B.y2&&B.y1<A.y2) goverlap=true;
}
t('居中布局节点不重叠', !goverlap);

// 边引用的必须是真实存在的节点 id（Canvas 里坏边会导致白板报错）
const nodeIds = new Set(g.nodes.map(n=>n.id));
t('边两端都指向真实节点', g.edges.every(e=>nodeIds.has(e.fromNode)&&nodeIds.has(e.toNode)));
t('无自环边', g.edges.every(e=>e.fromNode!==e.toNode));

// 指向白板外卡片的边必须被丢弃，否则 Canvas 出现悬空连线
created = null;
await sendCardsToCanvas(app2, [root], {
  folder:'Cards', ensureFolder: async()=>{},
  graph: { nodes:[{card:root,depth:0,via:'seed'}], edges:[{fromId:'root',toId:'notOnBoard'}] },
});
const g2 = JSON.parse(created.content);
t('丢弃指向白板外卡片的边', g2.edges.length===0 && g2.nodes.length===1);

// 追加到已有白板时也应带上连线；左列存在时整体右移避免重叠
created = { path:'Cards/x.canvas', content: JSON.stringify({ nodes:[{id:'old',type:'file',file:'Cards/old.md',x:0,y:0,width:300,height:220}], edges:[] }) };
const activeCanvas2 = { path:'Cards/x.canvas', basename:'x', extension:'canvas' };
await sendCardsToCanvas(app2, [root,m1,m2,leaf,x1,x2,bi], { folder:'Cards', activeCanvas:activeCanvas2, ensureFolder: async()=>{}, graph });
const g3 = JSON.parse(created.content);
t('追加模式也写入边', g3.edges.length===6 && g3.nodes.length===8);
const oldNode = g3.nodes.find(n=>n.file==='Cards/old.md');
const newNodes = g3.nodes.filter(n=>n.file!=='Cards/old.md');
t('追加时左列右移不压旧节点', newNodes.every(n=>n.x >= oldNode.x + oldNode.width + 20));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
