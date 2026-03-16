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
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_traces_start_service
                    ON traces(start_time DESC, service);
                CREATE INDEX IF NOT EXISTS idx_metrics_time_service
                    ON metrics(time DESC, service);
            """))
            await session.commit()
        logger.info("[DB] 인덱스 확인 완료")
    except Exception as e:
        logger.warning(f"[DB] 인덱스 생성 실패 (무시): {e}")
