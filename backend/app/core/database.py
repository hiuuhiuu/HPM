import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from app.core.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def ensure_indexes() -> None:
    """기존 설치 환경에서 누락될 수 있는 인덱스를 안전하게 추가"""
    indexes = [
        # 메트릭·트레이스 기본 시계열 조회
        "CREATE INDEX IF NOT EXISTS idx_traces_start_service ON traces(start_time DESC, service);",
        "CREATE INDEX IF NOT EXISTS idx_metrics_time_service  ON metrics(time DESC, service);",
        # 토폴로지 self-join: child.parent_span_id = parent.span_id ON trace_id
        "CREATE INDEX IF NOT EXISTS idx_traces_trace_span       ON traces(trace_id, span_id);",
        "CREATE INDEX IF NOT EXISTS idx_traces_trace_parent_span ON traces(trace_id, parent_span_id);",
    ]
    try:
        async with AsyncSessionLocal() as session:
            for ddl in indexes:
                await session.execute(text(ddl))
            await session.commit()
        logger.info("[DB] 인덱스 확인 완료")
    except Exception as e:
        logger.warning(f"[DB] 인덱스 생성 실패 (무시): {e}")


async def ensure_errors_migration() -> None:
    """
    errors 테이블 마이그레이션 (멱등):
    1. count / first_seen 컬럼 추가
    2. 기존 UnknownError 행 → HTTP attributes로 재분류
    3. 동일 (service, error_type, message) 중복 행 집약 (count 합산, 최신 1건 유지)
    4. UNIQUE INDEX 생성 (이후 UPSERT 기반)
    """
    try:
        async with AsyncSessionLocal() as session:
            # 1. 컬럼 추가 (각각 별도 execute — asyncpg 다중 명령 불가)
            await session.execute(text(
                "ALTER TABLE errors ADD COLUMN IF NOT EXISTS count INTEGER DEFAULT 1;"
            ))
            await session.execute(text(
                "ALTER TABLE errors ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;"
            ))
            await session.execute(text(
                "UPDATE errors SET first_seen = time WHERE first_seen IS NULL;"
            ))

            # 2. 기존 UnknownError 재분류
            await session.execute(text("""
                UPDATE errors
                SET
                    error_type = CASE
                        WHEN COALESCE(
                            attributes->>'http.response.status_code',
                            attributes->>'http.status_code'
                        ) IS NOT NULL
                        THEN 'HttpError ' || COALESCE(
                            attributes->>'http.response.status_code',
                            attributes->>'http.status_code'
                        )
                        ELSE error_type
                    END,
                    message = CASE
                        WHEN COALESCE(
                            attributes->>'http.response.status_code',
                            attributes->>'http.status_code'
                        ) IS NOT NULL
                        THEN TRIM(
                            COALESCE(
                                COALESCE(
                                    attributes->>'http.request.method',
                                    attributes->>'http.method'
                                ) || ' ',
                                ''
                            ) ||
                            COALESCE(
                                attributes->>'url.full',
                                attributes->>'http.url',
                                attributes->>'http.target',
                                ''
                            ) ||
                            ' → ' || COALESCE(
                                attributes->>'http.response.status_code',
                                attributes->>'http.status_code'
                            )
                        )
                        ELSE message
                    END
                WHERE error_type = 'UnknownError'
                  AND message = 'Unknown error'
                  AND COALESCE(
                      attributes->>'http.response.status_code',
                      attributes->>'http.status_code'
                  ) IS NOT NULL;
            """))

            # 3. 중복 집약 (UNIQUE index 생성 전에 실행)
            #    같은 (service, error_type, message)에서 MAX(id) 행을 보존,
            #    나머지는 삭제. count = 전체 중복 수, first_seen = 최초 발생 시각
            await session.execute(text("""
                UPDATE errors e
                SET count      = g.total_count,
                    first_seen = g.min_time
                FROM (
                    SELECT service, error_type, message,
                           MAX(id)    AS keep_id,
                           COUNT(*)   AS total_count,
                           MIN(time)  AS min_time
                    FROM errors
                    GROUP BY service, error_type, message
                    HAVING COUNT(*) > 1
                ) g
                WHERE e.id = g.keep_id;
            """))
            await session.execute(text("""
                DELETE FROM errors e
                USING (
                    SELECT service, error_type, message, MAX(id) AS keep_id
                    FROM errors
                    GROUP BY service, error_type, message
                    HAVING COUNT(*) > 1
                ) g
                WHERE e.service    = g.service
                  AND e.error_type = g.error_type
                  AND e.message    = g.message
                  AND e.id        != g.keep_id;
            """))

            # 4. UNIQUE INDEX (이미 존재하면 무시)
            await session.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_errors_unique_key
                    ON errors (service, error_type, message);
            """))

            await session.commit()
        logger.info("[DB] errors 마이그레이션 완료 (count/first_seen/dedup/unique)")
    except Exception as e:
        logger.warning(f"[DB] errors 마이그레이션 실패 (무시): {e}")


async def ensure_agent_configs_table() -> None:
    """agent_configs 테이블 생성 (멱등). 에이전트별 설정 저장."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS agent_configs (
                    id                   SERIAL PRIMARY KEY,
                    instance             TEXT NOT NULL,
                    min_span_duration_ms BIGINT NOT NULL DEFAULT 0,
                    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """))
            await session.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_configs_instance
                    ON agent_configs (instance);
            """))
            await session.commit()
        logger.info("[DB] agent_configs 테이블 확인 완료")
    except Exception as e:
        logger.warning(f"[DB] agent_configs 테이블 생성 실패 (무시): {e}")
