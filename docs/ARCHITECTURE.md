# Phase 1–3 아키텍처

frontend/src/main.tsx: 메모리 내 관리자 키, Endpoint 선택, 수동 REST 조회 및 상세 보기.
frontend/src/useRealtime.ts: Socket 연결·구독·재연결·정리 및 REST 재조회 예약.
frontend/src/realtimeEvents.ts: 제한된 ID 집합으로 알림 중복·Endpoint 검증.
frontend/src/RequestFilters.tsx 및 types.ts: 검색 초안·적용값 분리와 시간대 포함 query 직렬화.
frontend/src/RequestInspector.tsx, JsonTree.tsx, inspectorData.ts: 상세 탭·헤더 검색/복사·중복값 표·JSON 트리·표시 마스킹·원본 바이트 다운로드.
backend/src/app.ts: HTTP 라우팅·관리 인증·크기 제한·수신/조회 조합.
backend/src/body.ts: Raw Buffer에서 JSON/Text/Form 해석 및 헤더 마스킹.
backend/src/repository.ts: Drizzle CRUD. 테스트에서는 이 경계에 더블 주입.
backend/src/requestFilters.ts: Zod query 검증 및 Endpoint 범위 SQL 조건. 사용자 문자열은 SQL 파라미터로 전달한다.
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
