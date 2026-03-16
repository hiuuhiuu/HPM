"""
APM 운영 매뉴얼 PDF 생성 스크립트
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# ── 폰트 등록 (AppleSDGothicNeo, macOS 기본 한국어 폰트) ──────────
FONT_PATH = "/Library/Fonts/Arial Unicode.ttf"

pdfmetrics.registerFont(TTFont("Korean",      FONT_PATH))
pdfmetrics.registerFont(TTFont("Korean-Bold", FONT_PATH))

# ── 색상 ──────────────────────────────────────────────────────────
C_NAVY   = colors.HexColor("#1e3a5f")
C_BLUE   = colors.HexColor("#2563eb")
C_LIGHT  = colors.HexColor("#eff6ff")
C_GRAY   = colors.HexColor("#f1f5f9")
C_BORDER = colors.HexColor("#cbd5e1")
C_CODE   = colors.HexColor("#1e293b")
C_CODE_BG= colors.HexColor("#f8fafc")

# ── 스타일 ────────────────────────────────────────────────────────
def make_styles():
    base = getSampleStyleSheet()

    def S(name, font="Korean", **kw):
        return ParagraphStyle(name, fontName=font, **kw)

    return {
        "title":    S("title",    font="Korean-Bold",
                       fontSize=22, leading=28, textColor=C_NAVY, spaceAfter=4),
        "subtitle": S("subtitle",
                       fontSize=11, leading=16, textColor=colors.HexColor("#475569"),
                       spaceAfter=16),
        "h1":       S("h1",       font="Korean-Bold",
                       fontSize=14, leading=20, textColor=C_NAVY,
                       spaceBefore=18, spaceAfter=6),
        "h2":       S("h2",       font="Korean-Bold",
                       fontSize=11, leading=16, textColor=C_BLUE,
                       spaceBefore=12, spaceAfter=4),
        "body":     S("body",
                       fontSize=9.5, leading=15, textColor=colors.HexColor("#334155"),
                       spaceAfter=4),
        "code":     S("code",
                       fontSize=8.5, leading=13, textColor=C_CODE,
                       backColor=C_CODE_BG, leftIndent=8, rightIndent=8,
                       borderPadding=(4, 6, 4, 6), spaceAfter=6),
        "note":     S("note",
                       fontSize=8.5, leading=13, textColor=colors.HexColor("#64748b"),
                       leftIndent=12, spaceAfter=4),
    }


def hr():
    return HRFlowable(width="100%", thickness=0.5, color=C_BORDER, spaceAfter=8)


def table(headers, rows, col_widths, header_bg=C_NAVY):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths)
    style = [
        ("BACKGROUND",  (0, 0), (-1, 0),  header_bg),
        ("TEXTCOLOR",   (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",    (0, 0), (-1, 0),  "Korean-Bold"),
        ("FONTSIZE",    (0, 0), (-1, 0),  9),
        ("FONTNAME",    (0, 1), (-1, -1), "Korean"),
        ("FONTSIZE",    (0, 1), (-1, -1), 8.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, C_GRAY]),
        ("GRID",        (0, 0), (-1, -1), 0.4, C_BORDER),
        ("ALIGN",       (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0,0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ]
    t.setStyle(TableStyle(style))
    return t


def code_block(text, styles):
    lines = text.strip().split("\n")
    content = "<br/>".join(line.replace(" ", "&nbsp;") for line in lines)
    return Paragraph(content, styles["code"])


def build_pdf(output_path: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=22*mm, bottomMargin=20*mm,
        title="APM 운영 매뉴얼",
        author="APM System",
    )

    S = make_styles()
    W = A4[0] - 40*mm  # 본문 너비

    story = []

    # ── 표지 헤더 ───────────────────────────────────────────────
    story.append(Paragraph("APM 운영 매뉴얼", S["title"]))
    story.append(Paragraph(
        "Application Performance Monitoring &nbsp;|&nbsp; 운영 참고 문서",
        S["subtitle"]
    ))
    story.append(hr())
    story.append(Spacer(1, 4))

    # ── 1. 기술 스택 ─────────────────────────────────────────────
    story.append(Paragraph("1. 기술 스택", S["h1"]))
    story.append(table(
        ["구성 요소", "기술", "역할"],
        [
            ["DB",         "TimescaleDB (PostgreSQL 15 확장)", "시계열 메트릭/로그/트레이스 저장"],
            ["백엔드",     "Python 3.11 + FastAPI + asyncpg", "OTLP 수신, REST API 제공"],
            ["프론트엔드", "React 18 + TypeScript + Recharts", "대시보드 UI 및 시각화"],
            ["인프라",     "Docker + Docker Compose",         "컨테이너 오케스트레이션"],
            ["수집 프로토콜", "OpenTelemetry OTLP HTTP (protobuf)", "Java Agent → APM 서버 데이터 전송"],
        ],
        [30*mm, 65*mm, W - 95*mm],
    ))
    story.append(Spacer(1, 4))

    # ── 2. 포트 정보 ─────────────────────────────────────────────
    story.append(Paragraph("2. 포트 정보", S["h1"]))
    story.append(table(
        ["포트", "서비스", "설명"],
        [
            ["3000", "프론트엔드",   "대시보드 UI  →  http://localhost:3000"],
            ["8000", "백엔드 API",   "REST API / OTLP 수신  →  http://localhost:8000"],
            ["5432", "TimescaleDB", "PostgreSQL DB (컨테이너 내부: apm-db:5432)"],
        ],
        [20*mm, 35*mm, W - 55*mm],
    ))
    story.append(Paragraph(
        "※  OTLP 수신 경로:  http://localhost:8000/otlp/v1/{metrics|traces|logs}",
        S["note"]
    ))
    story.append(Spacer(1, 4))

    # ── 3. 기동 / 종료 ───────────────────────────────────────────
    story.append(Paragraph("3. 기동 / 종료", S["h1"]))

    story.append(Paragraph("프로젝트 경로로 이동", S["h2"]))
    story.append(code_block(
        "cd /Users/jeonghyun.hwang/Documents/Project/APM", S))

    story.append(Paragraph("전체 스택 기동", S["h2"]))
    story.append(code_block(
        "# 최초 실행 (이미지 빌드 포함)\n"
        "docker compose up --build -d\n\n"
        "# 이후 실행 (빌드 생략)\n"
        "docker compose up -d", S))

    story.append(Paragraph("전체 스택 종료", S["h2"]))
    story.append(code_block(
        "# 컨테이너만 중지 (데이터 보존)\n"
        "docker compose down\n\n"
        "# 컨테이너 + DB 볼륨 삭제 (데이터 초기화)\n"
        "docker compose down -v", S))

    story.append(Paragraph("개별 서비스 재시작", S["h2"]))
    story.append(code_block(
        "docker compose restart backend\n"
        "docker compose restart frontend\n"
        "docker compose restart db", S))

    story.append(Paragraph("코드 수정 후 재빌드", S["h2"]))
    story.append(code_block(
        "docker compose up --build -d backend   # 백엔드만\n"
        "docker compose up --build -d frontend  # 프론트엔드만", S))

    # ── 4. 상태 확인 ─────────────────────────────────────────────
    story.append(Paragraph("4. 상태 확인", S["h1"]))
    story.append(code_block(
        "# 컨테이너 실행 상태\n"
        "docker compose ps\n\n"
        "# 백엔드 헬스체크\n"
        "curl http://localhost:8000/\n\n"
        "# 백엔드 로그 실시간 확인\n"
        "docker logs -f apm-backend\n\n"
        "# 프론트엔드 로그 확인\n"
        "docker logs -f apm-frontend", S))

    # ── 5. 테스트 데이터 주입 ────────────────────────────────────
    story.append(Paragraph("5. 테스트 데이터 주입", S["h1"]))
    story.append(Paragraph(
        "Java Agent 없이 가짜 OTLP 데이터를 주입하는 스크립트입니다.",
        S["body"]
    ))

    story.append(Paragraph("의존성 설치 (최초 1회)", S["h2"]))
    story.append(code_block(
        "pip3 install opentelemetry-proto protobuf requests", S))

    story.append(Paragraph("실행 예시", S["h2"]))
    story.append(code_block(
        "# 단일 서비스, 10회 주입\n"
        "python3 scripts/test_otlp.py --service my-service --repeat 10\n\n"
        "# 여러 서비스 동시 주입 (백그라운드)\n"
        "python3 scripts/test_otlp.py --service order-service   --repeat 200 --interval 3 &\n"
        "python3 scripts/test_otlp.py --service payment-service --repeat 200 --interval 3 &\n"
        "python3 scripts/test_otlp.py --service user-service    --repeat 200 --interval 3 &", S))

    story.append(table(
        ["옵션", "기본값", "설명"],
        [
            ["--service",  "test-java-app", "서비스 이름"],
            ["--repeat",   "1",             "반복 횟수"],
            ["--interval", "1.0",           "반복 간격 (초)"],
            ["--host",     "localhost",     "APM 서버 호스트"],
            ["--port",     "8000",          "APM 서버 포트"],
        ],
        [35*mm, 30*mm, W - 65*mm],
    ))
    story.append(Spacer(1, 4))

    # ── 6. Java Agent 연동 ───────────────────────────────────────
    story.append(Paragraph("6. Java Agent 연동 (실제 서비스)", S["h1"]))
    story.append(code_block(
        "java \\\n"
        "  -javaagent:/path/to/opentelemetry-javaagent.jar \\\n"
        "  -Dotel.service.name=my-service \\\n"
        "  -Dotel.exporter.otlp.endpoint=http://localhost:8000/otlp \\\n"
        "  -Dotel.exporter.otlp.protocol=http/protobuf \\\n"
        "  -jar my-app.jar", S))
    story.append(Paragraph(
        "※  자세한 설정은 docs/java-agent-setup.md 참고",
        S["note"]
    ))

    # ── 7. 주요 API 엔드포인트 ──────────────────────────────────
    story.append(Paragraph("7. 주요 API 엔드포인트", S["h1"]))
    story.append(table(
        ["메서드", "경로", "설명"],
        [
            ["GET",  "/api/metrics/overview",       "전체 요약 (서비스 수, 응답시간, 에러율)"],
            ["GET",  "/api/metrics/summary/{svc}",  "서비스별 메트릭 요약"],
            ["GET",  "/api/traces",                 "트레이스 목록"],
            ["GET",  "/api/traces/{trace_id}",      "트레이스 상세 (Waterfall)"],
            ["GET",  "/api/errors",                 "에러 목록"],
            ["GET",  "/api/logs",                   "로그 목록"],
            ["GET",  "/api/alerts/rules",           "알림 규칙 목록"],
            ["GET",  "/api/alerts/active",          "현재 발화 중인 알림"],
            ["POST", "/otlp/v1/metrics",            "OTLP 메트릭 수신"],
            ["POST", "/otlp/v1/traces",             "OTLP 트레이스 수신"],
            ["POST", "/otlp/v1/logs",               "OTLP 로그 수신"],
        ],
        [20*mm, 60*mm, W - 80*mm],
    ))
    story.append(Paragraph(
        "※  전체 API 문서 (Swagger UI):  http://localhost:8000/docs",
        S["note"]
    ))

    # ── 8. DB 접속 정보 ─────────────────────────────────────────
    story.append(Paragraph("8. DB 접속 정보", S["h1"]))
    story.append(table(
        ["항목", "값"],
        [
            ["호스트",   "localhost:5432"],
            ["DB명",     "apmdb"],
            ["사용자",   "apm"],
            ["비밀번호", "apm1234"],
        ],
        [35*mm, W - 35*mm],
    ))

    story.append(Paragraph("psql 접속", S["h2"]))
    story.append(code_block(
        "# 컨테이너 내부 psql 접속\n"
        "docker exec -it apm-db psql -U apm -d apmdb\n\n"
        "-- 테이블 목록\n"
        "\\dt\n\n"
        "-- 최근 메트릭 확인\n"
        "SELECT service, name, value, time FROM metrics ORDER BY time DESC LIMIT 10;", S))

    doc.build(story)
    print(f"PDF 생성 완료: {output_path}")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "operations.pdf")
    build_pdf(os.path.abspath(out))
