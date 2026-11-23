# Portal Interno Explorer — Fase 1

## Pré-requisitos
Python 3.11+, PostgreSQL 14+ e um banco de dados vazio chamado `portal_explorer`.

## Windows / PowerShell
```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```
Edite `.env` com sua conexão PostgreSQL. Em ambiente local mantenha `SESSION_SECURE=false`; em produção, HTTPS e `SESSION_SECURE=true` são obrigatórios.

Inicialize a API (ela cria as tabelas) e, em outro terminal, crie o primeiro administrador:
```powershell
uvicorn app.main:app --reload
# Em outro terminal, com o ambiente virtual ativado e dentro de backend:
python bootstrap_admin.py
```
Abra http://localhost:8000.

## Fase 1 entregue
Login, sessão HttpOnly, troca obrigatória de senha inicial, cadastro de usuários pelo administrador, perfis, dashboard e esquema das leituras de alinhamentos.

## Antes de colocar em produção
Implementar proteção CSRF para requisições com cookie, limitação de tentativas de login, recuperação segura de senha, trilha de auditoria de autenticação, rotinas de backup, monitoramento, políticas de senha, configuração de CORS/origem e testes automatizados. Não exponha esta versão de desenvolvimento diretamente na internet. Os módulos de notícias/scripts e publicação/notificação de alinhamentos ainda não estão ativos.
