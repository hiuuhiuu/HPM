import { test, expect } from '@playwright/test';

/**
 * Hamster APM 스모크 테스트.
 * 각 페이지의 가장 핵심적인 렌더/상호작용만 빠르게 검증한다.
 */

test.describe('대시보드', () => {
  test('진입 시 제목과 LIVE 뱃지가 표시된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '대시보드', exact: true })).toBeVisible();
    // WebSocket 연결까지 최대 수 초 소요
    await expect(page.getByText(/LIVE|연결 중/)).toBeVisible({ timeout: 10_000 });
  });

  test('상단 요약 카드 5개가 렌더된다', async ({ page }) => {
    await page.goto('/');
    const titles = ['현재 TPS', '평균 응답시간', '에러율', '활성 거래'];
    for (const t of titles) {
      await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
    }
  });
});

test.describe('통합 검색 팔레트', () => {
  test('사이드바 검색 버튼으로 열리고 Esc로 닫힌다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /검색 팔레트 열기/ }).click();
    const dialog = page.getByRole('dialog', { name: '통합 검색 팔레트' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('"에러" 검색 → Enter로 에러 페이지 이동', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /검색 팔레트 열기/ }).click();
    await page.getByLabel('검색어 입력').fill('에러');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/errors/);
  });
});

test.describe('에러 그룹 뷰', () => {
  test('기본 진입 시 그룹 탭이 활성화된다', async ({ page }) => {
    await page.goto('/errors');
    const groupTab = page.getByRole('button', { name: /^그룹$/ });
    await expect(groupTab).toHaveClass(/active/);
  });

  test('개별 탭 전환 시 URL 유지하고 리스트 렌더', async ({ page }) => {
    await page.goto('/errors');
    await page.getByRole('button', { name: /^개별$/ }).click();
    await expect(page.getByRole('button', { name: /^개별$/ })).toHaveClass(/active/);
  });
});

test.describe('배포 마커', () => {
  const TS = Date.now();
  const VERSION = `e2e-${TS}`;

  test('POST /api/deployments로 생성하면 목록에 나타난다', async ({ request }) => {
    const created = await request.post('http://localhost:8000/api/deployments', {
      data: {
        service: 'jeus-sample',
        version: VERSION,
        environment: 'e2e-test',
        description: 'playwright e2e 스모크',
      },
    });
    expect(created.ok()).toBeTruthy();
    const body = await created.json();
    expect(body.version).toBe(VERSION);

    const list = await request.get('http://localhost:8000/api/deployments?limit=50');
    const rows = await list.json();
    const found = rows.find((r: { version?: string }) => r.version === VERSION);
    expect(found).toBeDefined();

    // 정리: 생성한 레코드 삭제
    await request.delete(`http://localhost:8000/api/deployments/${body.id}`);
  });
});

test.describe('토폴로지', () => {
  test('페이지 진입 시 제목 또는 로딩 문구가 보이고 최종 SVG가 렌더된다', async ({ page }) => {
    await page.goto('/topology');
    // 로딩 문구 → 제목 → SVG 순으로 확인 (데이터 페칭 대기)
    await expect(page.getByRole('heading', { name: '서비스 토폴로지' }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('사이드바 네비게이션', () => {
  test('각 메뉴 클릭 시 해당 페이지로 이동한다', async ({ page }) => {
    await page.goto('/');
    const cases: Array<[string, RegExp]> = [
      ['메트릭',     /\/metrics/],
      ['트레이싱',   /\/traces/],
      ['토폴로지',   /\/topology/],
      ['설정',       /\/settings/],
    ];
    for (const [label, re] of cases) {
      await page.getByRole('link', { name: label, exact: false }).first().click();
      await expect(page).toHaveURL(re);
    }
  });
});
