import os, getpass
from pathlib import Path
import psycopg
from argon2 import PasswordHasher
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent/'.env')
nome=input('Nome do administrador: ').strip()
login=input('Login do administrador: ').strip().lower()
senha=getpass.getpass('Senha provisória (mínimo 12 caracteres): ')
if len(senha)<12: raise SystemExit('Senha curta')
with psycopg.connect(os.environ['DATABASE_URL']) as conn:
    existe=conn.execute("SELECT 1 FROM usuarios WHERE perfil='administrador' LIMIT 1").fetchone()
    if existe: raise SystemExit('Já existe administrador; utilize o painel de administração')
    conn.execute('INSERT INTO usuarios(nome,login,senha_hash,perfil) VALUES (%s,%s,%s,%s)',(nome,login,PasswordHasher().hash(senha),'administrador'))
print('Administrador criado. Troque a senha no primeiro acesso.')
