// Exercise combined performance without changing reputation or payout inputs.
import { buildSync } from "esbuild";
import Module from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
globalThis.document = { documentElement: { getAttribute: () => "en" } };
const code = `
import assert from 'node:assert/strict';
import {ratesOf, loadPoints, rankOf} from './src/lib/points';
const player = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const table = {version:'uploop.performance.v1',players:{},pools:[],as_of_day:null,
 race_rates:{[player]:{settled:4,won:2,all_correct:1}}};
const state = {kind:'ok',table};
assert.deepEqual(ratesOf(state, player.toUpperCase()), {n:4,win:2,perfect:1});
assert.equal(rankOf(state,player),null);
assert.equal(ratesOf(state,'0xbb'),null);
assert.equal(ratesOf({kind:'none'},player),null);
table.players[player]={paid_entries:2,in_money:1,all_correct:1,rank:'Analyst'};
assert.deepEqual(ratesOf(state,player),{n:6,win:3,perfect:2});
assert.equal(rankOf(state,player),'Analyst');
assert.equal(table.players[player].paid_entries,2);
delete table.players[player].all_correct;
assert.equal(ratesOf(state,player).perfect,null);
let requested;
globalThis.fetch=async url=>{requested=url;return {ok:true,json:async()=>table}};
(async()=>{
 assert.equal((await loadPoints()).kind,'ok');
 assert.equal(requested,'/api/points');
 globalThis.fetch=async()=>({ok:false});
 assert.equal((await loadPoints()).kind,'none');
 console.log('PASS: race-only and combined rates, account normalization, missing history, API source and unchanged ranks');
})().catch(e=>{console.error(e);process.exitCode=1});
`;
const output = buildSync({stdin:{contents:code,resolveDir:root,loader:"ts"},bundle:true,platform:"node",format:"cjs",write:false,packages:"external",define:{"import.meta.env":JSON.stringify({VITE_API_BASE:"/api"})}}).outputFiles[0].text;
const filename = root + "__race_stats_check.cjs", compiled = new Module(filename);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(output, filename);
