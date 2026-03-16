#!/usr/bin/env python3
"""
APM 환경 구성 매뉴얼 PDF 생성 스크립트
"""
from fpdf import FPDF
from fpdf.enums import XPos, YPos
import os, sys

FONT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "NanumGothic.ttf")
OUT_PATH  = os.path.join(os.path.dirname(__file__), "..", "APM_설치_운영_매뉴얼.pdf")

# ── 색상 정의 ──────────────────────────────────────────
C_DARK   = (22,  28,  46)   # 배경 네이비
C_ACCENT = (99, 102, 241)   # 인디고
C_GREEN  = (52, 211, 153)   # 그린
C_GRAY   = (71,  85, 105)   # 슬레이트
C_LIGHT  = (241,245,249)    # 연한 배경
C_WHITE  = (255,255,255)
C_BLACK  = (15,  23,  42)
C_RED    = (239, 68,  68)
C_YELLOW = (251,191,  36)
C_BOX    = (30,  32,  53)   # 코드박스 배경


class ManualPDF(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.add_font("Gothic", style="",  fname=FONT_PATH)
        self.add_font("Gothic", style="B", fname=FONT_PATH)
        self.set_auto_page_break(auto=True, margin=18)
        self.page_num = 0

    # ── 헤더/푸터 ──────────────────────────────────────
    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill_color(*C_DARK)
        self.rect(0, 0, 210, 10, "F")
        self.set_font("Gothic", "B", 7)
        self.set_text_color(*C_ACCENT)
        self.set_xy(10, 2)
        self.cell(0, 6, "APM 환경 구성 매뉴얼  |  폐쇄망 은행 서버 배포 가이드")

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-12)
        self.set_fill_color(*C_DARK)
        self.rect(0, 285, 210, 12, "F")
        self.set_font("Gothic", "", 7)
        self.set_text_color(*C_GRAY)
        self.set_x(10)
        self.cell(0, 6, f"- {self.page_no()} -", align="C")

    # ── 유틸리티 ───────────────────────────────────────
    def h1(self, txt):
        self.ln(4)
        self.set_fill_color(*C_ACCENT)
        self.rect(10, self.get_y(), 4, 8, "F")
        self.set_xy(16, self.get_y())
        self.set_font("Gothic", "B", 14)
        self.set_text_color(*C_BLACK)
        self.cell(0, 8, txt, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def h2(self, txt):
        self.ln(3)
        self.set_font("Gothic", "B", 11)
        self.set_text_color(*C_ACCENT)
        self.set_x(10)
        self.cell(0, 7, f"▶  {txt}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def h3(self, txt):
        self.ln(1)
        self.set_font("Gothic", "B", 9.5)
        self.set_text_color(*C_BLACK)
        self.set_x(14)
        self.cell(0, 6, f"◆ {txt}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    def body(self, txt, indent=14, size=9):
        self.set_font("Gothic", "", size)
        self.set_text_color(*C_BLACK)
        self.set_x(indent)
        self.multi_cell(190 - indent, 5.5, txt)

    def bullet(self, txt, indent=18):
        self.set_font("Gothic", "", 9)
        self.set_text_color(*C_BLACK)
        self.set_x(indent)
        self.cell(4, 5.5, "•")
        self.set_x(indent + 4)
        self.multi_cell(190 - indent - 4, 5.5, txt)

    def note(self, txt, color=C_LIGHT):
        self.ln(1)
        y = self.get_y()
        self.set_fill_color(*color)
        self.set_draw_color(*C_ACCENT)
        self.set_x(14)
        self.set_font("Gothic", "", 8.5)
        self.set_text_color(*C_GRAY)
        self.multi_cell(182, 5.2, txt, border=0, fill=True)
        self.ln(1)

    def code_block(self, lines: list, title=""):
        self.ln(2)
        if title:
            self.set_font("Gothic", "B", 8)
            self.set_text_color(*C_GRAY)
            self.set_x(14)
            self.cell(0, 5, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        h = len(lines) * 5.2 + 6
        y = self.get_y()
        self.set_fill_color(*C_BOX)
        self.rect(14, y, 182, h, "F")
        self.set_font("Gothic", "", 8)
        self.set_text_color(*C_GREEN)
        for line in lines:
            self.set_x(17)
            self.cell(0, 5.2, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def table(self, headers, rows, col_widths):
        # 헤더
        self.set_fill_color(*C_DARK)
        self.set_text_color(*C_WHITE)
        self.set_font("Gothic", "B", 8.5)
        self.set_x(14)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 7, h, border=1, fill=True, align="C")
        self.ln()
        # 데이터
        self.set_font("Gothic", "", 8.5)
        for ri, row in enumerate(rows):
            self.set_fill_color(245, 247, 250) if ri % 2 == 0 else self.set_fill_color(*C_WHITE)
            self.set_text_color(*C_BLACK)
            self.set_x(14)
            for i, cell in enumerate(row):
                self.cell(col_widths[i], 6.5, cell, border=1, fill=True)
            self.ln()
        self.ln(2)

    def step_box(self, num, title, desc=""):
        self.ln(2)
        y = self.get_y()
        # 번호 원
        self.set_fill_color(*C_ACCENT)
        self.ellipse(14, y, 7, 7, "F")
        self.set_font("Gothic", "B", 9)
        self.set_text_color(*C_WHITE)
        self.set_xy(14, y + 0.5)
        self.cell(7, 6, str(num), align="C")
        # 제목
        self.set_font("Gothic", "B", 10)
        self.set_text_color(*C_BLACK)
        self.set_xy(24, y)
        self.cell(0, 7, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if desc:
            self.set_font("Gothic", "", 8.5)
            self.set_text_color(*C_GRAY)
            self.set_x(24)
            self.multi_cell(172, 5, desc)
        self.ln(1)

    def divider(self):
        self.ln(3)
        self.set_draw_color(*C_ACCENT)
        self.set_line_width(0.3)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)


def build_pdf():
    pdf = ManualPDF()

    # ════════════════════════════════════════════════════
    # 표지
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.set_fill_color(*C_DARK)
    pdf.rect(0, 0, 210, 297, "F")

    # 상단 장식 바
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(0, 0, 210, 4, "F")

    # 로고 영역
    pdf.set_xy(10, 50)
    pdf.set_font("Gothic", "B", 36)
    pdf.set_text_color(*C_WHITE)
    pdf.cell(0, 20, "APM", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Gothic", "B", 16)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_x(10)
    pdf.cell(0, 10, "Application Performance Monitoring", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # 구분선
    pdf.set_draw_color(*C_ACCENT)
    pdf.set_line_width(0.5)
    pdf.line(40, pdf.get_y() + 4, 170, pdf.get_y() + 4)
    pdf.ln(12)

    pdf.set_font("Gothic", "B", 20)
    pdf.set_text_color(*C_WHITE)
    pdf.set_x(10)
    pdf.cell(0, 12, "환경 구성 및 설치 매뉴얼", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Gothic", "", 11)
    pdf.set_text_color(*C_GRAY)
    pdf.set_x(10)
    pdf.cell(0, 8, "폐쇄망 은행 내부 서버 배포 가이드", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(20)

    # 정보 박스
    pdf.set_fill_color(30, 32, 60)
    pdf.rect(30, pdf.get_y(), 150, 55, "F")
    pdf.set_draw_color(*C_ACCENT)
    pdf.rect(30, pdf.get_y(), 150, 55)

    info_y = pdf.get_y() + 8
    items = [
        ("대 상", "JEUS WAS 운영 은행 내부망 환경"),
        ("구 성", "TimescaleDB + FastAPI + React/Nginx"),
        ("접속 포트", "8080 (UI/API), OTLP: 8080/otlp"),
        ("설치 방식", "Docker Compose (오프라인 설치)"),
    ]
    for label, value in items:
        pdf.set_xy(38, info_y)
        pdf.set_font("Gothic", "B", 9)
        pdf.set_text_color(*C_ACCENT)
        pdf.cell(24, 7, label)
        pdf.set_font("Gothic", "", 9)
        pdf.set_text_color(*C_WHITE)
        pdf.cell(0, 7, value)
        info_y += 9

    pdf.ln(70)

    # 하단 날짜
    pdf.set_font("Gothic", "", 9)
    pdf.set_text_color(*C_GRAY)
    pdf.set_x(10)
    pdf.cell(0, 8, "2026년 3월  |  내부 배포용 문서", align="C")

    # 하단 바
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(0, 293, 210, 4, "F")


    # ════════════════════════════════════════════════════
    # 목차
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.ln(5)
    pdf.set_font("Gothic", "B", 16)
    pdf.set_text_color(*C_DARK)
    pdf.set_x(10)
    pdf.cell(0, 10, "목  차", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.divider()

    toc = [
        ("1", "시스템 개요"),
        ("  1.1", "서비스 구성 및 아키텍처"),
        ("  1.2", "설치 패키지 구성"),
        ("2", "설치 사전 요구사항"),
        ("  2.1", "APM 서버 요구사항"),
        ("  2.2", "네트워크 방화벽 규칙"),
        ("3", "Step 1 — 설치 패키지 수집 (인터넷 PC)"),
        ("4", "Step 2 — APM 서버 설치 (은행 내부 서버)"),
        ("  4.1", "Docker 설치 (오프라인)"),
        ("  4.2", "자동 설치 스크립트 실행"),
        ("  4.3", "설치 결과 확인"),
        ("5", "Step 3 — JEUS WAS 에이전트 연동"),
        ("  5.1", "OTel Java Agent 배포"),
        ("  5.2", "JVM 옵션 설정"),
        ("  5.3", "인스턴스별 설정 예시"),
        ("6", "APM 대시보드 사용 가이드"),
        ("7", "운영 관리"),
        ("  7.1", "서비스 관리 명령어"),
        ("  7.2", "데이터 보존 정책"),
        ("  7.3", "보안 체크리스트"),
        ("8", "트러블슈팅"),
    ]
    pdf.set_font("Gothic", "", 10)
    for num, title in toc:
        pdf.set_x(20)
        is_main = not num.startswith(" ")
        if is_main:
            pdf.set_font("Gothic", "B", 10)
            pdf.set_text_color(*C_ACCENT)
        else:
            pdf.set_font("Gothic", "", 9.5)
            pdf.set_text_color(*C_BLACK)
        pdf.cell(20, 7, num)
        pdf.cell(0, 7, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


    # ════════════════════════════════════════════════════
    # 1. 시스템 개요
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("1. 시스템 개요")

    pdf.h2("1.1  서비스 구성 및 아키텍처")
    pdf.body("본 APM은 은행 내부 WAS(JEUS) 인스턴스의 트레이스·메트릭·로그를 수집하여\n"
             "실시간으로 모니터링하는 애플리케이션 성능 관리 시스템입니다.")
    pdf.ln(2)

    # 아키텍처 다이어그램 (텍스트)
    arch_lines = [
        "┌──────────────────────────────┐      OTLP/HTTP       ┌─────────────────────────────┐",
        "│     은행 WAS 서버들           │  ──────────────────▶  │        APM 서버              │",
        "│                              │   http://APM:8080    │                             │",
        "│  JEUS 인스턴스-1 (node1)     │        /otlp         │  ┌─────────────────────┐   │",
        "│    └ OTel Java Agent         │                      │  │  Frontend (Nginx)   │   │",
        "│  JEUS 인스턴스-2 (node2)     │                      │  │  포트 : 8080        │   │",
        "│    └ OTel Java Agent         │                      │  └──────────┬──────────┘   │",
        "│  JEUS 인스턴스-3 (node3)     │                      │             │ 프록시         │",
        "│    └ OTel Java Agent  ...    │                      │  ┌──────────▼──────────┐   │",
        "└──────────────────────────────┘                      │  │  Backend (FastAPI)  │   │",
        "                                                      │  │  포트 : 8000 (내부)  │   │",
        "  ┌───────────────┐                                   │  └──────────┬──────────┘   │",
        "  │  운영자 브라우저 │  ◀──── HTTP :8080 ─────────────  │             │              │",
        "  └───────────────┘                                   │  ┌──────────▼──────────┐   │",
        "                                                      │  │  TimescaleDB (PG15) │   │",
        "                                                      │  │  포트 : 5432 (내부)  │   │",
        "                                                      │  └─────────────────────┘   │",
        "                                                      └─────────────────────────────┘",
    ]
    pdf.code_block(arch_lines)

    pdf.h2("1.2  설치 패키지 구성")
    pdf.body("apm-installer-<날짜>.tar.gz 파일 하나에 설치에 필요한 모든 파일이 포함되어 있습니다.\n"
             "인터넷 연결 없이 은행 서버에서 바로 설치 가능합니다.")
    pdf.ln(2)

    pdf.table(
        ["구성 파일", "크기(참고)", "설명"],
        [
            ["images/apm-images.tar.gz", "~620 MB", "Docker 이미지 3개 (backend, frontend, TimescaleDB)"],
            ["agent/opentelemetry-javaagent.jar", "~21 MB", "JEUS WAS 연동용 OTel Java Agent"],
            ["docker-compose.prod.yml", "~2 KB", "프로덕션 서비스 구성 파일"],
            ["docker/init.sql", "~5 KB", "데이터베이스 스키마 초기화 SQL"],
            ["install.sh", "~4 KB", "은행 서버 자동 설치 스크립트"],
            ["VERSION", "< 1 KB", "버전 및 빌드 일시 정보"],
        ],
        [70, 28, 88]
    )

    pdf.note("[OK]  압축 파일 하나만 서버로 전송하면 추가 다운로드 없이 완전한 설치가 가능합니다.\n"
             "[OK]  Docker 이미지에는 Python 패키지(pip), Node.js 패키지(npm), React 빌드 결과물이\n"
             "    모두 포함되어 있습니다.")


    # ════════════════════════════════════════════════════
    # 2. 사전 요구사항
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("2. 설치 사전 요구사항")

    pdf.h2("2.1  APM 서버 요구사항")
    pdf.table(
        ["항목", "최소 사양", "권장 사양"],
        [
            ["OS",      "RHEL/CentOS 7+, Ubuntu 20.04+", "RHEL 8+ / Ubuntu 22.04+"],
            ["CPU",     "2코어",                           "4코어 이상"],
            ["메모리",  "8 GB",                            "16 GB 이상"],
            ["디스크",  "100 GB",                          "200 GB 이상 (데이터 보존 기간에 따라)"],
            ["Docker",  "24.0 이상",                       "최신 stable"],
            ["Docker Compose", "v2.0 이상",               "v2.20 이상"],
        ],
        [32, 72, 82]
    )

    pdf.note("[!]  Docker 및 Docker Compose v2는 인터넷 연결 PC에서 미리 RPM/DEB 패키지를 내려받아\n"
             "    오프라인으로 설치해야 합니다. (yum localinstall 또는 dpkg -i 사용)")

    pdf.h2("2.2  네트워크 방화벽 규칙")
    pdf.table(
        ["포트", "프로토콜", "출발지", "용도"],
        [
            ["8080", "TCP", "운영자 PC 대역", "APM 대시보드 UI 접속 (브라우저)"],
            ["8080", "TCP", "JEUS WAS 서버 대역", "OTLP 데이터 전송 (/otlp 경로)"],
            ["5432", "TCP", "APM 서버 내부 (127.0.0.1)", "PostgreSQL DB (외부 차단)"],
            ["8000", "TCP", "APM 서버 내부 전용", "FastAPI 백엔드 (외부 차단)"],
        ],
        [18, 22, 60, 86]
    )

    pdf.note("[OK]  운영자와 WAS 서버 모두 포트 8080 하나만 허용하면 됩니다.\n"
             "[OK]  5432(DB), 8000(백엔드)는 컨테이너 내부 통신 전용이며 외부에 노출되지 않습니다.")


    # ════════════════════════════════════════════════════
    # 3. 설치 패키지 수집
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("3. Step 1 — 설치 패키지 수집 (인터넷 PC)")

    pdf.body("인터넷에 연결된 개발 PC(또는 빌드 서버)에서 수행합니다.\n"
             "APM 프로젝트 소스가 있어야 하며, Docker가 설치되어 있어야 합니다.")
    pdf.ln(2)

    pdf.step_box(1, "APM 프로젝트 루트 디렉토리로 이동")
    pdf.code_block(["cd /path/to/APM"])

    pdf.step_box(2, "수집 스크립트 실행",
                 "백엔드/프론트엔드 이미지 빌드, 베이스 이미지 pull, OTel Agent 다운로드를 자동 수행합니다.")
    pdf.code_block(["./scripts/collect.sh"])

    pdf.step_box(3, "생성된 패키지 확인")
    pdf.code_block([
        "ls -lh apm-installer-*.tar.gz",
        "",
        "# 출력 예시:",
        "# -rw-r--r--  1 user  staff  644M  3월  2 20:50 apm-installer-20260302.tar.gz",
    ])

    pdf.step_box(4, "은행 서버로 파일 전송",
                 "USB, 내부망 파일 전송 시스템, sftp 등 허용된 방법으로 전달합니다.")
    pdf.code_block([
        "# sftp 예시",
        "sftp admin@bank-apm-server:/tmp",
        "> put apm-installer-20260302.tar.gz",
        "> bye",
    ])

    pdf.note("[OK]  스크립트 수행 시간: 약 5~15분 (네트워크 환경에 따라 상이)\n"
             "[OK]  패키지 총 용량: 약 640~700 MB")


    # ════════════════════════════════════════════════════
    # 4. APM 서버 설치
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("4. Step 2 — APM 서버 설치 (은행 내부 서버)")

    pdf.h2("4.1  Docker 설치 (오프라인)")
    pdf.body("Docker가 미설치된 경우, 인터넷 PC에서 패키지를 내려받아 설치합니다.")
    pdf.code_block([
        "# RHEL/CentOS — RPM 파일 오프라인 설치",
        "yum install -y --disablerepo='*' ./docker-ce-*.rpm",
        "systemctl enable --now docker",
        "",
        "# Ubuntu — DEB 파일 오프라인 설치",
        "dpkg -i ./containerd.io_*.deb ./docker-ce_*.deb",
        "systemctl enable --now docker",
        "",
        "# 설치 확인",
        "docker version",
        "docker compose version",
    ], title="Docker 오프라인 설치")

    pdf.h2("4.2  자동 설치 스크립트 실행")
    pdf.body("압축 파일을 해제하고 install.sh를 실행합니다. sudo(root) 권한이 필요합니다.")
    pdf.code_block([
        "# 1. 압축 해제",
        "tar -xzf apm-installer-20260302.tar.gz",
        "cd apm-installer-20260302",
        "",
        "# 2. 설치 실행 (root 또는 sudo 필요)",
        "sudo ./install.sh",
    ], title="설치 스크립트 실행")

    pdf.body("스크립트 실행 중 DB 비밀번호 입력 프롬프트가 표시됩니다:")
    pdf.code_block([
        "DB 비밀번호 설정 (8자 이상): ********",
        "DB 비밀번호 확인:            ********",
        "",
        "[INFO]  SECRET_KEY 자동 생성됨 (64자 랜덤)",
        "[OK]    디렉토리 구성 완료",
        "[OK]    .env 생성 완료 (권한 600)",
        "[OK]    이미지 로드 완료",
        "[OK]    OTel Java Agent 배포: /waslib/opentelemetry-javaagent.jar",
        "[OK]    APM 서비스 시작",
    ], title="설치 진행 출력 예시")

    pdf.h2("4.3  설치 결과 확인")
    pdf.body("설치 완료 후 출력되는 접속 정보를 메모해 두십시오.")
    pdf.code_block([
        "============================================================",
        "[OK]    APM 설치 완료!",
        "",
        "  APM 대시보드",
        "  http://192.168.10.100:8080",
        "",
        "  JEUS WAS 에이전트 JVM 옵션",
        "  -javaagent:/waslib/opentelemetry-javaagent.jar",
        "  -Dotel.exporter.otlp.endpoint=http://192.168.10.100:8080/otlp",
        "  -Dotel.exporter.otlp.protocol=http/protobuf",
        "  -Dotel.service.name=<서비스명>",
        "  -Dotel.service.instance.id=<인스턴스명>",
        "  ...",
        "============================================================",
    ], title="설치 완료 화면 예시")

    pdf.note("[OK]  설치 경로: /opt/apm\n"
             "[OK]  데이터 경로: /data/apm/db\n"
             "[OK]  OTel Agent 경로: /waslib/opentelemetry-javaagent.jar\n"
             "[OK]  설정 파일: /opt/apm/.env (chmod 600, root만 읽기 가능)")


    # ════════════════════════════════════════════════════
    # 5. JEUS 연동
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("5. Step 3 — JEUS WAS 에이전트 연동")

    pdf.h2("5.1  OTel Java Agent 배포")
    pdf.body("설치 스크립트 실행 시 /waslib/ 에 자동 배포됩니다.\n"
             "각 JEUS WAS 서버에 별도로 배포해야 하는 경우 아래 명령을 사용합니다.")
    pdf.code_block([
        "# APM 서버 → WAS 서버로 agent 파일 전달",
        "scp /waslib/opentelemetry-javaagent.jar  jeus@was-server-1:/waslib/",
        "scp /waslib/opentelemetry-javaagent.jar  jeus@was-server-2:/waslib/",
        "",
        "chmod 644 /waslib/opentelemetry-javaagent.jar",
    ])

    pdf.h2("5.2  JVM 옵션 설정")
    pdf.body("JEUS 관리콘솔의 서버 설정 또는 domain.xml의 JVM 옵션에 아래 내용을 추가합니다.")
    pdf.code_block([
        "-javaagent:/waslib/opentelemetry-javaagent.jar",
        "-Dotel.exporter.otlp.endpoint=http://<APM서버IP>:8080/otlp",
        "-Dotel.exporter.otlp.protocol=http/protobuf",
        "-Dotel.service.name=<서비스명>",
        "-Dotel.service.instance.id=<인스턴스명>",
        "-Dotel.metrics.exporter=otlp",
        "-Dotel.logs.exporter=otlp",
        "-Dotel.traces.exporter=otlp",
        "-Dotel.instrumentation.jdbc.enabled=true",
        "-Dotel.instrumentation.servlet.enabled=true",
    ], title="추가할 JVM 옵션")

    pdf.note("[!]  <APM서버IP>를 실제 APM 서버의 IP 주소로 변경하십시오.\n"
             "[!]  otel.service.name과 otel.service.instance.id는 인스턴스별로 구분하여 설정해야\n"
             "    APM 대시보드에서 정확한 서비스 토폴로지와 인스턴스 현황이 표시됩니다.")

    pdf.h2("5.3  인스턴스별 설정 예시")
    pdf.table(
        ["JEUS 서버", "otel.service.name", "otel.service.instance.id", "역할"],
        [
            ["was-server-1", "order-system",       "order-node1",    "주문 처리 WAS #1"],
            ["was-server-2", "order-system",       "order-node2",    "주문 처리 WAS #2"],
            ["was-server-3", "payment-system",     "payment-node1",  "결제 처리 WAS"],
            ["was-server-4", "external-interface", "ext-node1",      "대외계 WAS"],
            ["was-server-5", "inquiry-system",     "inquiry-node1",  "조회 WAS"],
        ],
        [32, 42, 46, 66]
    )

    pdf.body("service.name은 업무 시스템 단위로 묶고,\n"
             "service.instance.id는 물리/가상 WAS 노드별로 고유하게 부여합니다.")
    pdf.ln(2)

    pdf.h3("JEUS 재시작 후 연동 확인")
    pdf.code_block([
        "# APM 서버에서 수신된 서비스 목록 확인",
        "curl http://localhost:8080/api/services",
        "",
        "# 서비스가 목록에 나타나면 연동 성공",
        '# 예: [{"name":"order-system", ...}, {"name":"payment-system", ...}]',
    ])


    # ════════════════════════════════════════════════════
    # 6. 대시보드 사용 가이드
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("6. APM 대시보드 사용 가이드")

    pdf.body("브라우저에서 http://<APM서버IP>:8080 으로 접속합니다.")
    pdf.ln(2)

    pdf.table(
        ["메뉴", "기능"],
        [
            ["대시보드",    "서비스/인스턴스별 TPS, 응답시간, 에러율, 트랜잭션 분포 실시간 조회"],
            ["메트릭",      "CPU 사용률, JVM 힙 메모리, HTTP 응답시간, 스레드 수 시계열 차트"],
            ["토폴로지",    "서비스 간 호출 관계 시각화 (Force-directed 그래프), 인스턴스 단위 전환"],
            ["트레이스",    "분산 트레이스 검색, 스팬 워터폴 조회, DB 쿼리 상세"],
            ["에러",        "에러 목록 조회, 해결 처리, 트레이스 연결"],
            ["로그",        "서비스/레벨별 로그 실시간 조회, 트레이스 연결"],
            ["알림",        "알림 규칙 설정 (임계값 기반), 활성 알림 현황"],
            ["통계",        "시간/일 단위 집계, 기간별 성능 추이 분석"],
        ],
        [30, 156]
    )

    pdf.h2("서비스 / 인스턴스 단위 전환")
    pdf.bullet("대시보드 우상단 [서비스 | 인스턴스] 버튼으로 조회 단위를 전환합니다.")
    pdf.bullet("서비스 뷰: 업무 시스템 단위 집계 (order-system, payment-system 등)")
    pdf.bullet("인스턴스 뷰: WAS 노드 단위 집계 (order-node1, order-node2 등)")
    pdf.ln(2)

    pdf.h2("토폴로지 맵 활용")
    pdf.bullet("서비스 간 호출 방향과 호출 건수, 평균 응답시간, 에러율을 시각적으로 확인합니다.")
    pdf.bullet("노드를 클릭하면 해당 서비스의 트레이스 목록으로 이동합니다.")
    pdf.bullet("[서비스 | 인스턴스] 전환으로 노드별 라우팅 차이를 확인할 수 있습니다.")


    # ════════════════════════════════════════════════════
    # 7. 운영 관리
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("7. 운영 관리")

    pdf.h2("7.1  서비스 관리 명령어")
    pdf.code_block([
        "# 서비스 상태 확인",
        "docker compose -f /opt/apm/docker-compose.prod.yml ps",
        "",
        "# 실시간 로그 조회 (전체)",
        "docker compose -f /opt/apm/docker-compose.prod.yml logs -f",
        "",
        "# 특정 서비스 로그",
        "docker compose -f /opt/apm/docker-compose.prod.yml logs -f backend",
        "",
        "# 서비스 재시작",
        "docker compose -f /opt/apm/docker-compose.prod.yml restart",
        "",
        "# 서비스 중지",
        "docker compose -f /opt/apm/docker-compose.prod.yml down",
        "",
        "# 서비스 시작",
        "cd /opt/apm && docker compose -f docker-compose.prod.yml --env-file .env up -d",
    ], title="서비스 관리")

    pdf.h2("7.2  데이터 보존 정책")
    pdf.body("TimescaleDB 자동 파티션 정리 정책 설정 (설치 후 1회 적용):")
    pdf.code_block([
        "docker exec -it apm-db psql -U apm -d apmdb",
        "",
        "-- 트레이스 데이터: 30일 보존",
        "SELECT add_retention_policy('traces',  INTERVAL '30 days');",
        "",
        "-- 메트릭 데이터: 90일 보존",
        "SELECT add_retention_policy('metrics', INTERVAL '90 days');",
        "",
        "-- 로그 데이터: 14일 보존",
        "SELECT add_retention_policy('logs',    INTERVAL '14 days');",
        "",
        "-- 에러 데이터: 90일 보존 (errors 테이블은 hypertable 변환 후)",
        "\\q",
    ], title="데이터 보존 정책 설정")

    pdf.h2("7.3  보안 체크리스트")
    items = [
        "DB 비밀번호 8자 이상 설정 (설치 시 입력)",
        "/opt/apm/.env 파일 권한 600 확인 (root만 읽기)",
        "방화벽: 8080 포트는 허용된 IP 대역만 접근",
        "방화벽: 5432(DB), 8000(백엔드) 포트 외부 차단 확인",
        "/data/apm/db 디렉토리 정기 백업 설정",
        "데이터 보존 정책 적용 (디스크 용량 관리)",
        "OS 패치 및 Docker 버전 주기적 업데이트",
    ]
    for item in items:
        pdf.set_x(14)
        pdf.set_font("Gothic", "", 9)
        pdf.set_text_color(*C_BLACK)
        pdf.cell(6, 6, "□")
        pdf.set_x(20)
        pdf.cell(0, 6, item, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


    # ════════════════════════════════════════════════════
    # 8. 트러블슈팅
    # ════════════════════════════════════════════════════
    pdf.add_page()
    pdf.h1("8. 트러블슈팅")

    problems = [
        (
            "APM 대시보드에서 서비스 목록이 비어 있음",
            [
                "JEUS WAS → APM 서버(8080) 방화벽 허용 여부 확인",
                "JEUS JVM 옵션의 otel.exporter.otlp.endpoint IP 및 포트 확인",
                "docker compose logs -f backend  로 OTLP 수신 로그 확인",
            ]
        ),
        (
            "트레이스는 보이는데 메트릭(CPU/메모리)이 없음",
            [
                "JVM 옵션에 -Dotel.metrics.exporter=otlp 추가 여부 확인",
                "JEUS 재시작 후 30초 이상 대기 (메트릭 수집 주기)",
            ]
        ),
        (
            "대시보드 평균 응답시간이 — 로 표시됨",
            [
                "JEUS WAS에서 트레이스 데이터가 수집되고 있는지 트레이스 메뉴에서 확인",
                "트레이스가 없으면 OTLP 연결 문제 → 방화벽 및 JVM 옵션 재확인",
            ]
        ),
        (
            "인스턴스가 하나로 합쳐져 보임",
            [
                "각 JEUS 노드의 otel.service.instance.id 가 고유한지 확인",
                "동일한 값으로 설정 시 하나의 인스턴스로 인식됨",
            ]
        ),
        (
            "디스크 사용량 급증",
            [
                "데이터 보존 정책(7.2절) 적용 여부 확인",
                "df -h /data/apm  로 디스크 사용량 모니터링",
                "docker exec apm-db psql -U apm -d apmdb -c \"SELECT show_chunks('traces');\" 로 파티션 확인",
            ]
        ),
        (
            "컨테이너가 시작 직후 종료됨",
            [
                "docker compose logs apm-db  로 DB 초기화 오류 확인",
                "/data/apm/db 디렉토리 권한 확인 (root 소유 필요)",
                ".env 파일의 DB_PASSWORD 값에 특수문자 포함 시 따옴표 처리 필요",
            ]
        ),
    ]

    for title, solutions in problems:
        pdf.h3(title)
        for sol in solutions:
            pdf.bullet(sol, indent=20)
        pdf.ln(1)

    pdf.divider()

    pdf.set_font("Gothic", "B", 10)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_x(14)
    pdf.cell(0, 8, "문의 및 지원", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Gothic", "", 9)
    pdf.set_text_color(*C_GRAY)
    pdf.body("시스템 담당자에게 다음 정보를 함께 전달하면 빠른 지원이 가능합니다:", indent=14)
    pdf.code_block([
        "# 1. 컨테이너 상태",
        "docker compose -f /opt/apm/docker-compose.prod.yml ps",
        "",
        "# 2. 최근 로그 (50줄)",
        "docker compose -f /opt/apm/docker-compose.prod.yml logs --tail=50",
        "",
        "# 3. 버전 정보",
        "cat /opt/apm/.env | grep -v PASSWORD",
        "docker images | grep apm",
    ])

    # ── 저장 ─────────────────────────────────────────
    pdf.output(OUT_PATH)
    print(f"[OK] PDF 생성 완료: {OUT_PATH}")


if __name__ == "__main__":
    if not os.path.exists(FONT_PATH):
        print(f"[ERROR] 폰트 파일 없음: {FONT_PATH}")
        sys.exit(1)
    build_pdf()
