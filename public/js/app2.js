/* P.M. OFFSET PRINTERS — Frontend Part 2 */

/* CREATE/EDIT ORDER */
function showCreateOrder(ex){
  var e=!!ex,o=ex||{};
  var ep=o.process?o.process.split(', ').filter(Boolean):[];
  var ef=o.finish_type?o.finish_type.split(', ').filter(Boolean):[];
  var known=['Matte','Glossy','Satin','Uncoated','Laminated','Varnished'];
  var cf='';var sf=[];
  ef.forEach(function(f){if(known.indexOf(f)!==-1)sf.push(f);else cf=f});

  var fHtml=known.map(function(f){var c=sf.indexOf(f)!==-1;return '<label class="'+(c?'ck':'')+'"><input type="checkbox" value="'+f+'"'+(c?' checked':'')+' onchange="this.parentElement.classList.toggle(\'ck\',this.checked)">'+f+'</label>'}).join('')+
    '<label class="'+(cf?'ck':'')+'"><input type="checkbox" value="__other__"'+(cf?' checked':'')+' onchange="togFinOth(this)">Other</label>';

  var gv=o.gsm||'',cg=gv&&GSM_OPTIONS.indexOf(gv)===-1&&gv!=='Other',gsv=cg?'Other':gv;
  var gOpts=GSM_OPTIONS.map(function(g){return '<option value="'+g+'"'+(gsv===g?' selected':'')+'>'+g+'</option>'}).join('');
  var pHtml=PROCESS_OPTIONS.map(function(p){var c=ep.indexOf(p)!==-1;return '<label class="'+(c?'ck':'')+'"><input type="checkbox" value="'+p+'"'+(c?' checked':'')+' onchange="this.parentElement.classList.toggle(\'ck\',this.checked)">'+p+'</label>'}).join('');

  openModal(
    '<div class="gm-hdr"><h3>'+(e?'Edit Order':'New Order')+'</h3><button class="gm-x" onclick="closeModal()">×</button></div>'+
    '<div class="gm-body"><div id="of-msg"></div>'+
    '<div class="form-sec">Order Information</div>'+
    '<div class="form-row"><div class="fw"><label>Order ID *</label><input type="text" id="f-oid" value="'+esc(o.order_id||'')+'"'+(e?' disabled style="background:var(--sf);color:var(--tl);"':'')+'></div>'+
    '<div class="fw"><label>Customer Name *</label><input type="text" id="f-cust" value="'+esc(o.customer_name||'')+'"></div></div>'+
    '<div class="form-row"><div class="fw"><label>Job Type *</label><input type="text" id="f-job" value="'+esc(o.job_type||'')+'"></div>'+
    '<div class="fw"><label>Quantity & Specs</label><input type="text" id="f-qty" value="'+esc(o.quantity_specs||'')+'"></div></div>'+
    '<div class="form-row"><div class="fw"><label>Date of Order *</label><input type="date" id="f-doo" value="'+(o.date_of_order||new Date().toISOString().split('T')[0])+'"></div>'+
    '<div class="fw"><label>Est. Delivery</label><input type="date" id="f-del" value="'+(o.estimated_delivery||'')+'"></div></div>'+
    '<div class="fw"><label>Finish Type (select multiple)</label><div class="cbg" id="f-fin">'+fHtml+'</div>'+
      '<div class="other-in'+(cf?' vis':'')+'" id="fin-oth-w"><input type="text" id="f-fin-oth" placeholder="Type custom finish..." value="'+esc(cf)+'"></div></div>'+
    '<div class="form-sec">Specifications</div>'+
    '<div class="form-row"><div class="fw"><label>GSM</label><select id="f-gsm" onchange="togGsmOth()"><option value="">Select...</option>'+gOpts+'</select>'+
      '<div class="other-in'+((cg||gsv==='Other')?' vis':'')+'" id="gsm-oth-w"><input type="text" id="f-gsm-oth" placeholder="Type custom GSM..." value="'+(cg?esc(gv):'')+'"></div></div>'+
    '<div class="fw"><label>&nbsp;</label></div></div>'+
    '<div class="fw"><label>Process</label><div class="cbg" id="f-proc">'+pHtml+'</div></div>'+
    '<div class="fchk"><input type="checkbox" id="f-emb"'+(o.embellishments?' checked':'')+'><label for="f-emb">Embellishments</label></div>'+
    '<div class="fchk"><input type="checkbox" id="f-cc"'+(o.cast_and_cure?' checked':'')+'><label for="f-cc">Cast and Cure</label></div>'+
    '<div class="fw"><label>Other Specifications</label><textarea id="f-ospec">'+esc(o.other_specifications||'')+'</textarea></div>'+
    '<div class="form-acts"><button class="btn-s" onclick="closeModal()">Cancel</button>'+
      '<button class="btn-p" onclick="'+(e?"submitEdit('"+esc(o.order_id)+"')":"confirmCreate()")+'">'+
      (e?'Save Changes':'Review Order')+'</button></div></div>'
  );
}

function togFinOth(cb){cb.parentElement.classList.toggle('ck',cb.checked);var w=$('fin-oth-w');if(cb.checked)w.classList.add('vis');else{w.classList.remove('vis');$('f-fin-oth').value=''}}
function togGsmOth(){var v=$('f-gsm').value,w=$('gsm-oth-w');if(v==='Other')w.classList.add('vis');else{w.classList.remove('vis');$('f-gsm-oth').value=''}}

function getFormData(){
  var pr=[];document.querySelectorAll('#f-proc input:checked').forEach(function(c){pr.push(c.value)});
  var fin=[];document.querySelectorAll('#f-fin input:checked').forEach(function(c){if(c.value==='__other__'){var v=$('f-fin-oth').value.trim();if(v)fin.push(v)}else fin.push(c.value)});
  var gsm=$('f-gsm').value;if(gsm==='Other'){var v=$('f-gsm-oth').value.trim();gsm=v||'Other'}
  return{order_id:$('f-oid').value.trim(),customer_name:$('f-cust').value.trim(),job_type:$('f-job').value.trim(),quantity_specs:$('f-qty').value.trim(),date_of_order:$('f-doo').value,estimated_delivery:$('f-del').value,finish_type:fin.join(', '),gsm:gsm,process:pr,embellishments:$('f-emb').checked,cast_and_cure:$('f-cc').checked,other_specifications:$('f-ospec').value.trim()};
}

function confirmCreate(){
  var d=getFormData();if(!d.order_id||!d.customer_name||!d.job_type||!d.date_of_order){$('of-msg').innerHTML='<div class="msg-err">Fill in required fields (*).</div>';return}
  window._po=d;
  openModal('<div class="gm-hdr"><h3>Confirm Order</h3><button class="gm-x" onclick="closeModal()">×</button></div><div class="gm-body">'+
    '<p style="margin-bottom:20px;color:var(--tl);font-size:12px;">Review before saving:</p>'+
    '<div class="lo-panel" style="border:1px solid var(--bd);padding:20px;">'+
      '<div class="sp"><span class="sp-k">Order ID</span><span class="sp-v">'+esc(d.order_id)+'</span></div>'+
      '<div class="sp"><span class="sp-k">Customer</span><span class="sp-v">'+esc(d.customer_name)+'</span></div>'+
      '<div class="sp"><span class="sp-k">Job Type</span><span class="sp-v">'+esc(d.job_type)+'</span></div>'+
      '<div class="sp"><span class="sp-k">Quantity</span><span class="sp-v">'+esc(d.quantity_specs||'—')+'</span></div>'+
      '<div class="sp"><span class="sp-k">Order Date</span><span class="sp-v">'+fmtD(d.date_of_order)+'</span></div>'+
      '<div class="sp"><span class="sp-k">Est. Delivery</span><span class="sp-v">'+fmtD(d.estimated_delivery)+'</span></div>'+
      '<div class="sp"><span class="sp-k">Finish</span><span class="sp-v">'+esc(d.finish_type||'—')+'</span></div>'+
      '<div class="sp"><span class="sp-k">GSM</span><span class="sp-v">'+esc(d.gsm||'—')+'</span></div>'+
      '<div class="sp"><span class="sp-k">Process</span><span class="sp-v">'+esc(d.process.length?d.process.join(', '):'—')+'</span></div>'+
      '<div class="sp"><span class="sp-k">Embellishments</span><span class="sp-v">'+(d.embellishments?'Yes':'No')+'</span></div>'+
      '<div class="sp"><span class="sp-k">Cast & Cure</span><span class="sp-v">'+(d.cast_and_cure?'Yes':'No')+'</span></div>'+
      (d.other_specifications?'<div class="sp"><span class="sp-k">Other</span><span class="sp-v">'+esc(d.other_specifications)+'</span></div>':'')+
    '</div><div class="form-acts" style="margin-top:24px;"><button class="btn-s" onclick="showCreateOrder()">← Edit</button><button class="btn-g" onclick="submitCreate()">✓ Confirm</button></div></div>');
}
async function submitCreate(){try{await api('/api/orders',{method:'POST',body:window._po});closeModal();toast('Order created!');await loadOrders()}catch(e){toast(e.message,'err')}}
async function submitEdit(id){var d=getFormData();try{await api('/api/orders/'+encodeURIComponent(id),{method:'PUT',body:d});closeModal();toast('Order updated!');await loadOrders()}catch(e){if($('of-msg'))$('of-msg').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}}

/* ORDER DETAIL */
async function showDetail(id){
  try{
    var data=await api('/api/orders/track/'+encodeURIComponent(id)),o=data.order,notes=data.notes,isH=currentUser.role==='head_admin';
    window._detO=o;
    var sb=STAGES.map(function(s){return '<button class="stg-btn'+(o.current_stage===s.n?' on':'')+'" onclick="updStage(\''+esc(o.order_id)+'\','+s.n+')">'+s.n+'. '+s.name+'</button>'}).join('');
    var dh=o.is_delayed?
      '<div class="delay-bar" style="border:1px solid #e8d590;margin-bottom:12px;">⚠️ Delayed: '+esc(o.delay_reason||'No reason')+'</div><button class="btn-g btn-sm" onclick="rmDelay(\''+esc(o.order_id)+'\')">Remove Delay</button>'
      :'<div style="display:flex;gap:8px;align-items:end"><div class="fw" style="flex:1;margin-bottom:0"><label>Delay Reason</label><input type="text" id="del-reas" placeholder="e.g. Waiting for materials"></div><button class="btn-p btn-sm" style="background:var(--am)" onclick="setDelay(\''+esc(o.order_id)+'\')">Mark Delayed</button></div>';
    var nh=notes.length?notes.map(function(n){
      var db=isH?'<button class="ib" style="width:24px;height:24px;font-size:11px;" onclick="delNote('+n.id+',\''+esc(o.order_id)+'\')">🗑️</button>':'';
      return '<div class="log-row"><div class="log-ts">'+esc(n.author)+'<br>'+fmtDT(n.created_at)+'</div><div class="log-txt" style="display:flex;justify-content:space-between;align-items:start">'+esc(n.note)+db+'</div></div>';
    }).join(''):'<p style="color:var(--tl);font-size:12px;">No notes yet.</p>';

    openModal('<div class="gm-hdr"><h3>Order: '+esc(o.order_id)+'</h3><button class="gm-x" onclick="closeModal()">×</button></div><div class="gm-body">'+
      '<div class="form-sec">Update Stage</div><div class="stg-btns">'+sb+'</div>'+
      '<div class="form-sec">Delay Status</div><div style="margin-bottom:16px;">'+dh+'</div>'+
      '<div class="form-sec">Order Details</div>'+
      '<div class="lo-panel" style="border:1px solid var(--bd);padding:16px;margin-bottom:12px;">'+
        '<div class="sp"><span class="sp-k">Customer</span><span class="sp-v">'+esc(o.customer_name)+'</span></div>'+
        '<div class="sp"><span class="sp-k">Job</span><span class="sp-v">'+esc(o.job_type)+'</span></div>'+
        '<div class="sp"><span class="sp-k">Quantity</span><span class="sp-v">'+esc(o.quantity_specs||'—')+'</span></div>'+
        '<div class="sp"><span class="sp-k">Delivery</span><span class="sp-v">'+fmtD(o.estimated_delivery)+'</span></div>'+
        '<div class="sp"><span class="sp-k">Finish</span><span class="sp-v">'+esc(o.finish_type||'—')+'</span></div>'+
        '<div class="sp"><span class="sp-k">GSM</span><span class="sp-v">'+esc(o.gsm||'—')+'</span></div>'+
        '<div class="sp"><span class="sp-k">Process</span><span class="sp-v">'+esc(o.process||'—')+'</span></div>'+
      '</div><button class="btn-s btn-sm" onclick="closeModal();showCreateOrder(window._detO)">Edit Details</button>'+
      '<div class="form-sec">Notes</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:16px;"><input type="text" id="note-in" placeholder="Add a note..." style="flex:1;background:#fff;border:1px solid var(--bd);padding:10px 14px;font-family:DM Mono,monospace;font-size:12px;outline:0;" onkeydown="if(event.key===\'Enter\')addNote(\''+esc(o.order_id)+'\')"><button class="btn-p btn-sm" onclick="addNote(\''+esc(o.order_id)+'\')">Add</button></div>'+nh+
    '</div>');
  }catch(e){toast(e.message,'err')}
}
async function updStage(id,s){try{await api('/api/orders/'+encodeURIComponent(id)+'/stage',{method:'POST',body:{stage:s}});toast('Stage updated!');showDetail(id);loadOrders()}catch(e){toast(e.message,'err')}}
async function setDelay(id){var r=$('del-reas')?$('del-reas').value:'';try{await api('/api/orders/'+encodeURIComponent(id)+'/delay',{method:'POST',body:{is_delayed:true,delay_reason:r}});toast('Delayed.');showDetail(id);loadOrders()}catch(e){toast(e.message,'err')}}
async function rmDelay(id){try{await api('/api/orders/'+encodeURIComponent(id)+'/delay',{method:'POST',body:{is_delayed:false,delay_reason:''}});toast('Delay removed.');showDetail(id);loadOrders()}catch(e){toast(e.message,'err')}}
async function addNote(id){var n=$('note-in')?$('note-in').value.trim():'';if(!n)return;try{await api('/api/orders/'+encodeURIComponent(id)+'/notes',{method:'POST',body:{note:n}});toast('Note added.');showDetail(id)}catch(e){toast(e.message,'err')}}
async function delNote(nid,oid){try{await api('/api/orders/notes/'+nid,{method:'DELETE'});toast('Deleted.');showDetail(oid)}catch(e){toast(e.message,'err')}}

/* DELETE ORDER */
function confirmDel(id,name){
  openModal('<div class="gm-body" style="text-align:center;padding:48px;"><div style="font-size:3rem;margin-bottom:16px;">⚠️</div>'+
    '<h3 style="font-family:Rajdhani,sans-serif;font-size:20px;margin-bottom:8px;">Delete Order?</h3>'+
    '<p style="color:var(--tm);margin-bottom:24px;">Delete <strong>'+esc(id)+'</strong> for <strong>'+esc(name)+'</strong>? This cannot be undone.</p>'+
    '<div style="display:flex;gap:12px;justify-content:center;"><button class="btn-s" onclick="closeModal()">Cancel</button><button class="btn-d" onclick="doDel(\''+esc(id)+'\')">Delete</button></div></div>');
}
async function doDel(id){try{await api('/api/orders/'+encodeURIComponent(id),{method:'DELETE'});closeModal();toast('Deleted.');await loadOrders()}catch(e){toast(e.message,'err')}}

/* TEAM */
async function loadTeam(){
  $('tab-c').innerHTML='<div class="spin-w"><div class="spin"></div></div>';
  try{
    var d=await api('/api/admin/team');
    $('tab-c').innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><div style="font-family:Rajdhani,sans-serif;font-size:20px;font-weight:700;">Team Members</div><button class="btn-p btn-sm" onclick="showAddUser()">+ Add Member</button></div>'+
      d.users.map(function(u){
        var init=u.username.substring(0,2).toUpperCase(),role=u.role==='head_admin'?'👑 Head Admin':'Staff';
        var btns=u.role!=='head_admin'?'<button class="btn-s btn-sm" onclick="showResetPw('+u.id+',\''+esc(u.username)+'\')">Reset PW</button><button class="btn-d btn-sm" onclick="confirmDelUser('+u.id+',\''+esc(u.username)+'\')">Remove</button>':'';
        return '<div class="tc"><div class="tc-info"><div class="tc-av">'+init+'</div><div><div class="tc-name">'+esc(u.username)+'</div><div class="tc-role">'+role+'</div></div></div><div class="tc-acts">'+btns+'</div></div>';
      }).join('');
  }catch(e){$('tab-c').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}
}
function showAddUser(){
  openModal('<div class="gm-hdr"><h3>Add Team Member</h3><button class="gm-x" onclick="closeModal()">×</button></div><div class="gm-body"><div id="au-msg"></div>'+
    '<div class="fw"><label>Username</label><input type="text" id="au-user"></div>'+
    '<div class="fw"><label>Password</label><input type="password" id="au-pass"></div>'+
    '<div class="fw"><label>Security Question</label><input type="text" id="au-q" placeholder="e.g. Favourite colour?"></div>'+
    '<div class="fw"><label>Security Answer</label><input type="text" id="au-a"></div>'+
    '<div class="form-acts"><button class="btn-s" onclick="closeModal()">Cancel</button><button class="btn-p" onclick="doAddUser()">Create</button></div></div>');
}
async function doAddUser(){
  var u=$('au-user').value.trim(),p=$('au-pass').value,q=$('au-q').value.trim(),a=$('au-a').value.trim();
  if(!u||!p){$('au-msg').innerHTML='<div class="msg-err">Username and password required.</div>';return}
  try{await api('/api/admin/team',{method:'POST',body:{username:u,password:p,security_question:q,security_answer:a}});closeModal();toast(u+' added!');await loadTeam()}
  catch(e){$('au-msg').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}
}
function confirmDelUser(id,name){
  openModal('<div class="gm-body" style="text-align:center;padding:48px;"><div style="font-size:3rem;margin-bottom:16px;">⚠️</div><h3 style="font-family:Rajdhani,sans-serif;font-size:20px;margin-bottom:8px;">Remove?</h3><p style="color:var(--tm);margin-bottom:24px;">Remove <strong>'+esc(name)+'</strong>?</p><div style="display:flex;gap:12px;justify-content:center;"><button class="btn-s" onclick="closeModal()">Cancel</button><button class="btn-d" onclick="doDelUser('+id+')">Remove</button></div></div>');
}
async function doDelUser(id){try{await api('/api/admin/team/'+id,{method:'DELETE'});closeModal();toast('Removed.');await loadTeam()}catch(e){toast(e.message,'err')}}
function showResetPw(id,name){
  openModal('<div class="gm-hdr"><h3>Reset Password</h3><button class="gm-x" onclick="closeModal()">×</button></div><div class="gm-body"><div id="rp-msg"></div><p style="margin-bottom:16px;color:var(--tm);">New password for <strong>'+esc(name)+'</strong></p><div class="fw"><label>New Password</label><input type="password" id="rp-pw"></div><div class="form-acts"><button class="btn-s" onclick="closeModal()">Cancel</button><button class="btn-p" onclick="doResetPw('+id+')">Reset</button></div></div>');
}
async function doResetPw(id){var p=$('rp-pw').value;if(!p||p.length<4){$('rp-msg').innerHTML='<div class="msg-err">Min 4 characters.</div>';return}try{await api('/api/admin/team/'+id+'/reset-password',{method:'POST',body:{newPassword:p}});closeModal();toast('Password reset.')}catch(e){$('rp-msg').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}}

/* AUDIT */
async function loadAudit(){
  $('tab-c').innerHTML='<div class="spin-w"><div class="spin"></div></div>';
  try{var d=await api('/api/admin/audit-log');if(!d.logs.length){$('tab-c').innerHTML='<div class="empty"><div class="ei">📋</div><h3>No activity yet</h3></div>';return}
    $('tab-c').innerHTML='<div style="overflow-x:auto;"><table class="at"><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Order</th><th>Details</th></tr></thead><tbody>'+
      d.logs.map(function(l){return '<tr><td>'+fmtDT(l.created_at)+'</td><td><strong>'+esc(l.user)+'</strong></td><td>'+esc(l.action)+'</td><td>'+esc(l.order_id||'—')+'</td><td>'+esc(l.details||'')+'</td></tr>'}).join('')+'</tbody></table></div>';
  }catch(e){$('tab-c').innerHTML='<div class="msg-err">'+esc(e.message)+'</div>'}
}
