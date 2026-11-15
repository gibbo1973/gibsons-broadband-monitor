/* Gibson's Broadband Monitor — no third-party frontend dependencies. */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const t = (message, args) => window.GBM_I18N.t(message, args);
const locale = () => window.GBM_I18N.locale;
const state = {period:'7d', statsPeriod:'30d', networkPeriod:'30d', history:[], status:null, view:'overview', charts:{}, networkData:[], networkHits:[], networkSelectorSignature:''};
const palette = {download:'#35d4fa', upload:'#50edac', ping:'#c29cff'};
const number = (n, digits=1) => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits);
const formatDate = (value, options={dateStyle:'medium',timeStyle:'short'}) => {
  if (!value) return '—';
  const date = new Date(value); return Number.isNaN(+date) ? '—' : date.toLocaleString(locale(),options);
};
const ago = value => {
  if(!value) return t('Not yet');
  const s=Math.round((Date.now()-new Date(value).getTime())/1000);
  const rel = new Intl.RelativeTimeFormat(locale(), {numeric:'auto',style:'short'});
  if(s<0) return t('Just now');
  if(s<90) return rel.format(-s,'second');
  if(s<5400) return rel.format(-Math.floor(s/60),'minute');
  if(s<172800) return rel.format(-Math.floor(s/3600),'hour');
  return formatDate(value,{dateStyle:'short'});
};
async function jsonFetch(url, opts){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opts});if(r.status===401){location.assign('/login');throw Error(t('Sign in required'))}let data=await r.json();if(!r.ok)throw Error(data.error||t('Request failed'));return data}
function toast(message){const e=$('toast');e.textContent=message;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),4200)}
function setView(view){state.view=view;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('visible',x.id==='view-'+view));document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$('page-name').textContent=t(({overview:'Overview',history:'History',outages:'Outages',network:'Network usage',settings:'Settings'})[view]||view);window.scrollTo({top:0,behavior:'instant'});if(view==='overview')requestAnimationFrame(drawAll);if(view==='history')loadResults();if(view==='outages')loadOutages();if(view==='network'){loadNetworkUsage();requestAnimationFrame(drawNetworkChart)}}
function showStatus(data){state.status=data;const latest=data.latest,probe=data.last_probe;
  $('down-value').textContent=number(latest?.download);$('up-value').textContent=number(latest?.upload);
  $('ping-value').textContent=number(latest?.ping,0);$('ping-note').textContent=latest?.jitter!=null?t('Jitter')+' '+number(latest.jitter)+' ms':t('Most recent test');
  // The selected statistics window controls uptime/outage figures; status only provides live readings.
  $('tests-count').textContent=data.speed_samples.toLocaleString(locale());$('last-test').textContent=ago(latest?.ts);
  $('probe-every').textContent=data.probe_interval+'s';$('last-check').textContent=ago(probe?.ts);
  const pill=$('connection-pill'), indicator=$('status-indicator');
  pill.classList.toggle('offline',data.online===false);pill.classList.toggle('unknown',data.online==null);
  const label=data.online==null?t('Checking…'):data.online?t('Online'):t('Offline');
  pill.lastChild.textContent=label;indicator.textContent=label.toLocaleUpperCase(locale());indicator.style.color=data.online===false?'#ff7888':data.online===true?'#50edac':'#9ab3cb';
  $('status-title').textContent=data.online==null?t('Checking connection'):data.online?t('Internet connection active'):t('Connection unavailable');
  $('status-detail').textContent=data.current_outage?t('Outage detected since {date}',{date:formatDate(data.current_outage.started)}):data.online?t('Connectivity checks are responding normally.'):t('Waiting for an internet response.');
  $('down-note').textContent=latest?.download!=null && latest.download<data.slow_threshold?t('Below {threshold} Mbps warning',{threshold:data.slow_threshold}):t('Most recent test');
  const btn=$('run-btn');btn.disabled=Boolean(data.running);$('run-label').textContent=data.running?t('Testing in progress…'):t('Run speed test');
  if(data.last_attempt?.status==='failed'&&latest?.ts!==data.last_attempt.ts){$('last-test').title=t('Latest test failed: {reason}',{reason:data.last_attempt.error||t('unknown reason')})}
  if(document.activeElement!==$('speed-interval'))$('speed-interval').value=data.speed_interval;
  if(document.activeElement!==$('probe-interval'))$('probe-interval').value=data.probe_interval;
  if(document.activeElement!==$('slow-threshold'))$('slow-threshold').value=data.slow_threshold;
  for(const [key,id] of [['alert_outage','alert-outage'],['alert_restored','alert-restored'],['alert_slow','alert-slow']]){
    if(document.activeElement!==$(id))$(id).checked=Boolean(data[key]);
  }
  const configured=Boolean(data.alerts_configured);
  const alertStatus=$('alert-config-status');
  alertStatus.textContent=configured?t('Notifications ready'):t('Notifications not configured');
  alertStatus.classList.toggle('unconfigured',!configured);
  $('test-alert-btn').disabled=!configured;
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
    const label=(end-start<=48*3600000)?new Date(t).toLocaleString(locale(),{hour:'2-digit',minute:'2-digit'}):new Date(t).toLocaleDateString(locale(),{month:'short',day:'numeric'});
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
    $('speed-summary').textContent=t('{count} successful tests in selected period',{count:state.history.filter(x=>x.status==='ok').length.toLocaleString(locale())});
    drawAll();
  }catch(e){toast(t('Could not load chart: {reason}',{reason:e.message}))}
}
async function loadStatus(){try{showStatus(await jsonFetch('/api/status'))}catch(e){toast(e.message)}}
function cell(text,cls=''){const td=document.createElement('td');td.textContent=text;td.className=cls;return td}
async function loadResults(){try{
  const data=await jsonFetch('/api/results');const tbody=$('results-table');tbody.replaceChildren();
  if(!data.results.length){const tr=document.createElement('tr');tr.append(cell(t('No tests yet — your first result will appear automatically.')));tbody.append(tr);return}
  for(const result of data.results){const tr=document.createElement('tr');tr.append(cell(formatDate(result.ts)),cell(result.download==null?'—':number(result.download,2)+' Mbps','value-down'),cell(result.upload==null?'—':number(result.upload,2)+' Mbps','value-up'),cell(result.ping==null?'—':number(result.ping)+' ms'),cell(result.server||'—'),cell(result.status==='ok'?t('Success'):t('Failed'),'result-'+result.status));if(result.error)tr.title=result.error;tbody.append(tr)}
}catch(e){toast(e.message)}}
function prettyDuration(seconds){if(seconds==null)return t('In progress');seconds=Math.max(0,Math.floor(seconds));const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return [d?d+'d':null,h?h+'h':null,m?m+'m':null,s+'s'].filter(Boolean).join(' ')}
async function loadOutages(){try{const data=await jsonFetch('/api/outages');const body=$('outages-table');body.replaceChildren();if(!data.outages.length){const tr=document.createElement('tr');tr.append(cell(t('No confirmed outages have been recorded.')));body.append(tr);return}for(const o of data.outages){const tr=document.createElement('tr');tr.append(cell(formatDate(o.started)),cell(formatDate(o.ended)),cell(prettyDuration(o.duration_seconds)),cell(o.ended?t('Restored'):t('Ongoing'),o.ended?'result-ok':'result-failed'));body.append(tr)}}catch(e){toast(e.message)}}
async function runNow(){try{await jsonFetch('/api/run',{method:'POST',headers:{'X-Requested-With':'GibsonsDashboard'}});toast(t('Speed test started. The dashboard will update when it finishes.'));await loadStatus()}catch(e){toast(t('Could not start test: {reason}',{reason:e.message}))}}
async function saveSettings(e){e.preventDefault();const payload={speed_interval:+$('speed-interval').value,probe_interval:+$('probe-interval').value,slow_threshold:+$('slow-threshold').value};try{await jsonFetch('/api/settings',{method:'POST',headers:{'X-Requested-With':'GibsonsDashboard','Content-Type':'application/json'},body:JSON.stringify(payload)});$('settings-message').textContent=t('Saved');await loadStatus();toast(t('Settings saved'))}catch(e){$('settings-message').textContent=e.message}}
const statisticsPeriodLabels={
  '24h':'· LAST 24 HOURS',
  '7d':'· LAST 7 DAYS',
  '30d':'· LAST 30 DAYS',
  '90d':'· LAST 90 DAYS',
  '1y':'· LAST YEAR',
  'all':'· ALL TIME'
};
async function loadStatistics(){
  const selected=state.statsPeriod;
  try{
    const data=await jsonFetch('/api/statistics?period='+encodeURIComponent(selected));
    if(selected!==state.statsPeriod)return; // Ignore a slower response from the old period.
    $('stats-test-count').textContent=t('{count} successful tests in selected period', {
      count:Number(data.samples||0).toLocaleString(locale())
    });
    $('stats-coverage').textContent=data.first_sample
      ?t('Oldest test in this period: {date}',{date:formatDate(data.first_sample,{dateStyle:'medium'})})
      :t('No successful tests recorded in this period');
    $('uptime').textContent=number(data.uptime,2);
    $('outages-count').textContent=Number(data.outages||0).toLocaleString(locale());
    for(const id of ['uptime-period-label','outages-period-label'])
      $(id).textContent=t(statisticsPeriodLabels[selected]);
    for(const key of ['download','upload','ping','jitter']){
      for(const [field,suffix] of [['average','avg'],['minimum','min'],['maximum','max']]){
        $(`stats-${key}-${suffix}`).textContent=number(data[key]?.[field],1);
      }
    }
  }catch(error){
    if(selected===state.statsPeriod)toast(t('Could not load statistics: {reason}',{reason:error.message}));
  }
}
async function saveAlerts(event){
  event.preventDefault();
  const payload={
    alert_outage:$('alert-outage').checked?1:0,
    alert_restored:$('alert-restored').checked?1:0,
    alert_slow:$('alert-slow').checked?1:0
  };
  try{
    await jsonFetch('/api/settings',{method:'POST',headers:{
      'X-Requested-With':'GibsonsDashboard','Content-Type':'application/json'
    },body:JSON.stringify(payload)});
    $('alert-settings-message').textContent=t('Saved');
    toast(t('Alert preferences saved'));
    await loadStatus();
  }catch(error){$('alert-settings-message').textContent=error.message}
}
async function testAlert(){
  const button=$('test-alert-btn');
  button.disabled=true;
  try{
    await jsonFetch('/api/alerts/test',{method:'POST',headers:{'X-Requested-With':'GibsonsDashboard'}});
    toast(t('Test notification sent'));
  }catch(error){toast(t('Could not send test notification: {reason}',{reason:error.message}))}
  finally{button.disabled=false}
}

// Server network activity uses the same navy cards and cyan/mint palette as
// the speed charts. Units are decimal, as typically used for ISP data quotas.
function networkAmount(bytes){
  if(bytes==null || !Number.isFinite(Number(bytes)) || Number(bytes)<0)return {value:'—',unit:'GB'};
  let amount=Number(bytes);const units=['B','KB','MB','GB','TB','PB'];
  let i=0;while(amount>=1000 && i<units.length-1){amount/=1000;i++}
  const digits=i===0?0:amount>=100?0:amount>=10?1:2;
  return {value:amount.toLocaleString(locale(),{minimumFractionDigits:digits,maximumFractionDigits:digits}),unit:units[i]};
}
function displayNetworkAmount(id,bytes){
  const result=networkAmount(bytes);
  $(id).textContent=result.value;
  $(id+'-unit').textContent=result.unit;
}
function networkBucketDate(bucket){
  const iso=bucket.length===13?bucket+':00:00Z':bucket.length===10?bucket+'T00:00:00Z':bucket+'-01T00:00:00Z';
  const d=new Date(iso);
  if(Number.isNaN(+d))return bucket;
  if(bucket.length===13)return d.toLocaleString(locale(),{day:'numeric',hour:'2-digit'});
  if(bucket.length===7)return d.toLocaleString(locale(),{month:'short',year:'2-digit'});
  return d.toLocaleString(locale(),{day:'numeric',month:'short'});
}
function drawNetworkChart(){
  const canvas=$('network-chart'), width=canvas.getBoundingClientRect().width;
  if(width<30)return;
  const height=canvas.getBoundingClientRect().height;
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
  const rows=state.networkData;
  $('network-empty').classList.toggle('hidden',rows.length>0);
  state.networkHits=[];
  if(!rows.length)return;
  const box={left:49,right:width-12,top:15,bottom:height-35};
  const max=Math.max(1,...rows.map(x=>Number(x.download_bytes||0)+Number(x.upload_bytes||0)));
  const top=max*1.16;const w=box.right-box.left,h=box.bottom-box.top;
  ctx.save();ctx.font='10px system-ui,sans-serif';ctx.lineWidth=1;
  ctx.textAlign='right';ctx.fillStyle='#7895b3';ctx.strokeStyle='#243c54';
  for(let i=0;i<=4;i++){
    const y=box.top+h*i/4;
    ctx.setLineDash([2,6]);ctx.beginPath();ctx.moveTo(box.left,y);ctx.lineTo(box.right,y);ctx.stroke();ctx.setLineDash([]);
    const ordinate=networkAmount(top*(1-i/4));
    ctx.fillText(ordinate.value+' '+ordinate.unit,box.left-7,y+3);
  }
  const step=w/rows.length,barWidth=Math.max(1,Math.min(24,step*.6));
  const labelEvery=Math.max(1,Math.ceil(rows.length/5));
  rows.forEach((data,i)=>{
    const center=box.left+step*(i+.5);
    const down=Number(data.download_bytes||0),up=Number(data.upload_bytes||0);
    const hDown=h*down/top,hUp=h*up/top;
    if(down>0){ctx.fillStyle=palette.download;ctx.fillRect(center-barWidth/2,box.bottom-hDown,barWidth,hDown)}
    if(up>0){ctx.fillStyle=palette.upload;ctx.fillRect(center-barWidth/2,box.bottom-hDown-hUp,barWidth,hUp)}
    state.networkHits.push({x:center,bucket:data.bucket,down,up});
    if(i%labelEvery===0 || i===rows.length-1){
      ctx.fillStyle='#7895b3';ctx.textAlign='center';
      ctx.fillText(networkBucketDate(data.bucket),Math.max(box.left+23,Math.min(box.right-23,center)),height-10);
    }
  });
  ctx.restore();
}
function moveNetworkTooltip(event){
  const canvas=$('network-chart'),tip=$('network-tip'),hits=state.networkHits;
  if(!hits.length){tip.classList.remove('visible');return}
  const rect=canvas.getBoundingClientRect();
  const x=event.clientX-rect.left;
  let nearest=hits[0];
  for(const hit of hits)if(Math.abs(hit.x-x)<Math.abs(nearest.x-x))nearest=hit;
  if(Math.abs(nearest.x-x)>Math.max(20,rect.width/hits.length)){
    tip.classList.remove('visible');return;
  }
  const down=networkAmount(nearest.down),up=networkAmount(nearest.up);
  tip.textContent=networkBucketDate(nearest.bucket)+' · '+t('Downloaded')+': '+down.value+' '+down.unit+' · '+t('Uploaded')+': '+up.value+' '+up.unit;
  tip.style.left=Math.max(5,Math.min(rect.width-205,nearest.x+10))+'px';
  tip.style.top='20px';tip.classList.add('visible');
}
async function loadNetworkUsage(){
  const selected=state.networkPeriod;
  try{
    const data=await jsonFetch('/api/network/usage?period='+encodeURIComponent(selected));
    if(selected!==state.networkPeriod)return;
    const selector=$('network-interface');
    const signature=data.interfaces.join('|')+'|'+data.selected_interface;
    if(signature!==state.networkSelectorSignature){
      const options=[['auto',t('Auto (recommended)')],...data.interfaces.map(name=>[name,name])];
      selector.replaceChildren();
      for(const [value,label] of options){
        const option=document.createElement('option');option.value=value;option.textContent=label;selector.append(option);
      }
      if(data.selected_interface!=='auto' && !data.interfaces.includes(data.selected_interface)){
        const option=document.createElement('option');option.value=data.selected_interface;option.textContent=data.selected_interface+' ('+t('Unavailable')+')';selector.append(option);
      }
      selector.value=data.selected_interface;
      state.networkSelectorSignature=signature;
    }
    $('network-setup').hidden=Boolean(data.available);
    const hasSample=data.sample_count>0;
    displayNetworkAmount('network-down',hasSample?data.download_bytes:null);
    displayNetworkAmount('network-up',hasSample?data.upload_bytes:null);
    displayNetworkAmount('network-total',hasSample?data.total_bytes:null);
    // Month-to-date usage should remain visible even if the selected short period is empty.
    displayNetworkAmount('network-month',data.month_total_bytes);
    if(data.average_daily_bytes==null){
      $('network-daily').textContent=t('Collecting statistics...');
      $('network-daily').classList.add('is-pending');
      $('network-daily-unit').textContent='';
    }else{
      $('network-daily').classList.remove('is-pending');
      displayNetworkAmount('network-daily',data.average_daily_bytes);
    }
    $('network-first').textContent=data.first_sample?formatDate(data.first_sample,{dateStyle:'medium'}):'—';
    $('network-last').textContent=data.last_sample?ago(data.last_sample):t('Not yet');
    $('network-active-interface').textContent=data.interface
      ?(data.interfaces.includes(data.interface)
        ?t('Monitoring {interface}',{interface:data.interface})
        :t('Unavailable')+' · '+data.interface)
      :t('Awaiting host interface');
    state.networkData=data.buckets||[];
    $('network-empty').textContent=data.available
      ?t('Network samples will appear after the first collection interval.')
      :t('Add the host network mount to start monitoring.');
    $('network-chart-summary').textContent=hasSample
      ?t('{count} network samples in selected period',{count:Number(data.sample_count).toLocaleString(locale())})
      :t('No traffic samples recorded in this period');
    $('network-export').href='/api/network/export.csv?period='+encodeURIComponent(selected);
    if(document.activeElement!==$('network-limit'))$('network-limit').value=data.monthly_limit_gb||0;
    const limit=Number(data.monthly_limit_gb)||0;
    const proportion=limit>0?data.month_total_bytes/(limit*1000000000):0;
    $('network-budget-fill').style.width=Math.min(100,Math.max(0,proportion*100)).toFixed(1)+'%';
    $('network-budget-fill').classList.toggle('over-limit',proportion>=1);
    $('network-budget-status').textContent=limit===0
      ?t('No monthly warning level set.')
      :proportion>=1
      ?t('Monthly limit reached: {used} of {limit} GB',{used:networkAmount(data.month_total_bytes).value+' '+networkAmount(data.month_total_bytes).unit,limit})
      :t('{percent}% of your {limit} GB monthly warning level',{percent:(proportion*100).toFixed(1),limit});
    drawNetworkChart();
  }catch(error){toast(t('Could not load network usage: {reason}',{reason:error.message}))}
}
async function saveNetworkInterface(){
  const selector=$('network-interface');
  try{
    await jsonFetch('/api/network/interface',{method:'POST',headers:{
      'X-Requested-With':'GibsonsDashboard','Content-Type':'application/json'
    },body:JSON.stringify({interface:selector.value})});
    state.networkSelectorSignature='';
    await loadNetworkUsage();
    toast(t('Network interface saved'));
  }catch(error){toast(t('Could not save network interface: {reason}',{reason:error.message}))}
}
async function saveNetworkLimit(event){
  event.preventDefault();
  try{
    await jsonFetch('/api/network/limit',{method:'POST',headers:{
      'X-Requested-With':'GibsonsDashboard','Content-Type':'application/json'
    },body:JSON.stringify({limit_gb:Number($('network-limit').value)})});
    $('network-limit-message').textContent=t('Saved');
    await loadNetworkUsage();
  }catch(error){$('network-limit-message').textContent=error.message}
}
async function init(){
  await window.GBM_I18N.init();
  makeCanvasChart('speed-chart',[{key:'download',label:t('Download'),unit:'Mbps',color:palette.download},{key:'upload',label:t('Upload'),unit:'Mbps',color:palette.upload}],'speed-empty','speed-tip');
  makeCanvasChart('latency-chart',[{key:'ping',label:t('Ping'),unit:'ms',color:palette.ping}],'latency-empty','latency-tip');
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-period]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.period=b.dataset.period;$('date-range').classList.remove('open');loadHistory()}));
  document.querySelectorAll('[data-stats-period]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-stats-period]').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
    state.statsPeriod=b.dataset.statsPeriod;
    $('stats-test-count').textContent=t('Collecting statistics...');
    loadStatistics();
  }));
  $('custom-range-btn').addEventListener('click',()=>$('date-range').classList.toggle('open'));
  $('apply-range').addEventListener('click',()=>{state.period='custom';document.querySelectorAll('[data-period]').forEach(x=>x.classList.remove('selected'));loadHistory()});
  $('run-btn').addEventListener('click',runNow);$('settings-form').addEventListener('submit',saveSettings);
  $('alert-settings-form').addEventListener('submit',saveAlerts);
  $('test-alert-btn').addEventListener('click',testAlert);
  $('network-interface').addEventListener('change',saveNetworkInterface);
  $('network-limit-form').addEventListener('submit',saveNetworkLimit);
  $('network-chart').addEventListener('pointermove',moveNetworkTooltip);
  $('network-chart').addEventListener('pointerleave',()=>$('network-tip').classList.remove('visible'));
  document.querySelectorAll('[data-network-period]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-network-period]').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');state.networkPeriod=b.dataset.networkPeriod;loadNetworkUsage();
  }));
  if(typeof ResizeObserver!=='undefined'){const obs=new ResizeObserver(()=>drawAll());obs.observe($('speed-chart').parentElement);obs.observe($('latency-chart').parentElement);obs.observe($('network-chart').parentElement)}
  else window.addEventListener('resize',()=>{drawAll();drawNetworkChart()});
  function updateClock(){$('clock').textContent=new Date().toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'})}
  updateClock();setInterval(updateClock,30000);
  loadStatus();loadHistory();loadStatistics();
  setInterval(()=>{if(document.visibilityState==='visible'){loadStatus();if(state.view==='overview'){loadHistory();loadStatistics()}if(state.view==='network')loadNetworkUsage()}},30000);
}
document.addEventListener('DOMContentLoaded',init);
})();
