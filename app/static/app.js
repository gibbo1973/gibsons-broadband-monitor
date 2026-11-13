/* Gibson's Broadband Monitor — no third-party frontend dependencies. */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const state = {period:'7d', history:[], status:null, view:'overview', charts:{}};
const palette = {download:'#35d4fa', upload:'#50edac', ping:'#c29cff'};
const number = (n, digits=1) => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits);
const formatDate = (value, options={dateStyle:'medium',timeStyle:'short'}) => {
  if (!value) return '—';
  const date = new Date(value); return Number.isNaN(+date) ? '—' : date.toLocaleString(undefined,options);
};
const ago = value => {
  if(!value) return 'Not yet';
  const s=Math.round((Date.now()-new Date(value).getTime())/1000);
  if(s<0) return 'Just now';
  if(s<90) return s+'s ago';
  if(s<5400) return Math.floor(s/60)+'m ago';
  if(s<172800) return Math.floor(s/3600)+'h ago';
  return formatDate(value,{dateStyle:'short'});
};
async function jsonFetch(url, opts){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opts});if(r.status===401){location.assign('/login');throw Error('Sign in required')}let data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
function toast(message){const e=$('toast');e.textContent=message;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),4200)}
function setView(view){state.view=view;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('visible',x.id==='view-'+view));document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$('page-name').textContent=view.charAt(0).toUpperCase()+view.slice(1);window.scrollTo({top:0,behavior:'instant'});if(view==='overview')requestAnimationFrame(drawAll);if(view==='history')loadResults();if(view==='outages')loadOutages()}
function showStatus(data){state.status=data;const latest=data.latest,probe=data.last_probe;
  $('down-value').textContent=number(latest?.download);$('up-value').textContent=number(latest?.upload);
  $('ping-value').textContent=number(latest?.ping,0);$('ping-note').textContent=latest?.jitter!=null?'Jitter '+number(latest.jitter)+' ms':'Most recent test';
  $('uptime').textContent=number(data.uptime30,2);$('outages-count').textContent=data.outages30;
  $('tests-count').textContent=data.speed_samples.toLocaleString();$('last-test').textContent=ago(latest?.ts);
  $('probe-every').textContent=data.probe_interval+'s';$('last-check').textContent=ago(probe?.ts);
  const pill=$('connection-pill'), indicator=$('status-indicator');
  pill.classList.toggle('offline',data.online===false);pill.classList.toggle('unknown',data.online==null);
  const label=data.online==null?'Checking…':data.online?'Online':'Offline';
  pill.lastChild.textContent=label;indicator.textContent=label.toUpperCase();indicator.style.color=data.online===false?'#ff7888':data.online===true?'#50edac':'#9ab3cb';
  $('status-title').textContent=data.online==null?'Checking connection':data.online?'Internet connection active':'Connection unavailable';
  $('status-detail').textContent=data.current_outage?'Outage detected since '+formatDate(data.current_outage.started):data.online?'Connectivity checks are responding normally.':'Waiting for an internet response.';
  $('down-note').textContent=latest?.download!=null && latest.download<data.slow_threshold?'Below '+data.slow_threshold+' Mbps warning':'Most recent test';
  const btn=$('run-btn');btn.disabled=Boolean(data.running);$('run-label').textContent=data.running?'Testing in progress…':'Run speed test';
  if(data.last_attempt?.status==='failed'&&latest?.ts!==data.last_attempt.ts){$('last-test').title='Latest test failed: '+(data.last_attempt.error||'unknown reason')}
  if(document.activeElement!==$('speed-interval'))$('speed-interval').value=data.speed_interval;
  if(document.activeElement!==$('probe-interval'))$('probe-interval').value=data.probe_interval;
  if(document.activeElement!==$('slow-threshold'))$('slow-threshold').value=data.slow_threshold;
}

// PCHIP-style monotone Bezier tangents: attractive smooth curves without overshoot
// that would visually invent speed peaks or understate valleys.
function monotonePath(ctx,coords){
  if(!coords.length)return;
  ctx.moveTo(coords[0].x,coords[0].y);
  if(coords.length===1)return;
  if(coords.length===2){ctx.lineTo(coords[1].x,coords[1].y);return}
  const d=coords.slice(1).map((p,i)=>(p.y-coords[i].y)/(p.x-coords[i].x || 1));
  const m=d.map((s,i)=>i===0?s:0);m[0]=d[0];m[coords.length-1]=d[d.length-1];
  for(let i=1;i<coords.length-1;i++)m[i]=(d[i-1]*d[i]<=0)?0:(2*d[i-1]*d[i])/(d[i-1]+d[i]);
  for(let i=0;i<coords.length-1;i++){
    const a=coords[i],b=coords[i+1],dx=b.x-a.x;
    ctx.bezierCurveTo(a.x+dx/3,a.y+m[i]*dx/3,b.x-dx/3,b.y-m[i+1]*dx/3,b.x,b.y);
  }
}
function makeCanvasChart(id,series,emptyId,tipId){
  const canvas=$(id);const tip=$(tipId);const empty=$(emptyId);
  const chart={canvas,tip,empty,series,points:[],visible:[],box:null};
  state.charts[id]=chart;
  canvas.addEventListener('pointermove',(event)=>{
    if(!chart.visible.length||!chart.box)return;
    const rect=canvas.getBoundingClientRect();const x=event.clientX-rect.left;
    let best=chart.visible[0],bestdist=Infinity;
    for(const p of chart.visible){const dist=Math.abs(p.x-x);if(dist<bestdist){best=p;bestdist=dist}}
    if(!best||x<chart.box.left-12||x>chart.box.right+12){tip.classList.remove('visible');return}
    const date=formatDate(best.record.ts);let html='<div class="chart-tip-date">'+date+'</div>';
    for(const s of series){const v=best.record[s.key];if(v==null)continue;html+='<div class="chart-tip-row"><span style="color:'+s.color+'">'+s.label+'</span><strong>'+number(v,s.key==='ping'?1:2)+' '+s.unit+'</strong></div>'}
    tip.innerHTML=html;tip.classList.add('visible');tip.style.left=Math.max(5,Math.min(rect.width-165,best.x+13))+'px';tip.style.top=Math.max(5,Math.min(rect.height-70,best.y-60))+'px';
  });
  canvas.addEventListener('pointerleave',()=>tip.classList.remove('visible'));
  return chart;
}
function drawChart(chart){
  const {canvas,series,empty}=chart;const width=canvas.getBoundingClientRect().width;
  if(width<30)return;
  const height=canvas.getBoundingClientRect().height;
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
  const rows=state.history.filter(r=>Number.isFinite(+new Date(r.ts)));
  chart.empty.classList.toggle('hidden',rows.some(r=>series.some(s=>r[s.key]!=null)));
  chart.visible=[];
  if(!rows.length)return;
  const box={left:47,right:width-15,top:12,bottom:height-29};chart.box=box;
  const start=Math.min(...rows.map(r=>+new Date(r.ts))),end=Math.max(...rows.map(r=>+new Date(r.ts)));
  const vals=rows.flatMap(r=>series.map(s=>r[s.key])).filter(v=>v!=null && Number.isFinite(Number(v))).map(Number);
  const high=Math.max(1,...vals),low=0;
  const range=high-low,top=high+range*.18;
  const xScale=t=>box.left+(end === start ? 0.5 : (t-start)/(end-start))*(box.right-box.left);
  const yScale=v=>box.bottom-((v-low)/(top-low))*(box.bottom-box.top);
  ctx.save();ctx.strokeStyle='#243c54';ctx.fillStyle='#7791aa';ctx.lineWidth=1;ctx.font='10px system-ui,sans-serif';ctx.textAlign='right';
  for(let i=0;i<=4;i++){
    const y=box.top+(box.bottom-box.top)*(i/4);ctx.setLineDash([2,6]);ctx.beginPath();ctx.moveTo(box.left,y);ctx.lineTo(box.right,y);ctx.stroke();ctx.setLineDash([]);
    ctx.fillText((top*(1-i/4)).toFixed(top>50?0:1),box.left-9,y+3);
  }
  ctx.textAlign='center';
  for(let i=0;i<=4;i++){
    const t=start+(end-start)*i/4;
    const label=(end-start<=48*3600000)?new Date(t).toLocaleString(undefined,{hour:'2-digit',minute:'2-digit'}):new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});
    ctx.fillText(label,box.left+i/4*(box.right-box.left),height-7);
  }
  ctx.restore();
  chart.visible=rows.filter(r=>series.some(s=>r[s.key]!=null)).map(r=>({record:r,x:xScale(+new Date(r.ts)),y:yScale(Number(r[series[0].key]??0))}));
  for(const s of series){
    // Null values split the line rather than pretending missing tests succeeded.
    const sequences=[];let group=[];
    for(const row of rows){
      if(row[s.key]==null){if(group.length)sequences.push(group);group=[];continue}
      group.push({x:xScale(+new Date(row.ts)),y:yScale(+row[s.key])});
    }
    if(group.length)sequences.push(group);
    for(const coords of sequences){
      if(!coords.length)continue;
      const gradient=ctx.createLinearGradient(0,box.top,0,box.bottom);
      gradient.addColorStop(0,s.color+'35');gradient.addColorStop(1,s.color+'00');
      if(coords.length>1){
        ctx.beginPath();monotonePath(ctx,coords);ctx.lineTo(coords[coords.length-1].x,box.bottom);ctx.lineTo(coords[0].x,box.bottom);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
      }
      ctx.beginPath();monotonePath(ctx,coords);ctx.strokeStyle=s.color;ctx.lineWidth=2.55;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor=s.color+'50';ctx.shadowBlur=5;ctx.stroke();ctx.shadowBlur=0;
      if(coords.length===1){ctx.beginPath();ctx.arc(coords[0].x,coords[0].y,3.7,0,Math.PI*2);ctx.fillStyle=s.color;ctx.fill()}
    }
  }
}
function drawAll(){for(const chart of Object.values(state.charts))drawChart(chart)}
async function loadHistory(){
  try{
    let qs='period='+encodeURIComponent(state.period);
    if(state.period==='custom'){
      const from=$('start-date').value,to=$('end-date').value;
      if(from)qs+='&from='+encodeURIComponent(new Date(from).toISOString());
      if(to)qs+='&to='+encodeURIComponent(new Date(to).toISOString());
    }
    const result=await jsonFetch('/api/history?'+qs);state.history=result.points||[];
    $('speed-summary').textContent=state.history.filter(x=>x.status==='ok').length.toLocaleString()+' successful tests in selected period';
    drawAll();
  }catch(e){toast('Could not load chart: '+e.message)}
}
async function loadStatus(){try{showStatus(await jsonFetch('/api/status'))}catch(e){toast(e.message)}}
function cell(text,cls=''){const td=document.createElement('td');td.textContent=text;td.className=cls;return td}
async function loadResults(){try{
  const data=await jsonFetch('/api/results');const tbody=$('results-table');tbody.replaceChildren();
  if(!data.results.length){const tr=document.createElement('tr');tr.append(cell('No tests yet — your first result will appear automatically.'));tbody.append(tr);return}
  for(const result of data.results){const tr=document.createElement('tr');tr.append(cell(formatDate(result.ts)),cell(result.download==null?'—':number(result.download,2)+' Mbps','value-down'),cell(result.upload==null?'—':number(result.upload,2)+' Mbps','value-up'),cell(result.ping==null?'—':number(result.ping)+' ms'),cell(result.server||'—'),cell(result.status==='ok'?'Success':'Failed','result-'+result.status));if(result.error)tr.title=result.error;tbody.append(tr)}
}catch(e){toast(e.message)}}
function prettyDuration(seconds){if(seconds==null)return 'In progress';seconds=Math.max(0,Math.floor(seconds));const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return [d?d+'d':null,h?h+'h':null,m?m+'m':null,s+'s'].filter(Boolean).join(' ')}
async function loadOutages(){try{const data=await jsonFetch('/api/outages');const body=$('outages-table');body.replaceChildren();if(!data.outages.length){const tr=document.createElement('tr');tr.append(cell('No confirmed outages have been recorded.'));body.append(tr);return}for(const o of data.outages){const tr=document.createElement('tr');tr.append(cell(formatDate(o.started)),cell(formatDate(o.ended)),cell(prettyDuration(o.duration_seconds)),cell(o.ended?'Restored':'Ongoing',o.ended?'result-ok':'result-failed'));body.append(tr)}}catch(e){toast(e.message)}}
async function runNow(){try{await jsonFetch('/api/run',{method:'POST',headers:{'X-Requested-With':'GibsonsDashboard'}});toast('Speed test started. The dashboard will update when it finishes.');await loadStatus()}catch(e){toast('Could not start test: '+e.message)}}
async function saveSettings(e){e.preventDefault();const payload={speed_interval:+$('speed-interval').value,probe_interval:+$('probe-interval').value,slow_threshold:+$('slow-threshold').value};try{await jsonFetch('/api/settings',{method:'POST',headers:{'X-Requested-With':'GibsonsDashboard','Content-Type':'application/json'},body:JSON.stringify(payload)});$('settings-message').textContent='Saved';await loadStatus();toast('Settings saved')}catch(e){$('settings-message').textContent=e.message}}
function init(){
  makeCanvasChart('speed-chart',[{key:'download',label:'Download',unit:'Mbps',color:palette.download},{key:'upload',label:'Upload',unit:'Mbps',color:palette.upload}],'speed-empty','speed-tip');
  makeCanvasChart('latency-chart',[{key:'ping',label:'Ping',unit:'ms',color:palette.ping}],'latency-empty','latency-tip');
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-period]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.period=b.dataset.period;$('date-range').classList.remove('open');loadHistory()}));
  $('custom-range-btn').addEventListener('click',()=>$('date-range').classList.toggle('open'));
  $('apply-range').addEventListener('click',()=>{state.period='custom';document.querySelectorAll('[data-period]').forEach(x=>x.classList.remove('selected'));loadHistory()});
  $('run-btn').addEventListener('click',runNow);$('settings-form').addEventListener('submit',saveSettings);
  if(typeof ResizeObserver!=='undefined'){const obs=new ResizeObserver(()=>drawAll());obs.observe($('speed-chart').parentElement);obs.observe($('latency-chart').parentElement)}
  else window.addEventListener('resize',drawAll);
  function updateClock(){$('clock').textContent=new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
  updateClock();setInterval(updateClock,30000);
  loadStatus();loadHistory();
  setInterval(()=>{if(document.visibilityState==='visible'){loadStatus();if(state.view==='overview')loadHistory()}},30000);
}
document.addEventListener('DOMContentLoaded',init);
})();
