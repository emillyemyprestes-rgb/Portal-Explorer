import os
import secrets
import hashlib

from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import asynccontextmanager

import psycopg
from psycopg.rows import dict_row

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    Depends,
)

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel, Field

from argon2 import PasswordHasher
from argon2.exceptions import (
    VerifyMismatchError,
    VerificationError,
)

from dotenv import load_dotenv

from .alinhamentos import criar_router


# =====================================================
# CONFIGURAÇÕES GERAIS
# =====================================================

ROOT = Path(__file__).resolve().parents[2]

load_dotenv(ROOT / "backend" / ".env")

ph = PasswordHasher()

# Manter o nome existente para preservar as sessões.
COOKIE = "explorer_session"


# =====================================================
# BANCO DE DADOS
# =====================================================

def db():
    return psycopg.connect(
        os.environ["DATABASE_URL"],
        row_factory=dict_row,
    )


def token_hash(token):
    return hashlib.sha256(
        token.encode()
    ).hexdigest()


# =====================================================
# INICIALIZAÇÃO
# =====================================================

@asynccontextmanager
async def lifespan(app):
    with db() as conn:
        conn.execute(
            (ROOT / "backend" / "schema.sql").read_text(
                encoding="utf-8"
            )
        )

    yield


app = FastAPI(
    title="Portal IPASGO Saúde",
    description="Central de Comunicação e Gestão Operacional",
    lifespan=lifespan,
)


# =====================================================
# ARQUIVOS ESTÁTICOS
# =====================================================

app.mount(
    "/assets",
    StaticFiles(directory=ROOT / "frontend"),