// Render the real components without a browser or RPC. No wallet is connected.
// Run from app/: node scripts/check-one-click-stake.mjs
import { buildSync } from "esbuild";
import Module from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
globalThis.document = { documentElement: { getAttribute: () => process.env.CHECK_LANG ?? "en" } };
const code = `
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {StakePools} from './src/components/StakePools';
import {OneClickStake} from './src/components/OneClickStake';
import {oneClickPoolOpen} from './src/lib/one-click-stake';
import {tr} from './src/lib/i18n';
import assert from 'node:assert/strict';
const address='0x'+'1'.repeat(40);
const a={ticker:'TEST',underlying:'TEST',class:'crypto',name:'Test',address,decimals:18,pair:'',status:'listed',sort:0,note:'',pool:'open',updated_at:0};
const t={id:1,asset:address,underlying:address,cert:'0x'+'2'.repeat(40),mode:'redeem',symbol:'uTEST',cls:'crypto',unit:0n,unitDecimals:18,unitSymbol:'TEST',pledged:0n,issued:0n,status:'dark'};
const p={board:[t],connected:false,readOnly:true,busy:null,quotes:new Map(),assets:{status:'ok',assets:[a],delisted:[]},dividends:null,mints:new Map(),onDeposit:()=>{},onOneClickStake:()=>{}};
for(const view of ['rows','cards']) {
  globalThis.localStorage={getItem:()=>view};
  const html=render(<StakePools {...p}/>);
  assert.ok(html.includes(tr('One-click stake · live USDT quote')));
  assert.ok(html.includes(tr('Quantity')));assert.ok(html.includes(tr('cert')));
  assert.ok(!html.includes('type="number"'));
  assert.ok(!html.includes(tr('Supported tokens')));
  for(const closed of [{...a,pool:'closed',one_click_stake:true},{...a,status:'unlisted'},{...a,one_click_stake:false}]) {
    const h=render(<StakePools {...p} assets={{...p.assets,assets:[closed]}}/>);
    assert.ok(!h.includes(tr('One-click stake · live USDT quote')));
    assert.ok(!h.includes(tr('Supported tokens')));
    assert.equal(oneClickPoolOpen(closed),false);
  }
}
const modal=render(<OneClickStake t={t} open readOnly onClose={()=>{}}/>);
for(const text of ['role="dialog"','disabled',tr('Preview only')]) assert.ok(modal.includes(text));
assert.ok(modal.includes(tr('{0} certificates · bought on PancakeSwap and pledged in one transaction', 1)));
assert.ok(modal.includes(tr('Maximum USDT payment')));
assert.ok(!modal.includes('type="number"'));
const closedModal=render(<OneClickStake t={t} open={false} readOnly onClose={()=>{}}/>);
assert.ok(closedModal.includes(tr('This pool is closed')));
console.log('PASS: pool cards, closed/delisted gates, supported-token section removal, live-quote dialog and read-only payment guard');
`;
const output = buildSync({
  stdin: { contents: code, resolveDir: root, loader: "tsx" },
  bundle: true, platform: "node", format: "cjs", write: false, packages: "external",
  define: { "import.meta.env": "{}" },
}).outputFiles[0].text;
const filename = root + "__one_click_check.cjs";
const compiled = new Module(filename);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(output, filename);
