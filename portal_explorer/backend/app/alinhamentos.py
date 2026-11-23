
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field


def criar_router(db, atual, admin):
    router = APIRouter(
        prefix="/api/alinhamentos",
        tags=["Alinhamentos"]
    )

    # =====================================================
    # MODELOS DE ENTRADA
    # =====================================================

    class AlinhamentoNovo(BaseModel):
        titulo: str = Field(min_length=3, max_length=200)
        conteudo: str = Field(min_length=5)
        obrigatorio: bool = True
        publico: Literal[
            "todos",
            "operador",
            "supervisor",
            "administrador"
        ] = "todos"

    class NovaVersao(BaseModel):
        titulo: str = Field(min_length=3, max_length=200)
        conteudo: str = Field(min_length=5)
        obrigatorio: bool = True
        publico: Literal[
            "todos",
            "operador",
            "supervisor",
            "administrador"
        ] = "todos"

    # =====================================================
    # FUNÇÕES AUXILIARES
    # =====================================================

    def distribuir(conn, alinhamento_id, versao, publico):
        if publico == "todos":
            conn.execute(
                """
                INSERT INTO alinhamento_destinatarios (
                    alinhamento_id,
                    versao,
                    usuario_id
                )
                SELECT %s, %s, id
                FROM usuarios
                WHERE ativo = TRUE
                ON CONFLICT DO NOTHING
                """,
                (alinhamento_id, versao)
            )
        else:
            conn.execute(
                """
                INSERT INTO alinhamento_destinatarios (
                    alinhamento_id,
                    versao,
                    usuario_id
                )
                SELECT %s, %s, id
                FROM usuarios
                WHERE ativo = TRUE
                  AND perfil = %s
                ON CONFLICT DO NOTHING
                """,
                (alinhamento_id, versao, publico)
            )

    def registrar_versao(
        conn,
        alinhamento_id,
        versao,
        titulo,
        conteudo,
        obrigatorio,
        publico,
        publicado_por
    ):
        conn.execute(
            """
            INSERT INTO alinhamento_versoes (
                alinhamento_id,
                versao,
                titulo,
                conteudo,
                obrigatorio,
                publico,
                publicado_em,
                publicado_por
            )
            VALUES (
                %s, %s, %s, %s,
                %s, %s, NOW(), %s
            )
            """,
            (
                alinhamento_id,
                versao,
                titulo,
                conteudo,
                obrigatorio,
                publico,
                publicado_por
            )
        )

    def auditar(conn, usuario_id, acao, alinhamento_id):
        conn.execute(
            """
            INSERT INTO auditoria (
                ator_id,
                acao,
                alvo_id
            )
            VALUES (%s, %s, %s)
            """,
            (usuario_id, acao, alinhamento_id)
        )

    # =====================================================
    # PUBLICAR NOVO ALINHAMENTO
    # =====================================================

    @router.post("", status_code=201)
    def publicar(data: AlinhamentoNovo, u=Depends(admin)):
        titulo = data.titulo.strip()
        conteudo = data.conteudo.strip()

        if len(titulo) < 3 or len(conteudo) < 5:
            raise HTTPException(
                422,
                "Título ou conteúdo inválido"
            )

        with db() as conn:
            with conn.transaction():
                row = conn.execute(
                    """
                    INSERT INTO alinhamentos (
                        titulo,
                        conteudo,
                        obrigatorio,
                        publicado_em,
                        criado_por
                    )
                    VALUES (%s, %s, %s, NOW(), %s)
                    RETURNING id, versao
                    """,
                    (
                        titulo,
                        conteudo,
                        data.obrigatorio,
                        u["id"]
                    )
                ).fetchone()

                registrar_versao(
                    conn,
                    row["id"],
                    row["versao"],
                    titulo,
                    conteudo,
                    data.obrigatorio,
                    data.publico,
                    u["id"]
                )

                distribuir(
                    conn,
                    row["id"],
                    row["versao"],
                    data.publico
                )

                auditar(
                    conn,
                    u["id"],
                    "publicar_alinhamento",
                    row["id"]
                )

                return row

    # =====================================================
    # MEUS ALINHAMENTOS
    # =====================================================

    @router.get("")
    def meus(u=Depends(atual)):
        with db() as conn:
            return conn.execute(
                """
                SELECT
                    a.id,
                    v.titulo,
                    v.conteudo,
                    v.versao,
                    v.obrigatorio,
                    v.publicado_em,
                    l.confirmado_em,
                    (
                        l.confirmado_em IS NOT NULL
                    ) AS lido
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
                ORDER BY
                    l.confirmado_em NULLS FIRST,
                    v.publicado_em DESC
                """,
                (u["id"],)
            ).fetchall()

    # =====================================================
    # CONFIRMAR LEITURA
    # =====================================================

    @router.post("/{alinhamento_id}/confirmar")
    def confirmar(alinhamento_id: int, u=Depends(atual)):
        with db() as conn:
            with conn.transaction():
                row = conn.execute(
                    """
                    SELECT d.versao
                    FROM alinhamento_destinatarios d
                    JOIN alinhamentos a
                      ON a.id = d.alinhamento_id
                     AND a.versao = d.versao
                    WHERE d.alinhamento_id = %s
                      AND d.usuario_id = %s
                      AND a.publicado_em IS NOT NULL
                    """,
                    (alinhamento_id, u["id"])
                ).fetchone()

                if not row:
                    raise HTTPException(
                        404,
                        "Alinhamento não disponível para este usuário"
                    )

                conn.execute(
                    """
                    INSERT INTO alinhamento_leituras (
                        alinhamento_id,
                        versao,
                        usuario_id
                    )
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        alinhamento_id,
                        row["versao"],
                        u["id"]
                    )
                )

                return {
                    "ok": True,
                    "versao": row["versao"]
                }

    # =====================================================
    # RELATÓRIO ADMINISTRATIVO
    # =====================================================

    @router.get("/administracao")
    def relatorio(u=Depends(admin)):
        with db() as conn:
            return conn.execute(
                """
                SELECT
                    a.id,
                    v.titulo,
                    v.versao,
                    v.publicado_em,
                    v.obrigatorio,
                    COUNT(d.usuario_id) AS destinatarios,
                    COUNT(l.usuario_id) AS confirmados,
                    COUNT(d.usuario_id)
                      - COUNT(l.usuario_id) AS pendentes
                FROM alinhamentos a
                JOIN alinhamento_versoes v
                  ON v.alinhamento_id = a.id
                 AND v.versao = a.versao
                LEFT JOIN alinhamento_destinatarios d
                  ON d.alinhamento_id = v.alinhamento_id
                 AND d.versao = v.versao
                LEFT JOIN alinhamento_leituras l
                  ON l.alinhamento_id = d.alinhamento_id
                 AND l.versao = d.versao
                 AND l.usuario_id = d.usuario_id
                WHERE a.publicado_em IS NOT NULL
                GROUP BY
                    a.id,
                    v.alinhamento_id,
                    v.versao,
                    v.titulo,
                    v.publicado_em,
                    v.obrigatorio
                ORDER BY v.publicado_em DESC
                """
            ).fetchall()

    # =====================================================
    # DESTINATÁRIOS E CONFIRMAÇÕES
    # =====================================================

    @router.get(
        "/administracao/{alinhamento_id}/destinatarios"
    )
    def destinatarios(
        alinhamento_id: int,
        u=Depends(admin)
    ):
        with db() as conn:
            return conn.execute(
                """
                SELECT
                    u.id,
                    u.nome,
                    u.login,
                    u.perfil,
                    d.versao,
                    l.confirmado_em
                FROM alinhamento_destinatarios d
                JOIN usuarios u
                  ON u.id = d.usuario_id
                JOIN alinhamentos a
                  ON a.id = d.alinhamento_id
                 AND a.versao = d.versao
                LEFT JOIN alinhamento_leituras l
                  ON l.alinhamento_id = d.alinhamento_id
                 AND l.versao = d.versao
                 AND l.usuario_id = d.usuario_id
                WHERE d.alinhamento_id = %s
                ORDER BY
                    l.confirmado_em NULLS FIRST,
                    u.nome
                """,
                (alinhamento_id,)
            ).fetchall()

    # =====================================================
    # PUBLICAR NOVA VERSÃO
    # =====================================================

    @router.post("/{alinhamento_id}/nova-versao")
    def nova_versao(
        alinhamento_id: int,
        data: NovaVersao,
        u=Depends(admin)
    ):
        titulo = data.titulo.strip()
        conteudo = data.conteudo.strip()

        if len(titulo) < 3 or len(conteudo) < 5:
            raise HTTPException(
                422,
                "Título ou conteúdo inválido"
            )

        with db() as conn:
            with conn.transaction():
                # O UPDATE bloqueia a linha durante a transação,
                # evitando duas versões com o mesmo número.
                row = conn.execute(
                    """
                    UPDATE alinhamentos
                    SET
                        titulo = %s,
                        conteudo = %s,
                        obrigatorio = %s,
                        versao = versao + 1,
                        publicado_em = NOW()
                    WHERE id = %s
                    RETURNING id, versao
                    """,
                    (
                        titulo,
                        conteudo,
                        data.obrigatorio,
                        alinhamento_id
                    )
                ).fetchone()

                if not row:
                    raise HTTPException(
                        404,
                        "Alinhamento não encontrado"
                    )

                registrar_versao(
                    conn,
                    row["id"],
                    row["versao"],
                    titulo,
                    conteudo,
                    data.obrigatorio,
                    data.publico,
                    u["id"]
                )

                distribuir(
                    conn,
                    row["id"],
                    row["versao"],
                    data.publico
                )

                auditar(
                    conn,
                    u["id"],
                    "nova_versao_alinhamento",
                    row["id"]
                )

                return row

    # =====================================================
    # HISTÓRICO DE VERSÕES
    # =====================================================

    @router.get(
        "/administracao/{alinhamento_id}/historico"
    )
    def historico(
        alinhamento_id: int,
        u=Depends(admin)
    ):
        with db() as conn:
            existe = conn.execute(
                """
                SELECT id
                FROM alinhamentos
                WHERE id = %s
                """,
                (alinhamento_id,)
            ).fetchone()

            if not existe:
                raise HTTPException(
                    404,
                    "Alinhamento não encontrado"
                )

            return conn.execute(
                """
                SELECT
                    v.alinhamento_id,
                    v.versao,
                    v.titulo,
                    v.conteudo,
                    v.obrigatorio,
                    v.publico,
                    v.publicado_em,
                    v.publicado_por,
                    u.nome AS nome_publicador,
                    (
                        SELECT COUNT(*)
                        FROM alinhamento_destinatarios d
                        WHERE d.alinhamento_id =
                              v.alinhamento_id
                          AND d.versao = v.versao
                    ) AS destinatarios,
                    (
                        SELECT COUNT(*)
                        FROM alinhamento_leituras l
                        WHERE l.alinhamento_id =
                              v.alinhamento_id
                          AND l.versao = v.versao
                    ) AS confirmados
                FROM alinhamento_versoes v
                LEFT JOIN usuarios u
                  ON u.id = v.publicado_por
                WHERE v.alinhamento_id = %s
                ORDER BY v.versao DESC
                """,
                (alinhamento_id,)
            ).fetchall()

    return router
