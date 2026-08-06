// ========================================================================
// ระบบพิมพ์ใบปะหน้าพัสดุ — รองรับวางออเดอร์หลายรายการพร้อมกัน + Order ID/QR
// ========================================================================

let orderList = [];      // { id, data } ทั้งหมดที่จะพิมพ์ (สะสมได้เรื่อย ๆ)
let orderSeqCounter = 1;  // เลขที่ออเดอร์ถัดไปที่จะออก
let pendingReview = [];   // { data } ที่แยกได้แล้วแต่ยังไม่ยืนยัน รอแก้ไขก่อนสร้างป้ายจริง

const PHONE_RE = /0[\d-]{8,10}\d/; // จับเบอร์โทรแบบ 0xxxxxxxxx หรือ 0xx-xxxxxxx
// คำที่บ่งชี้ว่าเป็นชื่อธุรกิจ/ร้านค้า ใช้แยกออกจากชื่อคนให้เป็นคนละบรรทัด
const BUSINESS_KEYWORD_RE = /(ร้าน|บริษัท|ห้างหุ้นส่วน|หจก\.?|บจก\.?)/;
// เบอร์โทร: ต้องไม่ติดกับตัวเลขชุดอื่น (กันไปกินเลขรหัสไปรษณีย์/ราคา)
const FREEFORM_PHONE_RE = /(?:เบอร์โทร|โทร\.?|T\.?|Tel\.?)?\s*:?\s*(?<!\d)(0[\d\s-]{8,10}\d)(?!\d)/i;
// คำที่บ่งชี้จุดเริ่มที่อยู่หน่วยงาน/ราชการ/ทหาร ซึ่งมักไม่มีตัวเลขนำหน้าเลย
const INSTITUTION_KEYWORD_RE = /(บ้านพัก|ค่ายทหาร|ค่าย|กรม|กองพล|กองร้อย|กองบิน|กอง(?!ทัพ)|สภ\.|สถานีตำรวจ|โรงพัก|ตชด\.|เรือนจำ|ทัณฑสถาน|มณฑลทหารบก|หน่วย|ป้อมตำรวจ|ฐานทัพ)/;

// ------------------------------------------------------------------------
// Order ID
// ------------------------------------------------------------------------
function nextOrderId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const id = `${y}${m}${d}-${String(orderSeqCounter).padStart(3, "0")}`;
  orderSeqCounter++;
  return id;
}

function applyStartSeq() {
  const val = parseInt(document.getElementById("startSeqInput").value, 10);
  orderSeqCounter = isNaN(val) || val < 1 ? 1 : val;
  updateStatus();
}

// ------------------------------------------------------------------------
// ตัวช่วยแยกชื่อคน / ชื่อร้าน
// ------------------------------------------------------------------------
function splitNameAndBusiness(line) {
  const match = line.match(BUSINESS_KEYWORD_RE);
  if (!match) return { personal: line, business: "" };
  const idx = match.index;
  return {
    personal: line.slice(0, idx).trim(),
    business: line.slice(idx).trim()
  };
}

function normalizePhoneDigits(rawPhone) {
  const digits = rawPhone.replace(/[^\d]/g, "");
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits;
}

// ตัดคำนำหน้าชื่อทุกแบบทิ้ง แล้วขึ้นต้นด้วย "คุณ" ให้เหมือนกันหมดทุกคน
const TITLE_RE = /^(นางสาว|นาย|นาง|น\.ส\.|ดร\.|นพ\.|พญ\.|ด\.ช\.|ด\.ญ\.|คุณหญิง|คุณ|Mrs\.?|Mr\.?|Miss\.?|Ms\.?|Dr\.?|K\.)\s*/i;

function normalizeNameTitle(name) {
  if (!name) return name;
  const stripped = name.replace(TITLE_RE, "").trim();
  return stripped ? `คุณ ${stripped}` : name;
}

// รวม logic แยกชื่อคน/ชื่อร้าน + ทำให้ชื่อคนขึ้นต้นด้วย "คุณ" เสมอ
function resolveNameAndBusiness(rawLine) {
  const split = splitNameAndBusiness(rawLine);
  if (split.personal) {
    return { name: normalizeNameTitle(split.personal), business: split.business };
  }
  return { name: split.business, business: "" };
}

// ------------------------------------------------------------------------
// โหมด A: ข้อมูลลูกค้าพิมพ์แยกบรรทัดชัดเจน (ชื่อ / เบอร์ / ที่อยู่ / [โน้ต])
// ------------------------------------------------------------------------
function parseCustomerData(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l);

  let name = "";
  let business = "";
  let phone = "";
  let note = "";
  const address = [];

  lines.forEach(line => {
    const phoneMatch = line.match(PHONE_RE);
    if (phoneMatch && (line.replace(/[^0-9]/g, "").length >= 9)) {
      phone = phoneMatch[0];
      const rest = line.replace(PHONE_RE, "").replace(/โทร\.?:?/gi, "").trim();
      if (rest && !name) {
        const resolved = resolveNameAndBusiness(rest);
        name = resolved.name;
        business = resolved.business;
      }
    } else if (line.includes("[") && line.includes("]")) {
      note = line.replace(/^\[|\]$/g, "");
    } else if (!name) {
      const resolved = resolveNameAndBusiness(line);
      name = resolved.name;
      business = resolved.business;
    } else {
      address.push(line);
    }
  });

  return { name, business, phone, note: note ? `[${note}]` : "", address };
}

// ------------------------------------------------------------------------
// โหมด B: ข้อความก้อนเดียว ไม่มีขึ้นบรรทัดใหม่เลย (ชื่อ+ที่อยู่+เบอร์+โน้ตปนกัน)
// ------------------------------------------------------------------------
function parseShippingBlob(raw) {
  let working = raw.replace(/\s+/g, " ").trim();

  // ดึงโน้ตที่มี [ ] อยู่แล้วออกก่อน กันซ้อนวงเล็บ
  let bracketNote = "";
  const bracketMatch = working.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    bracketNote = bracketMatch[1].trim();
    working = (
      working.slice(0, bracketMatch.index) + " " +
      working.slice(bracketMatch.index + bracketMatch[0].length)
    ).replace(/\s+/g, " ").trim();
  }

  // ดึงเบอร์โทร (ไม่ว่าจะอยู่ตรงไหนของประโยค)
  let phone = "";
  const phoneMatch = working.match(FREEFORM_PHONE_RE);
  if (phoneMatch) {
    phone = normalizePhoneDigits(phoneMatch[1]);
    working = (
      working.slice(0, phoneMatch.index) + " " +
      working.slice(phoneMatch.index + phoneMatch[0].length)
    ).replace(/\s+/g, " ").trim();
  }

  // หาตำแหน่งตัดชื่อ โดยมองหาคำที่บ่งบอกถึง "ที่อยู่" ชัดเจน (เช่น บ้านเลขที่, เลขที่, หมู่ ฯลฯ)
  let nameEndIdx = -1;
  const addressStartRegex = /(?:มบ\.?|เดอะ|The|โครงการ|หมู่บ้าน|บ้านพัก|คอนโด(?:มิเนียม)?|อาคาร|ตึก|เลขที่|บ้านเลขที่|หมู่ที่|หมู่\s+|\b\d{1,3}\/\d+|\b\d{1,4}\s+(?:ซอย|ถนน|หมู่|ต\.|อ\.|จ\.))/i;
  const matchAddrStart = working.search(addressStartRegex);

  if (matchAddrStart !== -1) {
    nameEndIdx = matchAddrStart;
  } else {
    // ถ้าไม่เจอคำชัดเจน ค่อยใช้ตัวเลขตัวแรกตามเดิม
    nameEndIdx = working.search(/\d/);
  }

  // เช็คเรื่องหน่วยงานราชการ/ทหารเพิ่มเติม
  const instMatch = working.match(INSTITUTION_KEYWORD_RE);
  if (instMatch && instMatch.index > 0 && (nameEndIdx === -1 || instMatch.index < nameEndIdx)) {
    nameEndIdx = instMatch.index;
  }

  let nameRaw = working;
  let rest = "";
  if (nameEndIdx > 0) {
    nameRaw = working.slice(0, nameEndIdx).trim().replace(/,\s*$/, "");
    rest = working.slice(nameEndIdx).trim();
  } else if (nameEndIdx === 0) {
    nameRaw = "";
    rest = working;
  }

  const resolved = resolveNameAndBusiness(nameRaw);
  const name = resolved.name;
  const business = resolved.business;

  // ที่อยู่ตัดจบตรงรหัสไปรษณีย์ (เลข 5 หลัก) ส่วนที่เหลือถือเป็นโน้ต
  let address = rest;
  let noteFromTail = "";
  const zipMatch = rest.match(/^(.*?\b\d{5}\b)([\s\S]*)$/);
  if (zipMatch) {
    address = zipMatch[1].trim().replace(/,\s*$/, "");
    noteFromTail = zipMatch[2].trim();
  }
  noteFromTail = noteFromTail.replace(/^(?:ค่ะ|ค่า+|คะ|ครับ)+[\s,]*/, "").trim();

  const note = bracketNote || noteFromTail;

  return {
    name,
    business,
    phone,
    note: note ? `[${note}]` : "",
    address: address ? [address] : []
  };
}

// ------------------------------------------------------------------------
// โหมด C: ก้อนข้อความรวมหลายออเดอร์ คั่นด้วยเส้นประ
// ------------------------------------------------------------------------
function extractShippingBlob(block) {
  let idx = block.search(/ที่อยู่/);
  if (idx !== -1) return block.slice(idx + "ที่อยู่".length).trim();

  idx = block.search(/ชื่อ\s/);
  if (idx !== -1) return block.slice(idx + "ชื่อ".length).trim();

  const ttMatch = block.match(/ตต\s*(\S+)/);
  if (ttMatch) {
    const cutIdx = ttMatch.index + ttMatch[0].length;
    return block.slice(cutIdx).trim();
  }

  const totalMatches = [...block.matchAll(/รวม(?:ทั้งหมด|ท้ั้งหมด)?[\d\s+=,.]*/g)];
  if (totalMatches.length) {
    const last = totalMatches[totalMatches.length - 1];
    return block.slice(last.index + last[0].length).trim();
  }

  return block;
}

function parseBulkOrders(raw) {
  const blocks = raw.split(/[-–—_]{2,}/g).map(b => b.trim()).filter(b => b);
  return blocks.map(block => parseShippingBlob(extractShippingBlob(block)));
}

// ------------------------------------------------------------------------
// ขั้นตอนตรวจสอบ/แก้ไขก่อนสร้างป้ายจริง
// ------------------------------------------------------------------------
function renderReviewPanel() {
  const panel = document.getElementById("reviewPanel");

  if (pendingReview.length === 0) {
    panel.innerHTML = "";
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  panel.innerHTML = `
    <h4>🔍 ตรวจสอบก่อนสร้างป้าย (${pendingReview.length} รายการ)</h4>
    <p class="hint">ระบบแยกข้อมูลให้อัตโนมัติ แต่ถ้าคนพิมพ์ใช้แท็ก/คำย่อแปลก ๆ อาจแยกพลาดได้ กรุณาตรวจทุกช่องก่อนกด "ยืนยันและสร้างป้าย"</p>
    ${pendingReview.map((item, i) => `
      <div class="review-item">
        <div class="review-item-head">
          <b>รายการที่ ${i + 1}</b>
          <button class="danger small" onclick="removeReviewItem(${i})">✕ ลบรายการนี้</button>
        </div>
        <label>ชื่อผู้รับ</label>
        <input type="text" data-idx="${i}" data-field="name" value="${escapeAttr(item.name)}">
        <label>ชื่อร้าน/บริษัท (ถ้ามี)</label>
        <input type="text" data-idx="${i}" data-field="business" value="${escapeAttr(item.business)}">
        <label>เบอร์โทร</label>
        <input type="text" data-idx="${i}" data-field="phone" value="${escapeAttr(item.phone)}">
        <label>ที่อยู่</label>
        <textarea data-idx="${i}" data-field="address" rows="2">${escapeAttr(item.address.join("\n"))}</textarea>
        <label>โน้ต (ถ้ามี ไม่ต้องใส่ [ ] เอง ระบบใส่ให้)</label>
        <input type="text" data-idx="${i}" data-field="note" value="${escapeAttr(item.note.replace(/^\[|\]$/g, ""))}">
      </div>
    `).join("")}
    <button onclick="confirmReview()">✅ ยืนยันและสร้างป้ายทั้งหมด</button>
    <button class="secondary" onclick="cancelReview()">❌ ยกเลิกทั้งหมด</button>
  `;
}

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function removeReviewItem(idx) {
  pendingReview.splice(idx, 1);
  renderReviewPanel();
}

function confirmReview() {
  document.querySelectorAll("#reviewPanel [data-field]").forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const field = el.dataset.field;
    if (!pendingReview[idx]) return;
    if (field === "address") {
      pendingReview[idx].address = el.value.split("\n").map(l => l.trim()).filter(l => l);
    } else if (field === "note") {
      pendingReview[idx].note = el.value.trim() ? `[${el.value.trim()}]` : "";
    } else if (field === "name") {
      pendingReview[idx].name = normalizeNameTitle(el.value.trim());
    } else {
      pendingReview[idx][field] = el.value.trim();
    }
  });

  pendingReview.forEach(data => orderList.push({ id: nextOrderId(), data }));
  pendingReview = [];
  renderReviewPanel();
  renderAllPages();
}

function cancelReview() {
  if (!confirm("ยกเลิกรายการที่แยกไว้ทั้งหมดหรือไม่? (ยังไม่ได้สร้างป้าย)")) return;
  pendingReview = [];
  renderReviewPanel();
}

// ------------------------------------------------------------------------
// Render
// ------------------------------------------------------------------------
function buildReceiverInnerHTML(data) {
  const phoneText = data.phone ? "โทร. " + data.phone : "";
  return `
    <div class="line1">
      <span class="rlabel">กรุณาส่ง</span>
      <span class="namephone">${data.name}${phoneText ? " " + phoneText : ""}</span>
    </div>
    ${data.business ? `<div class="business">${data.business}</div>` : ""}
    <div class="address">${data.address.join("<br>")}</div>
    ${data.note ? `<div class="note">${data.note}</div>` : ""}
  `;
}

function renderAllPages() {
  const container = document.getElementById("pagesContainer");
  container.innerHTML = "";

  if (orderList.length === 0) {
    updateStatus();
    return;
  }

  const senderHTML = buildSenderHTML();

  for (let i = 0; i < orderList.length; i += 3) {
    const pageItems = orderList.slice(i, i + 3);
    const page = document.createElement("div");
    page.className = "a4-page";

    pageItems.forEach(item => {
      const labelDiv = document.createElement("div");
      labelDiv.className = "label";
      labelDiv.innerHTML = `
        <div class="sender">${senderHTML}</div>
        <div class="order-meta">
          <div class="qr" id="qr-${item.id}"></div>
          <div class="order-id">${item.id}</div>
        </div>
        <div class="receiver">${buildReceiverInnerHTML(item.data)}</div>
      `;
      page.appendChild(labelDiv);
    });

    while (page.children.length < 3) {
      const empty = document.createElement("div");
      empty.className = "label empty";
      page.appendChild(empty);
    }

    container.appendChild(page);
  }

  orderList.forEach(item => {
    const qrEl = document.getElementById("qr-" + item.id);
    if (qrEl && window.QRCode) {
      qrEl.innerHTML = "";
      new QRCode(qrEl, {
        text: `${item.id}|${item.data.phone}`,
        width: 50,
        height: 50,
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  });

  updateStatus();
}

function updateStatus() {
  const pageCount = Math.ceil(orderList.length / 3) || 0;
  document.getElementById("status").innerText =
    orderList.length === 0
      ? "ยังไม่มีป้าย — เลขที่ออเดอร์ถัดไป: " + nextOrderIdPreview()
      : `ป้ายทั้งหมด: ${orderList.length} ใบ (${pageCount} หน้า A4) — เลขที่ออเดอร์ถัดไป: ${nextOrderIdPreview()}`;
}

function nextOrderIdPreview() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}-${String(orderSeqCounter).padStart(3, "0")}`;
}

// ------------------------------------------------------------------------
// UI actions
// ------------------------------------------------------------------------
function addSingleOrder() {
  const input = document.getElementById("rawInput");
  const raw = input.value.trim();
  if (!raw) {
    alert("กรุณากรอกข้อมูลลูกค้าก่อนครับ");
    return;
  }

  const lineCount = raw.split("\n").map(l => l.trim()).filter(l => l).length;
  const data = lineCount <= 1 ? parseShippingBlob(raw) : parseCustomerData(raw);

  orderList.push({ id: nextOrderId(), data });
  input.value = "";
  input.focus();
  renderAllPages();
}

function addBulkOrders() {
  const input = document.getElementById("bulkInput");
  const raw = input.value.trim();
  if (!raw) {
    alert("กรุณาวางข้อมูลออเดอร์ก่อนครับ");
    return;
  }

  const dataList = parseBulkOrders(raw);
  if (dataList.length === 0) {
    alert("แยกออเดอร์ไม่เจอเลยครับ ลองเช็คว่ามีเส้นคั่น (----) ระหว่างแต่ละออเดอร์ไหม");
    return;
  }

  pendingReview = pendingReview.concat(dataList);
  input.value = "";
  renderReviewPanel();
  document.getElementById("reviewPanel").scrollIntoView({ behavior: "smooth" });
}

function resetAll() {
  if ((orderList.length || pendingReview.length) && !confirm("ล้างป้ายและรายการที่รอตรวจสอบทั้งหมดหรือไม่?")) return;
  orderList = [];
  pendingReview = [];
  renderReviewPanel();
  renderAllPages();
}

window.addEventListener("DOMContentLoaded", () => {
  updateStatus();
  renderReviewPanel();
});
