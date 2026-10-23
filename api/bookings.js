// 예약 저장소 API
//   POST   (누구나)  예약 접수 → { tag, booking }      ※ 같은 사이트 화면에서만, IP 당 10분에 5건
//   GET    (관리자)  예약 목록
//   PATCH  (관리자)  { tags: [...], status } 상태 바꾸기 (배차 확정 등)
//   DELETE (관리자)  모든 예약 지우기
//   POST   (관리자)  { seed: true } 예시 예약 넣기
// 예약은 접수 후 30일이 지나면 저장소에서 저절로 지워진다(개인정보 보관 기간 최소화).

const crypto = require("crypto");
const { 명령, 쓸수있나, 저장소없음 } = require("./_store");
const { 같은출처, 본문, 너무많음 } = require("./_http");
const { 관리자인가 } = require("./_auth");
const { 예약검사, 상태목록, 요금, kst날짜, 오늘부터 } = require("./_rules");

const 보관초 = 30 * 86400;
const 목록키 = "hd:bookings";
const 예약키 = (tag) => `hd:b:${tag}`;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!쓸수있나()) return res.status(503).json({ error: "예약 저장소가 아직 연결되지 않았습니다." });
  try {
    if (req.method === "POST") return await 접수(req, res);
    if (!["GET", "PATCH", "DELETE"].includes(req.method)) return res.status(405).json({ error: "지원하지 않는 요청입니다." });
    if (!관리자인가(req)) return res.status(401).json({ error: "관리자 로그인이 필요합니다." });
    if (req.method !== "GET" && !같은출처(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
    if (req.method === "GET") return res.json({ bookings: await 목록() });
    if (req.method === "PATCH") return await 상태바꾸기(req, res);
    return await 모두지우기(res);
  } catch (e) {
    if (e instanceof 저장소없음) return res.status(503).json({ error: e.message });
    console.error("예약 API 오류", e.message);
    return res.status(500).json({ error: "저장소에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요." });
  }
};

async function 접수(req, res) {
  if (!같은출처(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  const b = 본문(req);

  if (b.seed) {
    if (!관리자인가(req)) return res.status(401).json({ error: "관리자 로그인이 필요합니다." });
    for (const 예시 of 예시예약()) await 저장(예시);
    return res.json({ ok: true, bookings: await 목록() });
  }

  if (await 너무많음("book", req, 5, 600)) return res.status(429).json({ error: "예약 요청이 너무 잦습니다. 10분 뒤에 다시 시도해 주세요." });
  const { 예약, 오류 } = 예약검사(b);
  if (오류) return res.status(400).json({ error: 오류 });
  const 저장됨 = await 저장(예약);
  return res.status(201).json({ tag: 저장됨.tag, booking: 저장됨 });
}

async function 저장(예약) {
  const 날 = kst날짜(new Date()).slice(2).replace(/-/g, "");
  const 번호 = await 명령(["INCR", `hd:seq:${날}`]);
  if (번호 === 1) await 명령(["EXPIRE", `hd:seq:${날}`, 2 * 86400]);
  const tag = `HD-${날}-${String(번호).padStart(4, "0")}`;
  const 기록 = { ...예약, tag, id: crypto.randomUUID(), status: "수거 대기", createdAt: new Date().toISOString() };
  await 명령(["SET", 예약키(tag), JSON.stringify(기록), "EX", 보관초]);
  await 명령(["SADD", 목록키, tag]);
  return 기록;
}

async function 목록() {
  const tags = await 명령(["SMEMBERS", 목록키]);
  if (!tags.length) return [];
  const 값들 = await 명령(["MGET", ...tags.map(예약키)]);
  const 지난것 = tags.filter((_, i) => !값들[i]);
  if (지난것.length) await 명령(["SREM", 목록키, ...지난것]); // 보관 기간이 지나 지워진 예약
  return 값들.filter(Boolean).map((v) => JSON.parse(v)).sort((a, b) => a.pickup.localeCompare(b.pickup));
}

async function 상태바꾸기(req, res) {
  const { tags, status } = 본문(req);
  if (!상태목록.includes(status) || !Array.isArray(tags) || !tags.length || tags.length > 200) {
    return res.status(400).json({ error: "바꿀 예약과 상태를 확인해 주세요." });
  }
  for (const tag of tags) {
    if (!/^HD-\d{6}-\d{4}$/.test(String(tag))) continue;
    const 값 = await 명령(["GET", 예약키(tag)]);
    if (!값) continue;
    await 명령(["SET", 예약키(tag), JSON.stringify({ ...JSON.parse(값), status, updatedAt: new Date().toISOString() }), "EX", 보관초]);
  }
  return res.json({ bookings: await 목록() });
}

async function 모두지우기(res) {
  const tags = await 명령(["SMEMBERS", 목록키]);
  if (tags.length) await 명령(["DEL", ...tags.map(예약키)]);
  await 명령(["DEL", 목록키]);
  return res.json({ bookings: [] });
}

// 합성 데이터 — 실제 사람 정보가 아니다
function 예시예약() {
  const 예시 = [
    ["김하늘", "서울 성북구 삼선교로 16길", "서울 성북구", 2, 1, 10, "KE703"],
    ["이도윤", "서울 성북구 보문로 34", "서울 성북구", 3, 1, 10, "OZ102"],
    ["박서연", "서울 강남구 테헤란로 152", "서울 강남구", 1, 1, 14, "7C1101"],
    ["최지우", "인천 연수구 송도과학로 32", "인천 연수구", 2, 2, 8, "LJ203"],
    ["정민준", "경기 고양시 일산동구 중앙로 1275", "경기 고양시", 4, 3, 12, "ZE605"],
  ];
  return 예시.map(([name, address, region, bags, 일, 시, flight], i) => {
    const pickup = new Date(kst날짜(오늘부터(일)) + `T${String(시).padStart(2, "0")}:00:00+09:00`);
    return {
      name, phone: `010-0000-000${i}`, address, region, flight, airline: "", destination: "",
      terminal: i % 2 ? "제1터미널" : "제2터미널", departure: new Date(pickup.getTime() + 10 * 3600000).toISOString(),
      pickup: pickup.toISOString(), bags, fee: 요금(bags),
    };
  });
}
