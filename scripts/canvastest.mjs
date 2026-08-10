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
    children:[], archived:false, pinned:false, color, snippet:'', searchText:'', hasTaskList:false, mtime:Date.now() };
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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
