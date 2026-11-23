CREATE TABLE IF NOT EXISTS usuarios (id BIGSERIAL PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL, perfil TEXT NOT NULL CHECK (perfil IN ('administrador','supervisor','operador')), ativo BOOLEAN NOT NULL DEFAULT TRUE, troca_senha BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessoes (token_hash TEXT PRIMARY KEY, usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, expira_em TIMESTAMPTZ NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS alinhamentos (id BIGSERIAL PRIMARY KEY, titulo TEXT NOT NULL, versao INTEGER NOT NULL DEFAULT 1, conteudo TEXT NOT NULL, obrigatorio BOOLEAN NOT NULL DEFAULT TRUE, publicado_em TIMESTAMPTZ, criado_por BIGINT REFERENCES usuarios(id));
CREATE TABLE IF NOT EXISTS alinhamento_destinatarios (alinhamento_id BIGINT NOT NULL REFERENCES alinhamentos(id), versao INTEGER NOT NULL, usuario_id BIGINT NOT NULL REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(alinhamento_id,versao,usuario_id));
CREATE TABLE IF NOT EXISTS alinhamento_leituras (alinhamento_id BIGINT NOT NULL, versao INTEGER NOT NULL, usuario_id BIGINT NOT NULL, confirmado_em TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(alinhamento_id,versao,usuario_id), FOREIGN KEY(alinhamento_id,versao,usuario_id) REFERENCES alinhamento_destinatarios(alinhamento_id,versao,usuario_id));
CREATE TABLE IF NOT EXISTS auditoria (id BIGSERIAL PRIMARY KEY, ator_id BIGINT REFERENCES usuarios(id), acao TEXT NOT NULL, alvo_id BIGINT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now());

-- =====================================================
-- HISTÓRICO DE VERSÕES DOS ALINHAMENTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS alinhamento_versoes (
    alinhamento_id BIGINT NOT NULL
        REFERENCES alinhamentos(id),

    versao INTEGER NOT NULL
        CHECK (versao >= 1),

    titulo TEXT NOT NULL,

    conteudo TEXT NOT NULL,

    obrigatorio BOOLEAN NOT NULL DEFAULT TRUE,

    publico TEXT NOT NULL DEFAULT 'todos'
        CHECK (
            publico IN (
                'todos',
                'operador',
                'supervisor',
                'administrador'
            )
        ),

    publicado_em TIMESTAMPTZ NOT NULL,

    publicado_por BIGINT REFERENCES usuarios(id),

    PRIMARY KEY (alinhamento_id, versao)
);

-- =====================================================
-- MIGRAÇÃO DOS ALINHAMENTOS EXISTENTES
-- =====================================================

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
SELECT
    id,
    versao,
    titulo,
    conteudo,
    obrigatorio,
    'todos',
    publicado_em,
    criado_por
FROM alinhamentos
WHERE publicado_em IS NOT NULL
ON CONFLICT (alinhamento_id, versao)
DO NOTHING;

-- =====================================================
-- ÍNDICES PARA CONSULTAS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_alinhamento_versoes_data
ON alinhamento_versoes (publicado_em DESC);

CREATE INDEX IF NOT EXISTS idx_alinhamento_destinatarios_usuario
ON alinhamento_destinatarios (usuario_id);

CREATE INDEX IF NOT EXISTS idx_alinhamento_leituras_usuario
ON alinhamento_leituras (usuario_id);
