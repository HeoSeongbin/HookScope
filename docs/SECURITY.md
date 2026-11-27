# 보안 및 공개 배포 점검 — Phase 7

## 구현·검증한 경계
- ADMIN_KEY와 공개 수신 토큰 분리. 관리자 발급 사용자 키는 256bit 난수·해시 저장·30일 만료·폐기/재발급. 키는 브라우저 메모리에만 보관한다.
- 대소문자를 섞은 관리 경로에서도 동일한 소유권 검사를 적용하며 Express 라우팅과 검사 규칙을 맞춘 회귀를 검증했다.
- 일반 사용자의 Endpoint·요청·Test Sender·Replay/시도·통계·감사 격리. 관리자만 사용자 계정을 관리한다. REST 자원 UUID 추측과 Socket 타인 Room 가입을 거부한다.
- Socket 구독·이벤트 전송 시 신원 재확인 및 폐기 연결 해제. 계정 비활성화는 수신도 막으며 키 만료와 Endpoint 만료는 별개다.
- 인증 전 IP와 인증 후 사용자 한도, Socket handshake 한도, PostgreSQL 기반 Endpoint별 수신/보관 한도. 동시 10개 요청에서 maxRequests=2일 때 2건만 저장되는 실제 DB 검증을 수행했다.
- Raw/Parsed 보존·민감 Header 마스킹·크기/URL/timeout/redirect 제한 유지. Replay는 자체 고정 origin만 허용하며 관리 인증을 전송하지 않는다.
- 운영 변경과 감사 metadata를 같은 트랜잭션으로 저장. 만료 정리는 Replay 참조를 보존하고, 진행 중 Replay가 있으면 전체 삭제를 거부한다.
- 인증 키·공개 토큰·본문은 서버 로그/감사에 기록하지 않는다. .env는 Git 및 Docker 빌드에서 제외한다. 테스트에서만 발급된 사용자 키는 스크린샷 전에 닫는다.

## 공개 환경에서 아직 검증하지 않은 항목
- 실제 HTTPS 인증서/도메인·TLS 종료 프록시·HSTS 적용 결과. 현재 Compose 포트는 loopback에만 바인딩된다.
- 여러 인스턴스의 공유 IP/사용자/Socket Rate Limit과 Socket Redis adapter. 현재 프록시 뒤 요청은 프록시 peer IP 한도를 공유하며 임의의 X-Forwarded-For를 신뢰하지 않는다. 운영 ingress를 정할 때 신뢰할 proxy 범위와 실제 IP 처리를 함께 검증해야 한다.
- 대규모 트래픽·장기 집계·cleanup contention 및 전체 DB/Volume 디스크 한도·백업 복구 훈련. Body 합계 한도가 실제 디스크 용량 한도는 아니다.
- 공개 회원가입·비밀번호·SSO·MFA·쿠키 세션 및 로그인 계정 복구. 현재는 관리자가 키를 발급/재발급하는 방식이다. ADMIN_KEY 공유자는 전체 관리 권한을 가진다.
- 키 배포/회수 절차와 실제 운영 비밀 저장소. bootstrap 키 교체는 환경 변수 갱신과 프로세스 재시작이 필요하다.
- Body/Query의 민감값 완전 탐지와 암호화 저장. 원본 바이트는 관리자/소유자가 열람할 수 있고 기본 JSON 마스킹은 표시용이다.
- 악성 DB 관리자에 대한 감사 변조 방지. 감사 metadata는 90일 자동 정리되며 전용 불변 감사 저장소가 아니다.

이 목록은 공개 배포 승인을 뜻하지 않는다. 현재 검증은 로컬 Compose의 사용자별 접근 제어와 운영 정책 범위다. 실제 시험 결과와 제약은 PROGRESS.md를 기준으로 한다.
