# Phase 1–5 아키텍처

## Phase 5 재전송 경계
replayPolicy.ts는 입력·안전한 Header·고정 내부 origin·HMAC·결과 분류, replayTransport.ts는 실제 HTTP 및 5초/16KiB 제한을 담당한다. replayService.ts는 관리 API 조합과 durable outbox 조정, replayRepository.ts는 PostgreSQL 작업/시도/중복 수신 트랜잭션을 담당한다. replayQueue.ts는 BullMQ 연결과 제한된 enqueue 대기, replayWorker.ts는 실행/재시도 상태, worker.ts/workerHealth.ts는 별도 프로세스와 DB 확인 후 heartbeat를 담당한다.

인증된 생성 → 원본/활성 Endpoint 검증 → DB PENDING → Redis 작업 ID → Worker PG advisory lock → 시도/예약 Request ID 커밋 → 서명된 고정 내부 HTTP → 기존 수신·DB·Socket 흐름 → 실제 관측 응답을 시도/작업에 저장한다. QUEUED/RUNNING/RETRYING/SUCCEEDED/FAILED/CANCELLED/UNKNOWN을 DB가 관리한다. 429/5xx만 최대 3회 재시도하고 불확실 결과는 UNKNOWN이다.

API의 5초 조정자는 같은 queueName의 미완료 50개만 검사한다. Redis 유실/재등록 시에도 DB nextAttemptAt을 지킨다. 동일 시도 수신은 행 잠금·고유 FK로 한 기록에 연결한다. 일반 수신은 Redis를 사용하지 않으며 DB readiness와 Worker heartbeat를 구분한다. Compose는 별도 worker를 추가한 다섯 서비스다. Redis는 로컬 소스 개발용 loopback 6379도 제공한다.

ReplayCenter.tsx는 작업 상태/페이지·취소·시도별 HTTP 결과·원본 비교를 제공하고 활성 탭에서 2초 polling한다. Socket은 기존처럼 수신 메타데이터만 전달하며 작업 상태의 기준은 REST/DB다. EndpointTools와 ReplayCenter의 key를 구분해 컴포넌트 상태를 보존한다.

아래는 Phase 1–4의 유지된 구성이다.

frontend/src/main.tsx: 메모리 내 관리자 키, Endpoint 선택, 수동 REST 조회 및 상세 보기.
frontend/src/useRealtime.ts: Socket 연결·구독·재연결·정리 및 REST 재조회 예약.
frontend/src/realtimeEvents.ts: 제한된 ID 집합으로 알림 중복·Endpoint 검증.
frontend/src/RequestFilters.tsx 및 types.ts: 검색 초안·적용값 분리와 시간대 포함 query 직렬화.
frontend/src/RequestInspector.tsx, JsonTree.tsx, inspectorData.ts: 상세 탭·헤더 검색/복사·중복값 표·JSON 트리·표시 마스킹·원본 바이트 다운로드.
frontend/src/EndpointTools.tsx: 선택 Endpoint 응답 설정·자체 HTTP Test Sender·실제 결과와 저장 요청 상세 연결. Endpoint 변경 시 이전 도구 상태를 정리한다.
backend/src/app.ts: HTTP 라우팅·관리 인증·크기 제한·수신/조회 조합.
backend/src/body.ts: Raw Buffer에서 JSON/Text/Form 해석 및 헤더 마스킹.
backend/src/repository.ts: Drizzle CRUD. 테스트에서는 이 경계에 더블 주입.
backend/src/requestFilters.ts: Zod query 검증 및 Endpoint 범위 SQL 조건. 사용자 문자열은 SQL 파라미터로 전달한다.
backend/src/responsePolicy.ts: 응답 스키마 및 요청별 고정 응답 계획.
backend/src/testSender.ts: 입력 검증·자체 숫자 루프백 HTTP 전송·일회용 출처/Request ID·timeout/size/concurrency 제한. app.ts는 인터페이스를 주입받는다.
backend/src/responseSmoke.ts: 실제 PostgreSQL 설정/스냅샷·HTTP 전송·출처·빈 응답·과거 이력 불변 검증.
backend/src/filterSmoke.ts: 실제 HTTP 36건 기반 필터·검색·페이지·원본 바이트 DB 검증, 자체 데이터 정리.
backend/src/schema.ts 및 migrations/0001_initial.sql: 모델 및 초기 PostgreSQL 스키마.
backend/src/server.ts: 환경 설정·시작·종료.
backend/src/auth.ts: HTTP 및 Socket 공통 관리자 키 검증.
backend/src/realtime.ts: Origin/Socket 인증, Endpoint Room 가입, 식별자 알림 발행.
backend/src/smoke.ts: 실제 HTTP→PostgreSQL 검증, 자체 생성 데이터 정리.

공개 수신과 관리 API는 별도 경로 및 인증 경계다. URL을 알고 있어도 기록 조회 권한은 없다. Phase 1은 하나의 개발 관리자이므로 사용자 테이블은 아직 없다.
원본 본문과 Parsed Body는 독립 저장한다. 민감 헤더는 보존 대상에서 제외한다. 원본 수신 URL 토큰은 저장 경로와 로그에서 제거한다. Nginx access log도 비활성화하여 수신 URL을 남기지 않는다.
단일 인스턴스 메모리 Rate Limit은 멀티 인스턴스에서 공유되지 않는다. Redis adapter는 후속 Phase에 연결한다. 수신 라우트는 DB 저장 완료 후 주입된 publish 콜백을 호출하고 실시간 모듈은 해당 Endpoint Room에 식별자 이벤트를 보낸다. 발행 실패는 이미 저장된 기록을 롤백하지 않는다.
브라우저는 Room 가입 확인 뒤 REST를 조회하고 새 알림에서도 현재 페이지를 재조회한다. 이벤트를 목록 데이터로 직접 누적하지 않는다. 재연결·탭 복귀·수동 갱신으로 유실된 알림을 복구할 수 있다. 초기 조회 및 실시간 조회 간 경쟁은 세대 번호로 제어한다.
현재 적용된 필터와 정렬을 실시간 재조회에도 그대로 사용한다. 목록/total은 한 REPEATABLE READ 읽기 전용 트랜잭션의 스냅샷을 사용하며 receivedAt/UUID로 정렬한다. 페이지는 본문 없이 30건만 반환한다. 조건 변경은 페이지/상세를 초기화하며 로그아웃 시 필터도 초기화한다. JSON 표시 마스킹은 데이터 복사본에만 적용하고 Base64 Raw Body 저장값은 변경하지 않는다.

Docker Compose는 nginx 정적 프론트/리버스 프록시, Node HTTP + Socket.IO 서버, PostgreSQL, Redis로 구성한다. nginx와 Vite 모두 /socket.io/ polling 및 WebSocket upgrade를 프록시한다. 컨테이너 API 시작 시 migration을 먼저 실행한다. DB 실패 시 ready 및 수신 API에서 성공을 반환하지 않는다. 실시간 연결에는 별도 DB 테이블이나 스키마 변경이 필요하지 않다.
Phase 4는 webhook_response_configs와 요청별 응답 계획/출처 컬럼을 migration 0002로 추가한다. schema_migrations ledger·advisory lock·트랜잭션으로 미적용 파일만 순서대로 실행한다. 테스트 전송은 같은 API 프로세스의 loopback에만 도달하며 외부 URL 또는 관리 인증 키를 전송하지 않는다. 수신 측은 일회용 내부 증명을 확인하고 기존 저장/알림 흐름에 합류한다. 응답 실패와 저장 실패는 독립적으로 표시하며 스냅샷과 실제 Test Sender 관측 결과를 구분한다.
