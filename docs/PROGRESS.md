# 개발 상태 — 2026-11-24

## 현재 Phase
**Phase 0–5 구현·검증 완료. 다음 미완료 단계는 Phase 6이다.** 로컬 개발용 단일 관리자 MVP이며 공개 운영 준비 완료를 의미하지 않는다. 과거 Phase의 검증 기록은 이력으로 유지한다.

## Phase 5 구현 및 검증 (2026-11-24)
- 필수 문서·실제 소스·Git 비교: 기준 92860db(Phase 4), 작업 전 변경 없는 상태에서 시작. 과거 커밋 전 문구는 당시 기록이며 이후 사용자 요청으로 푸시됐다. 이번 변경은 커밋·푸시하지 않았다.
- 영향 분석: 기존 수신·Raw/Parsed 분리와 DB 이후 Socket 알림 유지. Replay 전송/정책/큐/작업 Repository/Worker를 분리하고 수신에는 서명 검증 및 중복 시도 저장 경계만 추가. 관리 인증과 원본 Endpoint 범위를 유지하며 외부 URL 전송은 구현하지 않았다.
- PostgreSQL 작업·시도·원본 요청 연결, UUID 멱등 키, DB 상태 전이/잠금/고유 제약, 실제 HTTP 응답 이력, 대기 취소, 429/5xx 제한 재시도 및 1초·2초 백오프, 불확실/중단 UNKNOWN 구현.
- Redis/BullMQ에는 작업 ID만 보관. 별도 Worker 동시 2개, DB PENDING outbox·5초 조정자·큐 namespace·DB 재시도 시각으로 큐 유실/중복 실행에 대응. Worker DB 확인 후 TTL heartbeat, DB readiness는 Redis와 독립 유지.
- 고정 내부 origin/원본 Endpoint, 원본 Base64 바이트·중복 Query, 안전한 Header만 전달. HMAC proof·활성 작업/시도 확인·서명 Header 제거, 동일 시도 수신 1건 보장. SQL 오류가 Redis에 본문 파라미터를 남기지 않도록 오류 코드를 정제했다.
- Replay Center: 생성·최대 시도·상태 필터/페이지·대기 취소, 2초 조회, 실제 관측 응답·원본 Parsed Body 비교·저장 확인된 수신 상세 연결. HTTP 예정 스냅샷과 Worker 실제 응답 구분.
- 추가 migration 0003/0004 적용. 0003 업그레이드 전후 기존 요청 **220건 보존**. 이후 통합 테스트는 실제 fixture를 추가하므로 현재 전체 건수는 달라질 수 있다. 기존 migration은 수정하지 않았다.
- **Vitest 119/119 통과**: 기존 92개 + Replay 정책/인증/서명/안전한 전송/한도/결과 분류 27개. HTTP 테스트의 Repository는 더블이다. 샌드박스 로컬 연결 EACCES로 실패한 검사는 권한 확장 후 전부 통과했다.
- **실제 Compose PostgreSQL smoke 4종 통과**: 기존 수신→DB→Socket, 필터 36건, 응답/Test Sender 회귀 및 신규 Replay. Replay는 binary 바이트·멱등 생성·위조 거부·503 최대 3회 및 시간 간격·400 1회·대기 취소·실행 중 취소 거부·서명 중복 수신 1건·중단 UNKNOWN·PENDING 복구·다른 큐 namespace 격리를 검증하고 자체 데이터를 정리했다.
- **실제 Redis stop/start 검증**: 중단 중 생성은 PENDING/enqueuePending, DB readiness 및 일반 HTTP 수신 성공. Redis 재시작 후 같은 작업이 SUCCEEDED가 됐으며 5개 서비스 모두 healthy로 복귀했다.
- **Compose Playwright 7/7 통과**: 기존 6개 + Replay 성공·실패 2회 재시도·REPLAY 표시·원본 비교·상태 필터. 데스크톱/390px 모바일 스크린샷 및 넘침 검사. E2E 데이터는 DB에 남는다.
- TypeScript·ESLint·Production Build 통과. Compose build/migration/기동 및 frontend/backend/worker/postgres/redis healthy. npm audit 전체/운영 모두 0건. CI에 Redis와 Replay smoke 추가; 원격 CI 실행은 미검증.
- 미검증: 모든 강제 종료 시점·장기 부하·멀티 인스턴스·공개 운영. Exactly-once 전달 성공 보증은 하지 않는다. 통계/계정 소유권/TTL/감사/외부 Replay는 완료 처리하지 않았다.

## Phase 5에서 해결한 문제
- 실제 smoke에서 다른 큐 조정자가 작업을 가져가 백오프가 단축됐다. 0004로 queueName/nextAttemptAt을 추가하고 DB가 시간 제한을 집행하도록 수정해 재검증했다.
- 기존 EndpointTools와 새 ReplayCenter의 동일 sibling key가 React 상태를 초기화했다. 컴포넌트별 접두사로 분리했다. 새 갱신 버튼/페이지 CSS와 기존 E2E 선택자 충돌도 고쳤으며 최종 7개 회귀가 통과했다.
- BullMQ Redis client의 SET 인자 형식 차이를 타입 검사에서 발견해 구조화 EX 옵션으로 수정했다. Worker 오류는 SQL 원인을 Redis에 전달하지 않도록 정제했다.

## Phase 5 변경 파일
- backend/src/replayPolicy.ts, replayTransport.ts, replayRepository.ts, replayQueue.ts, replayService.ts, replayWorker.ts, worker.ts, workerHealth.ts, replaySmoke.ts 및 tests/replay.test.ts 신규.
- backend/migrations/0003_internal_replay.sql, 0004_replay_deadline_and_namespace.sql 신규; app.ts/repository.ts/schema.ts/server.ts/package.json 수정.
- frontend/src/ReplayCenter.tsx 및 tests/phase5.spec.ts 신규; main.tsx/types.ts/style.css 수정. Phase 5 화면 신규, Phase 1–4 E2E 화면 재생성.
- docker-compose.yml, .env.example, .github/workflows/ci.yml, package-lock.json과 PROJECT.md/README.md/DECISIONS.md/ARCHITECTURE.md/TEST-SCENARIOS.md/openapi.yaml 갱신. .env는 제외.

## Phase 4 구현 및 검증 (2026-11-23)
- 필수 문서·소스·Git 비교 후 main이 origin/main과 같고 변경이 없는 기준 bd2e1e0에서 시작했다. 기존 테스트 45개를 재확인했다. Phase 3의 커밋 전 문구는 당시 이력이며 이후 사용자 요청으로 bd2e1e0를 푸시했다.
- Endpoint 응답 설정 GET/PUT API와 별도 테이블, DEFAULT/CUSTOM, 상태 200–599·JSON/Text·UTF-8 8KiB·안전한 사용자 Header·최대 2초 비동기 지연 구현.
- 수신 시점 responseBody/responseHeaders/responseDelayMs/source 스냅샷을 요청과 함께 저장. 저장 실패에서 준비된 Custom 응답을 제거하고 503. 알림·전송 완료/중단을 영속 저장과 구분한다.
- 자체 Test Sender POST API·UI: 고정 숫자 루프백/자신의 listening port/기존 수신 경로로 실제 HTTP 전송. URL·관리 인증 전달·redirect·자동 재시도 금지. 5초·응답 16KiB·동시 8개·관리 IP별 20회/분 제한.
- 일회용 내부 토큰을 Endpoint/Request ID와 연결해 TEST 출처를 확인하고 원본 토큰을 이력에서 제거. 결과 시점 DB 확인을 바탕으로 실제 수신 상세에 연결. 일반 Header와 출처 증명은 분리한다.
- schema_migrations ledger, 트랜잭션/advisory lock 및 0002 추가 migration. 기존 요청 **130건이 업그레이드 후·migration 재실행 후 모두 유지**됐고, 과거 응답 본문을 임의 생성하지 않고 null로 유지함을 확인했다.
- **Vitest 92/92 통과:** 기존 45개 + 응답/테스트 입력·실제 루프백 HTTP/전송 보안·제한 47개. 저장 경계는 Repository 더블이며 실제 DB 검증은 아래 smoke와 구분한다.
- **실제 PostgreSQL smoke 3종 통과:** 기존 HTTP→DB→Socket 및 36건 필터 검증, 신규 config 저장·422/204 관측·한국어 Raw Body·중복 Query·TEST ID 연결·과거 스냅샷 불변·기본 복원·외부 위조 거부. 각 smoke는 자체 데이터 정리.
- **Compose Playwright 6/6 통과:** 기존 5개 + 응답 설정→실제 전송→실시간 TEST 표시→상세/Query/응답 snapshot→204→기본 복원→다른 Endpoint 설정 격리 및 재조회 영속화. 데스크톱/390px 모바일 화면 검토 완료.
- TypeScript·ESLint·Production Build 통과. Compose 빌드·migration·기동 성공 및 PostgreSQL/Redis/backend/frontend 모두 healthy. npm audit 전체/운영 의존성 모두 0건. 새 의존성 없음.
- 원격 CI, 공개 운영, 부하/멀티 인스턴스·모든 장애 조합은 미검증. 테스트 실패 전송 자체의 영속 Job/Attempt와 설정 감사는 Phase 5/7로 이월. 전체 저장량 한도·자동 TTL 미구현 제약은 유지한다.

## Phase 4에서 해결한 문제
- 종료된 Docker 엔진을 시작하고 실제 Compose 검증을 진행했다.
- Node HTTP raw Header 배열 사용 시 Host가 자동 생성되지 않아 400을 받는 문제를 실제 HTTP 테스트로 발견했다. 사용자 입력 대신 고정 루프백 Host를 추가하고 재검증했다.
- 초기 내부 식별자 이름이 기존 E2E의 일반 X-HookScope-Test Header와 충돌해 해당 Header가 사라졌다. 예약 이름을 X-HookScope-Internal-Test-Token으로 분리하여 일반 사용자 Header 보존과 위조 방지를 함께 검증했다.
- 지연/빈 응답/Custom 오류 상태에서도 Request ID를 응답 본문에 의존하지 않고 연결하도록 일회용 서버 측 ID를 사용했다. 저장 실패 시 기존 Content-Length가 오류 응답을 깨뜨리지 않게 제거했다.

## Phase 4 변경 파일
- backend/src/responsePolicy.ts, testSender.ts, responseSmoke.ts, tests/responseAndTest.test.ts, migrations/0002_response_and_test.sql 신규.
- backend/src/app.ts, repository.ts, schema.ts, migrate.ts, server.ts, package.json 및 기존 app/realtime 테스트 수정. CI에 response smoke 추가.
- frontend/src/EndpointTools.tsx, tests/phase4.spec.ts 신규; main.tsx, RequestInspector.tsx, types.ts, style.css 수정.
- PROJECT.md, README.md, PROGRESS.md, DECISIONS.md, ARCHITECTURE.md, TEST-SCENARIOS.md, openapi.yaml 갱신. Phase 4 스크린샷 신규 및 기존 E2E 화면 재생성.
- 현재 변경은 로컬 작업 폴더에 있으며 이번 작업에서 커밋·푸시는 수행하지 않았다.

## Phase 3 구현 및 검증 (2026-11-19)
- 필수 문서·소스·Git 상태 비교: main은 origin/main과 같고 작업 전 변경사항이 없었다(기준 커밋 cbb53ab). 문서에 남은 Git 미초기화 기록은 Phase 1·2 당시 이력이다. 이번 변경은 로컬 작업 폴더에 있으며 커밋·푸시는 수행하지 않았다.
- Endpoint 범위 키워드·Method·Status·Content-Type·수신 기간·정렬 필터 및 엄격한 query 검증 추가. 기존 관리자 인증·수신·저장·Socket 경계 유지. 새 의존성 및 DB migration 없음.
- 목록과 total을 REPEATABLE READ 읽기 전용 스냅샷으로 조회, receivedAt/UUID 안정 정렬, 본문 없는 30건 페이지. 검색 값은 바인딩하고 %/_는 리터럴로 처리.
- 검색 초안/적용값 분리, 첫 페이지 복귀·초기화, 적용 필터를 유지한 실시간·재연결 재조회, 로그아웃 필터 초기화.
- 헤더 검색·개별/전체 복사, 중복 Query 행, JSON Pretty/Tree·민감 키 표시 마스킹, Text/Form/Binary 분석, Raw UTF-8/Base64 및 원본 .bin 다운로드.
- **Vitest 45/45 통과:** 기존 26개 + query/인증 경계/Inspector 데이터 처리 19개. Repository 더블과 파서 테스트이며 실제 DB 검증은 아래 smoke로 구분한다.
- **기존 실제 PostgreSQL+Socket smoke 통과:** 원본 바이트·중복 Query·DB ID/시각과 Room 알림·REST/인증 회귀 확인.
- **실제 PostgreSQL filter smoke 통과:** HTTP 36건 수신, Endpoint 격리, 복합 필터, 한국어/%_/SQL 문법 리터럴 검색, Header/Query 검색, 날짜/offset 범위, 정렬 반전, 30/5 페이지·중복 없음·본문 미포함 및 binary 바이트 검증. 테스트 데이터 자동 정리.
- **Compose Playwright 5/5 통과:** 기존 2개 + 필터 유지 실시간 갱신/트리/마스킹/복사/다운로드, 31건 페이지·Status/기간, Form 중복·malformed JSON·Text/HTML 비실행 3개.
- TypeScript 검사·ESLint·Production Build 통과. Compose 재빌드·기동 성공, PostgreSQL/Redis/backend/frontend 모두 healthy 확인. 데스크톱·390px 모바일 스크린샷 생성 및 시각 검토 완료.
- 2026-11-19 레지스트리 응답 기준 `npm audit` 전체와 `--omit=dev` 모두 0건. Phase 2 당시 High 11건과 구분하여 기록하며, 의존성을 강제 다운그레이드하거나 새로 추가하지 않았다.
- 원격 CI·공개 배포·대량 검색/부하·모든 네트워크 장애 유형은 미검증. 검색은 Parsed Body·마스킹 Header·Query·ID·Content-Type만 포함하며 Raw/Base64와 파싱 실패 본문은 검색하지 않는다. 페이지 간 offset 이동은 가능하다.

## Phase 3에서 해결한 문제
- Docker 엔진이 종료된 상태여서 최초 Compose 검증이 실패했다. Docker Desktop 시작 후 재빌드·실제 DB 및 E2E 검증을 완료했다.
- 기존 E2E가 Header/Query의 pre 요소를 찾고 있어 새 구조화 표의 행/값을 검사하도록 갱신했다.
- Playwright가 JSON Content-Type의 잘못된 문자열을 유효한 JSON 문자열로 인코딩한 점을 발견했다. malformed JSON을 Buffer 원본 바이트로 전송하도록 수정해 실제 파싱 실패·Raw 보존을 검증했다.
- 적용 필터와 재연결 조회가 달라지거나 로그아웃 후 이전 필터가 남지 않도록 최신 콜백·조회 세대와 초기화를 유지했다.

## Phase 3 변경 파일
- backend/src/requestFilters.ts, filterSmoke.ts, tests/requestFilters.test.ts 신규; src/app.ts, repository.ts, package.json 수정.
- frontend/src/RequestFilters.tsx, RequestInspector.tsx, JsonTree.tsx, inspectorData.ts, types.ts 및 tests/phase3.spec.ts 신규; src/main.tsx, style.css, tests/phase1.spec.ts 수정.
- .github/workflows/ci.yml에 DB filter smoke 추가. PROJECT.md, README.md, docs/PROGRESS.md, DECISIONS.md, ARCHITECTURE.md, TEST-SCENARIOS.md, openapi.yaml 갱신.
- docs/screenshots/phase3-desktop.png, phase3-mobile.png 신규. 기존 E2E 실행으로 Phase 1·2 스크린샷도 현재 UI로 재생성됨.

## Phase 2 구현 및 검증 (2026-11-18 이력)
- 시작 시 필수 문서·실제 코드·Git 상태를 비교. Git 저장소 미초기화 상태를 재확인했고 기존 테스트 17개와 실행 중인 Compose의 healthy 상태를 확인했다.
- Socket.IO 4.8.4 서버·클라이언트, 공통 관리자 키 검증, Origin 검사, UUID/Endpoint 존재 확인 및 인증된 Endpoint Room 구현.
- DB 저장 완료 후 PublishReceived 경계로 메타데이터 알림 발행. 수신·저장·Socket 모듈 분리. 발행 실패와 영속 저장 실패를 구분. DB 스키마 변경 없음.
- 브라우저 Socket 상태·자동 재연결·가입 ack 후 REST 재조회, 75ms 알림 합치기, 최근 512 ID 중복 제거, 오래된 조회 응답 무시, Endpoint 변경/로그아웃 정리 구현.
- nginx/Vite polling 및 WebSocket 프록시. ESLint flat config 및 CI lint 추가. Redis/Replay/검색 등 이후 Phase는 구현하지 않음.
- **Vitest 26/26 통과:** 기존 17개 + Socket 통합 7개 + 브라우저 중복 처리 단위 2개. Socket 테스트의 Repository는 더블이다.
- **실제 PostgreSQL smoke 통과:** 컨테이너 내부 HTTP 수신→DB 원본 바이트 및 중복 Query 확인→인증 Room 알림의 DB ID·시각 대조→REST/인증 확인.
- **Playwright 2/2 통과:** 기존 수신/상세 회귀와 두 탭 자동 갱신·실제 이벤트 프레임 중복 무시·실제 WebSocket 중단 중 저장·재연결 복구·모바일 로그아웃.
- TypeScript 검사·ESLint·Production Build 통과. `docker compose up -d --build` 성공 및 4개 서비스 healthy 확인. [실시간 화면](screenshots/phase2-desktop.png), [모바일](screenshots/phase2-mobile.png) 시각 검토 완료.
- `npm audit --omit=dev`: 0건. 전체 감사: High 11건(typescript-eslint/Vite/Vitest 및 picomatch 관련 전이 의존성). audit는 일부 도구 다운그레이드를 제안하며, 무조건적인 force 적용은 하지 않았다. 로컬 backend 이미지는 개발 의존성도 포함한다.
- 원격 GitHub Actions, 공개 운영, 멀티 인스턴스·Redis adapter, 부하 및 네트워크 장애 전 유형은 미검증.

## Phase 2에서 해결한 문제
- 최초 프로젝트에 Lint 명령이 없어 ESLint/TypeScript ESLint 구성과 CI 단계를 추가했다.
- Node events.once의 Socket 클라이언트 타입 호환 오류를 발견해 smoke에 명시적인 timeout/리스너 정리 대기 함수를 적용했다. 타입·빌드 및 실제 DB smoke 재검증 완료.
- 기존 모바일 CSS가 로그아웃 버튼을 숨겨 E2E 종료 단계가 실패했다. 모바일에서도 로그아웃 버튼을 제공하도록 수정하고 전체 E2E 2개를 재실행해 통과했다.
- 실시간 재조회와 Endpoint 선택/로그아웃의 응답 경쟁 가능성을 세대 번호 검사로 방지했다.

## Phase 2 당시 변경 파일
- backend/src/auth.ts, realtime.ts 신규; app.ts, server.ts, smoke.ts 수정; backend/tests/realtime.test.ts, realtimeEvents.test.ts 신규; backend/package.json 수정.
- frontend/src/useRealtime.ts, realtimeEvents.ts 신규; main.tsx, style.css, vite.config.ts, package.json 수정; frontend/tests/phase2.spec.ts 신규.
- package.json, package-lock.json, eslint.config.mjs, .github/workflows/ci.yml, docker/nginx.conf.
- PROJECT.md, README.md, docs/PROGRESS.md, DECISIONS.md, ARCHITECTURE.md, TEST-SCENARIOS.md, openapi.yaml. Phase 2 스크린샷 신규 및 기존 E2E 스크린샷 재생성.

## 완료 기능
- 비어 있는 작업 폴더에서 npm workspace, TypeScript strict, Express, React/Vite 구성
- 필수 5종 관리 문서 및 아키텍처/API/검증 시나리오 작성
- Drizzle PostgreSQL 스키마, 초기 SQL migration, UUID/FK/unique/index
- Endpoint 생성·목록·상세, 192bit 공개 토큰, 관리자 Bearer 인증
- JSON/Text/Form 및 raw binary 수신, Base64 바이트 보존, malformed JSON 기록
- 중복 Header/Query 유지 및 민감 헤더 마스킹
- 실제 DB 저장 후 응답, 저장 실패 503, 목록 페이지 조회·상세 API
- 한국어 다크 UI, URL 복사, 요청 상세 탭, 수동 갱신, 반응형 화면
- 본문 제한, 기본 Rate Limit, CORS·보안 헤더, 비밀 로그 방지
- Compose PostgreSQL/Redis/backend/frontend, named volume, healthcheck, 시작 시 migration
- CI 구성 및 브라우저 스크린샷

## Phase 1 당시 검증 결과 (이력)
- Vitest + Supertest **17/17 통과**. 단위·HTTP 통합 테스트이며 Repository는 더블이다.
- 실제 PostgreSQL smoke **통과**: Endpoint 생성 → HTTP 수신 → SQL 직접 조회 → 원본 한국어 바이트 및 중복 Query 비교 → REST 목록/상세 → 인증 확인. 로컬과 API 컨테이너 안에서 각각 검증했다.
- Playwright **1/1 통과**: 실제 Compose UI에서 Endpoint 생성, HTTP 전송, 목록 갱신, Headers/Query/Body/Raw 확인, 1440px 데스크톱 및 390px 모바일 가로 넘침 검증.
- frontend/backend 타입 검사 및 빌드 통과. Node.js 로컬 24.12.0 / 컨테이너 24.22.3.
- `docker compose up -d --build` 성공. PostgreSQL, Redis, backend, frontend 모두 healthy 확인.
- curl.exe JSON POST 실측 성공: requestId `f82b5a36-e1fb-4206-87f2-e6bbf24987b2`, PostgreSQL 직접 조회에서 POST / application/json / 52 bytes / 200 확인.
- 운영 npm 의존성 감사 **0건**. 개발 의존성 picomatch 및 연관 도구의 High advisory는 남아 있다. 현재 audit의 다운그레이드 제안은 최신 Vitest 보안 수정과 충돌하므로 강제 적용하지 않았다.
- GitHub Actions 파일은 작성했으며 원격 CI 실행은 아직 미검증.

## 해결한 문제
1. 샌드박스 DNS 및 로컬 TCP 제한: 승인된 실행으로 의존성 다운로드 및 HTTP 테스트 수행.
2. Docker 엔진 미기동: Docker Desktop 시작 후 검증.
3. 기존 8080 포트 점유: 기존 서비스를 변경하지 않고 frontend 기본 포트를 8088로 설정.
4. 초기 Drizzle/Vitest 취약 버전: Drizzle 0.45.4, Vitest 5.1.0, Vite 8.3.8로 상향.
5. 실제 DB 저장에서 null-prototype 객체를 Drizzle이 직렬화하지 못함: Query/Form을 Map으로 모은 뒤 Object.fromEntries로 변환. __proto__/constructor 입력 단위 테스트 및 실제 DB smoke 재검증.
6. Nginx access log의 공개 수신 토큰 노출 가능성: 기본 access logging 비활성화.

## 미완료 및 제약
- Phase 5 이후 Replay/Worker, 통계, 다중 사용자 인증, 자동 보관·정리, 전체 용량 및 엔드포인트별 quota는 미구현.
- 현재 본문·쿼리는 원문 보관. 자동 TTL 없이 수동 DB 정리 전까지 유지.
- 응답 durationMs는 DB insert 전 준비 시간이고 실제 전체 처리시간이 아니다.
- 대량 요청 부하 테스트·공개 배포·HTTPS·원격 CI는 미검증.
- 최초 폴더는 Git 저장소가 아니었으며 사용자 요청으로 Phase 2의 cbb53ab, Phase 3의 bd2e1e0를 origin/main에 푸시했다. Phase 4 변경은 아직 커밋하지 않았다.

## 다음 작업
Phase 5: Internal Replay, Redis/BullMQ Job 및 Worker, 시도별 영속 이력·제한된 재시도/백오프·실패 원인·중복 실행 대응·Replay Center. 외부 임의 URL 전송은 계속 금지하고 별도 검토한다.

## 실행 상태와 차단 요인
로컬 관리 콘솔: http://localhost:8088. 관리자 키는 Git 제외된 루트 .env의 ADMIN_KEY. Compose 서비스는 실행 상태로 유지한다.
테스트가 만든 Endpoint와 실제 요청은 로컬 DB에 남아 있으며 가짜 통계나 샘플 목록을 주입하지 않았다. smoke 자체 데이터는 자동 정리한다.
Phase 4의 기능 검증 차단 요인은 없다. 이벤트 전달은 best effort이며 유실 시 적용 필터의 REST 재조회가 기준이다. 현재 관리자 키를 공유한 사용자는 모든 Endpoint를 관리하며 계정별 소유권은 아직 없다. 원본 Body·Query·응답 설정·Raw 다운로드에는 민감값이 남을 수 있다. TIMEOUT/FAILED는 저장 실패와 동일하지 않으며 결과 시점 저장 확인과 실제 HTTP 관측을 구분한다.
