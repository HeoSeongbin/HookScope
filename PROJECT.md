# HookScope — 요구사항 및 아키텍처

Webhook Testing & Monitoring Platform. 실제 HTTP 요청을 수신하고 PostgreSQL에 영속 저장하여 개발자가 내용을 분석하는 포트폴리오 프로젝트다.

## 이번 범위
Phase 0–6을 유지하고 Phase 7 인증·사용자별 Endpoint·Rate Limit·만료·보관·정리·감사 이력을 구현한다. 기존 관리 키를 bootstrap 관리자에 연결하며 관리자가 발급한 사용자별 키로 소유권을 구분한다. 공개 회원가입·비밀번호·외부 Replay·Phase 8 UI 개편은 포함하지 않는다.

## 기술 스택
Node.js 24 LTS, TypeScript strict, Express 5, Drizzle ORM 및 node-postgres, PostgreSQL 17, Zod, Pino, React 19, Vite 8, Vitest 5, Supertest, Redis 7 및 BullMQ 5. 실제 설치 버전은 package-lock.json이 기준이다. Redis는 Replay 작업 전달에 사용하며 일반 수신 경로에서는 사용하지 않는다.

## 아키텍처 및 처리 흐름
React → 인증된 REST API → Repository → Drizzle → PostgreSQL.
외부 HTTP → 메서드·요청 크기 검증 → 토큰 조회·응답 설정 스냅샷 → Raw Buffer 및 Parsed Body 분리 → DB insert 완료 → 알림 → 비동기 지연 → 기본/사용자 정의 응답.
DB 실패는 503이며 성공 저장으로 표현하지 않는다. 저장 성공은 업무 처리 성공이 아니라 기록 접수 성공이다. 저장 완료 후 주입된 PublishReceived 콜백으로 실시간 모듈에 식별자 이벤트를 전달한다. 알림 발행 실패가 이미 커밋된 수신 기록을 실패로 바꾸지 않으며 EVENT_PUBLISH_FAILED 로그와 REST 재조회로 구분한다.
HTTP 책임은 app.ts, 파싱은 body.ts, 영속화는 repository.ts, DB 모델은 schema.ts, 시작 및 종료는 server.ts에 둔다.

## 데이터 모델
management_users: UUID, 이름, 역할, enabled, 키 해시/만료 시각. audit_logs: 행위자/소유자/대상 UUID, action, metadata, UTC 시각.
webhook_endpoints: UUID PK, 이름, 암호학적 192bit publicToken UNIQUE, enabled, ownerId FK, expiresAt/보관/한도, UTC createdAt.
webhook_requests: UUID PK, Endpoint FK CASCADE, method, 토큰이 제거된 path, 중복값 배열 query JSONB, 순서 및 중복을 보존한 마스킹 headers JSONB, rawBody Base64, parsedBody JSONB, parseError, contentType, bodySize, receivedAt UTC, responseStatus, durationMs, source(EXTERNAL/TEST/REPLAY), replayAttemptId UNIQUE FK, responseBody/responseHeaders/responseDelayMs 계획 스냅샷.
webhook_response_configs: Endpoint UUID PK/FK CASCADE, mode, status, contentType, body, headers JSONB, delayMs, updatedAt. 설정 upsert는 원자적이며 요청별 스냅샷은 이후 설정 변경으로 수정하지 않는다.
인덱스: endpointId + receivedAt. durationMs는 DB insert 전 캡처 준비 시간으로 전체 응답 지연이 아니다. 응답 상태는 예정 응답이며 실제 소켓 전달 보증이 아니다. 실제 finish는 별도 RESPONSE_SENT 로그로 기록한다.

## API
POST/GET /api/v1/endpoints, GET /api/v1/endpoints/:id,
GET /api/v1/endpoints/:id/requests?page=1 (30건, Phase 3 필터 계약 참조), GET /api/v1/requests/:id.
GET/POST/PUT/PATCH/DELETE /h/:publicToken. HEAD는 405. OPTIONS는 CORS 사전 확인 204이며 저장하지 않는다.
GET/PUT /api/v1/endpoints/:id/response, POST /api/v1/endpoints/:id/test.
GET /health/live, /health/ready. 오류는 {error:{code}} 규약.
상세 API는 rawEncoding: base64를 제공한다. JSONB의 객체 키 순서는 원본 보증 대상이 아니므로 서명 검증에는 rawBody만 사용한다.

## 보안 및 응답 정책
ADMIN_KEY(32자 이상)는 전체 관리 권한의 bootstrap 관리자 키다. 사용자 키는 관리자가 발급한 256bit 난수이고 SHA-256 해시만 DB에 저장하며 30일 만료한다. 공개 수신 토큰과 완전히 분리하고 REST/Socket에서 동일한 신원을 검증한다. 일반 사용자는 자기 Endpoint·요청·Replay·통계·감사만 관리하며 관리자는 전체 범위를 관리한다. 상세 계약은 Phase 7 항목을 따른다.
키는 React 메모리에만 저장한다. 수신 Body 256KiB, 관리 JSON 16KiB, 수신 URL 8KiB, Node 기본 Header 제한 16KiB. 압축 Body는 415. 수신 IP별 120회/분, 관리 IP별 300회/분의 단일 프로세스 제한.
인증/쿠키/API 키 계열 헤더는 저장 전에 마스킹한다. 그 외 본문·쿼리에는 비밀값이 포함될 수 있다. React 텍스트 렌더링으로 실행을 방지한다. IP는 저장하지 않는다. 토큰 경로와 Body는 로그에 남기지 않는다.
외부 URL 전송은 제공하지 않는다. Internal Replay는 아래 Phase 5 계약을 따른다. 기본 응답은 200 {requestId,message:'Request recorded'}. 사용자 정의 응답은 아래 Phase 4 제한을 따른다. 공통 보안 헤더와 허용 origin CORS를 적용한다.
신규 Endpoint 기본 보관은 7일이고 기존 Endpoint는 수동 보관을 유지한다. DB 기반 수신/보관 한도와 제한된 자동 정리를 적용한다. 실제 디스크 전체 용량·HTTPS·복구 훈련·멀티 인스턴스는 별도 검증이 필요하며 공개 서비스 준비 완료로 간주하지 않는다.

## 향후 Phase 및 최종 조건
2: Socket.IO 인증 Room·재연결 REST 동기화. 3: 검색·필터·JSON Tree. 4: 응답 설정·자체 Test Sender. 5: BullMQ Internal Replay·시도 기록·백오프. 6: 실제 DB 기반 통계. 7: 사용자별 권한·만료·보관·감사(이번 구현). 8: 테마·접근성·성능. 9: E2E·공개 포트폴리오 문서 및 시연.
Replay는 PostgreSQL 작업/시도 이력과 멱등성 제약을 함께 설계하며 Job ID만 신뢰하지 않는다. 외부 전송은 허용 목록, DNS/IP 검증, redirect 금지, timeout 및 응답 크기 제한 후 별도 제공한다.
Socket.IO는 DB 저장 이후 식별자 이벤트만 발행하고 REST 재조회가 정합성의 기준이 된다. 멀티 인스턴스에서는 Redis adapter와 공유 rate limiter가 필요하다.
최종 완료는 사용자 원문 28절의 전체 기능 및 테스트 조건을 충족한 시점이며, 현재는 Phase 0–7의 구현 및 명시한 검증 범위만 완료로 평가한다.

## 테스트 전략
파서/브라우저 이벤트 중복 방지 단위 테스트, Supertest 및 실제 Socket 클라이언트 통합 테스트, 실제 PostgreSQL HTTP→DB→Socket→REST 스모크 테스트, Compose 기반 브라우저 E2E를 구분한다. 타입 검사, ESLint, Production Build를 실행한다. 결과 및 차단 사항은 docs/PROGRESS.md 참조.

## Phase 7 보안 및 운영 계약
- migration 0006: management_users와 audit_logs, Endpoint ownerId/만료/보관/한도 컬럼. bootstrap UUID는 00000000-0000-4000-8000-000000000001이며 기존 Endpoint를 연결한다. 기존 원본/파싱 데이터와 Replay FK는 수정하지 않는다. 기존 retentionDays는 null, 신규 기본값만 7이다.
- GET /auth/me, 관리자 전용 GET/POST /users(최신 100개 목록), PATCH /users/:id {enabled}, POST /users/:id/rotate-key. 사용자 키는 한 번만 반환하며 30일 후 만료한다. 재발급은 이전 키를 폐기하고 비활성 계정을 자동 활성화하지 않는다. bootstrap 계정 변경은 거부하며 키 교체는 환경 설정/재시작으로 한다. 공개 가입·암호·쿠키 세션은 없다.
- securityService는 매 REST 요청에서 키/활성/만료를 확인하고 scoped Repository를 주입한다. 일반 사용자의 Endpoint 목록/생성/조회·Request 상세·응답 설정·Test Sender·Replay 생성/조회/시도/취소·Analytics·감사를 같은 소유권으로 제한한다. UUID를 알아도 타인 자원은 404다. ownerId/role을 사용자 입력으로 정하지 않는다.
- Socket handshake/Room 가입/이벤트 전송 시 인증과 소유권을 확인한다. 키 폐기/계정 비활성화 시 해당 사용자 Socket을 즉시 끊고, 10초 재확인으로 만료/DB 외부 변경도 감지한다. 인증 DB 오류에서는 이벤트를 보내지 않는다. 같은 사용자에게 이미 전달된 데이터나 승인된 진행 중 HTTP 요청을 소급 취소하지는 않는다.
- 인증 전 IP별 관리 요청 300회/분, 인증 후 사용자별 300회/분, Socket handshake IP별 120회/분(최대 10000개 메모리 항목), 기존 수신 IP별 120회/분. IP/사용자/Socket 제한은 단일 프로세스이며 공유 프록시 IP는 한도를 공유한다. Endpoint별 수신 한도는 PostgreSQL의 행 잠금과 최근 1분 저장 건수로 집행한다.
- 사용자별 Endpoint 최대 20개, bootstrap 최대 1000개. Endpoint별 Replay 작업은 최대 1000개이며 가득 차도 기존 멱등 키 재조회는 허용한다. Endpoint 정책은 enabled, expiresAt(ISO/null), retentionDays(1–365/null), rateLimitPerMinute(1–1200, 기본 120), maxRequests(1–100000, 기본 10000), maxBodyStorageBytes(1–1GiB, 기본 64MiB). 기존 IP 한도를 늘리지는 않는다. 만료/비활성/비활성 소유자 수신은 404, 수신/보관 한도는 429다. 계정 키 만료 자체는 계정 비활성화가 아니므로 Endpoint 수신을 중단하지 않는다.
- 일반/TEST/REPLAY 저장 모두 같은 트랜잭션 안에서 Endpoint 행을 잠그고 상태·원본 Body 합계·건수·수신률을 확인한다. DB 실패를 성공 접수로 표현하지 않으며 동시 요청이 건수/바이트 한도를 초과해 저장되지 않게 한다. Body 합계는 실제 DB 디스크 사용량이 아니다.
- PUT /endpoints/:id/policy, POST /endpoints/:id/rotate-token, POST /endpoints/:id/cleanup, DELETE /endpoints/:id/requests, DELETE /endpoints/:id. URL 재발급은 기존 토큰으로 새로 승인되는 수신을 거부한다. 전체 이력/Endpoint 삭제는 미완료 Replay가 있으면 409이며 종료 Job/Attempt부터 정리해 FK 정합성을 유지한다. 원본이 삭제된 큐 ID의 늦은 전달은 작업을 수행하지 않는다.
- API 프로세스에서 60초마다 cleanupExpired를 호출하고 CLI cleanup도 제공한다. advisory lock·SKIP LOCKED·쿼리별 5초 timeout으로 최대 20개 Endpoint × 100개 만료 요청을 처리한다. 원본을 참조하는 Job 또는 replayAttemptId가 있는 수신은 보관 기간이 지나도 보존하며 전체 이력 삭제에서 정리한다. 정책 변경은 기존 기록을 즉시 삭제하지 않지만 다음 sweep부터 적용한다.
- 감사는 actorId/ownerId/action/대상 UUID/시각/허용된 정책·건수 metadata만 남긴다. 사용자·Endpoint·정책·응답 설정·Replay 생성/취소·삭제/정리를 해당 DB 변경과 같은 트랜잭션에 기록한다. 본문·공개 토큰·키/해시·요청 Header는 감사에 넣지 않는다. GET /audit는 소유권 범위와 Endpoint 선택, 30건 페이지다. 자동 정리에서 90일 초과 감사 최대 500개도 정리한다. DB 관리자의 변조까지 막는 감사 저장소는 아니다.
- 보안/운영 UI는 사용자 키 발급·폐기, 정책·URL 교체·삭제·감사를 제공한다. 키는 메모리에만 유지하고 401에서 화면 데이터를 비운다. E2E는 RateLimit 응답의 남은 수를 확인해 운영 한도를 낮추거나 우회하지 않고 창 갱신을 기다린다. 공개 배포 전 확인 사항은 docs/SECURITY.md에 명시한다.

## Phase 6 Analytics 계약
- GET /api/v1/dashboard/summary는 현재 관리자가 접근 가능한 전체 Endpoint, GET /api/v1/endpoints/:id/statistics는 검증한 Endpoint 하나만 집계한다. 모두 관리 키 인증과 rate limit을 적용한다. Phase 7에서 member의 전역 집계도 본인 소유권으로 제한하며 bootstrap 관리자만 전체 Endpoint 범위를 관리한다. 공개 토큰은 관리 인증에 사용하지 않는다.
- query는 from/to만 허용하며 명시적 UTC/offset ISO 시각, from < to, 최대 31일이다. to 기본값은 조회 시각, from은 to 이전 24시간이다. 시작 포함·종료 미포함이며 임의/중복 key와 잘못된 범위를 400으로 거부한다. 요청 목록의 검색/페이지와 독립적이다.
- PostgreSQL REPEATABLE READ READ ONLY 트랜잭션에서 전체/기간 건수·Method·예정 Status·출처·UTC 시간량·Endpoint 상위 10개·최근 수신/오류 각각 5개·처리시간을 같은 스냅샷으로 읽는다. SQL 파라미터 바인딩과 쿼리별 5초 statement_timeout을 적용한다. 조회 실패는 503이며 가짜 0건으로 대체하지 않는다.
- endpointCount/allTimeRequests는 보관된 전체 범위, totals 및 분포는 조회 기간의 실제 수신 행이다. EXTERNAL/TEST/REPLAY 모두 포함하며 recentHourRequests는 조회 기간과 to 이전 1시간의 교집합이다. plannedErrorResponses는 예정 상태 >=400, parseErrors는 파싱 오류로 서로 겹칠 수 있다. 업무 성공률·실제 클라이언트 응답 성공률로 표현하지 않는다.
- UTC 시간별 버킷은 최대 745개(31일의 부분 시작/종료 시간 포함)이고 실제 비어 있는 구간만 0으로 채운다. Endpoint 상위 10개 비율도 전체 기간 요청 수를 분모로 사용한다. 최근 오류는 예정 4xx/5xx 또는 파싱 오류이며 HTTP 원문/본문/헤더/쿼리/공개 토큰은 응답에서 제외한다.
- durationMs의 평균/P95는 DB 저장 전 캡처 준비 시간이다. 전체 HTTP 응답 시간으로 이름을 바꾸지 않는다. Replay 실제 HTTP 시간은 시도 startedAt 기간으로 별도 집계하고 durationMs가 있는 시도 수를 함께 제공한다. 측정값이 없으면 평균/P95는 null이다. 불확실 시도도 상태별 건수로 남으며 시간 없는 값을 0으로 꾸미지 않는다.
- analyticsPolicy.ts/analyticsRepository.ts 및 AnalyticsPanel을 분리한다. UI는 선택 Endpoint/전체 Dashboard, 최근 24시간/7일/사용자 기간, SVG 차트와 수치 표, 최근 상세 링크, 활성 탭 15초 조회를 제공한다. 이전 Endpoint/기간 응답은 세대 번호로 무시한다. 캡처·Worker 상태나 알림 발행 로직은 변경하지 않는다.
- migration 0005는 수신 시각/Replay 시작 시각 인덱스만 추가한다. 과거 duration/예정 응답을 새 측정값으로 재작성하지 않는다. 캐시·사전 집계 테이블·새 차트 의존성은 추가하지 않는다. 대규모 부하/전체 wire latency/사용자별 소유권은 이번에 검증하지 않는다.

## Phase 5 Internal Replay 계약
- 관리 인증 후 원본 요청과 활성 Endpoint를 확인한다. POST /api/v1/requests/:id/replay는 UUID idempotencyKey와 maxAttempts(1–3, 기본 3)를 받는다. 같은 키·원본·시도 한도는 같은 작업을 반환하고 다른 입력 재사용은 409다. 관리 IP별 20회/분 제한이며 사용자 목적지 URL은 받지 않는다.
- GET /api/v1/endpoints/:id/replays는 page/status 필터 및 30건 페이지, GET /api/v1/replays/:id와 /attempts는 작업/최대 3개 시도, POST /api/v1/replays/:id/cancel은 대기·재시도 작업만 취소한다. RUNNING/종료 작업은 409이며 CANCELLED 재취소는 멱등이다.
- PostgreSQL webhook_replay_jobs가 상태·원본·Endpoint·멱등 키·queueName·nextAttemptAt을 보관한다. webhook_replay_attempts는 고유 (jobId, number) 및 사전 예약 requestId, 실제 관측 HTTP 응답·소요시간·오류를 보관한다. webhook_requests.source는 REPLAY를 추가하고 replayAttemptId UNIQUE FK로 연결한다. Raw Body와 Parsed Body는 변경하지 않는다. migration 0003/0004를 추가하며 기존 파일은 수정하지 않는다.
- Redis/BullMQ에는 replayId만 넣는다. DB PENDING 저장 후 enqueue하며 실패해도 202/enqueuePending으로 작업을 유지한다. 5초 주기 조정자가 같은 queueName의 미완료 작업 최대 50개를 복구한다. 큐 유실 재등록에도 DB의 nextAttemptAt이 백오프를 지킨다.
- 별도 Worker(동시 2개)는 PostgreSQL advisory lock 및 트랜잭션으로 시도를 예약한다. 2xx 성공, 429/5xx만 1초·2초 백오프와 최대 3회 제한을 적용한다. 다른 HTTP 응답은 실패다. timeout/전송 불확실성/중단된 RUNNING은 UNKNOWN으로 종료하고 자동 재전송하지 않는다. Exactly-once 또는 모든 장애에서 전달 성공을 보증하지 않는다.
- 목적지는 운영자가 설정한 INTERNAL_API_ORIGIN의 http backend/127.0.0.1/localhost와 원본 Endpoint의 고정 /h/:token이다. 원본 바이트·중복 Query·Content-Type을 보내며 허용 X-Test-/X-Mock-/X-Custom-/Accept/User-Agent만 전달한다. Authorization/Cookie/Host/hop Header와 마스킹 값은 제외한다. redirect 금지, 전체 5초, 응답 Header/Body 각 16KiB, URL 8KiB 제한이다.
- HMAC 출처 증명은 시도·예약 Request ID·Endpoint·Method·본문 해시·Query에 결합한다. 관리자 키를 HTTP에 전달하지 않는다. 유효한 RUNNING 작업/시도만 REPLAY 수신을 허용하며 증명 Header는 저장하지 않는다. 시도 행 잠금과 고유 제약으로 동일 시도의 중복 수신을 한 기록으로 연결하고 새 알림도 한 번만 발행한다.
- UI는 작업 상태/필터·시도별 관측 응답·원본 Parsed Body 비교·확인된 수신 상세 링크를 제공하고 활성 탭에서 2초마다 조회한다. 실제 응답과 수신 시점 계획 스냅샷을 구분한다. DB 준비 상태는 Redis와 독립적이며 Worker는 DB 확인 후 Redis에 TTL 15초 heartbeat를 갱신한다.

## Phase 2 실시간 계약
- /socket.io/의 polling 및 WebSocket 연결. Origin 허용 목록과 관리자 키 검증, 최대 메시지 크기 16KiB.
- endpoint:subscribe {endpointId: UUID} → ack {ok:true} 또는 {ok:false,code}. 인증된 관리자 권한과 Endpoint 존재를 확인한다. Socket 하나당 Endpoint Room 하나를 유지하며 변경·종료 시 이전 구독을 정리한다.
- webhook:received {event,endpointId,requestId,method,receivedAt}: DB insert 완료 후 해당 Room에만 전달. 본문·헤더·공개 토큰은 포함하지 않는다. connection:status는 연결 시 서버 상태 알림이다. 수정·삭제 기능이 없는 현재 단계에서는 webhook:updated/deleted 및 endpoint:updated를 발행하지 않는다.
- 클라이언트는 최초 연결 및 재연결마다 Room 가입 ack 뒤 현재 페이지를 REST로 재조회한다. 알림은 75ms 단위로 합쳐 재조회하고 최근 512개 Request ID의 중복 이벤트를 무시한다. 페이지는 API 결과로 교체하므로 오래된 중복 알림도 목록을 중복 삽입하지 않는다.
- Endpoint 변경·로그아웃에서 Socket/리스너/타이머를 정리한다. 오래된 REST 응답은 세대 번호로 무시한다. 다중 탭은 각자 인증·구독·재동기화한다.
- 이벤트는 영속 메시지 큐가 아니다. 연결 중 드물게 알림이 유실되면 수동 갱신·탭 복귀·다음 알림 또는 재연결 재조회로 복구한다. Exactly-once, 멀티 인스턴스 및 Redis adapter는 이번에 보장하지 않는다.

## Phase 3 요청 조회 계약
- query: page(1–10000, 기본 1), method(GET/POST/PUT/PATCH/DELETE), status(100–599), contentType(MIME type, 매개변수 제외), from/to(명시적 시간대 포함 ISO 8601, 양 끝 포함), q(최대 200자), sort(newest/oldest, 기본 newest). 중복·알 수 없는 query key 및 잘못된 범위는 400.
- 조건은 모두 AND로 조합하며 Endpoint ID 조건을 항상 유지한다. Content-Type은 소문자 미디어 타입으로 비교한다. q는 Request ID·Parsed Body·마스킹된 Headers·Query·Content-Type의 대소문자 구분 없는 리터럴 부분 문자열이다. %, _ 및 SQL 문법을 패턴으로 해석하지 않으며 파라미터 바인딩을 사용한다.
- q는 원본 Base64/파싱 실패 본문/binary 본문을 검색하지 않는다. Raw Body는 상세 조회와 다운로드로 확인한다. 검색은 전체 텍스트 인덱스 없이 해당 Endpoint 범위를 스캔하므로 대량 검색 성능은 후속 검토 대상이다.
- 목록(본문 제외, 최대 30건)과 total은 REPEATABLE READ 읽기 전용 트랜잭션의 동일 스냅샷에서 조회한다. receivedAt와 UUID의 동일 방향 정렬로 같은 시각의 순서를 고정한다. 페이지 사이의 동시 수신에 의한 offset 이동은 가능하며 페이지 전체의 영속 스냅샷은 제공하지 않는다.
- UI에서 날짜는 현지 시각으로 입력하고 UTC로 변환한다. 적용/초기화는 첫 페이지로 이동하며 실시간·재연결 재조회는 적용된 필터·정렬·현재 페이지를 유지한다. total은 필터 적용 건수다. 더 이상 존재하지 않는 페이지는 마지막 유효 페이지로 보정한다.
- Inspector: 헤더 이름/값 검색 및 개별·전체 복사, 중복 Query 값별 행, JSON Pretty/Tree, Text/Form, Binary Metadata, Raw UTF-8 또는 Base64 미리보기, 원본 .bin 다운로드. 다운로드는 Base64를 바이트로 디코딩할 뿐 텍스트로 재인코딩하지 않는다.
- JSON 표시·복사는 민감 키(password/token/secret 등)를 기본 마스킹하고 해제할 수 있다. 이는 표시용 휴리스틱이며 저장·검색·Raw/다운로드는 원본 그대로다. Tree는 펼친 노드만 렌더링하고 분기당 100개씩, 최대 32단계로 표시한다. HTML은 텍스트로만 렌더링한다.

## Phase 4 응답 및 테스트 정책
- 설정: mode DEFAULT/CUSTOM, status 200–599, contentType application/json 또는 text/plain, body UTF-8 최대 8KiB, delayMs 0–2000 정수, headers 최대 12쌍. Header 이름은 X-Test-/X-Mock-/X-Custom- 접두사와 짧은 ASCII 이름만 허용하며 값은 탭/인쇄 가능한 ASCII 최대 512자, 중복 이름(대소문자 무시)·CRLF를 거부한다. 204/205/304의 Body는 비워야 한다.
- DEFAULT는 사용자 정의 값을 사용하지 않고 기존 200 접수 JSON을 반환한다. CUSTOM JSON Body는 의도적인 잘못된 JSON 응답 테스트를 허용하므로 문자열로 저장한다. Content-Length, Location, Set-Cookie, 보안/프록시/연결 Header는 설정할 수 없다.
- 수신 전용 응답 계획을 만든 뒤 본문·응답 상태·응답 애플리케이션 Header·지연·출처를 요청과 함께 저장한다. DB 저장 실패 시 Custom 성공 응답을 보내지 않고 기존 계획 Header를 지운 503 오류를 반환한다. 저장 후 알림을 발행하고 timers/promises로 지연한다. 완료/중단은 RESPONSE_SENT/RESPONSE_ABORTED 로그로 구분한다. 저장된 스냅샷은 클라이언트 수신 보증이 아니며 Date/프록시 Header 등 최종 wire Header 전체를 보존하지 않는다.
- 테스트 입력: method 5종, contentType JSON/Text/Form, body UTF-8 최대 8KiB, Header 최대 12쌍(위 X- 접두사 및 Accept/User-Agent만), Query 최대 20쌍(이름 80자/값 512자, 인코딩 후 4KiB). GET은 빈 Body만 허용한다. 전체 관리 JSON 16KiB 제한도 적용한다.
- 관리 인증과 Endpoint 존재/활성 상태를 확인한 뒤 서버 자신의 숫자 주소 127.0.0.1 및 실제 listening port의 고정 /h/:token으로 HTTP 요청한다. 사용자 URL, Host 기반 목적지, DNS, 인증 Header 전달, redirect 추적, 자동 재시도는 없다. 테스트 응답 Header 16KiB·Body 16KiB·전체 시간 5초·동시 전송 8개·관리 IP별 20회/분으로 제한한다.
- 일회용 256bit 내부 토큰을 Endpoint와 사전 발급 Request ID에 묶어 한 번만 claim한다. 예약 Header는 이력에서 제거하며 외부의 임의/재사용 값은 TEST 권한을 주지 않는다. 일반 X-HookScope-Test 같은 사용자 Header는 보존한다. 토큰은 로그·응답·본문에 노출하지 않고 완료/실패 시 정리한다.
- 테스트 API 200은 전송 실행 결과를 반환했다는 의미다. outcome(RESPONSE/TIMEOUT/FAILED), response(status/headers/body 또는 null), durationMs, recorded, requestId를 제공한다. HTTP 4xx/5xx 모의 응답과 전송 실패를 구분한다. recorded는 결과 시점에 DB에서 확인한 저장 여부이며 확인된 요청만 링크한다. 시간 초과 후 늦은 저장은 이후 목록에서 확인할 수 있다.
- TEST 요청은 기존 수신 경로·제한·저장·Socket 알림을 모두 통과하며 일반 이력과 함께 source로 구분한다. 전송 실패 자체의 별도 영속 Job/Attempt 이력은 Phase 5 대상이다. 설정 변경 감사 이력은 이번에 제공하지 않고 수신 시점 스냅샷만 유지한다.
- migration runner는 advisory lock과 단일 트랜잭션 안에서 순서대로 미적용 SQL 파일을 실행하고 schema_migrations에 기록한다. 기존 0001은 idempotent이므로 기존 DB에 ledger를 도입해도 데이터가 유지된다. 적용한 migration 파일은 수정하지 않고 새 파일을 추가한다.
