# HookScope — 요구사항 및 아키텍처

Webhook Testing & Monitoring Platform. 실제 HTTP 요청을 수신하고 PostgreSQL에 영속 저장하여 개발자가 내용을 분석하는 포트폴리오 프로젝트다.

## 이번 범위
Phase 0–3의 수신·저장·실시간·검색·분석을 유지한다. 이번 작업은 Phase 4의 사용자 정의 응답과 자체 Endpoint Test Sender만 구현한다. Replay, BullMQ 및 외부 URL 전송은 포함하지 않는다.

## 기술 스택
Node.js 24 LTS, TypeScript strict, Express 5, Drizzle ORM 및 node-postgres, PostgreSQL 17, Zod, Pino, React 19, Vite 8, Vitest 5, Supertest. 실제 설치 버전은 package-lock.json이 기준이다. Redis 7은 향후 큐용으로 Compose에 준비하되 Phase 1 수신 경로에서는 사용하지 않는다.

## 아키텍처 및 처리 흐름
React → 인증된 REST API → Repository → Drizzle → PostgreSQL.
외부 HTTP → 메서드·요청 크기 검증 → 토큰 조회·응답 설정 스냅샷 → Raw Buffer 및 Parsed Body 분리 → DB insert 완료 → 알림 → 비동기 지연 → 기본/사용자 정의 응답.
DB 실패는 503이며 성공 저장으로 표현하지 않는다. 저장 성공은 업무 처리 성공이 아니라 기록 접수 성공이다. 저장 완료 후 주입된 PublishReceived 콜백으로 실시간 모듈에 식별자 이벤트를 전달한다. 알림 발행 실패가 이미 커밋된 수신 기록을 실패로 바꾸지 않으며 EVENT_PUBLISH_FAILED 로그와 REST 재조회로 구분한다.
HTTP 책임은 app.ts, 파싱은 body.ts, 영속화는 repository.ts, DB 모델은 schema.ts, 시작 및 종료는 server.ts에 둔다.

## 데이터 모델
webhook_endpoints: UUID PK, 이름, 암호학적 192bit publicToken UNIQUE, enabled, UTC createdAt.
webhook_requests: UUID PK, Endpoint FK CASCADE, method, 토큰이 제거된 path, 중복값 배열 query JSONB, 순서 및 중복을 보존한 마스킹 headers JSONB, rawBody Base64, parsedBody JSONB, parseError, contentType, bodySize, receivedAt UTC, responseStatus, durationMs, source(EXTERNAL/TEST), responseBody/responseHeaders/responseDelayMs 계획 스냅샷.
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
단일 로컬 관리자 ADMIN_KEY(32자 이상) Bearer 인증. 공개 토큰과 완전히 분리하며 모든 관리 API에 인증을 적용한다. Socket.IO handshake.auth.token에도 동일한 관리자 키를 검증한다. 이 로컬 관리자는 모든 기존 Endpoint를 관리할 수 있으나 공개 수신 토큰으로는 Socket 연결할 수 없다. 계정별 소유권은 Phase 7 대상이다.
키는 React 메모리에만 저장한다. 수신 Body 256KiB, 관리 JSON 16KiB, 수신 URL 8KiB, Node 기본 Header 제한 16KiB. 압축 Body는 415. 수신 IP별 120회/분, 관리 IP별 300회/분의 단일 프로세스 제한.
인증/쿠키/API 키 계열 헤더는 저장 전에 마스킹한다. 그 외 본문·쿼리에는 비밀값이 포함될 수 있다. React 텍스트 렌더링으로 실행을 방지한다. IP는 저장하지 않는다. 토큰 경로와 Body는 로그에 남기지 않는다.
외부 URL 전송·Replay는 이번 범위에서 제공하지 않는다. 기본 응답은 200 {requestId,message:'Request recorded'}. 사용자 정의 응답은 아래 Phase 4 제한을 따른다. 공통 보안 헤더와 허용 origin CORS를 적용한다.
보관 자동 정리·전체 저장량 한도는 Phase 7로 예정. Phase 1 데이터는 수동 삭제 전까지 유지되므로 로컬 개발에서만 사용한다. 공개 서비스 준비 완료로 간주하지 않는다.

## 향후 Phase 및 최종 조건
2: Socket.IO 인증 Room·재연결 REST 동기화. 3: 검색·필터·JSON Tree. 4: 응답 설정·자체 Test Sender(이번 구현). 5: BullMQ Internal Replay·시도 기록·백오프. 6: 실제 DB 기반 통계. 7: 사용자별 권한·만료·보관·감사. 8: 테마·접근성·성능. 9: E2E·공개 포트폴리오 문서 및 시연.
Replay는 PostgreSQL 작업/시도 이력과 멱등성 제약을 함께 설계하며 Job ID만 신뢰하지 않는다. 외부 전송은 허용 목록, DNS/IP 검증, redirect 금지, timeout 및 응답 크기 제한 후 별도 제공한다.
Socket.IO는 DB 저장 이후 식별자 이벤트만 발행하고 REST 재조회가 정합성의 기준이 된다. 멀티 인스턴스에서는 Redis adapter와 공유 rate limiter가 필요하다.
최종 완료는 사용자 원문 28절의 전체 기능 및 테스트 조건을 충족한 시점이며, 현재는 최초 Phase 검증만 평가한다.

## 테스트 전략
파서/브라우저 이벤트 중복 방지 단위 테스트, Supertest 및 실제 Socket 클라이언트 통합 테스트, 실제 PostgreSQL HTTP→DB→Socket→REST 스모크 테스트, Compose 기반 브라우저 E2E를 구분한다. 타입 검사, ESLint, Production Build를 실행한다. 결과 및 차단 사항은 docs/PROGRESS.md 참조.

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
