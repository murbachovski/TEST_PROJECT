// API 공통 도우미 — 출처 검사, 요청 본문, 이용자 IP, 요청 수 제한

const { 명령, 접두 } = require("./_store");

// 이 사이트 화면에서 온 요청만 받는다. 브라우저는 POST·PATCH·DELETE 에 Origin 을 꼭 붙이므로,
// Origin 이 없는 요청(curl 등 화면 밖 호출)도 거절한다.
function 같은출처(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function 본문(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

// Vercel 은 x-forwarded-for 를 자기 값으로 덮어쓴다 — 맨 앞 값이 실제 접속 IP 다
function 접속IP(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "local";
}

// 종류별 요청 수 제한 (저장소에 세므로 함수 인스턴스가 여러 개여도 공유된다)
async function 너무많음(종류, req, 최대, 초) {
  const 칸 = Math.floor(Date.now() / (초 * 1000));
  const key = `${접두()}:rl:${종류}:${접속IP(req)}:${칸}`;
  try {
    const n = await 명령(["INCR", key]);
    if (n === 1) await 명령(["EXPIRE", key, 초 * 2]);
    return n > 최대;
  } catch {
    return false; // 저장소 장애로 서비스 전체를 막지는 않는다
  }
}

module.exports = { 같은출처, 본문, 접속IP, 너무많음 };
