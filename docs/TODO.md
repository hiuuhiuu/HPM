# HPM TODO

---

## [ ] 스케줄링 프레임워크 표현 방식 개선

**배경**
OTel Java Agent는 Quartz / Spring `@Scheduled` 등을 자동 계측한다.
현재는 HTTP 트레이스와 동일 뷰에 혼재되어 노이즈로 작용하므로 기본 비활성화(`otel.instrumentation.quartz.enabled=false`)로 처리 중.

**검토할 내용**
- [ ] Background Jobs 전용 카테고리(탭/섹션) UI 분리
  - Datadog: "Jobs" 탭 별도 분리, TPS 지표에서 제외
  - New Relic: "Background Transactions" 분리 뷰
  - 현재 HPM은 분리 없이 HTTP와 동일하게 카운트됨
- [ ] 에러/지연 이상만 표면화하는 전략 검토
  - 정상 실행은 숨기고, 오류 발생 시 또는 평균 실행시간 N배 초과 시에만 트레이스 노출
- [ ] 활성화 조건 정의
  - Background Jobs 전용 뷰 구현 완료 후 기본값 `true` 전환

**현재 상태**
`docs/java-agent-setup.md` 권장 JVM 옵션에 비활성화 플래그 추가 완료 (2026-03-17)
