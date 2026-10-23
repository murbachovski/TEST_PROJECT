// 관리자 로그인 — 비밀번호는 Vercel 환경변수 ADMIN_PASSWORD 에만 둔다(코드·화면에 적지 않는다).
// 로그인하면 「만료시각.서명」 형태의 출입증을 준다. 서명은 비밀번호로 만든 HMAC 이라 서버에 따로 저장할 것이 없다.

const crypto = require("crypto");

const 유효시간 = 12 * 3600 * 1000; // 12시간

const 비밀번호 = () => String(process.env.ADMIN_PASSWORD || "");
const 서명 = (msg) => crypto.createHmac("sha256", "homedrop-admin:" + 비밀번호()).update(msg).digest("base64url");
const 같다 = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

function 설정됨() {
  return 비밀번호().length >= 8;
}

function 출입증발급(입력) {
  if (!설정됨() || !같다(입력, 비밀번호())) return null;
  const exp = String(Date.now() + 유효시간);
  return `${exp}.${서명(exp)}`;
}

function 관리자인가(req) {
  if (!설정됨()) return false;
  const m = String(req.headers.authorization || "").match(/^Bearer (\d+)\.([\w-]+)$/);
  if (!m || Number(m[1]) < Date.now()) return false;
  return 같다(m[2], 서명(m[1]));
}

module.exports = { 설정됨, 출입증발급, 관리자인가 };
