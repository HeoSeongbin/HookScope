# Phase 1–4 검증

## 자동화
1. Vitest/Supertest: 관리 인증, 생성 토큰, JSON 원본 바이트, 중복 Query, 비밀 헤더 마스킹, malformed JSON, GET/PUT/PATCH/DELETE, 256KiB 초과, DB 실패, 토큰/메서드 거부, 입력 검증, live/ready, Text/Form/Binary 파싱, 중복 헤더 및 프로토타입 키.
2. PostgreSQL smoke: 독립 HTTP 서버→Endpoint 생성→한국어 JSON 수신→DB 직접 원본 바이트 및 중복 query 비교→목록/상세→미인증 거부→테스트 데이터 CASCADE 정리.
3. Playwright: Compose 프론트 접속→키 입력→Endpoint 생성→실제 HTTP POST→수동 목록 갱신→Body/Headers/Query/Raw 확인→데스크톱/모바일 스크린샷 및 가로 넘침 확인.

## 수동 재현
Docker Desktop 실행 후 README의 Compose 명령으로 전체 서비스를 올린다. 모든 서비스 healthy를 확인한다. 관리 화면에서 Endpoint를 만들고 docs/curl-sample.json을 curl.exe로 전송한다. 응답 200 및 requestId를 확인한 다음 화면 새로고침 후 목록/본문을 확인한다.

## Phase 2 추가 검증
1. 실제 Socket 클라이언트: 비어 있는/잘못된 키/공개 수신 토큰 인증 거부, 허용되지 않은 WebSocket Origin 거부.
2. 인증 후 UUID/Endpoint 존재 확인, DB 조회 실패 시 구독 오류, Endpoint Room 격리, 두 탭 전달, 이전 Room 이탈 및 disconnect 정리.
3. 지연된 DB 저장 Promise 완료 전 알림이 없음을 확인. 저장 실패 시 알림이 없고, 알림 발행 예외가 저장 성공 응답을 바꾸지 않음을 확인.
4. 브라우저 알림 게이트 단위 테스트: 중복·잘못된 이벤트·다른 Endpoint 거부, 메모리 제한 및 구독별 초기화.
5. 실제 PostgreSQL smoke: 저장 행과 Socket 이벤트의 Request ID, Endpoint ID, receivedAt 일치 확인.
6. Compose E2E: 새로고침 없이 두 탭에 표시, 실제 WebSocket 알림 프레임만 재전달해 REST 중복 조회가 없음을 확인, 한 탭 연결을 끊고 HTTP 접수 후 재연결하여 요청 복구. 모바일 화면 및 로그아웃 확인.

## Phase 3 추가 검증
1. Query 스키마: page/method/status/MIME/날짜/정렬/q 길이·NUL·중복/알 수 없는 키 및 역전 시간 범위. 인증 없이 검색 API에 접근할 수 없으며 Endpoint ID와 검증된 조건을 Repository로 전달.
2. Inspector 단위 테스트: 시간대 직렬화, Header/Query 중복 및 프로토타입 유사 키, binary Base64 바이트 복원, 비파괴 JSON 마스킹.
3. 실제 PostgreSQL `smoke:filters`: Endpoint 두 개에 HTTP 요청 36건 수신. 35건 Endpoint를 30/5로 조회하고 누락/중복·본문 미포함·다른 Endpoint 격리를 확인. Method+Status+MIME 조합, 한국어/리터럴 %_ 및 SQL 문법 검색, Header/Query 검색, 정렬 양방향, UTC·offset 기간 및 binary 바이트 확인. 자체 데이터를 삭제.
4. Compose E2E: 필터 적용 중 제외 Method 요청이 표시되지 않고 일치 요청은 실시간 추가됨. JSON Tree 펼치기/마스킹, 헤더 검색·클립보드 내용, 중복 Query 행, 모바일 가로 넘침과 binary 다운로드 바이트 확인.
5. Compose E2E: HTTP 31건으로 30/1 페이지·오래된순·필터 적용 시 1페이지 복귀·Status 500 빈 결과·과거 날짜·조건 초기화 확인.
6. Compose E2E: Form 중복 키 및 HTML 안전한 텍스트 표시, Buffer로 전송한 malformed JSON의 오류와 Raw 내용, Text의 script 문자열 비실행 확인.

## Phase 4 추가 검증
1. 설정/테스트 입력: 상태·UTF-8 byte 한도·지연·CRLF/중복/위험 Header·빈 본문 상태·사용자 URL·인증 Header·GET Body·Query 크기 거부.
2. 실제 로컬 HTTP와 Repository 더블: 관리자 인증/Endpoint·활성 확인, 422 응답/TEST 이력, 외부 위조 거부, 저장 실패 시 사용자 응답 제거 및 503, 204/205/304의 빈 응답과 기록 연결, 비동기 지연 중 health 응답.
3. Transport 전용 실제 서버: 일회용 Endpoint-bound claim, 관리 Authorization 미전달, redirect 대상 미접속, 최대 응답 Body·전체 timeout·8개 동시 전송 제한과 실패 정리.
4. 실제 Compose DB migration: 기존 요청 130건 유지, ledger에 0001/0002 기록, 재실행 후 130건 그대로 유지 확인.
5. 실제 PostgreSQL response smoke: 설정 테이블 저장, Test Sender로 한국어 원본 바이트 및 중복 Query 수신, TEST/source·Request ID·응답 snapshot 확인, 422/204, 설정 변경 후 과거 기록 불변, 기본 복원·외부 위조 거부. 자체 데이터 정리.
6. Compose E2E: 응답 설정 저장→실제 전송 결과와 TEST 배지→상세/Query/Response→204→기본 모드→외부 요청, 다른 Endpoint 기본값 및 재선택한 설정 영속화, 데스크톱/모바일 가로 넘침 검증.

Replay·외부 전송·계정별 소유권·TTL·부하·멀티 인스턴스 검증은 후속 Phase 대상이며 통과 처리하지 않는다.
