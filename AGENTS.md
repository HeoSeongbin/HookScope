# HookScope 작업 규칙

작업 전 PROJECT.md, docs/PROGRESS.md, docs/DECISIONS.md와 실제 소스 및 Git 상태를 확인한다.
현재 Phase의 범위를 지키고 기존 정상 기능을 보존한다. 구현 전 수신·저장·조회·UI에 미치는 영향을 분석한다.
핵심 동작에 테스트를 추가하고 타입 검사, 빌드, 관련 통합 테스트를 실행한다.
설계 변경은 docs/DECISIONS.md에 기록하고 작업 종료 시 README.md 및 docs/PROGRESS.md를 갱신한다.
검증하지 못한 기능을 완료로 표시하지 않는다. 테스트 더블과 실제 PostgreSQL 검증을 명확히 구분한다.
공개 수신 토큰을 관리 인증에 사용하지 않는다. Raw Body 바이트, 크기 제한, 저장 실패 시 오류 응답을 보존한다.
인증 키, 공개 토큰, 요청 Body를 서버 로그에 출력하지 않는다. .env를 커밋하지 않는다.
Phase 2 이후 기능은 별도 요청 전 구현하지 않는다.
