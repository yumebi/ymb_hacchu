let senders = [];
let clients = [];
let orders = [];
let lastNo = 1;
let items = [];
let currentOrderId = crypto.randomUUID();

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function nl2br(s){ return escapeHtml(s||'').replace(/\n/g,'<br>'); }
function yen(n){
  n = Math.round(n||0);
  return n.toLocaleString('ja-JP');
}

// ---- 和暦変換(令和のみ対応) ----
function toWareki(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr+'T00:00:00');
  const reiwaStart = new Date('2019-05-01T00:00:00');
  if(d < reiwaStart) return d.getFullYear()+'年 '+(d.getMonth()+1)+'月 '+d.getDate()+'日';
  let year = d.getFullYear() - 2018;
  const yearLabel = year===1 ? '元' : year;
  return '令和 '+yearLabel+' 年 '+(d.getMonth()+1)+' 月 '+d.getDate()+' 日';
}

// ---- DOM参照 ----
const senderSelect = document.getElementById('senderSelect');
const senderZip = document.getElementById('senderZip');
const senderAddr = document.getElementById('senderAddr');
const senderName = document.getElementById('senderName');

const clientSelect = document.getElementById('clientSelect');
const clientZip = document.getElementById('clientZip');
const clientAddr = document.getElementById('clientAddr');
const clientName = document.getElementById('clientName');
const clientSuffix = document.getElementById('clientSuffix');

const docNo = document.getElementById('docNo');
const docDate = document.getElementById('docDate');
const remarksInput = document.getElementById('remarksInput');

// ---- セレクトボックス再描画 ----
function refreshSenderSelect(selectedIdx){
  senderSelect.innerHTML = '<option value="">-- 選択 --</option>' +
    senders.map((s,i)=>`<option value="${i}">${escapeHtml(s.name)}</option>`).join('');
  if(selectedIdx!==undefined) senderSelect.value = selectedIdx;
}
function refreshClientSelect(selectedIdx){
  clientSelect.innerHTML = '<option value="">-- 選択 --</option>' +
    clients.map((c,i)=>`<option value="${i}">${escapeHtml(c.name)}</option>`).join('');
  if(selectedIdx!==undefined) clientSelect.value = selectedIdx;
}

// ---- 発注元フォーム ----
senderSelect.addEventListener('change', e=>{
  const i = e.target.value;
  if(i===''){ senderZip.value=''; senderAddr.value=''; senderName.value=''; }
  else{
    const s = senders[i];
    senderZip.value=s.zip; senderAddr.value=s.addr; senderName.value=s.name;
  }
  updateSheet();
});
document.getElementById('senderNewBtn').addEventListener('click', async ()=>{
  if(!senderName.value.trim()){ alert('会社名を入力してください'); return; }
  senders.push({zip:senderZip.value, addr:senderAddr.value, name:senderName.value});
  senders = await window.api.setSenders(senders);
  refreshSenderSelect(senders.length-1);
  updateSheet();
});
document.getElementById('senderEditBtn').addEventListener('click', async ()=>{
  const i = senderSelect.value;
  if(i===''){ alert('編集する登録先を選択してください'); return; }
  senders[i] = {zip:senderZip.value, addr:senderAddr.value, name:senderName.value};
  senders = await window.api.setSenders(senders);
  refreshSenderSelect(i);
  updateSheet();
});
document.getElementById('senderDelBtn').addEventListener('click', async ()=>{
  const i = senderSelect.value;
  if(i===''){ return; }
  senders.splice(i,1);
  senders = await window.api.setSenders(senders);
  refreshSenderSelect();
  senderZip.value=''; senderAddr.value=''; senderName.value='';
  updateSheet();
});
[senderZip, senderAddr, senderName].forEach(el=> el.addEventListener('input', updateSheet));

// ---- 宛先フォーム ----
clientSelect.addEventListener('change', e=>{
  const i = e.target.value;
  if(i===''){ clientZip.value=''; clientAddr.value=''; clientName.value=''; clientSuffix.value='御中'; }
  else{
    const c = clients[i];
    clientZip.value=c.zip; clientAddr.value=c.addr; clientName.value=c.name; clientSuffix.value=c.suffix||'御中';
  }
  updateSheet();
});
document.getElementById('clientNewBtn').addEventListener('click', async ()=>{
  if(!clientName.value.trim()){ alert('宛名を入力してください'); return; }
  clients.push({zip:clientZip.value, addr:clientAddr.value, name:clientName.value, suffix:clientSuffix.value});
  clients = await window.api.setClients(clients);
  refreshClientSelect(clients.length-1);
  updateSheet();
});
document.getElementById('clientEditBtn').addEventListener('click', async ()=>{
  const i = clientSelect.value;
  if(i===''){ alert('編集する登録先を選択してください'); return; }
  clients[i] = {zip:clientZip.value, addr:clientAddr.value, name:clientName.value, suffix:clientSuffix.value};
  clients = await window.api.setClients(clients);
  refreshClientSelect(i);
  updateSheet();
});
document.getElementById('clientDelBtn').addEventListener('click', async ()=>{
  const i = clientSelect.value;
  if(i===''){ return; }
  clients.splice(i,1);
  clients = await window.api.setClients(clients);
  refreshClientSelect();
  clientZip.value=''; clientAddr.value=''; clientName.value='';
  updateSheet();
});
[clientZip, clientAddr, clientName].forEach(el=> el.addEventListener('input', updateSheet));
clientSuffix.addEventListener('change', updateSheet);

// ---- 明細行 ----
function addItem(data){
  items.push(Object.assign({name:'',qty:'',unit:'',price:'',amount:''}, data||{}));
  renderItems();
}
function renderItems(){
  const body = document.getElementById('itemsBody');
  body.innerHTML = '';
  items.forEach((it,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center;" class="no-print"><button type="button" class="row-del" data-i="${i}">✕</button></td>
      <td class="name"><textarea rows="1" data-field="name" data-i="${i}">${escapeHtml(it.name)}</textarea></td>
      <td class="num"><input type="number" data-field="qty" data-i="${i}" value="${it.qty}"></td>
      <td class="num"><input type="text" data-field="unit" data-i="${i}" value="${escapeHtml(it.unit)}" style="text-align:center;"></td>
      <td class="num"><input type="number" data-field="price" data-i="${i}" value="${it.price}"></td>
      <td class="num"><input type="number" data-field="amount" data-i="${i}" value="${it.amount}"></td>
    `;
    body.appendChild(tr);
  });
  body.querySelectorAll('[data-field]').forEach(el=>{
    el.addEventListener('input', onItemInput);
  });
  body.querySelectorAll('.row-del').forEach(btn=>{
    btn.addEventListener('click', e=>{
      items.splice(+e.target.dataset.i, 1);
      renderItems();
      updateSheet();
    });
  });
}
function onItemInput(e){
  const i = +e.target.dataset.i;
  const field = e.target.dataset.field;
  const it = items[i];
  it[field] = e.target.value;
  if(field==='qty' || field==='price'){
    const q = parseFloat(it.qty), p = parseFloat(it.price);
    if(!isNaN(q) && !isNaN(p)){
      it.amount = String(q*p);
      const amountInput = document.querySelector(`input[data-field="amount"][data-i="${i}"]`);
      if(amountInput) amountInput.value = it.amount;
    }
  }
  updateSheet();
}
document.getElementById('addRowBtn').addEventListener('click', ()=>{ addItem(); renderItems(); });

// ---- シート表示更新 ----
function updateSheet(){
  document.getElementById('viewClientZip').textContent = clientZip.value ? '〒'+clientZip.value : '';
  document.getElementById('viewClientAddr').innerHTML = nl2br(clientAddr.value) || '&nbsp;';
  document.getElementById('viewClientName').textContent = clientName.value || '';
  document.getElementById('viewClientSuffix').textContent = clientSuffix.value || '';

  document.getElementById('viewSenderZip').textContent = senderZip.value ? '〒'+senderZip.value : '';
  document.getElementById('viewSenderAddr').innerHTML = nl2br(senderAddr.value) || '&nbsp;';
  document.getElementById('viewSenderName').textContent = senderName.value || '';

  document.getElementById('wareki').textContent = toWareki(docDate.value);

  let subtotal = 0;
  items.forEach(it=>{ subtotal += parseFloat(it.amount)||0; });
  const tax = Math.floor(subtotal*0.10);
  const total = subtotal+tax;

  document.getElementById('viewSubtotal').textContent = '¥'+yen(subtotal)+'-';
  document.getElementById('viewSub2').textContent = yen(subtotal);
  document.getElementById('viewTax').textContent = yen(tax);
  document.getElementById('viewTotal').textContent = yen(total);

  document.getElementById('remarksView').innerHTML = nl2br(remarksInput.value);

  return { subtotal, tax, total };
}
docDate.addEventListener('input', updateSheet);
docNo.addEventListener('input', updateSheet);
remarksInput.addEventListener('input', updateSheet);

// ---- 履歴一覧 ----
function renderHistoryList(){
  const box = document.getElementById('historyList');
  if(orders.length===0){
    box.innerHTML = '<div class="hist-empty">履歴はありません</div>';
    return;
  }
  const sorted = [...orders].sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
  box.innerHTML = '';
  sorted.forEach(o=>{
    const div = document.createElement('div');
    div.className = 'hist-item';
    div.innerHTML = `
      <div class="info">
        <div class="l1">No.${escapeHtml(o.no)} ${escapeHtml(o.date||'')}</div>
        <div class="l2">${escapeHtml(o.clientName||'(宛先未設定)')}</div>
      </div>
      <div class="amount">¥${yen(o.total)}</div>
      <div class="btn-row">
        <button type="button" class="small secondary" data-act="open" data-id="${o.id}">開く</button>
        <button type="button" class="small danger" data-act="del" data-id="${o.id}">削除</button>
      </div>
    `;
    box.appendChild(div);
  });
  box.querySelectorAll('[data-act="open"]').forEach(btn=>{
    btn.addEventListener('click', ()=> loadOrder(btn.dataset.id));
  });
  box.querySelectorAll('[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm('この履歴を削除しますか?')) return;
      orders = await window.api.deleteOrder(btn.dataset.id);
      renderHistoryList();
    });
  });
}

function loadOrder(id){
  const o = orders.find(x=>x.id===id);
  if(!o) return;
  currentOrderId = o.id;
  docNo.value = o.no;
  docDate.value = o.date;
  senderSelect.value = '';
  senderZip.value = o.senderZip||'';
  senderAddr.value = o.senderAddr||'';
  senderName.value = o.senderName||'';
  clientSelect.value = '';
  clientZip.value = o.clientZip||'';
  clientAddr.value = o.clientAddr||'';
  clientName.value = o.clientName||'';
  clientSuffix.value = o.clientSuffix||'御中';
  remarksInput.value = o.remarks||'';
  items = (o.items||[]).map(it=>Object.assign({}, it));
  if(items.length===0) items.push({name:'',qty:'',unit:'',price:'',amount:''});
  renderItems();
  updateSheet();
}

function newOrder(){
  currentOrderId = crypto.randomUUID();
  docNo.value = lastNo;
  docDate.value = new Date().toISOString().slice(0,10);
  remarksInput.value = '';
  items = [];
  addItem();
  updateSheet();
}
document.getElementById('newOrderBtn').addEventListener('click', newOrder);

function buildOrderObject(){
  const totals = updateSheet();
  return {
    id: currentOrderId,
    no: docNo.value,
    date: docDate.value,
    senderName: senderName.value,
    senderZip: senderZip.value,
    senderAddr: senderAddr.value,
    clientName: clientName.value,
    clientZip: clientZip.value,
    clientAddr: clientAddr.value,
    clientSuffix: clientSuffix.value,
    items: items.map(it=>Object.assign({}, it)),
    remarks: remarksInput.value,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total
  };
}

async function saveCurrentOrder(){
  if(!docNo.value.trim()){ alert('発注書No.を入力してください'); return null; }
  if(!clientName.value.trim()){ alert('宛先を入力してください'); return null; }
  const order = buildOrderObject();
  const res = await window.api.saveOrder(order);
  orders = res.orders;
  lastNo = res.lastNo;
  renderHistoryList();
  return order;
}

document.getElementById('saveOrderBtn').addEventListener('click', async ()=>{
  const o = await saveCurrentOrder();
  if(o) alert('履歴に保存しました');
});

document.getElementById('printBtn').addEventListener('click', async ()=>{
  const o = await saveCurrentOrder();
  if(!o) return;
  const result = await window.api.exportPdf(`発注書_No${o.no}.pdf`);
  if(result.ok){
    alert('PDFを保存しました:\n'+result.path);
  }
});

// ---- 初期化 ----
(async function init(){
  const data = await window.api.getData();
  senders = data.senders;
  clients = data.clients;
  orders = data.orders;
  lastNo = data.lastNo;

  refreshSenderSelect();
  if(senders.length>0){
    senderZip.value = senders[0].zip; senderAddr.value = senders[0].addr; senderName.value = senders[0].name;
    senderSelect.value = 0;
  }

  refreshClientSelect();

  docDate.value = new Date().toISOString().slice(0,10);
  docNo.value = lastNo;

  addItem();
  renderHistoryList();
  updateSheet();

  const version = await window.api.getVersion();
  document.getElementById('appVersion').textContent = 'v' + version;

  window.api.checkUpdate().then(result => {
    if (result && result.hasUpdate) {
      const banner = document.getElementById('updateBanner');
      document.getElementById('updateBannerText').textContent =
        `新しいバージョン v${result.latest} が公開されています(現在: v${version})`;
      banner.style.display = 'flex';
      document.getElementById('updateBannerBtn').addEventListener('click', () => {
        window.api.openUrl(result.url);
      });
    }
  });
})();
