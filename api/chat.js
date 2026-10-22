// 문서 기반 답변 — 키는 이 서버 파일에서만 쓴다. 화면(public)으로 내려가지 않는다.
// 키: GEMINI_API_KEYS · GROQ_API_KEYS (쉼표로 여러 개). 한 키가 막히면 다음 키로 넘어간다.
// 키가 하나도 없거나 모두 실패하면, 문서에서 찾은 대목을 그대로 보여 주는 「문서 검색 답변」으로 대신한다.

const { 찾기 } = require("./_docs");

const 질문_최대길이 = 500;
const 대화_최대개수 = 6;
const 제한초 = 12;
const 문의처 = "이 서비스는 수업 시연용이라 실제 문의처가 없습니다. 공항 외 수하물 수속은 이지드랍 고객센터(02-6010-1220)에 문의하세요.";

const 시스템규칙 = `너는 「홈드롭 예약 챗봇」의 안내 도우미다. 홈드롭은 집 앞에서 짐을 수거해 인천공항까지 옮기는 서비스를 가정한 수업 시연이다.
규칙:
1. 아래 [참고 문서]에 있는 내용으로만 한국어로 답한다. 문서에 없는 내용은 추측하지 말고 "문서에 없는 내용입니다"라고 말한 뒤 문의처를 안내한다.
2. 답 마지막 줄에 "근거: 파일이름" 형식으로 실제로 쓴 문서 파일 이름을 적는다.
3. 이용 자격, 배차, 탑승 가능 여부를 단정하지 않는다. AI 는 안내와 접수 보조까지만 하고 최종 결정은 관리자·항공사가 한다.
4. 시연용 가정 값(요금·수거 시각·적재 한도)을 말할 때는 시연용이라고 밝힌다.
5. 쉬운 말로 5문장 이내로 짧게 답한다. 이용자가 예약을 원하면 화면의 「예약 시작」 버튼을 누르라고 안내한다.
6. 실제 개인정보(실명·전화번호·주소)를 요구하지 않는다.
문의처: ${문의처}`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 로만 호출할 수 있습니다." });

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const 질문 = String(body.question || "").trim().slice(0, 질문_최대길이);
  if (!질문) return res.status(400).json({ error: "질문이 비어 있습니다." });

  const 이전대화 = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-대화_최대개수)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 질문_최대길이) }));

  const 대목 = 찾기(질문);
  const 근거파일 = [...new Set(대목.map((d) => d.파일))];

  if (!대목.length) {
    return res.json({ answer: `문서에 없는 내용입니다. ${문의처}`, sources: [], mode: "none" });
  }

  const 참고 = 대목.map((d) => `[파일: ${d.파일}]\n${d.내용}`).join("\n\n---\n\n");
  const 시스템 = `${시스템규칙}\n\n[참고 문서]\n${참고}`;
  const 메시지 = [...이전대화, { role: "user", content: 질문 }];

  const ai = (await gemini(시스템, 메시지)) || (await groq(시스템, 메시지));
  if (ai) return res.json({ answer: ai, sources: 근거파일, mode: "ai" });

  // AI 키가 없거나 모두 실패 — 가장 가까운 대목을 그대로 보여 준다
  const 첫 = 대목[0];
  if (첫.점수 < 0.5) {
    return res.json({ answer: `문서에서 확실한 내용을 찾지 못했습니다. ${문의처}`, sources: [], mode: "search" });
  }
  const 발췌 = 첫.내용.replace(/^## .+\n/, "").replace(/^> .*$/gm, "").trim().slice(0, 600);
  return res.json({
    answer: `문서에서 찾은 내용입니다 (AI 요약 없이 원문 발췌).\n\n「${첫.소제목}」\n${발췌}\n\n근거: ${첫.파일}`,
    sources: [첫.파일],
    mode: "search",
  });
};

function 키목록(...이름들) {
  return 이름들
    .flatMap((n) => String(process.env[n] || "").split(","))
    .map((k) => k.trim())
    .filter(Boolean);
}

async function gemini(시스템, 메시지) {
  const 모델 = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  for (const key of 키목록("GEMINI_API_KEYS", "GEMINI_API_KEY")) {
    try {
      const r = await 시간제한fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${모델}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: 시스템 }] },
            contents: 메시지.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
            generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
          }),
        }
      );
      if (!r.ok) { console.error("gemini 실패", r.status); continue; } // 한도 초과·키 오류 → 다음 키 (키 값은 남기지 않는다)
      const data = await r.json();
      const 글 = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
      if (글) return 글;
    } catch {
      // 시간 초과·네트워크 오류 → 다음 키
    }
  }
  return null;
}

async function groq(시스템, 메시지) {
  const 모델 = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  for (const key of 키목록("GROQ_API_KEYS", "GROQ_API_KEY")) {
    try {
      const r = await 시간제한fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 모델,
          messages: [{ role: "system", content: 시스템 }, ...메시지],
          temperature: 0.2,
          max_tokens: 800,
        }),
      });
      if (!r.ok) { console.error("groq 실패", r.status); continue; }
      const data = await r.json();
      const 글 = String(data?.choices?.[0]?.message?.content || "")
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .trim();
      if (글) return 글;
    } catch {
      // 다음 키
    }
  }
  return null;
}

function 시간제한fetch(url, opts) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 제한초 * 1000);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
