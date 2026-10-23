// 저장소 — Upstash Redis(REST). Vercel 마켓플레이스로 연결하면 KV_REST_API_URL · KV_REST_API_TOKEN 이 생긴다.
// 내 컴퓨터에서 시험할 때(VERCEL 환경이 아닐 때)만 메모리 저장소로 대신한다. 배포본에서 저장소가 없으면 오류를 낸다.

const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

class 저장소없음 extends Error {}

function 쓸수있나() {
  return Boolean((URL_() && TOKEN()) || !process.env.VERCEL);
}

async function 명령(args) {
  if (URL_() && TOKEN()) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(URL_(), {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: ctl.signal,
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error("저장소 오류 " + r.status);
      return d.result;
    } finally {
      clearTimeout(t);
    }
  }
  if (process.env.VERCEL) throw new 저장소없음("예약 저장소가 연결되지 않았습니다");
  return 메모리(args);
}

// ── 내 컴퓨터 시험용 메모리 저장소 (쓰는 명령만) ──
const 값 = new Map();
const 만료 = new Map();
function 살아있나(k) {
  if (만료.has(k) && 만료.get(k) < Date.now()) { 값.delete(k); 만료.delete(k); }
  return 값.has(k);
}
function 메모리([cmd, k, ...rest]) {
  switch (cmd.toUpperCase()) {
    case "INCR": { const n = (살아있나(k) ? Number(값.get(k)) : 0) + 1; 값.set(k, String(n)); return n; }
    case "EXPIRE": 만료.set(k, Date.now() + Number(rest[0]) * 1000); return 1;
    case "SET": 값.set(k, rest[0]); if (rest[1] === "EX") 만료.set(k, Date.now() + Number(rest[2]) * 1000); return "OK";
    case "GET": return 살아있나(k) ? 값.get(k) : null;
    case "MGET": return [k, ...rest].map((x) => (살아있나(x) ? 값.get(x) : null));
    case "DEL": return [k, ...rest].filter((x) => 값.delete(x)).length;
    case "SADD": { const s = 값.get(k) || new Set(); rest.forEach((m) => s.add(m)); 값.set(k, s); return 1; }
    case "SREM": { const s = 값.get(k); if (s) rest.forEach((m) => s.delete(m)); return 1; }
    case "SMEMBERS": return [...(값.get(k) || [])];
    default: throw new Error("메모리 저장소가 모르는 명령: " + cmd);
  }
}

module.exports = { 명령, 쓸수있나, 저장소없음 };
