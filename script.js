// ========================================================================
// ระบบพิมพ์ใบปะหน้าพัสดุ — รองรับวางออเดอร์หลายรายการพร้อมกัน + Order ID/QR
// ฉบับรวมแก้ทั้งหมด (v4) — ดูรายการ "FIX" ด้านล่าง
//
// แก้จากรอบก่อน (ตัวเลขอ้างอิงตรงกับคอมเมนต์ "FIX:" ในโค้ด)
//  #1  "วิน" นับเป็นบรรทัดค่าส่ง (+ ส่งฟรี / ค่าส่ง / Grab / Lalamove ...)
//  #2  เบอร์ในวงเล็บกลม ( ) — วนทุกคู่วงเล็บ ไม่ใช่แค่คู่แรก
//  #3  คำนำหน้าเบอร์: เบอร์ / โทร / โทรศัพท์ / มือถือ / T. / Tel. / +66
//  #4  วงเล็บ [ ] = โน้ต, ( ) = เอาออกเฉพาะที่เป็นเบอร์จริง
//  #5  "มบ" (สมบูรณ์) / "The" (Matthew) / "ตต" (ปัตตานี) / TITLE (Drew) ไม่โดนตัดกลางคำอีก
//  #6  parseCustomerData ไม่ทิ้งชื่อเมื่อเบอร์อยู่บรรทัดเดียวกัน
//  #7  "รวม" ไม่กินเลขบ้านบรรทัดถัดไป / ไม่ตัดที่อยู่ที่มีคำว่า รวมใจ
//  #8  ล้าง ":" หน้าข้อมูล, รับ "ที่อยุ่" (พิมพ์ผิด), รับ "ชื่อ ... ที่อยู่ ..."
//  #9  หน้า Review ไม่ทำค่าที่แก้ไว้หาย (syncReviewFromDOM)
//  #10 บรรทัด "xxx ส่งที่" ไม่ใช่ชื่อ / "ส่ง <สถานที่>" เป็นจุดเริ่มที่อยู่
//  #11 ที่อยู่แบบ Google Maps (ตำบล/อำเภอ/แขวง/เขต + รหัสไปรษณีย์กลางประโยค)
//  #12 ข้ามก้อนที่ไม่ใช่ออเดอร์ (ไม่มีทั้งเบอร์และที่อยู่) แล้วแจ้งผู้ใช้
//  #13 ชื่อร้านภาษาอังกฤษ/ชื่อคอนโดที่ไม่มีคำว่า "ร้าน" แยกเป็น business
//  #14 เลข Order ID เก็บใน localStorage + รีเซ็ตข้ามวัน
//  #15 escape HTML, โน้ตไม่หาย, เบอร์บ้าน 9 หลัก ฯลฯ
//  #16 รูปแบบ "ที่อยู่ก่อน ชื่อทีหลัง" (ชื่อคนอยู่หลังรหัสไปรษณีย์) + หอพัก/อพาร์ทเม้นท์ = ที่อยู่
//  #17 จำนวนป้ายต่อหน้าตั้งได้ที่ LABELS_PER_PAGE (ตอนนี้ 4 ป้าย/หน้า)
// ========================================================================

let orderList = [];      // { id, data } ทั้งหมดที่จะพิมพ์
let orderSeqCounter = 1; // เลขลำดับถัดไปของ "วันนี้"
let orderSeqDate = "";   // วันที่ของ orderSeqCounter (YYYYMMDD)
let pendingReview = [];  // { data } ที่แยกแล้วแต่ยังไม่ยืนยัน

// ตั้งเป็น false ถ้าอยากให้ชื่อเล่นในวงเล็บท้ายชื่อ เช่น "ธนพร แก่นกอ (เตย)" ขึ้นบนป้ายด้วย
const STRIP_NAME_NICKNAME = false;

// FIX (#17): จำนวนป้ายต่อหน้า A4 (CSS ของ .label ต้องสอดคล้อง: 4 ป้าย = height 25%, 3 ป้าย = 33.33%)
const LABELS_PER_PAGE = 3;

// ------------------------------------------------------------------------
// Regex กลาง
// ------------------------------------------------------------------------

// เบอร์โทรไทย: มือถือ 0xx-xxx-xxxx (10 หลัก) / เบอร์บ้าน 0x-xxx-xxxx (9 หลัก)
// FIX (#15): เดิมใช้ [\d\s-]{8,10} ซึ่งยอมให้ช่องว่างอยู่กลางเบอร์ จึงอาจกินเลขที่ตามหลังเข้าไป
//            ตอนนี้บังคับโครงสร้างเบอร์จริง ๆ
const PHONE_CORE = "0\\d{1,2}[\\s-]?\\d{3}[\\s-]?\\d{3,4}";
// FIX (#3): เบอร์โทรศัพท์ / เบอร์โทร / เบอร์ / โทรศัพท์ / โทร / มือถือ / T. / Tel.
// (T/Tel ต้องไม่ติดหลังตัวอักษรอังกฤษ ไม่งั้น "Matt 0812..." จะโดนกิน t ท้ายชื่อ)
const PHONE_PREFIX =
  "(?:เบอร์โทรศัพท์|เบอร์โทร|เบอร์|โทรศัพท์|โทร\\.?|มือถือ|(?<![A-Za-z])(?:Tel|T)\\.?)";
const FREEFORM_PHONE_RE = new RegExp(
  `(?:${PHONE_PREFIX})?\\s*:?\\s*(?<!\\d)(${PHONE_CORE})(?!\\d)`, "i"
);
const PHONE_ONLY_RE = new RegExp(`^(?:${PHONE_PREFIX})?\\s*:?\\s*${PHONE_CORE}$`, "i");

// คำที่บ่งชี้ว่าเป็นชื่อธุรกิจ/ร้านค้า
const BUSINESS_KEYWORD_RE = /(ร้าน|บริษัท|ห้างหุ้นส่วน|หจก\.?|บจก\.?)/;

// FIX (#13): ชื่อสถานที่/ร้านที่ไม่มีคำว่า "ร้าน"
const ENGLISH_VENUE_RE =
  /(mansion|condo|apartment|house|home|place|residence|tower|park|village|hotel|resort|shop|store|cafe|coffee|studio|bar|office|building|clinic|co\.|ltd|company)/i;
const THAI_VENUE_RE =
  /(แอนด์|เฮ้าท์|เฮ้าส์|เฮาส์|คอนโด|แมนชั่น|อพาร์ท|ออฟฟิศ|สตูดิโอ|คาเฟ่|ฟาร์ม|สปา|ซาลอน|คลินิก|เพลส|เรสซิเดนซ์|พาร์ค|วิลล่า|รีสอร์ท|โฮสเทล|โฮม)/;

// FIX (#15): หน่วยงาน — ต้องขึ้นต้นคำ (หลังช่องว่าง) และไม่ใช้ "กอง"/"กรม" ลอย ๆ
//            กันนามสกุลอย่าง กองทอง กองแก้ว กรมสุข
const INSTITUTION_KEYWORD_RE = new RegExp(
  "(?<=^|\\s)(?:" + [
    "บ้านพัก", "มหาวิทยาลัย", "วิทยาลัย", "สถาบัน", "โรงเรียน", "ค่ายทหาร", "ค่าย(?=\\s)",
    "กรม(?:ทหาร|ตำรวจ|ทางหลวง|ที่ดิน|ศุลกากร|สรรพากร|ธนารักษ์|ราชทัณฑ์|การปกครอง)",
    "กองพล", "กองร้อย", "กองพัน", "กองบิน", "กองบัญชาการ", "กองกำลัง",
    "สภ\\.", "สถานีตำรวจ", "โรงพัก", "ตชด\\.", "เรือนจำ", "ทัณฑสถาน",
    "มณฑลทหารบก", "หน่วย", "ป้อมตำรวจ", "ฐานทัพ"
  ].join("|") + ")"
);

// จุดเริ่มของที่อยู่ (ตำแหน่งแรกที่เจอ = ตัดชื่อตรงนั้น)
// FIX (#5): "มบ." ต้องมีจุดและห้ามมีอักษรไทยนำหน้า (สมบูรณ์/สมบัติ ไม่โดน)
// FIX (#5): "The" ต้องเป็นคำเต็ม (Matthew/Catherine ไม่โดน)
// FIX (#11): เพิ่ม ตำบล/อำเภอ/แขวง/เขต/จังหวัด เมื่อขึ้นต้นคำ
// FIX (#10): "ส่ง" ที่มีช่องว่างล้อม = ส่ง <สถานที่> เช่น "ส่ง Mr.bag ..."
// FIX (#15): เลขบ้านติดกับ หมู่/ม. ได้ เช่น "309หมู่10"
const ADDRESS_START_RE = new RegExp([
  "(?<![ก-๙])มบ\\.",
  "(?<![A-Za-z])The(?![A-Za-z])",
  "เดอะ",
  "โครงการ", "หมู่บ้าน", "บ้านพัก",
  "หอพัก", "อพาร์ท(?:เม้นท์|เมนต์|เมนท์)", "แมนชั่น", "โรงแรม", "รีสอร์ท",
  "คอนโด(?:มิเนียม)?", "อาคาร", "ตึก",
  "บ้านเลขที่", "เลขที่", "หมู่ที่", "หมู่\\s+",
  "\\b\\d{1,3}\\/\\d+",
  "\\b\\d{1,4}\\s*(?:ซอย|ถนน|หมู่|ม\\.|ต\\.|อ\\.|จ\\.)",
  "(?<=^|\\s)(?:ตำบล|อำเภอ|แขวง|เขต|จังหวัด)",
  "(?<=\\s)ส่ง(?=\\s)"
].join("|"), "i");

// บรรทัดค่าส่ง — ใช้ตัดรายการสินค้าทิ้ง
// FIX (#1): วิน / FIX (#15): ส่งฟรี, ค่าส่ง, Grab, Lalamove, Bolt, Line man
// ตัวเลขต้องไม่ตามด้วย "/" เพื่อไม่ชนที่อยู่ที่ขึ้นต้นว่า "ส่ง 123/4 ..."
const SHIPPING_FEE_LINE_RE =
  /^[ \t]*(?:ค่าส่ง|ส่ง|วิน|Grab|Lalamove|Bolt|Line\s*man|ไลน์แมน)[ \t]*(?:ฟรี|\d+(?![\d/])).*$/im;

// คำนำหน้าชื่อ — ตัดทิ้งแล้วเติม "คุณ" ให้เหมือนกันหมด
// FIX (#5): คำนำหน้าไทยห้ามตามด้วยสระ/วรรณยุกต์ (คุณากร, คุณาพร ไม่โดนตัด)
//           คำอังกฤษต้องตามด้วยจุดหรือช่องว่าง (Drew, Mrinal ไม่โดนตัด)
const THAI_NON_LEADING = "(?![ะัาำิีึืฺุู็่้๊๋์ํ])";
const TITLE_RE = new RegExp(
  "^(?:" +
    "(?:นางสาว|นาย|นาง|คุณหญิง|คุณ)" + THAI_NON_LEADING + "|" +
    "น\\.ส\\.|ดร\\.|นพ\\.|พญ\\.|ด\\.ช\\.|ด\\.ญ\\.|" +
    "(?:กรุณาจัดส่ง|จัดส่ง|ส่ง)(?=\\s|คุณ)|" +
    "(?:Mrs|Mr|Miss|Ms|Dr)(?:\\.\\s*|\\s+)|K\\.\\s*" +
  ")\\s*", "i"
);

// FIX (#16): รูปแบบ "ที่อยู่ก่อน ชื่อทีหลัง" เช่น
//   "หอพักสตรี ... 44150 นางสาวณัฐนรี จิตไพศาล 0932425144"
//   ข้อความหลังรหัสไปรษณีย์ที่เป็นชื่อคน ต้องเป็นชื่อ ไม่ใช่โน้ต
const NAME_TITLE_RE = new RegExp(
  "^(?:(?:นางสาว|นาย|นาง|คุณหญิง|คุณ)" + THAI_NON_LEADING +
  "|น\\.ส\\.|ดร\\.|นพ\\.|พญ\\.|ด\\.ช\\.|ด\\.ญ\\.|(?:Mrs|Mr|Miss|Ms|Dr)(?:\\.\\s*|\\s+)|K\\.\\s*)", "i"
);
const NOTE_HINT_RE = /(ฝาก|โทร|ก่อน|ถึง|ด้วย|รบกวน|ห้าม|หน้า|หลัง|ตรง|ค่ะ|ครับ|คะ|ที่|ถ้า|ไม่|ให้|ส่ง)/;

function looksLikeNameTail(tail, nameRaw) {
  const t = String(tail || "").trim();
  if (!t || /\d/.test(t) || /[\[\](){}]/.test(t)) return false;
  const tokens = t.split(/\s+/);
  // มีคำนำหน้าชื่อ (นางสาว/นาย/คุณ ...) และช่วงหน้าไม่ใช่ชื่อที่มีคำนำหน้าอยู่แล้ว
  if (NAME_TITLE_RE.test(t)) return tokens.length <= 5 && !NAME_TITLE_RE.test(nameRaw || "");
  // ไม่มีคำนำหน้า: ใช้ต่อเมื่อช่วงหน้าไม่มีชื่อเลย และข้อความสั้นไม่เหมือนโน้ต
  return !nameRaw && tokens.length <= 3 && !NOTE_HINT_RE.test(t);
}

// ------------------------------------------------------------------------
// Order ID  (FIX #14: เก็บใน localStorage + รีเซ็ตข้ามวันอัตโนมัติ)
// ------------------------------------------------------------------------
const SEQ_STORAGE_KEY = "labelSystem.seq";

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function loadSeq() {
  orderSeqDate = todayStr();
  orderSeqCounter = 1;
  try {
    if (typeof localStorage === "undefined") return;
    const s = JSON.parse(localStorage.getItem(SEQ_STORAGE_KEY) || "null");
    if (s && s.date === orderSeqDate && s.seq >= 1) orderSeqCounter = s.seq;
  } catch (e) { /* ใช้ค่าเริ่มต้น */ }
}

function saveSeq() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SEQ_STORAGE_KEY, JSON.stringify({ date: orderSeqDate, seq: orderSeqCounter }));
  } catch (e) { /* ไม่เป็นไร */ }
}

function ensureToday() {
  const t = todayStr();
  if (t !== orderSeqDate) { orderSeqDate = t; orderSeqCounter = 1; saveSeq(); }
}

function nextOrderId() {
  ensureToday();
  const id = `${orderSeqDate}-${String(orderSeqCounter).padStart(3, "0")}`;
  orderSeqCounter++;
  saveSeq();
  return id;
}

function nextOrderIdPreview() {
  ensureToday();
  return `${orderSeqDate}-${String(orderSeqCounter).padStart(3, "0")}`;
}

function applyStartSeq() {
  const val = parseInt(document.getElementById("startSeqInput").value, 10);
  ensureToday();
  orderSeqCounter = isNaN(val) || val < 1 ? 1 : val;
  saveSeq();
  updateStatus();
}

// ------------------------------------------------------------------------
// ตัวช่วยทั่วไป
// ------------------------------------------------------------------------
function escapeHTML(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const escapeAttr = escapeHTML;

// FIX (#15): รองรับเบอร์บ้าน 9 หลัก (02-xxx-xxxx)
function normalizePhoneDigits(rawPhone) {
  const d = rawPhone.replace(/[^\d]/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

// FIX (#15): ต้องเป็น "เบอร์ล้วน ๆ" เท่านั้น — ถ้ามีข้อความอื่นปน (ฝากไว้ 081-...) ถือเป็นโน้ต
function looksLikePhoneNumber(text) {
  return PHONE_ONLY_RE.test(String(text).trim());
}

// FIX (#5): ตัดคำนำหน้าซ้ำจนไม่เจอ ("กรุณาจัดส่ง คุณสมชาย" -> "สมชาย")
function normalizeNameTitle(name) {
  if (!name) return name;
  let s = name.trim(), prev;
  do { prev = s; s = s.replace(TITLE_RE, "").trim(); } while (s !== prev && s);
  return s ? `คุณ ${s}` : name;
}

// FIX (#13): แยกชื่อสถานที่ภาษาอังกฤษ/ชื่อร้านที่ไม่มีคำว่า "ร้าน"
function splitVenueName(text) {
  // "นะโม walkin mansion" -> นะโม | walkin mansion
  let m = text.match(/^([ก-๙]+)\s+([A-Za-z][A-Za-z0-9 .&'\-]*)$/);
  if (m && ENGLISH_VENUE_RE.test(m[2])) return { personal: m[1], business: m[2].trim() };
  // "Butter บัวแอนด์บอลเฮ้าท์" -> Butter | บัวแอนด์บอลเฮ้าท์
  m = text.match(/^([A-Za-z][A-Za-z.\-]*)\s+([ก-๙][ก-๙A-Za-z0-9&.\-]*)$/);
  if (m && !/^(?:Mr|Mrs|Miss|Ms|Dr|K)\.?$/i.test(m[1]) && THAI_VENUE_RE.test(m[2])) {
    return { personal: m[1], business: m[2] };
  }
  return null;
}

function splitNameAndBusiness(line) {
  const match = line.match(BUSINESS_KEYWORD_RE);
  if (match) {
    return { personal: line.slice(0, match.index).trim(), business: line.slice(match.index).trim() };
  }
  const venue = splitVenueName(line);
  if (venue) return venue;
  return { personal: line, business: "" };
}

function resolveNameAndBusiness(rawLine) {
  const line = String(rawLine || "").trim().replace(/[,\s]+$/, "");
  const split = splitNameAndBusiness(line);
  let personal = split.personal;
  if (STRIP_NAME_NICKNAME) {
    const stripped = personal.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (stripped) personal = stripped;
  }
  if (personal) return { name: normalizeNameTitle(personal), business: split.business };
  return { name: split.business, business: "" };
}

// FIX (#10): ลบป้าย "xxx ส่งที่" / "ส่งที่:" ที่ไม่ใช่ชื่อ
function stripLabels(s) {
  return String(s || "")
    .replace(/^[^\n]*ส่ง(?:ไป)?ที่[ \t:]*$/gm, "")
    .replace(/ส่ง(?:ไป)?ที่[ \t]*:?[ \t]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------------
// โหมด A: ข้อมูลลูกค้าพิมพ์แยกบรรทัด (ชื่อ / เบอร์ / ที่อยู่ / [โน้ต])
// ------------------------------------------------------------------------
function parseCustomerData(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l);

  let name = "", business = "", phone = "";
  const notes = [];
  const address = [];

  lines.forEach(rawLine => {
    let line = rawLine.replace(/^(?:ชื่อ(?:ผู้รับ)?|ที่อย[ุู]่)\s*:?\s*/, "");

    // [ ] = โน้ต (ดึงออกก่อน ส่วนที่เหลือของบรรทัดประมวลผลต่อ)
    line = line.replace(/\[([^\]]*)\]/g, (m, inner) => {
      const t = inner.trim();
      if (t) {
        if (!phone && looksLikePhoneNumber(t)) phone = normalizePhoneDigits(t);
        else notes.push(t);
      }
      return " ";
    });

    // FIX (#6): ดึงเบอร์ออกจากบรรทัด แล้วใช้ส่วนที่เหลือเป็นชื่อ/ที่อยู่ ไม่ทิ้งทั้งบรรทัด
    const pm = line.match(FREEFORM_PHONE_RE);
    if (pm) {
      if (!phone) phone = normalizePhoneDigits(pm[1]);
      line = line.slice(0, pm.index) + " " + line.slice(pm.index + pm[0].length);
    }
    line = line.replace(/\s+/g, " ").trim();
    if (!line) return;

    const looksLikeAddress = /^\d/.test(line) || line.search(ADDRESS_START_RE) === 0;
    if (!name && !looksLikeAddress) {
      const r = resolveNameAndBusiness(line);
      name = r.name;
      business = r.business;
      return;
    }
    address.push(line);
  });

  const note = notes.join(" / ");
  return { name, business, phone, note: note ? `[${note}]` : "", address };
}

// ------------------------------------------------------------------------
// โหมด B: ข้อความก้อนเดียว (ชื่อ+ที่อยู่+เบอร์+โน้ตปนกัน)
// ------------------------------------------------------------------------
function parseShippingBlob(raw) {
  // FIX (#8): ล้าง ":" / ช่องว่างหน้าข้อมูล (เหลือจากการตัดป้าย "ที่อยู่:" ฯลฯ)
  let working = String(raw || "").replace(/\s+/g, " ").trim().replace(/^[\s:：]+/, "");
  // FIX (#3): +66 81 234 5678 -> 081 234 5678
  working = working.replace(/(?<!\d)\+66[\s-]*\(?0?\)?[\s-]*(?=[1-9])/g, "0");

  let phone = "";
  const notes = [];

  // 4a) [ ] = ช่องโน้ต วนทุกคู่ (ถ้าข้างในเป็นเบอร์ล้วน ๆ ถือเป็นเบอร์)
  working = working.replace(/\[([^\]]*)\]/g, (m, inner) => {
    const t = inner.trim();
    if (t) {
      if (!phone && looksLikePhoneNumber(t)) phone = normalizePhoneDigits(t);
      else notes.push(t);
    }
    return " ";
  });

  // 4b) ( ) = เอาออกเฉพาะที่เป็นเบอร์จริง — FIX (#2): วนทุกคู่ ไม่ใช่แค่คู่แรก
  working = working.replace(/\(([^()]*)\)/g, (m, inner) => {
    if (!phone && looksLikePhoneNumber(inner)) {
      phone = normalizePhoneDigits(inner);
      return " ";
    }
    return m; // เช่น (CEO) (เตย) ปล่อยไว้
  });
  working = working.replace(/\s+/g, " ").trim();

  // เบอร์ที่เขียนอิสระ (มีหรือไม่มีคำนำหน้า)
  if (!phone) {
    const pm = working.match(FREEFORM_PHONE_RE);
    if (pm) {
      phone = normalizePhoneDigits(pm[1]);
      working = (working.slice(0, pm.index) + " " + working.slice(pm.index + pm[0].length))
        .replace(/\s+/g, " ").trim();
    }
  }

  // หาตำแหน่งตัดชื่อ
  let nameEndIdx = working.search(ADDRESS_START_RE);
  if (nameEndIdx === -1) nameEndIdx = working.search(/\d/);

  const inst = working.match(INSTITUTION_KEYWORD_RE);
  if (inst && inst.index > 0 && (nameEndIdx === -1 || inst.index < nameEndIdx)) {
    nameEndIdx = inst.index;
  }

  let nameRaw = working, rest = "";
  if (nameEndIdx > 0) {
    nameRaw = working.slice(0, nameEndIdx).trim().replace(/,\s*$/, "");
    rest = working.slice(nameEndIdx).trim();
  } else if (nameEndIdx === 0) {
    nameRaw = "";
    rest = working;
  }

  // FIX (#10): "ส่ง Mr.bag ..." ตัดคำว่า ส่ง นำหน้าที่อยู่ทิ้ง
  rest = rest.replace(/^ส่ง\s+/, "");

  // ที่อยู่ตัดจบที่รหัสไปรษณีย์ 5 หลัก ส่วนที่เหลือ = โน้ต
  // FIX (#11): ถ้าส่วนท้ายขึ้นต้นด้วย "," แปลว่ายังเป็นที่อยู่ (รูปแบบ Google Maps)
  let address = rest;
  let noteFromTail = "";
  const zipMatch = rest.match(/^(.*?(?<!\d)\d{5}(?!\d))([\s\S]*)$/);
  if (zipMatch) {
    const tail = zipMatch[2];
    if (/^\s*,/.test(tail)) {
      address = rest;
    } else {
      address = zipMatch[1].trim();
      noteFromTail = tail.trim();
    }
  }
  address = address.replace(/[,\s]+$/, "")
    .replace(/((?:แขวง|เขต|ตำบล|อำเภอ)\S+)\s+\1/g, "$1"); // ต้นฉบับพิมพ์ซ้ำ

  noteFromTail = noteFromTail
    .replace(/^(?:ค่ะ|ค่า+|คะ|ครับ)+[\s,]*/, "")
    .replace(/^\((.*)\)$/, "$1") // FIX (#15): ไม่ให้เป็น [( ... )]
    .trim();

  // FIX (#16): ถ้าส่วนท้ายคือชื่อคน ให้ใช้เป็นชื่อ และเอาส่วนหน้า (เช่น ชื่อหอพัก) ไปไว้ที่อยู่
  let nameSource = nameRaw;
  if (noteFromTail && looksLikeNameTail(noteFromTail, nameRaw)) {
    if (nameRaw) address = (nameRaw + " " + address).trim();
    nameSource = noteFromTail;
    noteFromTail = "";
  }
  if (noteFromTail) notes.push(noteFromTail);

  const { name, business } = resolveNameAndBusiness(nameSource);

  // FIX (#15): โน้ตจาก [ ] และจากท้ายข้อความ ต่อกัน ไม่ทิ้งอันใดอันหนึ่ง
  const note = notes.join(" / ");

  return {
    name, business, phone,
    note: note ? `[${note}]` : "",
    address: address ? [address] : []
  };
}

// ------------------------------------------------------------------------
// โหมด C: ก้อนข้อความรวมหลายออเดอร์ คั่นด้วยเส้นประ
// ------------------------------------------------------------------------
function extractShippingBlob(block) {
  // FIX (#8): รับ "ที่อยู่" และ "ที่อยุ่" (พิมพ์ผิดบ่อย) + ตัด ":" และรองรับ "ชื่อ ... ที่อยู่ ..."
  const addrLabel = block.match(/ที่อย[ุู]่\s*:?/);
  const nameLabel = block.match(/ชื่อ(?:ผู้รับ)?(?:\s*:\s*|\s+)/);

  if (addrLabel) {
    const after = block.slice(addrLabel.index + addrLabel[0].length);
    if (nameLabel && nameLabel.index < addrLabel.index) {
      const nameText = block.slice(nameLabel.index + nameLabel[0].length, addrLabel.index).trim();
      return (nameText + " " + after).trim();
    }
    return after.trim();
  }

  if (nameLabel) return block.slice(nameLabel.index + nameLabel[0].length).trim();

  // FIX (#5): "ตต" ต้องขึ้นต้นคำ (ปัตตานี, ภัตตาคาร ไม่โดน)
  const ttMatch = block.match(/(?:^|\s)ตต\s*(\S+)/);
  if (ttMatch) {
    return block.slice(ttMatch.index + ttMatch[0].length).trim();
  }

  // ตัดรายการสินค้าทิ้งด้วยบรรทัดค่าส่ง (ส่ง/วิน/ค่าส่ง/Grab/ส่งฟรี ...)
  const shipFeeMatch = block.match(SHIPPING_FEE_LINE_RE);
  if (shipFeeMatch) {
    return block.slice(shipFeeMatch.index + shipFeeMatch[0].length).trim();
  }

  // FIX (#7): "รวม" ต้องตามด้วยตัวเลขจริง และห้ามข้ามบรรทัด (ไม่กินเลขบ้านบรรทัดถัดไป,
  //           ไม่ชนคำว่า รวมใจ/รวมสุข)
  const totalRe =
    /รวม(?:ทั้งหมด|ท้ั้งหมด)?[ \t]*\d[\d,.]*(?:[ \t]*[+=][ \t]*\d[\d,.]*)*(?:[ \t]*(?:บาท|฿))?/g;
  const totalMatches = [...block.matchAll(totalRe)];
  if (totalMatches.length) {
    const last = totalMatches[totalMatches.length - 1];
    return block.slice(last.index + last[0].length).trim();
  }

  return block;
}

// FIX (#12): ข้ามก้อนที่ไม่ใช่ออเดอร์ (ไม่มีทั้งเบอร์และที่อยู่) แล้วบอกจำนวนที่ข้าม
function parseBulkOrdersDetailed(raw) {
  const blocks = raw.split(/[-–—_]{2,}/g).map(b => b.trim()).filter(b => b);
  const parsed = blocks.map(block => parseShippingBlob(stripLabels(extractShippingBlob(block))));
  const orders = parsed.filter(d => d.phone || d.address.length);
  return { orders, skipped: parsed.length - orders.length };
}

function parseBulkOrders(raw) {
  return parseBulkOrdersDetailed(raw).orders;
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

// FIX (#9): อ่านค่าที่ผู้ใช้แก้ในช่องกลับเข้า pendingReview ก่อน render ใหม่ทุกครั้ง
function syncReviewFromDOM() {
  if (typeof document === "undefined") return;
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
}

function removeReviewItem(idx) {
  syncReviewFromDOM();
  pendingReview.splice(idx, 1);
  renderReviewPanel();
}

function confirmReview() {
  syncReviewFromDOM();
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
// FIX (#15): escape ทุกช่องก่อนใส่ innerHTML (ชื่อ/ที่อยู่ที่มี < หรือ & ป้ายไม่พังแล้ว)
function buildReceiverInnerHTML(data) {
  const phoneText = data.phone ? "โทร. " + data.phone : "";
  return `
    <div class="line1">
      <span class="rlabel">กรุณาส่ง</span>
      <span class="namephone">${escapeHTML(data.name)}${phoneText ? " " + escapeHTML(phoneText) : ""}</span>
    </div>
    ${data.business ? `<div class="business">${escapeHTML(data.business)}</div>` : ""}
    <div class="address">${data.address.map(escapeHTML).join("<br>")}</div>
    ${data.note ? `<div class="note">${escapeHTML(data.note)}</div>` : ""}
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

  for (let i = 0; i < orderList.length; i += LABELS_PER_PAGE) {
    const pageItems = orderList.slice(i, i + LABELS_PER_PAGE);
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

    while (page.children.length < LABELS_PER_PAGE) {
      const empty = document.createElement("div");
      empty.className = "label empty";
      page.appendChild(empty);
    }

    container.appendChild(page);
  }

  // QR 50px ให้ตรงกับ CSS (.qr ล็อก 50px) + ใช้ error correction ระดับ L ให้โมดูลใหญ่ขึ้น สแกนง่ายขึ้น
  // ถ้าจะขยายเป็น 64px ต้องแก้ CSS ของ .order-meta .qr (3 จุด) ให้ตรงกันด้วย
  orderList.forEach(item => {
    const qrEl = document.getElementById("qr-" + item.id);
    if (qrEl && window.QRCode) {
      qrEl.innerHTML = "";
      new QRCode(qrEl, {
        text: `${item.id}|${item.data.phone}`,
        width: 50,
        height: 50,
        correctLevel: QRCode.CorrectLevel.L
      });
    }
  });

  updateStatus();
}

function updateStatus() {
  const pageCount = Math.ceil(orderList.length / LABELS_PER_PAGE) || 0;
  document.getElementById("status").innerText =
    orderList.length === 0
      ? "ยังไม่มีป้าย — เลขที่ออเดอร์ถัดไป: " + nextOrderIdPreview()
      : `ป้ายทั้งหมด: ${orderList.length} ใบ (${pageCount} หน้า A4) — เลขที่ออเดอร์ถัดไป: ${nextOrderIdPreview()}`;
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

  const { orders, skipped } = parseBulkOrdersDetailed(raw);
  if (orders.length === 0) {
    alert("แยกออเดอร์ไม่เจอเลยครับ ลองเช็คว่ามีเส้นคั่น (----) ระหว่างแต่ละออเดอร์ไหม");
    return;
  }

  syncReviewFromDOM(); // FIX (#9): เก็บค่าที่แก้ค้างไว้ก่อนเติมรายการใหม่
  pendingReview = pendingReview.concat(orders);
  input.value = "";
  renderReviewPanel();
  if (skipped > 0) alert(`ข้าม ${skipped} รายการที่ไม่มีทั้งเบอร์โทรและที่อยู่ (เช่น โน้ตที่ไม่ใช่ออเดอร์)`);
  document.getElementById("reviewPanel").scrollIntoView({ behavior: "smooth" });
}

function resetAll() {
  if ((orderList.length || pendingReview.length) && !confirm("ล้างป้ายและรายการที่รอตรวจสอบทั้งหมดหรือไม่?")) return;
  orderList = [];
  pendingReview = [];
  renderReviewPanel();
  renderAllPages();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    loadSeq();
    updateStatus();
    renderReviewPanel();
  });
}

// สำหรับรันเทสต์ใน Node (เบราว์เซอร์ไม่กระทบ)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseShippingBlob, parseCustomerData, parseBulkOrders, parseBulkOrdersDetailed,
    extractShippingBlob, stripLabels, normalizeNameTitle, normalizePhoneDigits,
    looksLikePhoneNumber, resolveNameAndBusiness
  };
}
