# Architecture Decision Records

## ADR-001 · Express 5와 Drizzle (채택)
HTTP 수신 및 미들웨어 경계를 명시하기 위해 Express를 사용한다. 작은 Phase 1 모델과 PostgreSQL JSONB를 직접 다루고 SQL 마이그레이션을 검토하기 위해 Drizzle을 선택한다. npm audit 결과에 따라 Drizzle 0.45.4와 Vitest 5.1.0으로 상향했다.

## ADR-002 · 단일 로컬 관리자와 공개 토큰 분리 (채택)
ADMIN_KEY로 모든 관리 API를 보호하고 24바이트 난수 publicToken은 수신 식별에만 사용한다. 계정 및 소유권 모델은 Phase 7. 현재 공유 키 정책을 다중 사용자 인증으로 표현하지 않는다.

## ADR-003 · 원본 바이트 및 중복값 (채택)
express.raw inflate:false와 Base64 text 저장으로 UTF-8 정규화 없이 원본 바이트를 복구한다. JSON 파싱 실패도 정상 기록한다. 중복 헤더는 쌍 배열, Query/Form은 값 배열. 민감 헤더는 저장 전 제거하므로 헤더 원문 전체 보존보다 비밀 보호를 우선한다.

## ADR-004 · 실시간·Redis·Replay (계획)
PostgreSQL을 기록의 기준으로 유지한다. Phase 2의 Socket.IO 인증 Room, 저장 후 이벤트 발행 및 재연결 REST 재조회는 구현했다. 멀티 인스턴스는 Redis adapter와 공유 limiter 필요. Phase 5에 BullMQ Internal Replay, DB 시도 이력, 제한된 재시도·백오프·중복 실행 방지를 구현한다. 현재 Worker와 Redis adapter는 없다.

## ADR-008 · 인증된 단일 Endpoint Room (채택, Phase 2)
REST와 Socket에 공통 상수 시간 관리자 키 검증을 적용한다. Socket handshake.auth로 키를 전달하고 URL/query/localStorage에는 보관하지 않는다. 공개 수신 토큰은 Socket 인증에 사용할 수 없다. 서버에서 UUID·Endpoint 존재·관리 권한을 확인한 뒤 endpoint:{id} Room에 가입한다. 현재 단일 관리자는 모든 기존 Endpoint 권한이 있으며 사용자별 소유권은 Phase 7이다. 임의 room 이름을 받지 않는다. 구독 변경 시 이전 Room을 떠나고 Socket 종료 시 정리한다. 브라우저 Origin은 polling과 WebSocket 모두 검사한다.

## ADR-009 · 커밋 이후 best-effort 알림과 REST 동기화 (채택, Phase 2)
수신 코드는 PublishReceived 콜백만 알고 Socket.IO 서버를 직접 참조하지 않는다. Drizzle insert가 완료된 후 본문 없는 메타데이터를 발행한다. 발행 예외는 EVENT_PUBLISH_FAILED로 구분하고 저장 성공 응답은 유지한다. 이벤트의 개별 클라이언트 전달을 보증했다고 로그에 기록하지 않는다. DB outbox나 재전송 큐는 추가하지 않는다.
클라이언트는 Room 가입 ack 후 REST를 조회하여 연결 공백을 복구한다. 중복 ID 512개를 제한된 메모리로 제거하고 75ms 동안의 알림을 합친다. 데이터는 항상 PostgreSQL 기반 페이지 응답으로 교체한다. Socket.IO connectionStateRecovery만으로 복구를 보장한다고 가정하지 않으며 재연결마다 인증·가입·조회한다. 조회 세대 번호로 이전 Endpoint·페이지·로그아웃 전 응답이 최신 상태를 덮지 못하게 한다.

## ADR-010 · Phase 2 검증 및 Lint (채택)
기존 테스트 17개를 유지하고 실제 Socket 클라이언트의 인증/Origin/Room/저장 경계 통합 테스트와 브라우저 중복 알림 단위 테스트를 추가한다. 실제 PostgreSQL smoke에 인증된 Socket 알림과 저장 행의 ID·수신 시각 대조를 추가했다. Playwright는 실제 Compose WebSocket 프레임만 중복 전달하거나 끊어 연결 공백을 재현하며 HTTP 요청 데이터는 조작하지 않는다. ESLint flat config와 TypeScript ESLint를 추가하고 CI에 lint를 연결한다.

## ADR-005 · 데이터 보관 및 중복 (부분 채택)
동일한 요청이 다시 와도 새로운 UUID로 별도 저장한다. 원본 요청 수신은 멱등성을 강제하지 않는다. Phase 1은 수동 보관이고 자동 TTL 및 용량 정책은 Phase 7로 이월한다. 로컬용 제한을 README에 명시한다.

## ADR-006 · 외부 전송 보안 (채택)
Phase 1은 서버 발 외부 HTTP 전송 기능을 제공하지 않는다. 이후 기본 Replay는 내부 엔드포인트 한정. External Replay는 허용 목록 및 SSRF·DNS rebinding·redirect·timeout·크기 제한을 별도 검증한다.

## ADR-007 · 준비 상태와 저장 성공 의미 (채택)
live는 프로세스, ready는 실제 요청 테이블 접근 가능 여부. DB insert 이전에 성공 응답하지 않는다. responseStatus는 설정된 응답이며 클라이언트 수신 여부와 구분한다. durationMs는 저장 전 준비 시간이다. 배포는 HTTPS·저장 한도·다중 사용자 권한 구현 전 공개하지 않는다.
