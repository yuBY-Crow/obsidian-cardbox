import esbuild from 'esbuild';
const r = await esbuild.build({
  entryPoints: ['src/boxes.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
  external: ['obsidian'],
});
const code = r.outputFiles[0].text;
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const { cardMatchesBox, resolveTimeWindow, describeBox } = mod;

const day = 86400000;
const now = new Date(2026, 7, 10, 12, 0, 0).getTime();
function card(o={}) {
  return { id:o.id??'c1', path:'Cards/c1.md', title:o.title, tags:o.tags??[], created:o.created??now,
    updated:now, children:[], archived:false, pinned:o.pinned??false, color:o.color,
    snippet:o.snippet??'', searchText:(o.searchText??o.snippet??'').toLowerCase(), hasTaskList:false, mtime:now };
}
function box(o={}) {
  return { id:'b', name:'b', time:o.time??{mode:'any'}, tags:o.tags??[], keywords:o.keywords??[],
    keywordMatch:o.keywordMatch??'any', colors:o.colors??[], pinnedOnly:o.pinnedOnly??false };
}
let pass=0, fail=0;
const t=(name,cond)=>{ if(cond){pass++;} else {fail++; console.log('FAIL:',name);} };

t('empty box matches all', cardMatchesBox(card(), box(), now));
t('nested tag prefix', cardMatchesBox(card({tags:['读书/笔记']}), box({tags:['读书']}), now));
t('tag no false positive', !cardMatchesBox(card({tags:['读书会']}), box({tags:['读书']}), now));
t('multi tag any-hit', cardMatchesBox(card({tags:['灵感']}), box({tags:['书摘','灵感']}), now));
t('keyword in body', cardMatchesBox(card({searchText:'#写作心得 今天有感'}), box({keywords:['写作']}), now));
t('keyword all mode', cardMatchesBox(card({searchText:'写作 阅读'}), box({keywords:['写作','阅读'],keywordMatch:'all'}), now));
t('keyword all fails', !cardMatchesBox(card({searchText:'写作'}), box({keywords:['写作','阅读'],keywordMatch:'all'}), now));

const w = resolveTimeWindow(box({time:{mode:'dynamic',lastDays:7}}), now);
t('dynamic has from only', typeof w.from === 'number' && w.to === undefined);
t('today in last7', cardMatchesBox(card({created:now}), box({time:{mode:'dynamic',lastDays:7}}), now));
t('6d ago in last7', cardMatchesBox(card({created:now-6*day}), box({time:{mode:'dynamic',lastDays:7}}), now));
t('8d ago not in last7', !cardMatchesBox(card({created:now-8*day}), box({time:{mode:'dynamic',lastDays:7}}), now));

const sbox = box({time:{mode:'static',from:'2026-08-01',to:'2026-08-05'}});
t('static includes start day', cardMatchesBox(card({created:new Date(2026,7,1,0,0,1).getTime()}), sbox, now));
t('static includes end day late', cardMatchesBox(card({created:new Date(2026,7,5,23,59,0).getTime()}), sbox, now));
t('static excludes after', !cardMatchesBox(card({created:new Date(2026,7,6,0,0,1).getTime()}), sbox, now));

t('color match', cardMatchesBox(card({color:'red'}), box({colors:['red','blue']}), now));
t('color mismatch', !cardMatchesBox(card({color:'green'}), box({colors:['red']}), now));
t('no color vs color box', !cardMatchesBox(card({}), box({colors:['red']}), now));
t('pinnedOnly excludes unpinned', !cardMatchesBox(card({pinned:false}), box({pinnedOnly:true}), now));
t('AND semantics', !cardMatchesBox(card({tags:['读书'],color:'green'}), box({tags:['读书'],colors:['red']}), now));

console.log('describeBox =>', describeBox(box({time:{mode:'dynamic',lastDays:7},tags:['读书'],keywords:['写作']})));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
