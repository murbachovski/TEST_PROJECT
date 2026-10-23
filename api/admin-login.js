// 관리자 로그인: POST { password } → { token, expiresAt }

const { 같은출처, 본문, 너무많음 } = require("./_http");
const { 설정됨, 출입증발급 } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 로만 호출할 수 있습니다." });
  if (!같은출처(req)) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
  if (!설정됨()) return res.status(503).json({ error: "관리자 비밀번호가 아직 설정되지 않았습니다. Vercel 환경변수 ADMIN_PASSWORD 를 넣어 주세요." });
  // 비밀번호 대입 공격 막기: 10분에 5번까지
  if (await 너무많음("login", req, 5, 600)) return res.status(429).json({ error: "로그인 시도가 너무 많습니다. 10분 뒤에 다시 시도하세요." });

  const token = 출입증발급(String(본문(req).password || ""));
  if (!token) return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ token, expiresAt: Number(token.split(".")[0]) });
};
