# 개발 상태 — 2026-11-18

## 현재 Phase
**Phase 0–2 구현·검증 완료. 다음 미완료 단계는 Phase 3이다.** 로컬 개발용 단일 관리자 MVP이며 공개 운영 준비 완료를 의미하지 않는다. 아래 Phase 1 기록은 유지하고 이번 검증을 별도 기록한다.

## Phase 2 구현 및 검증 (이번 작업)
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

## 이번 변경 파일
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
- Phase 3 이후 검색/필터, JSON Tree, Custom Response, Test Sender, Replay/Worker, 통계, 다중 사용자 인증, 자동 보관·정리, 전체 용량 및 엔드포인트별 quota는 미구현.
- 현재 본문·쿼리는 원문 보관. 자동 TTL 없이 수동 DB 정리 전까지 유지.
- 응답 durationMs는 DB insert 전 준비 시간이고 실제 전체 처리시간이 아니다.
- 대량 요청 부하 테스트·공개 배포·HTTPS·원격 CI는 미검증.
- 폴더는 시작 시 Git 저장소가 아니었다. 원격 생성·배포·커밋은 수행하지 않았다.

## 다음 작업
Phase 3: Header 상세 검색/복사, Query 상세, JSON Tree Viewer, Raw Body 및 Request Inspector 개선, Method/시간/Content-Type 필터, 키워드 검색과 페이지네이션 UX. 기존 실시간 동기화와 필터 상태 간 정합성도 함께 검증한다.

## 실행 상태와 차단 요인
로컬 관리 콘솔: http://localhost:8088. 관리자 키는 Git 제외된 루트 .env의 ADMIN_KEY. Compose 서비스는 실행 상태로 유지한다.
테스트가 만든 Endpoint와 실제 요청은 로컬 DB에 남아 있으며 가짜 통계나 샘플 목록을 주입하지 않았다. smoke 자체 데이터는 자동 정리한다.
Phase 2의 기능 검증 차단 요인은 없다. 개발 도구 advisory는 업데이트 추적이 필요하다. 이벤트 전달은 best effort이며 유실 시 REST 재조회가 기준이다. 현재 관리자 키를 공유한 사용자는 모든 Endpoint를 관리하며 계정별 소유권은 아직 없다.
