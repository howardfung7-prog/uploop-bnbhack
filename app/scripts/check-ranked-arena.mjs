// Render English/Chinese match rules and verify the single settlement rule.
import { buildSync } from "esbuild";
import Module from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
globalThis.document = { documentElement: { getAttribute: () => process.env.CHECK_LANG ?? "en" } };
globalThis.location = { hash: "#arena/1" };
globalThis.localStorage = { getItem: () => null };
const code = `
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {Arena} from './src/components/Arena';
import {phaseOf,participantCount} from './src/lib/arena';
import {demoPools,demoResults} from './src/lib/demo';
import {tr} from './src/lib/i18n';
import assert from 'node:assert/strict';
const now=Math.floor(Date.now()/1000);
const pool={id:1,kind:0,buyIn:10n**19n,locksAt:now+3600,settlesAt:now+4500,entryClosesAt:now+3540,entries:30,participants:12,settlementRule:'rank90_v2',rankingSlots:3,settled:false,refunding:false,settledAt:null,review:null,template:null,featured:null,gross:300n*10n**18n,sponsored:0n};
const props={account:null,canWrite:false,configured:true,loggedIn:false,busy:false,source:{},featured:new Map(),funds:null,points:{kind:'none'},followDemo:false,entriesPaused:false,onEnter:()=>{},onFunds:()=>{}};
const html=render(<Arena {...props} pools={[pool]}/>);
assert.ok(html.includes(tr('Base weight = shares × return tier^(-0.25)')));
assert.ok(html.includes(tr('90% is split by shares and return tier. 10% goes to the top K tiers (K = accounts ÷ 10 rounded up, at least 3), weighted 1 / tier. Equal returns share a tier.')));
assert.ok(html.includes(tr('A positive return does not guarantee your buy-in back. Zero return is refunded; a negative return gets nothing. No positive returns, all returns equal, or under 10 accounts: full refund, no fee.')));
assert.equal(participantCount(pool),12);
assert.equal(phaseOf({...pool,participants:2},now+3601),'short');
for(const p of demoPools().filter(p=>p.settled)) {
 const state=demoResults(p);assert.equal(state.kind,'ok');
 assert.equal(state.results.settlement_rule,'rank90_v2');
 assert.equal(state.results.break_even,undefined);
 const gross=state.results.standings.reduce((s,r)=>s+BigInt(r.amount),0n);
 const zero=state.results.standings.filter(r=>BigInt(r.strategy_return)===0n).reduce((s,r)=>s+BigInt(r.amount),0n);
 const paid=state.results.claims.reduce((s,c)=>s+BigInt(c.amount),0n);
 assert.equal(paid,state.results.refunded?gross:gross-(gross-zero)*14n/100n+p.sponsored);
}
console.log('PASS: rank90_v2 arena rules, unique-account minimum, and demo payouts');
`;
const output=buildSync({stdin:{contents:code,resolveDir:root,loader:"tsx"},bundle:true,platform:"node",format:"cjs",write:false,packages:"external",define:{"import.meta.env":"{}"}}).outputFiles[0].text;
const filename=root+"__ranked_check.cjs", compiled=new Module(filename);
compiled.filename=filename;compiled.paths=Module._nodeModulePaths(root);compiled._compile(output,filename);
