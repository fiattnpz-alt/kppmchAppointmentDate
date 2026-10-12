const $ = id => document.getElementById(id);
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
let hideTimer;

// ข้อความ "คำแนะนำ / ติดต่อสอบถาม" บนบัตรนัด (แก้เบอร์โทร/ข้อความที่นี่ที่เดียว ใช้ทั้งบนจอ ตอนพิมพ์ และในรูปที่บันทึก)
const CONTACT_TEXT = 'บัตรนัดนี้ออกโดยเจ้าหน้าที่ IT กรุณาติดต่อสอบถามเพิ่มเติม';
const CONTACT_PHONE = 'โทร. 055-716715';

let lastTicket = null;   // เก็บข้อมูลบัตรนัดล่าสุด ไว้สร้างรูป

// จัดรูปแบบเลขบัตร x-xxxx-xxxxx-xx-x
$('nid').addEventListener('input', e => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 13);
    e.target.value = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d.slice(12, 13)].filter(Boolean).join('-');
    e.target.classList.remove('err'); $('err').textContent = '';
});
$('nid').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
$('go').addEventListener('click', submit);

// ตรวจว่ากรอกครบ 13 หลัก
function validId(id) { return /^\d{13}$/.test(id); }
function showErr(msg, el) { $('err').textContent = msg; if (el) { el.classList.add('err'); el.focus(); } }

// อุ่นเซิร์ฟเวอร์ล่วงหน้า ระหว่างที่ผู้ใช้กำลังพิมพ์เลขบัตร เพื่อลดเวลารอตอนกดตรวจสอบ
let lastWarm = 0;
function warmUp() {
    if (window.google && google.script && google.script.run) return;
    if (Date.now() - lastWarm < 240000) return;
    lastWarm = Date.now();
    fetch(API_URL + '?ping=1', { mode: 'no-cors' }).catch(() => { });
}
warmUp();
$('nid').addEventListener('input', warmUp);

// ถ้าเปิดจาก GAS ใช้ google.script.run / ถ้าโฮสต์ข้างนอก (Vercel) ใช้ fetch
function lookupOnce(nid) {
    if (window.google && google.script && google.script.run) {
        return new Promise((ok, fail) =>
            google.script.run.withSuccessHandler(ok).withFailureHandler(fail).searchAppointment(nid));
    }
    return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ nationalId: nid })
    }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
}

// ลองซ้ำ 1 ครั้งถ้าเครือข่ายหรือเซิร์ฟเวอร์สะดุด (กันขึ้น "ไม่พบข้อมูล" ทั้งที่จริงมีข้อมูล)
async function lookup(nid) {
    for (let i = 0; i < 2; i++) {
        try {
            const res = await lookupOnce(nid);
            if (res && res.error) throw new Error('server error');
            return res;
        } catch (e) {
            if (i === 1) throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function submit() {
    const nid = $('nid').value.replace(/\D/g, '');
    if (!validId(nid)) return showErr('เลขบัตรประชาชนไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', $('nid'));
    setLoading(true); $('result').style.display = 'none'; clearTimeout(hideTimer);

    let finished = false;
    const slow = setTimeout(() => { if (!finished) setLoading(true, 'กำลังตรวจสอบ... กรุณารอสักครู่'); }, 6000);
    const done = () => { finished = true; clearTimeout(guard); clearTimeout(slow); setLoading(false); };
    const guard = setTimeout(() => {
        if (finished) return; done();
        showErr('ระบบตอบสนองช้า กรุณาลองกดตรวจสอบอีกครั้ง');
    }, 45000);

    lookup(nid)
        .then(res => { if (finished) return; done(); render(res); })
        .catch(err => {
            console.error(err); if (finished) return; done();
            showErr('ระบบขัดข้อง กรุณาลองใหม่อีกครั้งในภายหลัง');
        });
}

function setLoading(on, msg) {
    const b = $('go'); b.disabled = on;
    b.innerHTML = on ? '<span class="spin"></span>' + (msg || 'กำลังตรวจสอบ...') : 'ตรวจสอบวันนัด';
}

function thaiDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return { text: `${d} ${MONTHS[m - 1]} ${y + 543}`, day: 'วัน' + DAYS[dt.getUTCDay()], utc: dt };
}
function daysLeft(utc) {
    const n = new Date(); const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((utc - today) / 864e5);
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// วันเวลาที่พิมพ์ (แสดงเฉพาะตอนพิมพ์) เช่น "9 ตุลาคม 2569 เวลา 14:05 น."
function printedAt() {
    const n = new Date();
    const hh = String(n.getHours()).padStart(2, '0'), mm = String(n.getMinutes()).padStart(2, '0');
    return `${n.getDate()} ${MONTHS[n.getMonth()]} ${n.getFullYear() + 543} เวลา ${hh}:${mm} น.`;
}

function render(res) {
    const box = $('result'); box.style.display = 'block';
    if (!res || !res.found) {
        box.innerHTML = `<div class="notfound"><h2>ไม่พบข้อมูลวันนัด</h2>
      <p>ไม่พบวันนัดที่ตรงกับข้อมูลที่กรอก<br>กรุณาตรวจสอบข้อมูลอีกครั้ง หรือ<b> ติดต่อเจ้าหน้าที่</b></p></div>`;
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return;
    }
    const a = res.data, t = thaiDate(a.next_appointment), n = daysLeft(t.utc);
    const past = !!a.is_past;
    const cd = past ? 'เลยกำหนดวันนัดมาแล้ว' : n === 0 ? 'วันนี้ !' : n === 1 ? 'พรุ่งนี้' : `อีก ${n} วัน`;
    const orgName = (document.querySelector('.org') || {}).textContent || '';
    lastTicket = { a, t, n, past, cd, orgName, printed: printedAt() };
    const ico = p => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1d4e9e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    box.innerHTML = `
  <article class="ticket">
    <div class="print-head"><div class="ph-org">${esc(orgName)}</div></div>
    <div class="t-head"><b>บัตรนัดผู้ป่วย</b><span class="badge">${past ? 'เลยกำหนดนัด' : 'นัดครั้งถัดไป'}</span></div>
    <div class="t-body">
      <div class="t-name">${esc(a.first_name)} ${esc(a.last_name)}</div>
      <div class="t-lbl">ท่านมีนัดวันที่</div>
      <div class="t-date">${t.text}</div>
      <div class="t-day">${t.day}</div>
      <span class="count ${past ? 'late' : n <= 3 ? 'soon' : ''}">${cd}</span>
      ${past ? '<p class="late-note">ไม่พบวันนัดครั้งถัดไป กรุณาติดต่อเจ้าหน้าที่</p>' : ''}
    </div>
    <div class="tear"></div>
    <div class="t-info">
      <div class="row">${ico('<path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/>')}
        <div><small>แพทย์ผู้นัด</small><span>${esc(a.doctor_name) || '-'}</span></div></div>
      <div class="row">${ico('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>')}
        <div><small>หมายเหตุ</small><span>${esc(a.note) || '-'}</span></div></div>
      <div class="row">${ico('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>')}
        <div><small>คำแนะนำ / ติดต่อสอบถาม</small><span>${esc(CONTACT_TEXT)} <br> ${esc(CONTACT_PHONE)}</span></div></div>
    </div>
    <div class="print-foot">พิมพ์เมื่อ ${lastTicket.printed}</div>
    <div class="t-act">
      <button class="btn ghost btn-print" onclick="window.print()">พิมพ์บัตรนัด</button>
      <button class="btn ghost" onclick="saveTicket(this)">บันทึกเป็นรูป</button>
      <button class="btn ghost" onclick="clearAll()">ค้นหาเพิ่มเติม</button>
    </div>
  </article>
  <div class="timer">เพื่อความเป็นส่วนตัว ข้อมูลจะถูกล้างอัตโนมัติใน 90 วินาที</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    hideTimer = setTimeout(clearAll, 90000);
}

function clearAll() {
    clearTimeout(hideTimer);
    closeModal();
    $('result').style.display = 'none'; $('result').innerHTML = '';
    $('nid').value = ''; $('err').textContent = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// บันทึกบัตรนัดเป็นรูป (วาดลง canvas เอง ไม่ต้องใช้ไลบรารีเสริม)
// ใช้แทนปุ่มพิมพ์บนมือถือ เพราะมือถือสั่งพิมพ์ไม่ได้
// ============================================================
const IMG = { W: 540, PAD: 20, S: 2 };   // กว้าง 540 หน่วย × ขยาย 2 เท่า = รูปกว้าง 1080 px
const SANS = 'Sarabun, "Noto Sans Thai", system-ui, sans-serif';
const SERIF = '"Noto Serif Thai", serif';

function loadImage(src) {
    return new Promise(res => {
        if (!src) return res(null);
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = src;
    });
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ตัดบรรทัดข้อความ (ภาษาไทยไม่มีเว้นวรรค จึงใช้ Intl.Segmenter ตัดตามคำ)
function wrapText(ctx, text, maxW) {
    const out = [];
    String(text == null ? '' : text).split('\n').forEach(par => {
        const segs = (window.Intl && Intl.Segmenter)
            ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(par), x => x.segment)
            : Array.from(par);
        let line = '';
        segs.forEach(w => {
            if (line && ctx.measureText(line + w).width > maxW) { out.push(line.trim()); line = w.trimStart(); }
            else line += w;
        });
        if (line.trim() || !out.length) out.push(line.trim());
    });
    return out;
}

// วาดบัตรนัดทั้งใบ H = ความสูงรูป (รอบแรกส่ง 0 เพื่อวัดความสูง) คืนค่าความสูงรวม
function paintTicket(ctx, H) {
    const d = lastTicket, W = IMG.W, P = IMG.PAD, CW = W - P * 2, IP = 22, cx = W / 2;
    const navy = '#0c2340', blue = '#1d4e9e', gold = '#b8902f', muted = '#5d6b82', line = '#d5deec', sky = '#e8eef8';
    const textW = CW - IP * 2;
    ctx.textBaseline = 'alphabetic';

    // พื้นหลังรูป + การ์ด
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    roundRect(ctx, P, P, CW, H - P * 2, 14); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save();
    roundRect(ctx, P, P, CW, H - P * 2, 14); ctx.clip();

    let y = P + 22;

    // โลโก้ + ชื่อหน่วยงาน
    if (d.logo) { ctx.drawImage(d.logo, cx - 30, y, 60, 60); y += 60 + 10; }
    ctx.fillStyle = navy; ctx.textAlign = 'center'; ctx.font = '700 17px ' + SERIF;
    wrapText(ctx, d.orgName, textW).forEach(l => { ctx.fillText(l, cx, y + 17); y += 25; });
    y += 12;

    // แถบหัวบัตร
    const bandH = 48;
    const g = ctx.createLinearGradient(P, 0, P + CW, 0);
    g.addColorStop(0, navy); g.addColorStop(1, blue);
    ctx.fillStyle = g; ctx.fillRect(P, y, CW, bandH);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '700 18px ' + SERIF;
    ctx.fillText('บัตรนัดผู้ป่วย', P + IP, y + 30);
    const badge = d.past ? 'เลยกำหนดนัด' : 'นัดครั้งถัดไป';
    ctx.font = '600 13px ' + SANS;
    const bw = ctx.measureText(badge).width + 26;
    roundRect(ctx, P + CW - IP - bw, y + 11, bw, 26, 13); ctx.fillStyle = '#e6c872'; ctx.fill();
    ctx.fillStyle = navy; ctx.textAlign = 'center';
    ctx.fillText(badge, P + CW - IP - bw / 2, y + 29);
    y += bandH + 26;

    // ชื่อ / วันนัด
    const fullName = d.a.first_name + ' ' + d.a.last_name;
    let nfs = 20;
    ctx.font = '600 ' + nfs + 'px ' + SANS;
    while (ctx.measureText(fullName).width > textW && nfs > 12) { nfs -= 1; ctx.font = '600 ' + nfs + 'px ' + SANS; }
    ctx.fillStyle = navy; ctx.fillText(fullName, cx, y + 20); y += 34;
    ctx.fillStyle = muted; ctx.font = '400 14px ' + SANS;
    ctx.fillText('ท่านมีนัดวันที่', cx, y + 14); y += 28;

    let fs = 34;
    ctx.font = '700 ' + fs + 'px ' + SERIF;
    while (ctx.measureText(d.t.text).width > textW && fs > 20) { fs -= 1; ctx.font = '700 ' + fs + 'px ' + SERIF; }
    ctx.fillStyle = blue; ctx.fillText(d.t.text, cx, y + fs); y += fs + 12;
    ctx.fillStyle = gold; ctx.font = '600 19px ' + SANS;
    ctx.fillText(d.t.day, cx, y + 19); y += 34;

    // ป้ายจำนวนวัน
    const pill = d.past ? { bg: '#fdeaea', fg: '#a63232' } : d.n <= 3 ? { bg: '#fff3d6', fg: '#7a5600' } : { bg: sky, fg: navy };
    ctx.font = '600 15px ' + SANS;
    const pw = ctx.measureText(d.cd).width + 38;
    roundRect(ctx, cx - pw / 2, y, pw, 32, 16); ctx.fillStyle = pill.bg; ctx.fill();
    ctx.fillStyle = pill.fg; ctx.fillText(d.cd, cx, y + 21); y += 32;
    if (d.past) {
        ctx.fillStyle = '#a63232'; ctx.font = '400 14px ' + SANS;
        ctx.fillText('ไม่พบวันนัดครั้งถัดไป กรุณาติดต่อเจ้าหน้าที่', cx, y + 26); y += 32;
    }
    y += 28;

    // เส้นปรุ + รอยบาก
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(P + 18, y); ctx.lineTo(P + CW - 18, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = sky;
    [P, P + CW].forEach(x => { ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); });
    y += 26;

    // รายการ: แพทย์ / หมายเหตุ / ติดต่อสอบถาม
    const rowW = textW - 14;
    const row = (label, lines) => {
        const top = y;
        ctx.textAlign = 'left';
        ctx.fillStyle = muted; ctx.font = '400 13px ' + SANS; ctx.fillText(label, P + IP + 14, y + 13); y += 20;
        ctx.fillStyle = '#1b2433'; ctx.font = '500 16px ' + SANS;
        lines.forEach(l => { ctx.fillText(l, P + IP + 14, y + 16); y += 24; });
        ctx.fillStyle = blue; ctx.fillRect(P + IP, top + 2, 3, y - top - 6);
        y += 12;
    };
    ctx.font = '500 16px ' + SANS;
    row('แพทย์ผู้นัด', wrapText(ctx, d.a.doctor_name || '-', rowW));
    row('หมายเหตุ', wrapText(ctx, d.a.note || '-', rowW));
    row('คำแนะนำ / ติดต่อสอบถาม', wrapText(ctx, CONTACT_TEXT, rowW).concat(wrapText(ctx, CONTACT_PHONE, rowW)));

    // ท้ายบัตร
    y += 2;
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(P + CW, y); ctx.stroke();
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.font = '400 12.5px ' + SANS;
    ctx.fillText('พิมพ์เมื่อ ' + d.printed, cx, y + 24); y += 38;

    ctx.restore();
    // เส้นขอบการ์ด
    roundRect(ctx, P, P, CW, y - P, 14); ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
    return y + P;
}

async function buildTicketBlob() {
    if (!lastTicket) throw new Error('no ticket');
    // รอให้ฟอนต์ Sarabun / Noto Serif Thai โหลดเสร็จก่อนวาด
    try {
        await Promise.all([
            document.fonts.load('400 16px Sarabun', 'กขค'),
            document.fonts.load('500 16px Sarabun', 'กขค'),
            document.fonts.load('600 16px Sarabun', 'กขค'),
            document.fonts.load('700 16px "Noto Serif Thai"', 'กขค')
        ]);
    } catch (e) { }
    lastTicket.logo = await loadImage((document.querySelector('.hero img') || {}).src);

    const S = IMG.S;
    const c0 = document.createElement('canvas'); c0.width = 10; c0.height = 10;
    const x0 = c0.getContext('2d'); x0.scale(S, S);
    const H = Math.ceil(paintTicket(x0, 0));          // รอบแรก: วัดความสูง

    const c = document.createElement('canvas');
    c.width = IMG.W * S; c.height = H * S;
    const ctx = c.getContext('2d'); ctx.scale(S, S);
    paintTicket(ctx, H);                               // รอบสอง: วาดจริง
    return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('toBlob')), 'image/png'));
}

// ---------- หน้าต่างแสดงรูป + ปุ่มบันทึก/แชร์ ----------
let imgUrl = null;

function closeModal() {
    const m = $('imgModal');
    if (m) m.classList.remove('open');
    if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
}

async function saveTicket(btn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'กำลังสร้างรูป...';
    try {
        showModal(await buildTicketBlob());
    } catch (e) {
        console.error(e);
        alert('สร้างรูปไม่สำเร็จ กรุณาลองใหม่ หรือแคปหน้าจอแทน');
    } finally {
        btn.disabled = false; btn.textContent = old;
    }
}

function showModal(blob) {
    closeModal();
    imgUrl = URL.createObjectURL(blob);
    let m = $('imgModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'imgModal'; m.className = 'modal';
        m.innerHTML = `<div class="modal-box">
      <p class="modal-tip">กดค้างที่รูปแล้วเลือก "บันทึกรูปภาพ" หรือกดปุ่มด้านล่าง</p>
      <img alt="บัตรนัด">
      <div class="modal-act">
        <button class="btn" data-act="share">บันทึก / แชร์รูป</button>
        <button class="btn ghost" data-act="close">ปิด</button>
      </div></div>`;
        document.body.appendChild(m);
        m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    }
    m.querySelector('img').src = imgUrl;
    m.querySelector('[data-act=share]').onclick = () => shareOrDownload(blob);
    m.querySelector('[data-act=close]').onclick = closeModal;
    m.classList.add('open');
}

// มือถือ: เปิดแผ่นแชร์ (เลือก "บันทึกรูปภาพ" ได้) / คอม: ดาวน์โหลดไฟล์
async function shareOrDownload(blob) {
    const file = new File([blob], 'appointment.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'บัตรนัด' }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = imgUrl; a.download = 'appointment.png';
    document.body.appendChild(a); a.click(); a.remove();
}