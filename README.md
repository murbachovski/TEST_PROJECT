# 홈드롭 예약 챗봇 (수업 시연용)

집 앞에서 짐을 수거해 인천공항까지 옮겨 주는 「홈드롭」 예약을 챗봇이 받고, 관리자가 예약표로 보는 서비스입니다.
AI기반 공공행정프로젝트 캡스톤디자인 1팀 시연용이며, 실제 예약·결제·수거는 이뤄지지 않습니다.

배포: https://test-project-pi-seven-49.vercel.app (`main` 에 push 하면 Vercel 이 자동 배포)

## 구성
- `public/` — 화면 (예약 챗봇 · 관리자 예약표)
- `api/chat.js` — 안내 도우미 「드롭이」. `docs/답변참고문서` 에 있는 내용으로만 답하고, 답마다 실제 출처(기관·페이지 링크)를 붙인다
- `api/_rag.js` — 임베딩 검색(Gemini `gemini-embedding-2`, 막히면 `gemini-embedding-001`, 768차원, 코사인 유사도, 조각별 임베딩을 저장소에 보관). 실패하면 `api/_docs.js` 의 키워드 검색으로 대신한다
- `api/flight.js` — 인천국제공항공사 여객편 주간 운항 현황(공공데이터포털)으로 항공편 찾기
- `docs/답변참고문서/` — 답변 근거 문서

## 환경변수 (Vercel → Settings → Environment Variables)
| 이름 | 내용 | 없으면 |
|---|---|---|
| `INCHEON_FLY_INFO` | 공공데이터포털 OpenAPI KEY (Decoding) | 항공편 번호 형식만 확인 |
| `GEMINI_API_KEYS` | Gemini 키, 쉼표로 여러 개 (답변 생성 + 임베딩) | 다음 키 → Groq · 키워드 검색 |
| `GROQ_API_KEYS` | Groq 키, 쉼표로 여러 개 | 문서 원문 발췌로 답변 |
| `KV_REST_API_URL` · `KV_REST_API_TOKEN` | 예약 저장소(Upstash Redis, Vercel 마켓플레이스로 연결하면 자동으로 생김) | 예약 접수·관리자표 사용 불가 |
| `ADMIN_PASSWORD` | 관리자 예약표 비밀번호 (12자 이상 권장) | 관리자 로그인 불가 |
| `RAG_MIN_SCORE` | (선택) 이 유사도보다 낮으면 AI 를 부르지 않고 「자료에 없다」로 답함 | gemini-embedding-001 은 0.64(실측), 그 밖은 끄기 |

예약은 서버 저장소에 30일 동안만 보관되고 자동으로 지워집니다. 관리자 예약표는 비밀번호로 로그인한 사람만 볼 수 있습니다.

키는 코드와 `public/` 에 적지 않습니다.
