// ===== ข้อมูลผู้ส่ง (แก้ตรงนี้ที่เดียว มีผลกับทุกช่อง) =====
const SENDER_INFO = {
  name: "คุณแก้ม",
  phone: "099-4695163",
  addressLines: [
    "199/152 Centro ratchapruek2 ม.7",
    "ต.บางกร่าง อ.เมือง จ.นนทบุรี 11000"
  ]
};

function buildSenderHTML() {
  const addr = SENDER_INFO.addressLines.join("<br>");
  return `ผู้ส่ง : ${SENDER_INFO.name} ${SENDER_INFO.phone}<br>${addr}`;
}