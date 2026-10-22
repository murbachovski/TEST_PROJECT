// 문서 기반 답변 (RAG) — 키는 이 서버 파일에서만 쓴다. 화면(public)으로 내려가지 않는다.
// 1) 검색: 임베딩(_rag.js) → 실패하면 키워드(_docs.js)
// 2) 생성: Gemini → Groq (GEMINI_API_KEYS · GROQ_API_KEYS, 쉼표로 여러 개, 막히면 다음 키)
// 3) AI 가 모두 실패하면 가장 가까운 문서 대목을 그대로 보여 준다
// 출처는 파일 이름이 아니라 문서 머리의 실제 기관·페이지 이름과 링크로 돌려준다.

const { 키워드찾기 } = require("./_docs");
const { 임베딩찾기 } = require("./_rag");
const { 위기인가, 위기안내 } = require("./_safety");

const 질문_최대길이 = 500;
const 대화_최대개수 = 6;
const 제한초 = 12;
const 분당_최대 = 20; // 한 사람(IP)이 1분에 보낼 수 있는 질문 수 — 키 소모를 막는다

// ── 페르소나 ──
const 페르소나 = `너는 「드롭이」다. 수업 시연 서비스 「홈드롭」(집 앞에서 짐을 수거해 인천공항까지 옮겨 주는 서비스를 가정한 시연)의 안내 도우미다.
너는 인천공항·항공사·정부기관이 아니며, 그렇게 행세하지 않는다.
성격: 무거운 캐리어를 든 여행객, 짐 많은 가족 여행객의 걱정을 먼저 알아주는 차분하고 친절한 안내원. 과장하거나 들뜨지 않는다.
말투: 존댓말. 첫 문장에 결론(된다/안 된다/얼마다)을 말한다. 전체 2~5문장. 단계나 여러 항목은 「• 」로 시작하는 짧은 줄로 나눈다. 굵게(**), 표, 제목(#) 같은 마크다운은 쓰지 않는다. 이모지는 쓰지 않는다.`;

const 답변규칙 = `규칙:
1. [참고 문서]에 있는 내용으로만 답한다. 추측하지 않는다. 숫자(요금·무게·시간)는 문서에 적힌 그대로 쓴다.
2. 문서가 허용 범위를 정해 두었으면(예: 수거 지역 서울·인천·경기), 그 밖의 경우는 "안 된다"고 분명히 답한다.
3. 문서에 답이 없으면 "제가 가진 안내 자료에는 그 내용이 없어요."라고 말하고, 참고 문서에 그 주제의 문의처가 있을 때만 알려 준다. 상관없는 문의처는 붙이지 않는다.
4. 「시연용」 표시가 있는 문서의 값(요금·수거 시각·짐 한도 등)을 말할 때는 "시연용 기준"이라고 밝힌다.
5. 이용 자격·배차·탑승 가능 여부를 단정하지 않는다. 이 이야기는 이용자가 승인·자격·배차를 물을 때만 꺼낸다: 접수는 AI 가 돕고 확정은 관리자·항공사가 한다.
6. 「예약 시작」 버튼 안내는 이용자가 예약하려는 뜻을 보일 때만 한다. 매 답마다 붙이지 않는다.
7. 실제 이름·전화번호·주소를 묻거나 받지 않는다.
8. 이용자가 자해·자살을 떠올리게 하거나 몹시 괴롭다는 말을 하면, 문서와 상관없이 먼저 마음을 알아주고 「자살예방 상담전화 109(24시간), 위급하면 112·119」를 안내한다. 「자료에 없다」고 답하지 않는다.
9. 인사·감사·짧은 잡담에는 문서 없이도 한두 문장으로 친절히 답하고, 도울 수 있는 일(예약·요금·수거 시간·맡길 수 없는 물품·공항 이용)을 알려 준다. 이때는 「출처: 없음」.
10. 욕설·모욕에는 맞대응하지 않고 차분하게 도울 수 있는 일을 안내한다.
11. 답 맨 끝에 한 줄로 실제로 근거로 쓴 문서 번호를 「출처: [1], [3]」처럼 적는다. 근거가 없으면 「출처: 없음」.`;

const 요청기록 = new Map();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 로만 호출할 수 있습니다." });

  // 다른 사이트의 화면에서 이 API 를 부르는 것을 막는다 (브라우저는 POST 에 Origin 을 붙인다)
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "허용되지 않은 출처입니다." });
    } catch {
      return res.status(403).json({ error: "허용되지 않은 출처입니다." });
    }
  }
  if (너무많음(String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "local")) {
    return res.status(429).json({ error: "질문이 너무 잦아요. 1분 뒤에 다시 물어봐 주세요." });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const 질문 = String(body.question || "").trim().slice(0, 질문_최대길이);
  if (!질문) return res.status(400).json({ error: "질문이 비어 있습니다." });

  // 위기 표현은 문서 검색·AI 보다 먼저 — 정해진 안내(상담 전화)를 바로 돌려준다
  if (위기인가(질문)) return res.json({ ...위기안내, retrieval: "none" });

  const 이전대화 = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-대화_최대개수)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 질문_최대길이) }));

  // 짧은 후속 질문("그럼 2개는요?")도 앞 질문의 맥락으로 찾도록 직전 질문을 붙여 검색한다
  const 직전 = [...이전대화].reverse().find((m) => m.role === "user");
  const 검색어 = 질문.length < 15 && 직전 ? `${직전.content} ${질문}` : 질문;

  let 대목 = await 임베딩찾기(검색어);
  let retrieval = "embedding";
  if (!대목) {
    대목 = 키워드찾기(검색어);
    retrieval = "keyword";
  }

  if (!대목.length) {
    return res.json({ answer: "제가 가진 안내 자료에는 그 내용이 없어요. 홈드롭 예약·요금·수거 시간, 맡길 수 없는 물품, 인천공항 이용 안내를 물어봐 주세요.", sources: [], mode: "none", retrieval });
  }

  const 참고 = 대목
    .map((d, i) => `[${i + 1}] 문서: ${d.문서}${d.시연용 ? " (시연용 가정 값)" : ""} / 절: ${d.소제목}\n${d.내용}`)
    .join("\n\n---\n\n");
  const 시스템 = `${페르소나}\n\n${답변규칙}\n\n[참고 문서]\n${참고}`;
  const 메시지 = [...이전대화, { role: "user", content: 질문 }];

  const ai = (await gemini(시스템, 메시지)) || (await groq(시스템, 메시지));
  if (ai) {
    const { 본문, 번호 } = 출처떼기(ai, 대목.length);
    return res.json({ answer: 본문, sources: 출처모으기(번호.map((n) => 대목[n - 1])), mode: "ai", retrieval });
  }

  // AI 키가 없거나 모두 실패 — 가장 가까운 대목을 그대로 보여 준다
  const 첫 = 대목[0];
  if (retrieval === "keyword" && 첫.점수 < 0.5) {
    return res.json({ answer: "제가 가진 안내 자료에서 확실한 내용을 찾지 못했어요.", sources: [], mode: "search", retrieval });
  }
  return res.json({
    answer: `안내 자료에서 찾은 내용이에요 (AI 요약 없이 원문 발췌).\n\n「${첫.소제목}」\n${첫.내용.slice(0, 600)}`,
    sources: 출처모으기([첫]),
    mode: "search",
    retrieval,
  });
};

// 답 끝의 「출처: [1], [3]」 줄을 떼어 번호만 남긴다
function 출처떼기(글, 개수) {
  const 줄들 = 글.trim().split("\n");
  let 번호 = [];
  while (줄들.length && /^\s*(출처|근거)\s*[:：]/.test(줄들[줄들.length - 1])) {
    const 줄 = 줄들.pop();
    번호 = [...줄.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 개수);
  }
  const 본문 = 줄들.join("\n").replace(/\*\*(.+?)\*\*/g, "$1").trim();
  return { 본문, 번호: [...new Set(번호)] };
}

// 조각 → 화면에 보일 출처 목록 (같은 링크는 한 번만)
function 출처모으기(조각들) {
  const 모음 = new Map();
  for (const c of 조각들) {
    for (const s of c.출처) {
      const key = s.url || s.label;
      if (!모음.has(key)) 모음.set(key, { label: s.label, url: s.url, demo: !s.url });
    }
  }
  return [...모음.values()].slice(0, 4);
}

function 너무많음(ip) {
  const 지금 = Date.now();
  const 기록 = (요청기록.get(ip) || []).filter((t) => 지금 - t < 60000);
  기록.push(지금);
  요청기록.set(ip, 기록);
  if (요청기록.size > 5000) 요청기록.clear();
  return 기록.length > 분당_최대;
}

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
