/* P.M. OFFSET PRINTERS — Frontend */
var STAGES=[
  {n:1,name:'Order Received'},{n:2,name:'Design / Prepress'},
  {n:3,name:'Printing'},{n:4,name:'Post-Press Finishing'},
  {n:5,name:'Quality Check'},{n:6,name:'Shipping / Ready for Pickup'}
];
var FINISH_TYPES=['Matte','Glossy','Satin','Uncoated','Laminated','Varnished','Other'];
var GSM_OPTIONS=['80','100','120','150','170','200','250','300','350','Other'];
var PROCESS_OPTIONS=['Velvet Finish','Matt Finish','Gloss Finish','Lamination','Foiling'];
var currentUser=null,allOrders=[],currentTab='orders';

async function api(url,o){o=o||{};var r=await fetch(url,{headers:{'Content-Type':'application/json'},method:o.method||'GET',body:o.body?JSON.stringify(o.body):undefined});var d=await r.json();if(!r.ok)throw new Error(d.error||'Something went wrong');return d}
function $(id){return document.getElementById(id)}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function toast(msg,t){var el=$('toast');el.textContent=msg;el.className='toast '+(t||'ok')+' show';setTimeout(function(){el.classList.remove('show')},3000)}
function fmtD(s){if(!s||s==='null')return'—';var d=new Date(String(s).replace(' ','T'));if(isNaN(d))return'—';return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
function fmtDT(s){if(!s||s==='null')return'—';var str=String(s);if(str.indexOf('T')===-1&&str.indexOf(' ')!==-1)str=str.replace(' ','T');else if(str.indexOf('T')===-1)str=str+'T00:00:00';var d=new Date(str);if(isNaN(d))return'—';return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})}

/* MODALS */
function openLoginModal(){$('login-modal').classList.add('open');$('login-msg').innerHTML='';showLoginInModal();setTimeout(function(){$('login-user').focus()},100)}
function closeLoginModal(){$('login-modal').classList.remove('open')}
function showForgotInModal(){$('login-form-area').style.display='none';$('forgot-form-area').style.display='block';$('login-msg').innerHTML='';$('forgot-step1').style.display='block';$('forgot-step2').style.display='none'}
function showLoginInModal(){$('forgot-form-area').style.display='none';$('login-form-area').style.display='block';$('login-msg').innerHTML=''}
function openModal(html){$('gen-modal-box').innerHTML=html;$('gen-modal').classList.add('open')}
function closeModal(){$('gen-modal').classList.remove('open')}

document.addEventListener('DOMContentLoaded',function(){
  $('login-modal').addEventListener('click',function(e){if(e.target===$('login-modal'))closeLoginModal()});
  $('gen-modal').addEventListener('click',function(e){if(e.target===$('gen-modal'))closeModal()});
  document.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&$('login-modal').classList.contains('open')&&$('login-form-area').style.display!=='none')doLogin();
    if(e.key==='Escape'){closeLoginModal();closeModal()}
  });
  checkAuth();
});

/* AUTH */
async function checkAuth(){try{var d=await api('/api/auth/me');currentUser=d.user}catch(e){currentUser=null}render()}

function render(){
  if(currentUser){
    var icon=currentUser.role==='head_admin'?'👑':'👤';
    $('nav-right').innerHTML='<span class="nav-user">'+icon+' '+esc(currentUser.username)+'</span><button class="nav-btn" onclick="logout()">Logout</button>';
    renderDashboard();
  } else {
    $('nav-right').innerHTML='<div class="nav-tagline">Order Tracking Portal</div><button class="nav-btn" onclick="openLoginModal()">Login</button>';
    renderLanding();
  }
}

async function doLogin(){
  var u=$('login-user').value.trim(),p=$('login-pass').value;
  if(!u||!p){$('login-msg').innerHTML='<div class="lm-err" style="display:block">Please enter username and password.</div>';return}
  try{var d=await api('/api/auth/login',{method:'POST',body:{username:u,password:p}});currentUser=d.user;closeLoginModal();toast('Welcome, '+currentUser.username+'!');render()}
  catch(err){$('login-msg').innerHTML='<div class="lm-err" style="display:block">'+esc(err.message)+'</div>'}
}
async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch(e){}currentUser=null;currentTab='orders';toast('Logged out.');render()}
async function forgotGetQ(){
  var u=$('forgot-user').value.trim();if(!u){$('login-msg').innerHTML='<div class="lm-err" style="display:block">Enter your username.</div>';return}
  try{var d=await api('/api/auth/forgot-password/question',{method:'POST',body:{username:u}});$('forgot-q').textContent=d.question;$('forgot-step1').style.display='none';$('forgot-step2').style.display='block';$('login-msg').innerHTML=''}
  catch(e){$('login-msg').innerHTML='<div class="lm-err" style="display:block">'+esc(e.message)+'</div>'}
}
async function forgotReset(){
  var u=$('forgot-user').value.trim(),a=$('forgot-ans').value.trim(),p=$('forgot-pw').value;
  if(!a||!p){$('login-msg').innerHTML='<div class="lm-err" style="display:block">Fill in all fields.</div>';return}
  try{await api('/api/auth/forgot-password/reset',{method:'POST',body:{username:u,answer:a,newPassword:p}});toast('Password reset!');showLoginInModal()}
  catch(e){$('login-msg').innerHTML='<div class="lm-err" style="display:block">'+esc(e.message)+'</div>'}
}

/* LANDING */
function renderLanding(){
  $('app').innerHTML=
    '<section class="hero"><div>'+
      '<div class="hero-eye">Live Production Status</div>'+
      '<h1>Track your<br><span>print order</span><br>in real time.</h1>'+
      '<p>Enter your order ID to see exactly where your job is in our production pipeline — from first proof to delivery.</p>'+
    '</div><div class="lookup">'+
      '<div class="lookup-lbl">Track an Order</div><div id="trk-msg"></div>'+
      '<div class="fw"><label>Order ID</label><input type="text" id="trk-in" placeholder="e.g. PM-20847" autocomplete="off" spellcheck="false" onkeydown="if(event.key===\'Enter\')trackOrder()"></div>'+
      '<button class="btn-big" onclick="trackOrder()">TRACK MY ORDER</button>'+
      '<p class="help-text">Don\'t have your ID? <a href="mailto:planning@pmoffsetprinters.com">Email us</a> and we\'ll find your job.</p>'+
    '</div></section>';
}

/* TRACKING */
async function trackOrder(){
  var id=$('trk-in').value.trim();
  if(!id){$('trk-msg').innerHTML='<div class="msg-err">Please enter an Order ID.</div>';return}
  $('trk-msg').innerHTML='<div class="spin-w"><div class="spin"></div></div>';
  try{var d=await api('/api/orders/track/'+encodeURIComponent(id));renderTracking(d)}
  catch(e){$('trk-msg').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}
}

function renderTracking(data){
  var o=data.order,stgs=data.stages,notes=data.notes,done=o.current_stage===6;
  var procs=o.process?o.process.split(', ').filter(Boolean):[];

  var pillHtml=o.is_delayed?'<span class="pill pill-delayed"><span class="pill-dot"></span>Delayed</span>'
    :done?'<span class="pill pill-done"><span class="pill-dot"></span>Complete</span>'
    :o.current_stage===1?'<span class="pill pill-pending"><span class="pill-dot"></span>Pending</span>'
    :'<span class="pill pill-active"><span class="pill-dot"></span>In Progress</span>';

  var pipeHtml=stgs.map(function(s){
    var cls=s.completed?'done':s.number===o.current_stage?(o.is_delayed?'held':'now'):'wait';
    return '<div class="ps '+cls+'"><div class="ps-n">'+(s.completed?'✓':s.number)+'</div>'+
      '<div class="ps-l">'+s.name.replace(' / ','<br>')+'</div>'+
      (s.completed?'<div class="ps-tag">Done</div>':s.number===o.current_stage?(o.is_delayed?'<div class="ps-tag">Delayed</div>':'<div class="ps-tag">Active</div>'):'')+
      (s.completed_at?'<div class="ps-time">'+fmtDT(s.completed_at)+'</div>':'')+
    '</div>';
  }).join('');

  var pct=o.current_stage<=1?0:((o.current_stage-1)/(STAGES.length-1))*100;

  var notesHtml=notes.length?notes.map(function(n){
    return '<div class="log-row"><div class="log-ts">'+esc(n.author)+'<br>'+fmtDT(n.created_at)+'</div><div class="log-txt">'+esc(n.note)+'</div></div>';
  }).join(''):'<p style="color:var(--tl);font-size:12px;">No updates yet.</p>';

  $('app').innerHTML=
    '<div class="result"><button class="back-btn" onclick="render()">← Back</button><div class="sec-lbl">Order Status</div>'+
      '<div class="ob"><div><div class="ob-lbl">Order Number</div><div class="ob-id">'+esc(o.order_id)+'</div></div>'+
        '<div class="ob-meta"><div class="ob-chip"><label>Client</label><span>'+esc(o.customer_name)+'</span></div>'+
        '<div class="ob-chip"><label>Est. Delivery</label><span>'+fmtD(o.estimated_delivery)+'</span></div>'+
        '<div class="ob-chip"><label>Status</label><span>'+pillHtml+'</span></div></div></div>'+
      (done?'<div class="done-bar">✅ Order completed! Estimated delivery: '+fmtD(o.estimated_delivery)+'</div>':'')+
      (o.is_delayed?'<div class="delay-bar">⚠️ Delayed — '+(o.delay_reason?esc(o.delay_reason):'No details')+'</div>':'')+
      '<div class="pipe-block"><div class="pipe-hdr">Production Pipeline</div><div class="pipe-track"><div class="pipe-fill" id="pipe-fill"></div>'+pipeHtml+'</div></div>'+
      '<div class="lo-grid">'+
        '<div class="lo-panel"><div class="lo-title">Order Details</div>'+
          '<div class="sp"><span class="sp-k">Customer</span><span class="sp-v">'+esc(o.customer_name)+'</span></div>'+
          '<div class="sp"><span class="sp-k">Job Type</span><span class="sp-v">'+esc(o.job_type)+'</span></div>'+
          '<div class="sp"><span class="sp-k">Quantity</span><span class="sp-v">'+esc(o.quantity_specs||'—')+'</span></div>'+
          '<div class="sp"><span class="sp-k">Order Date</span><span class="sp-v">'+fmtD(o.date_of_order)+'</span></div>'+
          '<div class="sp"><span class="sp-k">Est. Delivery</span><span class="sp-v">'+fmtD(o.estimated_delivery)+'</span></div>'+
          '<div class="sp"><span class="sp-k">Finish</span><span class="sp-v">'+esc(o.finish_type||'—')+'</span></div>'+
        '</div>'+
        '<div class="lo-panel"><div class="lo-title">Specifications</div>'+
          '<div class="sp"><span class="sp-k">GSM</span><span class="sp-v">'+esc(o.gsm||'—')+'</span></div>'+
          '<div class="sp"><span class="sp-k">Process</span><span class="sp-v">'+esc(procs.length?procs.join(', '):'—')+'</span></div>'+
          '<div class="sp"><span class="sp-k">Embellishments</span><span class="sp-v">'+(o.embellishments?'Yes':'No')+'</span></div>'+
          '<div class="sp"><span class="sp-k">Cast & Cure</span><span class="sp-v">'+(o.cast_and_cure?'Yes':'No')+'</span></div>'+
          (o.other_specifications?'<div class="sp"><span class="sp-k">Other</span><span class="sp-v">'+esc(o.other_specifications)+'</span></div>':'')+
        '</div>'+
      '</div>'+
      '<div class="log-panel"><div class="lo-title">Activity Log</div>'+notesHtml+'</div>'+
    '</div>';
  setTimeout(function(){var f=$('pipe-fill');if(f)f.style.width=pct+'%'},80);
}

/* DASHBOARD */
function renderDashboard(){
  var isH=currentUser.role==='head_admin';
  var tabs='<button class="dtab'+(currentTab==='orders'?' on':'')+'" onclick="switchTab(\'orders\')">Orders</button>';
  if(isH){tabs+='<button class="dtab'+(currentTab==='team'?' on':'')+'" onclick="switchTab(\'team\')">Manage Team</button>';
    tabs+='<button class="dtab'+(currentTab==='audit'?' on':'')+'" onclick="switchTab(\'audit\')">Audit Log</button>'}
  $('app').innerHTML='<div class="dash"><div class="dash-hdr"><div class="dash-title">Dashboard</div><button class="btn-p" onclick="showCreateOrder()">+ New Order</button></div><div class="dash-tabs">'+tabs+'</div><div id="tab-c"></div></div>';
  switchTab(currentTab);
}
async function switchTab(t){
  currentTab=t;document.querySelectorAll('.dtab').forEach(function(b){b.classList.toggle('on',b.textContent.toLowerCase().indexOf(t)!==-1)});
  if(t==='orders')await loadOrders();else if(t==='team')await loadTeam();else if(t==='audit')await loadAudit();
}

/* ORDERS TAB */
async function loadOrders(){
  $('tab-c').innerHTML='<div class="spin-w"><div class="spin"></div></div>';
  try{var d=await api('/api/orders');allOrders=d.orders;renderOrders()}catch(e){$('tab-c').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}
}
function renderOrders(){
  var so=STAGES.map(function(s){return'<option value="'+s.n+'">'+s.name+'</option>'}).join('');
  $('tab-c').innerHTML='<div class="filters"><input type="text" id="f-search" placeholder="Search Order ID or Customer" oninput="filterO()" style="flex:1;min-width:200px;">'+
    '<select id="f-stage" onchange="filterO()"><option value="">All Stages</option>'+so+'<option value="d">Delayed</option></select>'+
    '<input type="date" id="f-from" onchange="filterO()"><input type="date" id="f-to" onchange="filterO()">'+
    '<select id="f-sort" onchange="filterO()"><option value="new">Newest</option><option value="old">Oldest</option><option value="dl">Deadline</option><option value="sa">Stage ↑</option><option value="sd">Stage ↓</option></select></div><div id="o-list"></div>';
  filterO();
}
function filterO(){
  var q=($('f-search')?$('f-search').value:'').toLowerCase(),st=$('f-stage')?$('f-stage').value:'',fr=$('f-from')?$('f-from').value:'',to=$('f-to')?$('f-to').value:'',so=$('f-sort')?$('f-sort').value:'new';
  var f=allOrders.slice();
  if(q)f=f.filter(function(o){return o.order_id.toLowerCase().indexOf(q)!==-1||o.customer_name.toLowerCase().indexOf(q)!==-1});
  if(st==='d')f=f.filter(function(o){return o.is_delayed});else if(st)f=f.filter(function(o){return o.current_stage===parseInt(st)});
  if(fr)f=f.filter(function(o){return o.date_of_order>=fr});if(to)f=f.filter(function(o){return o.date_of_order<=to});
  switch(so){case'old':f.sort(function(a,b){return new Date(a.created_at)-new Date(b.created_at)});break;case'dl':f.sort(function(a,b){if(!a.estimated_delivery)return 1;if(!b.estimated_delivery)return-1;return new Date(a.estimated_delivery)-new Date(b.estimated_delivery)});break;case'sa':f.sort(function(a,b){return a.current_stage-b.current_stage});break;case'sd':f.sort(function(a,b){return b.current_stage-a.current_stage});break;default:f.sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at)})}

  var el=$('o-list');
  if(!f.length){el.innerHTML='<div class="empty"><div class="ei">📭</div><h3>No orders found</h3></div>';return}
  el.innerHTML=f.map(function(o){
    var s=STAGES.find(function(x){return x.n===o.current_stage}),sn=s?s.name:'';
    var cc=o.is_delayed?' delayed':o.current_stage===6?' completed':'';
    var pc=o.is_delayed?'sd':'s'+o.current_stage;
    return '<div class="oc'+cc+'" ondblclick="showDetail(\''+esc(o.order_id)+'\')"><div class="oc-id">'+esc(o.order_id)+'</div><div><div class="oc-name">'+esc(o.customer_name)+'</div><div class="oc-meta">'+esc(o.job_type)+' · Due: '+fmtD(o.estimated_delivery)+'</div></div><div class="oc-right"><span class="spill '+pc+'">'+(o.is_delayed?'⚠ Delayed':sn)+'</span><button class="ib" onclick="event.stopPropagation();showDetail(\''+esc(o.order_id)+'\')" title="View">📝</button><button class="ib" onclick="event.stopPropagation();confirmDel(\''+esc(o.order_id)+'\',\''+esc(o.customer_name).replace(/'/g,"\\'")+'\')" title="Delete">🗑️</button></div></div>';
  }).join('');
}
