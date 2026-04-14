# E2E 테스트 (Playwright)

## 실행 전 준비
컨테이너가 떠있어야 합니다.
```bash
cd .. && docker compose up -d
```

## 실행
```bash
# 프론트엔드 디렉토리에서
npm run test:e2e            # 헤드리스
npm run test:e2e:ui         # UI 모드 (디버그용)
npx playwright show-report  # 결과 HTML 리포트 열기
```

## 기본 가정
- 프론트엔드: `http://localhost:9700`
- 백엔드 API: `http://localhost:8000`
- 다른 환경이면 `E2E_BASE_URL=...` 환경변수로 지정

## 테스트 스코프
`e2e/smoke.spec.ts` — 핵심 페이지 렌더 + 상호작용 스모크 (5~7건).
새 기능 추가 시 동일 파일에 케이스 추가하는 것을 권장합니다.
