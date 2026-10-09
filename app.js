const $ = id => document.getElementById(id);
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
let hideTimer;

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
    const orgName = ($('org') || {}).textContent || '';
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
        <div><small>คำแนะนำ / ติดต่อสอบถาม</small><span>บัตรนัดนี้ออกโดยเจ้าหน้าที่ IT กรุณาติดต่อสอบถามเพิ่มเติม <br> โทร. 055-716715</span></div></div>
    </div>
    <div class="print-foot">พิมพ์เมื่อ ${printedAt()}</div>
    <div class="t-act">
      <button class="btn ghost" onclick="window.print()">พิมพ์บัตรนัด</button>
      <button class="btn ghost" onclick="clearAll()">ค้นหาเพิ่มเติม</button>
    </div>
  </article>
  <div class="timer">เพื่อความเป็นส่วนตัว ข้อมูลจะถูกล้างอัตโนมัติใน 90 วินาที</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    hideTimer = setTimeout(clearAll, 90000);
}

function clearAll() {
    clearTimeout(hideTimer);
    $('result').style.display = 'none'; $('result').innerHTML = '';
    $('nid').value = ''; $('err').textContent = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}