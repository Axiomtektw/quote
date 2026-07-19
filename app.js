(function(){
  const STORAGE_KEY = 'catalog:items';
  let taxRate = 0.05; // 稅率，可由使用者調整
  let catalog = []; // {code,name,spec,price,cost}
  let rowSeq = 0;

  const itemsBody = document.getElementById('itemsBody');
  const partnoList = document.getElementById('partnoList');
  const nameList = document.getElementById('nameList');
  const specList = document.getElementById('specList');
  const catalogTableBody = document.getElementById('catalogTableBody');
  const catalogEmpty = document.getElementById('catalogEmpty');
  const catalogCount = document.getElementById('catalogCount');
  const syncBadge = document.getElementById('syncBadge');
  const userChip = document.getElementById('userChip');
  const userEmailLabel = document.getElementById('userEmailLabel');
  const loginModal = document.getElementById('loginModal');

  // ---- Firebase 雲端同步（多裝置共用常用料號清單）----
  const firebaseConfig = {
    apiKey: "AIzaSyDOWpyh1l_28-MJg7539otah0aqpuNLCP0",
    authDomain: "axiomtek-quotation.firebaseapp.com",
    projectId: "axiomtek-quotation",
    storageBucket: "axiomtek-quotation.firebasestorage.app",
    messagingSenderId: "149802750074",
    appId: "1:149802750074:web:07d5070948287e019a2bc3",
    measurementId: "G-VST30YDVW5"
  };

  let cloudReady = false;
  let auth = null;
  let db = null;
  let currentUser = null;
  let cloudUnsub = null;
  let skippedLogin = false;

  try{
    if(typeof firebase !== 'undefined'){
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      cloudReady = true;
    }
  }catch(e){
    console.error('Firebase 初始化失敗，改用本機儲存', e);
    cloudReady = false;
  }

  function setSyncBadge(mode, text){
    syncBadge.className = 'sync-badge sync-' + mode;
    syncBadge.textContent = text;
  }

  function currentCurrency(){
    const el = document.getElementById('currency');
    const c = (el && el.textContent || '').trim();
    return c || 'TWD';
  }

  function fmt(n){
    n = Math.round(n + Number.EPSILON);
    return currentCurrency() + ' ' + n.toLocaleString('en-US');
  }

  function localLoad(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){
      return [];
    }
  }

  function localSave(list){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch(e){ console.error('無法儲存到本機', e); }
  }

  async function loadCatalog(){
    // 尚未登入或雲端不可用時，先用本機資料
    catalog = localLoad();
    renderCatalog();
  }

  async function saveCatalog(){
    if(currentUser && db){
      try{
        setSyncBadge('syncing', '🔄 同步中…');
        await db.collection('users').doc(currentUser.uid).collection('catalog').doc('main')
          .set({ items: catalog, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        // 畫面會由 onSnapshot 監聽自動更新，這裡不需要再 renderCatalog
      }catch(e){
        console.error('雲端儲存失敗，改存本機', e);
        localSave(catalog);
        renderCatalog();
        setSyncBadge('offline', '⚠ 雲端同步失敗，暫存本機');
      }
    }else{
      localSave(catalog);
      renderCatalog();
    }
  }

  function attachCloudSync(user){
    if(cloudUnsub) cloudUnsub();
    setSyncBadge('syncing', '🔄 連線中…');
    const docRef = db.collection('users').doc(user.uid).collection('catalog').doc('main');
    cloudUnsub = docRef.onSnapshot(async (snap) => {
      if(snap.exists && Array.isArray(snap.data().items)){
        catalog = snap.data().items;
        renderCatalog();
        setSyncBadge('online', '☁ 已同步（' + user.email + '）');
      }else{
        // 雲端還沒有資料：如果本機已經有料號，詢問是否要上傳整批過去
        const local = localLoad();
        if(local.length > 0){
          const ok = await confirmDialog(`偵測到這台裝置本機已有 ${local.length} 筆常用料號，要一次上傳到雲端帳號「${user.email}」嗎？\n（上傳後，之後所有裝置登入同一帳號就能看到這些料號）`, { okText: '上傳', cancelText: '先不要' });
          if(ok){
            catalog = local;
            await saveCatalog();
            return;
          }
        }
        catalog = [];
        renderCatalog();
        setSyncBadge('online', '☁ 已同步（' + user.email + '）');
      }
    }, (err) => {
      console.error('雲端同步發生錯誤', err);
      setSyncBadge('offline', '⚠ 雲端連線中斷，暫用本機資料');
      catalog = localLoad();
      renderCatalog();
    });
  }

  function detachCloudSync(){
    if(cloudUnsub){ cloudUnsub(); cloudUnsub = null; }
  }

  function showLoginModal(){
    if(skippedLogin) return;
    loginModal.classList.add('open');
  }
  function hideLoginModal(){
    loginModal.classList.remove('open');
  }

  if(cloudReady){
    auth.onAuthStateChanged((user) => {
      currentUser = user;
      if(user){
        hideLoginModal();
        userChip.style.display = 'flex';
        userEmailLabel.textContent = user.email;
        attachCloudSync(user);
        attachQuotesSync(user);
      }else{
        userChip.style.display = 'none';
        detachCloudSync();
        detachQuotesSync();
        setSyncBadge('offline', '⚠ 尚未登入（僅本機儲存）');
        catalog = localLoad();
        renderCatalog();
        loadQuotes();
        renderQuotes();
        showLoginModal();
      }
    });
  }else{
    setSyncBadge('offline', '⚠ 雲端套件未載入（僅本機儲存）');
  }

  document.getElementById('loginSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    if(!email || !pw){ errEl.textContent = '請輸入 Email 和密碼'; return; }
    if(!cloudReady){ errEl.textContent = '雲端套件尚未載入，請確認網路連線'; return; }
    try{
      await auth.signInWithEmailAndPassword(email, pw);
    }catch(e){
      const map = {
        'auth/invalid-email': 'Email 格式不正確',
        'auth/user-not-found': '找不到這個帳號，請確認是否在 Firebase 主控台建立過',
        'auth/wrong-password': '密碼不正確',
        'auth/invalid-credential': 'Email 或密碼不正確',
        'auth/too-many-requests': '嘗試次數過多，請稍後再試'
      };
      errEl.textContent = map[e.code] || ('登入失敗：' + e.message);
    }
  });

  document.getElementById('skipLoginBtn').addEventListener('click', () => {
    skippedLogin = true;
    hideLoginModal();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    if(auth) await auth.signOut();
    skippedLogin = false;
  });

  function upsertCatalogEntry(code, name, spec, price, cost){
    if(!code || !name || !spec) return false;
    const existing = catalog.find(c => c.code === code);
    if(existing){
      let changed = false;
      if(existing.name !== name){ existing.name = name; changed = true; }
      if(existing.spec !== spec){ existing.spec = spec; changed = true; }
      if(price && existing.price !== price){ existing.price = price; changed = true; }
      if(cost && existing.cost !== cost){ existing.cost = cost; changed = true; }
      return changed;
    }else{
      catalog.push({code, name, spec, price: price || 0, cost: cost || 0});
      return true;
    }
  }

  function renderCatalog(){
    catalogCount.textContent = catalog.length;
    catalogTableBody.innerHTML = '';
    partnoList.innerHTML = '';
    nameList.innerHTML = '';
    specList.innerHTML = '';

    catalogEmpty.style.display = catalog.length === 0 ? 'block' : 'none';

    catalog.forEach((c, idx) => {
      const opt1 = document.createElement('option'); opt1.value = c.code; partnoList.appendChild(opt1);
      const opt2 = document.createElement('option'); opt2.value = c.name; nameList.appendChild(opt2);
      const opt3 = document.createElement('option'); opt3.value = c.spec; specList.appendChild(opt3);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(c.code)}</td>
        <td class="name-td">${escapeHtml(c.name)}</td>
        <td class="spec-td">${escapeHtml(c.spec)}</td>
        <td>${c.price ? c.price.toLocaleString('en-US') : '-'}</td>
        <td>${c.cost ? c.cost.toLocaleString('en-US') : '-'}</td>
        <td><button class="small danger" data-del="${idx}" type="button">刪除</button></td>
      `;
      catalogTableBody.appendChild(tr);
    });

    catalogTableBody.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const i = parseInt(btn.getAttribute('data-del'), 10);
        catalog.splice(i,1);
        await saveCatalog();
      });
    });
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[s]));
  }

  function renumber(){
    [...itemsBody.children].forEach((tr, i) => {
      tr.querySelector('.rowidx').textContent = i+1;
    });
  }

  function addRow(prefill){
    prefill = prefill || {};
    rowSeq++;
    const tr = document.createElement('tr');
    tr.dataset.rowId = rowSeq;
    tr.innerHTML = `
      <td class="rowidx"></td>
      <td><input class="f-code" list="partnoList" placeholder="料號" value="${escapeHtml(prefill.code||'')}"></td>
      <td class="name-cell"><input class="f-name" list="nameList" placeholder="品名" value="${escapeHtml(prefill.name||'')}"></td>
      <td class="spec-cell"><input class="f-spec" list="specList" placeholder="規格敘述" value="${escapeHtml(prefill.spec||'')}"></td>
      <td><input class="f-qty" type="number" min="0" step="1" value="${prefill.qty||1}"></td>
      <td><input class="f-price" type="number" min="0" step="1" value="${prefill.price||''}"></td>
      <td class="money f-total">TWD 0</td>
      <td class="cost-col"><input class="f-cost" type="number" min="0" step="1" value="${prefill.cost||''}" placeholder="成本"></td>
      <td class="cost-col gp-col f-gp">-</td>
      <td><button class="row-del" type="button" title="刪除此列">✕</button></td>
    `;
    itemsBody.appendChild(tr);

    const codeInput = tr.querySelector('.f-code');
    const nameInput = tr.querySelector('.f-name');
    const specInput = tr.querySelector('.f-spec');
    const qtyInput = tr.querySelector('.f-qty');
    const priceInput = tr.querySelector('.f-price');
    const costInput = tr.querySelector('.f-cost');

    // 選擇 / 輸入完整符合的料號時，立即帶出品名、規格；單價與成本只在欄位空白時才帶入，避免覆蓋手動議價。
    function autofillFromCode(){
      const match = catalog.find(c => c.code === codeInput.value.trim());
      if(match){
        nameInput.value = match.name;
        specInput.value = match.spec;
        if(!priceInput.value && match.price) priceInput.value = match.price;
        if(!costInput.value && match.cost) costInput.value = match.cost;
        recalc();
      }
    }

    async function maybeSaveToCatalog(){
      const code = codeInput.value.trim();
      const name = nameInput.value.trim();
      const spec = specInput.value.trim();
      const price = parseFloat(priceInput.value) || 0;
      const cost = parseFloat(costInput.value) || 0;
      if(code && name && spec){
        const changed = upsertCatalogEntry(code, name, spec, price, cost);
        if(changed) await saveCatalog();
      }
    }

    codeInput.addEventListener('input', autofillFromCode);
    codeInput.addEventListener('change', () => { autofillFromCode(); maybeSaveToCatalog(); });
    nameInput.addEventListener('change', maybeSaveToCatalog);
    specInput.addEventListener('change', maybeSaveToCatalog);
    priceInput.addEventListener('change', maybeSaveToCatalog);
    costInput.addEventListener('change', maybeSaveToCatalog);
    [qtyInput, priceInput, costInput].forEach(el => el.addEventListener('input', recalc));

    tr.querySelector('.row-del').addEventListener('click', () => {
      tr.remove();
      renumber();
      recalc();
      scheduleDraftSave();
    });

    renumber();
    recalc();
    scheduleDraftSave();
    if(!prefill.code) codeInput.focus();
  }

  function recalc(){
    let subtotal = 0;
    let costTotal = 0;
    itemsBody.querySelectorAll('tr').forEach(tr=>{
      const qty = parseFloat(tr.querySelector('.f-qty').value) || 0;
      const price = parseFloat(tr.querySelector('.f-price').value) || 0;
      const cost = parseFloat(tr.querySelector('.f-cost').value) || 0;
      const total = qty * price;
      tr.querySelector('.f-total').textContent = fmt(total);
      subtotal += total;
      costTotal += qty * cost;

      const gpCell = tr.querySelector('.f-gp');
      const costInput = tr.querySelector('.f-cost');
      if(costInput.value === '' || price === 0){
        gpCell.innerHTML = '-';
        gpCell.classList.remove('gp-neg');
      }else{
        const gpAmt = price - cost;
        const gpPct = price > 0 ? (gpAmt / price * 100) : 0;
        gpCell.innerHTML = `<span class="gp-pct">${gpPct.toFixed(1)}%</span><span class="gp-amt">${gpAmt>=0?'+':''}${Math.round(gpAmt).toLocaleString('en-US')}/件</span>`;
        gpCell.classList.toggle('gp-neg', gpAmt < 0);
      }
    });
    const tax = subtotal * taxRate;
    document.getElementById('sumSub').textContent = fmt(subtotal);
    document.getElementById('sumTax').textContent = fmt(tax);
    document.getElementById('sumTotal').textContent = fmt(subtotal + tax);

    const margin = subtotal - costTotal;
    const marginPct = subtotal > 0 ? (margin / subtotal * 100) : 0;
    document.getElementById('sumCost').textContent = fmt(costTotal);
    document.getElementById('sumMargin').textContent = fmt(margin);
    document.getElementById('sumMarginPct').textContent = marginPct.toFixed(1) + '%';
  }

  // ---- 目前報價單：序列化 / 還原 ----
  const META_IDS = ['q_no','q_date','q_customer','q_valid','q_contact','q_pay','q_contact_tel','q_incoterms','q_contact_email','q_sales','q_delivery_date','q_sales_tel','q_delivery_place','q_sales_email'];
  const EDITABLE_BOXES = ['companyBox','noticeBox'];

  function collectQuote(){
    const meta = {};
    META_IDS.forEach(id => { const el = document.getElementById(id); if(el) meta[id] = el.value; });
    const boxes = {};
    EDITABLE_BOXES.forEach(id => { const el = document.getElementById(id); if(el) boxes[id] = el.innerHTML; });
    const items = [];
    itemsBody.querySelectorAll('tr').forEach(tr => {
      items.push({
        code:  tr.querySelector('.f-code').value,
        name:  tr.querySelector('.f-name').value,
        spec:  tr.querySelector('.f-spec').value,
        qty:   tr.querySelector('.f-qty').value,
        price: tr.querySelector('.f-price').value,
        cost:  tr.querySelector('.f-cost').value
      });
    });
    return { meta, boxes, items, currency: currentCurrency(), taxRate, remark: document.getElementById('remark').value };
  }

  function applyQuote(q){
    if(!q) return;
    q.meta = q.meta || {};
    META_IDS.forEach(id => { const el = document.getElementById(id); if(el) el.value = q.meta[id] || ''; });
    if(q.boxes){
      EDITABLE_BOXES.forEach(id => { const el = document.getElementById(id); if(el && typeof q.boxes[id] === 'string') el.innerHTML = q.boxes[id]; });
    }
    const cur = document.getElementById('currency');
    if(cur && q.currency) cur.textContent = q.currency;
    if(typeof q.taxRate === 'number'){ taxRate = q.taxRate; taxRateInput.value = +(q.taxRate * 100).toFixed(4); }
    document.getElementById('remark').value = q.remark || '';
    itemsBody.innerHTML = '';
    const items = (Array.isArray(q.items) && q.items.length) ? q.items : [{}];
    items.forEach(it => addRow(it));
    recalc();
  }

  function isQuoteEmpty(q){
    if(!q) return true;
    const hasMeta = q.meta && Object.values(q.meta).some(v => v && String(v).trim());
    const hasItem = Array.isArray(q.items) && q.items.some(it =>
      [it.code, it.name, it.spec, it.price, it.cost].some(v => v && String(v).trim()));
    return !hasMeta && !hasItem && !(q.remark && q.remark.trim());
  }

  // ---- 目前報價單：localStorage 自動暫存 ----
  const DRAFT_KEY = 'quote:draft';
  let draftTimer = null;
  function saveDraft(){
    try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(collectQuote())); }catch(e){}
  }
  function scheduleDraftSave(){
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  document.getElementById('addRowBtn').addEventListener('click', () => addRow());
  document.getElementById('addRowBtn2').addEventListener('click', () => addRow());
  document.getElementById('printBtn').addEventListener('click', () => window.print());

  // 列印 / 另存 PDF 時，以報價單號 (與客戶) 作為預設檔名。
  // 瀏覽器「另存 PDF」的檔名取自 document.title，故列印前暫改標題、列印後還原。
  const BASE_TITLE = document.title;
  function quoteFileTitle(){
    const no = (document.getElementById('q_no').value || '').trim();
    const cust = (document.getElementById('q_customer').value || '').trim();
    let name = '報價單';
    if(no) name += '_' + no;
    if(cust) name += '_' + cust;
    return name.replace(/[\/\\:*?"<>|]/g, '-'); // 移除檔名不允許的字元
  }
  window.addEventListener('beforeprint', () => { document.title = quoteFileTitle(); });
  window.addEventListener('afterprint', () => { document.title = BASE_TITLE; });

  // 幣別變更時，重新格式化所有金額
  document.getElementById('currency').addEventListener('input', recalc);
  // 可調稅率
  const taxRateInput = document.getElementById('taxRateInput');
  taxRateInput.addEventListener('input', () => {
    const v = parseFloat(taxRateInput.value);
    taxRate = (isFinite(v) && v >= 0) ? v / 100 : 0;
    recalc();
    scheduleDraftSave();
  });
  // 報價單任何欄位變動即排程自動暫存
  document.getElementById('sheet').addEventListener('input', scheduleDraftSave);
  document.getElementById('newQuoteBtn').addEventListener('click', async () => {
    if(await confirmDialog('確定要清空目前這張報價單的品項與客戶資訊嗎？（已儲存的常用料號清單不會被刪除）', { okText: '清空', danger: true })){
      document.querySelectorAll('.meta-val input').forEach(i=>i.value='');
      document.getElementById('remark').value='';
      itemsBody.innerHTML='';
      addRow();
      saveDraft();
    }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `axiomtek-常用料號備份-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    try{
      const text = await file.text();
      const imported = JSON.parse(text);
      if(!Array.isArray(imported)) throw new Error('格式不正確');
      let added = 0, updated = 0;
      imported.forEach(item => {
        if(!item.code || !item.name || !item.spec) return;
        const changed = upsertCatalogEntry(item.code, item.name, item.spec, item.price, item.cost);
        if(changed){
          const existedBefore = catalog.some(c => c.code === item.code);
          existedBefore ? updated++ : added++;
        }
      });
      await saveCatalog();
      toast(`匯入完成：新增 ${added} 筆，更新 ${updated} 筆。`);
    }catch(err){
      toast('匯入失敗，請確認是本工具匯出的 JSON 備份檔。', 'error');
    }
    e.target.value = '';
  });

  // ---- 匯入既有料號資料 (Excel / CSV)，需先對應欄位 ----
  let importedRows = []; // array of arrays, row[0] = header
  const mapModal = document.getElementById('mapModal');
  const GUESS = {
    code: ['料號','品號','型號','part no','part number','pn','item no','編號'],
    name: ['品名','名稱','產品名稱','item','name','description short','品項'],
    spec: ['規格','規格敘述','spec','specification','description','描述'],
    price: ['單價','售價','價格','price','unit price','報價'],
    cost: ['成本','進價','cost','buy price','採購價']
  };

  function guessColumn(headers, keywords){
    const lower = headers.map(h => String(h||'').toLowerCase().trim());
    for(const kw of keywords){
      const idx = lower.findIndex(h => h.includes(kw));
      if(idx !== -1) return idx;
    }
    return -1;
  }

  function populateSelect(sel, headers, selectedIdx, optional){
    sel.innerHTML = '';
    if(optional){
      const optNone = document.createElement('option');
      optNone.value = '-1'; optNone.textContent = '（不匯入）';
      sel.appendChild(optNone);
    }
    headers.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${h ? h : '(欄' + (i+1) + ')'}`;
      sel.appendChild(opt);
    });
    sel.value = selectedIdx >= 0 ? selectedIdx : (optional ? '-1' : 0);
  }

  function renderPreview(headers, rows){
    const table = document.getElementById('previewTable');
    let html = '<thead><tr>' + headers.map(h => `<th>${escapeHtml(h || '')}</th>`).join('') + '</tr></thead><tbody>';
    rows.slice(0,5).forEach(r => {
      html += '<tr>' + headers.map((_,i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('') + '</tr>';
    });
    html += '</tbody>';
    table.innerHTML = html;
  }

  document.getElementById('importSheetBtn').addEventListener('click', () => {
    document.getElementById('importSheetFile').click();
  });

  document.getElementById('importSheetFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    if(typeof XLSX === 'undefined'){
      toast('讀取套件尚未載入完成，請確認網路連線後再試一次。', 'error');
      return;
    }
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1, raw:false, defval:''});
      if(rows.length < 2){ toast('這個檔案裡沒有偵測到資料列。', 'error'); return; }

      const headers = rows[0];
      importedRows = rows.slice(1).filter(r => r.some(v => String(v).trim() !== ''));

      populateSelect(document.getElementById('mapCode'), headers, guessColumn(headers, GUESS.code), false);
      populateSelect(document.getElementById('mapName'), headers, guessColumn(headers, GUESS.name), false);
      populateSelect(document.getElementById('mapSpec'), headers, guessColumn(headers, GUESS.spec), false);
      populateSelect(document.getElementById('mapPrice'), headers, guessColumn(headers, GUESS.price), true);
      populateSelect(document.getElementById('mapCost'), headers, guessColumn(headers, GUESS.cost), true);

      document.getElementById('mapSubtitle').textContent =
        `「${file.name}」共偵測到 ${importedRows.length} 筆資料。請確認欄位對應（系統已自動猜測，可自行調整）：`;
      renderPreview(headers, importedRows);
      mapModal.classList.add('open');
    }catch(err){
      console.error(err);
      toast('讀取檔案失敗，請確認檔案格式是否為 .csv、.xlsx 或 .xls。', 'error');
    }
  });

  document.getElementById('mapModalClose').addEventListener('click', () => mapModal.classList.remove('open'));
  document.getElementById('mapCancelBtn').addEventListener('click', () => mapModal.classList.remove('open'));

  document.getElementById('mapConfirmBtn').addEventListener('click', async () => {
    const codeIdx = parseInt(document.getElementById('mapCode').value, 10);
    const nameIdx = parseInt(document.getElementById('mapName').value, 10);
    const specIdx = parseInt(document.getElementById('mapSpec').value, 10);
    const priceIdx = parseInt(document.getElementById('mapPrice').value, 10);
    const costIdx = parseInt(document.getElementById('mapCost').value, 10);

    let added = 0, updated = 0, skipped = 0;
    importedRows.forEach(r => {
      const code = String(r[codeIdx] ?? '').trim();
      const name = String(r[nameIdx] ?? '').trim();
      const spec = String(r[specIdx] ?? '').trim();
      const price = priceIdx >= 0 ? parseFloat(String(r[priceIdx]).replace(/[^0-9.\-]/g,'')) || 0 : 0;
      const cost = costIdx >= 0 ? parseFloat(String(r[costIdx]).replace(/[^0-9.\-]/g,'')) || 0 : 0;
      if(!code || !name || !spec){ skipped++; return; }
      const existedBefore = catalog.some(c => c.code === code);
      const changed = upsertCatalogEntry(code, name, spec, price, cost);
      if(changed) existedBefore ? updated++ : added++;
    });

    await saveCatalog();
    mapModal.classList.remove('open');
    toast(`匯入完成：新增 ${added} 筆，更新 ${updated} 筆${skipped ? `，略過 ${skipped} 筆（缺少料號/品名/規格）` : ''}。`);
  });

  document.getElementById('catalogToggle').addEventListener('click', () => {
    const body = document.getElementById('catalogBody');
    const btn = document.querySelector('#catalogToggle button');
    body.classList.toggle('open');
    btn.textContent = body.classList.contains('open') ? '收合 ▴' : '展開 ▾';
  });

  // ---- 已存報價單：本機儲存與歷史紀錄 ----
  const QUOTES_KEY = 'quotes:list';
  let quotes = [];
  const quotesTableBody = document.getElementById('quotesTableBody');
  const quotesEmpty = document.getElementById('quotesEmpty');

  let quotesUnsub = null;

  function loadQuotesLocal(){
    try{ const raw = localStorage.getItem(QUOTES_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
    catch(e){ return []; }
  }
  function loadQuotes(){ quotes = loadQuotesLocal(); }
  function saveQuotesLocal(){
    try{ localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes)); }
    catch(e){ console.error('無法儲存報價單清單', e); }
  }
  // 註：所有報價單存於單一 Firestore 文件 (users/{uid}/quotes/main) 的陣列中，
  // 與常用料號清單相同模式；若日後資料量大可改為每張報價單一份文件。
  async function persistQuotesCloud(){
    await db.collection('users').doc(currentUser.uid).collection('quotes').doc('main')
      .set({ items: quotes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
  function persistQuotes(){
    if(currentUser && db){
      persistQuotesCloud().catch(e => {
        console.error('報價單雲端儲存失敗，改存本機', e);
        saveQuotesLocal();
      });
      renderQuotes(); // 即時回饋；稍後 onSnapshot 會再同步一次
    }else{
      saveQuotesLocal();
      renderQuotes();
    }
  }

  function attachQuotesSync(user){
    if(quotesUnsub) quotesUnsub();
    const ref = db.collection('users').doc(user.uid).collection('quotes').doc('main');
    quotesUnsub = ref.onSnapshot(async (snap) => {
      if(snap.exists && Array.isArray(snap.data().items)){
        quotes = snap.data().items;
        renderQuotes();
      }else{
        // 雲端尚無報價單：若本機已有，首次登入自動上傳
        const local = loadQuotesLocal();
        if(local.length > 0){ quotes = local; await persistQuotesCloud().catch(e => console.error(e)); return; }
        quotes = [];
        renderQuotes();
      }
    }, (err) => {
      console.error('報價單雲端同步錯誤', err);
      loadQuotes(); renderQuotes();
    });
  }
  function detachQuotesSync(){ if(quotesUnsub){ quotesUnsub(); quotesUnsub = null; } }
  function quoteTotals(q){
    let sub = 0;
    (q.items||[]).forEach(it => { sub += (parseFloat(it.qty)||0) * (parseFloat(it.price)||0); });
    const rate = typeof q.taxRate === 'number' ? q.taxRate : 0.05;
    return { sub, total: sub * (1 + rate) };
  }
  function fmtCur(n, cur){ n = Math.round(n + Number.EPSILON); return (cur||'TWD') + ' ' + n.toLocaleString('en-US'); }

  let toastTimer = null;
  function toast(msg, type){
    let el = document.getElementById('toast');
    if(!el){ el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    el.textContent = msg;
    void el.offsetWidth; // 強制 reflow，讓重複觸發也能重新播放動畫
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 3600 : 2200);
  }

  // 取代瀏覽器原生 confirm()，回傳 Promise<boolean>
  function confirmDialog(message, opts){
    opts = opts || {};
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      const box = document.createElement('div');
      box.className = 'modal-box confirm-box';
      const msg = document.createElement('div');
      msg.className = 'confirm-msg';
      msg.textContent = message;
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = opts.cancelText || '取消';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = opts.danger ? 'danger' : 'primary';
      ok.textContent = opts.okText || '確定';
      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(msg);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const done = (val) => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
      const onKey = (e) => {
        if(e.key === 'Escape') done(false);
        else if(e.key === 'Enter') done(true);
      };
      ok.addEventListener('click', () => done(true));
      cancel.addEventListener('click', () => done(false));
      overlay.addEventListener('click', (e) => { if(e.target === overlay) done(false); });
      document.addEventListener('keydown', onKey);
      ok.focus();
    });
  }

  function saveCurrentQuote(){
    const q = collectQuote();
    const no = (q.meta.q_no||'').trim();
    const now = Date.now();
    const rec = no ? quotes.find(r => (((r.quote||{}).meta||{}).q_no||'').trim() === no) : null;
    if(rec){ rec.quote = q; rec.savedAt = now; toast('已更新報價單 ' + no); }
    else{
      quotes.unshift({ id: now.toString(36) + Math.random().toString(36).slice(2,6), savedAt: now, quote: q });
      toast(no ? ('已儲存報價單 ' + no) : '已儲存報價單');
    }
    persistQuotes();
  }

  function renderQuotes(){
    if(!quotesTableBody) return;
    quotesTableBody.innerHTML = '';
    if(quotesEmpty) quotesEmpty.style.display = quotes.length ? 'none' : 'block';
    quotes.forEach((rec, idx) => {
      const q = rec.quote || {}; const meta = q.meta || {};
      const t = quoteTotals(q);
      const d = new Date(rec.savedAt || Date.now());
      const pad = n => String(n).padStart(2,'0');
      const savedStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(meta.q_no || '—')}</td>
        <td class="name-td">${escapeHtml(meta.q_customer || '—')}</td>
        <td>${escapeHtml(meta.q_date || '—')}</td>
        <td style="text-align:right;">${escapeHtml(fmtCur(t.total, q.currency))}</td>
        <td style="color:var(--ink-faint); white-space:nowrap;">${savedStr}</td>
        <td style="white-space:nowrap;">
          <button class="small" data-open="${idx}" type="button">開啟</button>
          <button class="small" data-dup="${idx}" type="button">複製</button>
          <button class="small danger" data-delq="${idx}" type="button">刪除</button>
        </td>`;
      quotesTableBody.appendChild(tr);
    });
    quotesTableBody.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      applyQuote(JSON.parse(JSON.stringify(quotes[+b.dataset.open].quote)));
      saveDraft(); toast('已載入報價單'); window.scrollTo({ top:0, behavior:'smooth' });
    }));
    quotesTableBody.querySelectorAll('[data-dup]').forEach(b => b.addEventListener('click', () => {
      const q = JSON.parse(JSON.stringify(quotes[+b.dataset.dup].quote));
      q.meta = q.meta || {}; q.meta.q_no = '';
      applyQuote(q); saveDraft();
      toast('已複製為新報價單，請設定新單號'); window.scrollTo({ top:0, behavior:'smooth' });
    }));
    quotesTableBody.querySelectorAll('[data-delq]').forEach(b => b.addEventListener('click', async () => {
      const i = +b.dataset.delq;
      if(await confirmDialog('確定要刪除這張已存報價單嗎？此動作無法復原。', { okText: '刪除', danger: true })){ quotes.splice(i,1); persistQuotes(); }
    }));
  }

  document.getElementById('saveQuoteBtn').addEventListener('click', saveCurrentQuote);
  document.getElementById('quotesToggle').addEventListener('click', () => {
    const body = document.getElementById('quotesBody');
    const btn = document.querySelector('#quotesToggle button');
    body.classList.toggle('open');
    btn.textContent = body.classList.contains('open') ? '收合 ▴' : '展開 ▾';
  });

  // default dates
  const today = new Date();
  const iso = d => d.toISOString().slice(0,10);
  document.getElementById('q_date').value = iso(today);
  const valid = new Date(today); valid.setDate(valid.getDate()+7);
  document.getElementById('q_valid').value = iso(valid);

  loadQuotes();
  renderQuotes();

  loadCatalog().then(() => {
    let draft = null;
    try{ const raw = localStorage.getItem(DRAFT_KEY); if(raw) draft = JSON.parse(raw); }catch(e){}
    if(draft && !isQuoteEmpty(draft)) applyQuote(draft);
    else addRow();
  });
})();
