import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root,'app/static/i18n.js'),'utf8');

function setup({languages=['en-GB'],saved=null,fail=false}={}) {
  const window = {};
  const store = {getItem:()=>saved, setItem:()=>{}, removeItem:()=>{}};
  const document = {body:null,addEventListener:()=>{},getElementById:()=>null};
  const fetch = async url => {
    if (fail) throw Error('Network unavailable');
    const name = decodeURIComponent(url.split('/').at(-1));
    return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,'app/static/locales',name),'utf8'))};
  };
  vm.runInNewContext(source,{window,document,navigator:{languages},localStorage:store,fetch,console:{warn:()=>{}},location:{reload:()=>{}}});
  return window.GBM_I18N;
}

test('16 languages are available in one app image',()=>{
  const instance=setup();
  assert.equal(instance.options.length,16);
  assert.equal(instance.code,'en');
});
test('browser-language detection works for Japanese',async()=>{
  const i18n=setup({languages:['ja-JP','en-GB']});
  assert.equal(i18n.code,'ja');
  await i18n.init();
  assert.equal(i18n.t('Settings'),'設定');
});
test('Hong Kong Chinese uses Traditional Chinese',async()=>{
  const i18n=setup({languages:['zh-HK']});
  assert.equal(i18n.code,'zh-TW');
  await i18n.init();
  assert.equal(i18n.t('Settings'),'設定');
});
test('Mainland Chinese uses Simplified Chinese',async()=>{
  const i18n=setup({languages:['zh-CN']});
  assert.equal(i18n.code,'zh-CN');
  await i18n.init();
  assert.equal(i18n.t('Settings'),'设置');
});
test('Norwegian browser locale maps to Bokmål',async()=>{
  const i18n=setup({languages:['no-NO']});
  assert.equal(i18n.code,'nb');
  await i18n.init();
  assert.equal(i18n.t('Settings'),'Innstillinger');
});
test('manually selected language overrides browser preference',async()=>{
  const i18n=setup({languages:['ja'],saved:'sv'});
  assert.equal(i18n.code,'sv');
  await i18n.init();
  assert.equal(i18n.t('Settings'),'Inställningar');
});
test('translated variable placeholders are substituted',async()=>{
  const i18n=setup({languages:['es']});
  await i18n.init();
  assert.match(i18n.t('Below {threshold} Mbps warning',{threshold:80}),/80 Mbps/);
  assert.doesNotMatch(i18n.t('Below {threshold} Mbps warning',{threshold:80}),/\{threshold\}/);
});
test('unknown language or missing translation falls back safely to English',async()=>{
  const unknown=setup({languages:['xx-ZZ']});
  assert.equal(unknown.code,'en');
  const unavailable=setup({languages:['fr'],fail:true});
  await unavailable.init();
  assert.equal(unavailable.t('Settings'),'Settings');
});
