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
    name="assets",
)


# =====================================================
# MODELOS
# =====================================================

class Login(BaseModel):
    login: str
    senha: str


class UsuarioNovo(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    login: str = Field(min_length=3, max_length=80)
    senha: str = Field(min_length=12, max_length=128)
    perfil: str = "operador"


class TrocaSenha(BaseModel):
    atual: str
    nova: str = Field(min_length=12, max_length=128)


# =====================================================
# AUTENTICAÇÃO
# =====================================================

def atual(request: Request):
    token = request.cookies.get(COOKIE)

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Sessão necessária",
        )

    with db() as conn:
        usuario = conn.execute(
            """
            SELECT
                u.id,
                u.nome,
                u.login,
                u.perfil,
                u.troca_senha
            FROM sessoes s
            JOIN usuarios u
                ON u.id = s.usuario_id
            WHERE s.token_hash = %s
              AND s.expira_em > now()
              AND u.ativo = true
            """,
            (token_hash(token),),
        ).fetchone()

    if not usuario:
        raise HTTPException(
            status_code=401,
            detail="Sessão expirada",
        )

    return usuario


# =====================================================
# LEITURAS OBRIGATÓRIAS PENDENTES
# =====================================================

def exigir_leituras_concluidas(u):
    """Bloqueia operações protegidas quando há leitura obrigatória pendente.

    Considera somente destinatários da versão vigente e publicada.
    Alinhamentos não obrigatórios não bloqueiam o usuário.
    """
    with db() as conn:
        pendente = conn.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM alinhamento_destinatarios d
                JOIN alinhamentos a
                  ON a.id = d.alinhamento_id
                 AND a.versao = d.versao
                JOIN alinhamento_versoes v
                  ON v.alinhamento_id = d.alinhamento_id
                 AND v.versao = d.versao
                LEFT JOIN alinhamento_leituras l
                  ON l.alinhamento_id = d.alinhamento_id
                 AND l.versao = d.versao
                 AND l.usuario_id = d.usuario_id
                WHERE d.usuario_id = %s
                  AND a.publicado_em IS NOT NULL
                  AND v.obrigatorio = TRUE
                  AND l.usuario_id IS NULL
            ) AS pendente
            """,
            (u["id"],),
        ).fetchone()["pendente"]

    if pendente:
        raise HTTPException(
            status_code=403,
            detail=(
                "Existem alinhamentos obrigatórios pendentes. "
                "Confirme as leituras para continuar."
            ),
        )


# =====================================================
# PERMISSÃO EXCLUSIVA DO ADMINISTRADOR
# =====================================================

def admin(u=Depends(atual)):
    if u["perfil"] != "administrador":
        raise HTTPException(
            status_code=403,
            detail="Acesso restrito",
        )

    if u["troca_senha"]:
        raise HTTPException(
            status_code=403,
            detail="Troque sua senha primeiro",
        )

    exigir_leituras_concluidas(u)
    return u


# =====================================================
# PERMISSÕES — GESTÃO DE ALINHAMENTOS
# =====================================================

def gestor_alinhamentos(u=Depends(atual)):
    """
    Permite acesso somente aos perfis:
    - administrador
    - supervisor

    Bloqueia usuários com troca obrigatória
    de senha pendente.
    """

    if u["troca_senha"]:
        raise HTTPException(
            status_code=403,
            detail="Troque sua senha primeiro",
        )

    if u["perfil"] not in (
        "administrador",
        "supervisor",
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Acesso restrito a "
                "administradores e supervisores"
            ),
        )

    exigir_leituras_concluidas(u)
    return u


# =====================================================
# PERMISSÃO — USUÁRIO LIBERADO
# =====================================================

def usuario_liberado(u=Depends(atual)):
    """
    Permite acesso a qualquer usuário autenticado
    que não tenha troca obrigatória de senha pendente.
    """

    if u["troca_senha"]:
        raise HTTPException(
            status_code=403,
            detail="Troque sua senha primeiro",
        )

    return u


# =====================================================
# PÁGINAS DO PORTAL
# =====================================================

@app.get("/")
def index():
    return FileResponse(
        ROOT / "frontend" / "login.html"
    )


@app.get("/inicio")
def inicio(u=Depends(atual)):
    return FileResponse(
        ROOT / "frontend" / "inicio.html"
    )


@app.get("/alinhamentos")
def pagina_alinhamentos(u=Depends(usuario_liberado)):
    return FileResponse(
        ROOT / "frontend" / "alinhamentos.html"
    )


# =====================================================
# LOGIN
# =====================================================

@app.post("/api/login")
def login(data: Login, response: Response):
    with db() as conn:
        usuario = conn.execute(
            """
            SELECT *
            FROM usuarios
            WHERE login = %s
              AND ativo = true
            """,
            (data.login.strip().lower(),),
        ).fetchone()

        try:
            valido = bool(usuario) and ph.verify(
                usuario["senha_hash"],
                data.senha,
            )
        except (VerifyMismatchError, VerificationError):
            valido = False

        if not valido:
            raise HTTPException(
                status_code=401,
                detail="Credenciais inválidas",
            )

        token = secrets.token_urlsafe(48)

        conn.execute(
            """
            INSERT INTO sessoes (
                token_hash,
                usuario_id,
                expira_em
            )
            VALUES (%s, %s, %s)
            """,
            (
                token_hash(token),
                usuario["id"],
                datetime.now(timezone.utc)
                + timedelta(hours=8),
            ),
        )

    response.set_cookie(
        key=COOKIE,
        value=token,
        httponly=True,
        secure=os.getenv(
            "SESSION_SECURE", "false"
        ).lower() == "true",
        samesite="strict",
        max_age=28800,
        path="/",
    )

    return {
        "ok": True,
        "troca_senha": usuario["troca_senha"],
    }


# =====================================================
# USUÁRIO AUTENTICADO
# =====================================================

@app.get("/api/me")
def me(u=Depends(atual)):
    return u


# =====================================================
# LOGOUT
# =====================================================

@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)

    if token:
        with db() as conn:
            conn.execute(
                """
                DELETE FROM sessoes
                WHERE token_hash = %s
                """,
                (token_hash(token),),
            )

    response.delete_cookie(
        COOKIE,
        path="/",
    )

    return {"ok": True}


# =====================================================
# TROCA DE SENHA
# =====================================================

@app.post("/api/trocar-senha")
def trocar(
    data: TrocaSenha,
    request: Request,
    u=Depends(atual),
):
    with db() as conn:
        registro = conn.execute(
            """
            SELECT senha_hash
            FROM usuarios
            WHERE id = %s
            """,
            (u["id"],),
        ).fetchone()

        try:
            ph.verify(
                registro["senha_hash"],
                data.atual,
            )
        except (VerifyMismatchError, VerificationError):
            raise HTTPException(
                status_code=400,
                detail="Senha atual incorreta",
            )

        conn.execute(
            """
            UPDATE usuarios
            SET senha_hash = %s,
                troca_senha = false
            WHERE id = %s
            """,
            (
                ph.hash(data.nova),
                u["id"],
            ),
        )

        conn.execute(
            """
            DELETE FROM sessoes
            WHERE usuario_id = %s
              AND token_hash <> %s
            """,
            (
                u["id"],
                token_hash(
                    request.cookies[COOKIE]
                ),
            ),
        )

    return {"ok": True}


# =====================================================
# LISTAR USUÁRIOS
# =====================================================

@app.get("/api/usuarios")
def usuarios(u=Depends(admin)):
    with db() as conn:
        return conn.execute(
            """
            SELECT
                id,
                nome,
                login,
                perfil,
                ativo,
                troca_senha
            FROM usuarios
            ORDER BY nome
            """
        ).fetchall()


# =====================================================
# CADASTRAR USUÁRIO
# =====================================================

@app.post("/api/usuarios", status_code=201)
def criar(data: UsuarioNovo, u=Depends(admin)):
    if data.perfil not in (
        "administrador",
        "supervisor",
        "operador",
    ):
        raise HTTPException(
            status_code=400,
            detail="Perfil inválido",
        )

    try:
        with db() as conn:
            registro = conn.execute(
                """
                INSERT INTO usuarios (
                    nome,
                    login,
                    senha_hash,
                    perfil
                )
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (
                    data.nome.strip(),
                    data.login.strip().lower(),
                    ph.hash(data.senha),
                    data.perfil,
                ),
            ).fetchone()

            conn.execute(
                """
                INSERT INTO auditoria (
                    ator_id,
                    acao,
                    alvo_id
                )
                VALUES (%s, %s, %s)
                """,
                (
                    u["id"],
                    "criar_usuario",
                    registro["id"],
                ),
            )

            return {
                "id": registro["id"]
            }

    except psycopg.errors.UniqueViolation:
        raise HTTPException(
            status_code=409,
            detail="Login já cadastrado",
        )


# =====================================================
# RESUMO DO PORTAL
# =====================================================

@app.get("/api/resumo")
def resumo(u=Depends(atual)):
    with db() as conn:
        registro = conn.execute(
            """
            SELECT COUNT(*) AS total
            FROM alinhamento_destinatarios d
            LEFT JOIN alinhamento_leituras l
                ON l.alinhamento_id = d.alinhamento_id
               AND l.versao = d.versao
               AND l.usuario_id = d.usuario_id
            JOIN alinhamentos a
                ON a.id = d.alinhamento_id
               AND a.versao = d.versao
            WHERE d.usuario_id = %s
              AND a.publicado_em IS NOT NULL
              AND l.usuario_id IS NULL
            """,
            (u["id"],),
        ).fetchone()

    return {
        "alinhamentos_pendentes": registro["total"],
        "noticias": 0,
        "scripts": 0,
    }


# =====================================================
# MÓDULO DE ALINHAMENTOS
# =====================================================

app.include_router(
    criar_router(
        db=db,
        atual=usuario_liberado,
        admin=gestor_alinhamentos,
    )
)
