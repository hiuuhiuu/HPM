# Hamster APM 통합 에이전트 가이드

본 가이드는 단 하나의 Java 에이전트 설정만으로 **"상세 메트릭 수집"**, **"실시간 스레드 스택 분석"**, **"메서드 단위 콜 트리 추적"**을 활성화하는 방법을 안내합니다.

## 1. 구성 요소
*   **hamster-agent.jar**: 표준 OTel 에이전트와 Hamster 전용 확장 기능이 통합된 올인원 에이전트.
*   **hamster-methods.conf**: (선택) 메서드 단위 콜 트리 추적 대상을 지정하는 설정 파일.

## 2. JVM 옵션 적용 (WAS 설정)

WAS(JEUS, Tomcat 등)의 시작 스크립트에 아래 Java 옵션을 추가합니다. 별도의 확장 경로(`-Dotel.javaagent.extensions`)를 지정할 필요가 없습니다.

### 추천 설정 (Copy & Paste)
```bash
# 1. 에이전트 경로 (install.sh 실행 후 /waslib/hamster-agent.jar 에 배포됨)
AGENT_PATH="/waslib/hamster-agent.jar"

# 2. JVM 옵션 추가 (단 한 줄로 충분합니다)
JAVA_OPTS="${JAVA_OPTS} -javaagent:${AGENT_PATH}"

# 3. 필수 설정 (APM 서버 IP와 포트 — nginx 포트 8080 사용, /otlp 경로 필수)
JAVA_OPTS="${JAVA_OPTS} -Dotel.exporter.otlp.endpoint=http://<APM-SERVER-IP>:8080/otlp"
JAVA_OPTS="${JAVA_OPTS} -Dotel.exporter.otlp.protocol=http/protobuf"

# 4. 서비스 및 인스턴스 이름 지정
JAVA_OPTS="${JAVA_OPTS} -Dotel.service.name=my-jeus-app"
JAVA_OPTS="${JAVA_OPTS} -Dotel.resource.attributes=service.instance.id=node-01"

# 5. 메트릭·트레이스·로그 수집 활성화
JAVA_OPTS="${JAVA_OPTS} -Dotel.metrics.exporter=otlp"
JAVA_OPTS="${JAVA_OPTS} -Dotel.traces.exporter=otlp"
JAVA_OPTS="${JAVA_OPTS} -Dotel.logs.exporter=otlp"
```

---

## 3. 메서드 콜 트리 추적 (선택 기능)

특정 비즈니스 메서드를 스팬으로 계측하여 APM 트레이싱 페이지의 **[콜 트리]** 뷰에서 메서드 단위 호출 흐름을 확인할 수 있습니다.

### 3-1. 설정 파일 위치

설정 파일은 다음 순서로 탐색됩니다:

1. `-Dhamster.methods.config=<경로>` 시스템 프로퍼티로 명시한 경로
2. `hamster-agent.jar` 와 동일한 디렉토리의 `hamster-methods.conf`
3. `/waslib/hamster-methods.conf` (기본 설치 경로)

`install.sh`로 설치하면 JAR도 `/waslib/`에 배포되므로, **별도 JVM 옵션 없이** `/waslib/hamster-methods.conf` 파일만 생성하면 자동 적용됩니다.

```
/waslib/
  ├── hamster-agent.jar         ← install.sh가 배포
  └── hamster-methods.conf      ← 이 파일만 작성하면 됨
```

### 3-2. 설정 파일 형식

다섯 가지 형식을 지원합니다.

#### ① 특정 메서드 지정
```
com.bank.service.TransferService[transfer,validate,rollback]
com.bank.service.AccountService[getBalance,deposit,withdraw]
```
지정한 메서드만 스팬으로 수집합니다.

#### ② 클래스 전체 메서드 후킹 `[*]`
```
com.bank.service.OrderService[*]
com.bank.dao.TransactionDao[*]
```
해당 클래스의 **모든 메서드**를 스팬으로 수집합니다.

#### ③ 패키지 직계 클래스 전체 후킹 `패키지.*`
```
com.bank.service.*
```
해당 패키지의 **직계 클래스 전체**를 수집합니다. 하위 패키지(`com.bank.service.impl.*` 등)는 포함되지 않습니다.

#### ④ 패키지 및 하위 패키지 전체 후킹 `패키지.**`
```
com.bank.**
```
해당 패키지와 **모든 하위 패키지**의 클래스 전체를 수집합니다.

#### ⑤ 상속 클래스 자동 후킹 `extends:슈퍼클래스[메서드]`
```
extends:javax.servlet.http.HttpServlet[doGet,doPost,service,_jspService]
```
지정한 슈퍼클래스/인터페이스를 **상속·구현한 모든 하위 클래스**를 자동으로 후킹합니다.
클래스명을 직접 나열하지 않아도 되므로, **JSP 컴파일 서블릿처럼 자동 생성되는 클래스**에 특히 유용합니다.

| 상황 | 설정 예시 |
|------|-----------|
| 커스텀 서블릿 + JSP 전체 | `extends:javax.servlet.http.HttpServlet[service,doGet,doPost,doPut,doDelete,_jspService]` |
| 서블릿 필터 체인 | `extends:javax.servlet.Filter[doFilter]` |
| JEUS/Jasper JSP 베이스 | `extends:org.apache.jasper.runtime.HttpJspBase[_jspService]` |
| JSP 커스텀 태그 | `extends:javax.servlet.jsp.tagext.Tag[doStartTag,doEndTag]` |
| 커스텀 인터페이스 구현체 전체 | `extends:com.example.common.BusinessHandler[execute]` |

#### 스팬 이름 자동 포맷팅

JSP·Servlet·Filter 메서드로 판별되면 스팬 이름이 자동으로 읽기 좋게 포맷팅됩니다:

| 메서드 | 스팬 이름 예시 | `code.hamster.kind` |
|--------|----------------|---------------------|
| `_jspService` | `JSP order_list_jsp` | `jsp` |
| `service` / `doGet` / `doPost` / `doPut` / `doDelete` | `Servlet OrderServlet.doPost` | `servlet` |
| `doFilter` | `Filter AuthFilter.doFilter` | `filter` |
| 기타 | `OrderService.process` | (없음) |

모든 스팬에는 `code.namespace` (FQCN), `code.function` (메서드명) 속성이 포함됩니다.

#### 웹 요청 콜 트리 예시

```
[GET /order/list.jsp]                         ← OTel HTTP 자동 계측
  └── [Filter AuthFilter.doFilter]            ← extends:Filter
        └── [Filter LoggingFilter.doFilter]   ← 다음 필터
              └── [JSP order_list_jsp]        ← extends:HttpServlet (_jspService)
                    ├── [OrderService.findActiveOrders]  ← hamster-methods.conf
                    └── [OrderDao.findByStatus]          ← hamster-methods.conf
```

> **JSP 콜 트리 확인 방법**: `_jspService`는 JSP가 컴파일된 서블릿의 본문 실행 메서드입니다.
> 이 메서드를 후킹하면 JSP 호출 스팬 아래에 JSP 내부에서 호출된 비즈니스 메서드들이
> 자식 스팬으로 나타납니다.

> **주의**: `extends:` 규칙은 WAS 기동 시 해당 슈퍼타입을 상속한 모든 클래스를 검사합니다.
> `HttpServlet`처럼 광범위한 슈퍼클래스 사용 시 후킹 대상 클래스가 많아질 수 있으므로
> 반드시 메서드 목록을 명시하세요.

#### 혼합 사용 예시
```
# 특정 메서드만
com.bank.service.PaymentService[approve,cancel]

# 클래스 전체
com.bank.service.OrderService[*]

# 패키지 직계
com.bank.util.*

# 하위 패키지 포함 전체
com.bank.external.**

# JSP + 서블릿 콜 트리 (상속 자동 감지)
extends:javax.servlet.http.HttpServlet[doGet,doPost,service,_jspService]
```

> **주의**: 패키지 와일드카드(`*`, `**`)는 범위가 넓을수록 WAS 기동 시간과 트레이스 수가 증가합니다.
> 실운영 전 테스트 환경에서 충분히 검증하세요.

### 3-3. WAS 재시작

설정 파일을 저장한 후 WAS를 재시작하면 에이전트가 파일을 읽어 메서드 후킹을 자동 적용합니다.

### 3-4. 콜 트리 확인

APM 대시보드 → **[트레이싱]** 메뉴 → 트레이스 클릭 → **[🌲 콜 트리]** 탭

계측된 메서드가 HTTP 요청 스팬 하위에 트리 구조로 표시됩니다.

---

## 4. 스팬 억제 (suppress) — 스케쥴러·체크쿼리 숨기기

Quartz 같은 스케쥴링 프레임워크나 주기적 체크쿼리는 트레이싱을 오염시킬 수 있습니다.
`suppress:` 규칙으로 해당 스팬을 **Sampler 레벨에서 드랍**하면 백엔드로 전송조차 되지 않고 CPU/메모리 낭비도 없습니다. 자식 스팬도 함께 드랍됩니다.

### 4-1. 억제 규칙 형식

`hamster-methods.conf` 에 아래 형식으로 추가합니다.

```
suppress:<타입>:<패턴>
```

| 형식 | 억제 기준 | 예시 |
|------|-----------|------|
| `suppress:span:<prefix>` | 스팬 이름이 prefix 로 시작 | `suppress:span:QuartzJob` |
| `suppress:http:<path>` | HTTP 요청 경로가 prefix 로 시작 | `suppress:http:/health` |
| `suppress:sql:<prefix>` | DB 쿼리(db.statement)가 prefix 로 시작 (대소문자 무시) | `suppress:sql:select 1` |
| `suppress:attr:<key>=<value>` | OTel 속성 정확 일치 | `suppress:attr:job.system=quartz` |
| `suppress:class:<prefix>` | code.namespace(클래스 FQCN)가 prefix 로 시작 | `suppress:class:org.quartz` |

### 4-2. 주요 사용 사례

#### Quartz 스케쥴러 전체 숨기기
OTel Quartz 자동계측 스팬에는 `job.system=quartz` 속성이 붙습니다:
```
suppress:attr:job.system=quartz
```

커스텀 스케쥴러 클래스명 기반으로 억제할 수도 있습니다:
```
suppress:class:org.quartz
suppress:class:com.example.scheduler
suppress:span:BatchJob
```

#### 헬스체크 HTTP 요청 숨기기
```
suppress:http:/health
suppress:http:/actuator/health
suppress:http:/ping
```

#### DB 체크쿼리 / keep-alive 쿼리 숨기기
```
suppress:sql:select 1
suppress:sql:select 1 from dual
suppress:sql:values 1
```

#### 혼합 예시
```
# Quartz 스케쥴러
suppress:attr:job.system=quartz

# 모니터링 HTTP 호출
suppress:http:/health
suppress:http:/actuator/

# DB 생존 확인 쿼리
suppress:sql:select 1

# 커스텀 배치 클래스
suppress:class:com.example.batch
```

### 4-3. 동작 확인

WAS 재시작 시 로그에서 규칙 로드 확인:
```
[Hamster] Suppress rules: 3
[Hamster]   suppress:attr:job.system=quartz
[Hamster]   suppress:http:/health
[Hamster]   suppress:sql:select 1
```

> **주의**: `suppress:` 규칙은 추가/제거 후 **WAS 재시작**이 필요합니다.
> Sampler 등록은 JVM 기동 시점에 이루어지므로 hot-reload 는 지원되지 않습니다.

---

## 5. 작동 원리 및 확인 방법

1.  **동작 원리**: `hamster-agent.jar` 내부에는 실시간 제어 스레드가 내장되어 있어, WAS 기동과 동시에 APM 서버와 통신을 시작합니다.
2.  **작동 확인**:
    *   대시보드 메인 화면의 **[실시간 활성 거래]** 카드를 클릭합니다.
    *   수 초 내에 해당 인스턴스의 실제 코드 스택이 나타나는지 확인합니다.
    *   **[메트릭]** 메뉴에서 JVM 및 JEUS 전용 메트릭(ThreadPool 등)이 수집되는지 확인합니다.

## 6. 트러블슈팅

*   **스택 분석 타임아웃**: WAS 서버에서 APM 서버 IP의 8080번 포트로 통신이 가능한지 확인하십시오 (`telnet <APM-IP> 8080`). 백엔드 8000 포트는 외부에 직접 노출되지 않으므로 반드시 8080 포트를 사용해야 합니다.
*   **권한 문제**: `hamster-agent.jar` 파일에 대해 WAS 실행 계정이 읽기(Read) 권한을 가지고 있는지 확인하십시오.
*   **메서드 추적 미적용 (특정 메서드)**: WAS 로그에서 `[Hamster] Exact method tracing:` 로그를 확인하십시오.
*   **메서드 추적 미적용 (와일드카드)**: WAS 로그에서 `[Hamster] Wildcard rules registered for ByteBuddy:` 로그를 확인하십시오. 로그가 없으면 설정 파일 경로 또는 형식을 확인하십시오.
*   **suppress 규칙 미적용**: WAS 로그에서 `[Hamster] Suppress rules:` 로그가 있는지 확인하십시오. 로그가 없으면 `suppress:` 앞뒤 공백 또는 오타를 확인하세요.
*   **suppress 규칙 적용했는데도 스팬이 보임**: `suppress:span:` 의 경우 스팬 이름 **prefix** 매칭입니다. APM 대시보드에서 실제 스팬 이름을 확인 후 정확한 prefix 를 지정하세요.
*   **와일드카드 적용 후 성능 저하**: 범위를 좁혀 재설정하세요. `com.bank.**` 대신 `com.bank.service.*` 처럼 구체적인 패키지를 지정하는 것을 권장합니다.
