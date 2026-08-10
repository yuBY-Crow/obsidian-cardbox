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
const root = card('root','blue');
const m1 = card('m1');
const m2 = card('m2','green');
const leaf = card('leaf');
const graph = {
  nodes: [
    { card: root, depth: 0, via: 'seed' },
    { card: m1, depth: 1, via: 'outgoing' },
    { card: m2, depth: 1, via: 'outgoing' },
    { card: leaf, depth: 2, via: 'outgoing' },
  ],
  edges: [
    { fromId: 'root', toId: 'm1' },
    { fromId: 'root', toId: 'm2' },
    { fromId: 'm1', toId: 'leaf' },
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
await sendCardsToCanvas(app2, [root,m1,m2,leaf], { folder:'Cards', ensureFolder: async()=>{}, graph });
const g = JSON.parse(created.content);

t('graph 模式 4 个节点', g.nodes.length===4);
t('graph 模式生成 3 条边', g.edges.length===3);
t('边字段完整', g.edges.every(e=>e.id&&e.fromNode&&e.toNode&&e.fromSide==='bottom'&&e.toSide==='top'));

const at = (f) => g.nodes.find(n=>n.file===`Cards/${f}.md`);
t('depth0 在最上一行', at('root').y < at('m1').y);
t('同层 y 相同', at('m1').y === at('m2').y);
t('depth2 在最下一行', at('leaf').y > at('m1').y);
t('同层 x 不同（并排）', at('m1').x !== at('m2').x);
t('层级行间距大于节点高', at('m1').y - at('root').y > at('root').height);
// 行内居中：最宽的一行是 depth1（2 个），root 应居中于其上
const rowCenter = (at('m1').x + at('m2').x + at('m2').width) / 2;
t('单节点行水平居中', Math.abs(at('root').x + at('root').width/2 - rowCenter) <= 1);
t('颜色仍映射', at('root').color==='5' && at('m2').color==='4');
t('无色节点不带 color 键', at('m1').color===undefined);

// graph 模式下节点仍不可重叠
const gboxes = g.nodes.map(n=>({x1:n.x,y1:n.y,x2:n.x+n.width,y2:n.y+n.height}));
let goverlap=false;
for(let i=0;i<gboxes.length;i++)for(let j=i+1;j<gboxes.length;j++){
  const A=gboxes[i],B=gboxes[j];
  if(A.x1<B.x2&&B.x1<A.x2&&A.y1<B.y2&&B.y1<A.y2) goverlap=true;
}
t('graph 模式节点不重叠', !goverlap);

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

// 追加到已有白板时也应带上连线
created = { path:'Cards/x.canvas', content: JSON.stringify({ nodes:[], edges:[] }) };
const activeCanvas2 = { path:'Cards/x.canvas', basename:'x', extension:'canvas' };
await sendCardsToCanvas(app2, [root,m1,m2,leaf], { folder:'Cards', activeCanvas:activeCanvas2, ensureFolder: async()=>{}, graph });
const g3 = JSON.parse(created.content);
t('追加模式也写入边', g3.edges.length===3 && g3.nodes.length===4);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
