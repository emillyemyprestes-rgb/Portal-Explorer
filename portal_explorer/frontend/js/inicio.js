"use strict";

// =============================================
// EXPLORER HUB — PÁGINA INICIAL
// LEITURA OBRIGATÓRIA
// =============================================

const $ = id => document.getElementById(id);

let me = null;
let pendenciasObrigatorias = [];
let alinhamentoAtual = null;
let confirmandoLeitura = false;
let verificacaoConcluida = false;
let administracaoCarregada = false;

// =============================================
// API
// =============================================

async function api(url, options = {}) {
  const resposta = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  if (resposta.status === 401) {
    location.href = "/";
    throw new Error("Sessão expirada");
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(
      typeof dados.detail === "string"
        ? dados.detail
        : "Erro ao realizar operação"
    );
  }

  return dados;
}

const json = (method, obj) => ({
  method,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(obj)
});

// =============================================
// INDICADORES
// =============================================

async function atualizarResumo() {
  const resumo = await api("/api/resumo");

  $("pendentes").textContent =
    resumo.alinhamentos_pendentes ?? 0;
}

// =============================================
// MODAL DE LEITURA
// =============================================

function abrirModalLeitura() {
  $("modalLeitura").hidden = false;
  document.body.classList.add("leitura-bloqueada");

  $("aceiteLeitura").focus();
}

function fecharModalLeitura() {
  $("modalLeitura").hidden = true;
  document.body.classList.remove("leitura-bloqueada");

  alinhamentoAtual = null;
}

function mostrarErroLeitura(mensagem) {
  $("erroModalLeitura").textContent = mensagem;
}

function bloquearNavegacao(evento) {
  if ($("modalLeitura").hidden) return;

  const link = evento.target.closest("a[href]");

  if (!link) return;

  if (link.closest(".sidebar") || link.closest("main")) {
    evento.preventDefault();
    evento.stopPropagation();

    mostrarErroLeitura(
      "Confirme os alinhamentos obrigatórios antes de navegar."
    );
  }
}

function protegerTeclado(evento) {
  if ($("modalLeitura").hidden) return;

  if (evento.key === "Escape") {
    evento.preventDefault();
  }

  if (evento.key !== "Tab") return;

  const modal = $("modalLeitura");

  const controles = Array.from(
    modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled])'
    )
  );

  if (!controles.length) return;

  const primeiro = controles[0];
  const ultimo = controles[controles.length - 1];

  if (evento.shiftKey && document.activeElement === primeiro) {
    evento.preventDefault();
    ultimo.focus();
  } else if (
    !evento.shiftKey &&
    document.activeElement === ultimo
  ) {
    evento.preventDefault();
    primeiro.focus();
  }
}

// =============================================
// CONSULTAR PENDÊNCIAS
// =============================================

async function consultarPendenciasObrigatorias() {
  const alinhamentos = await api("/api/alinhamentos");

  if (!Array.isArray(alinhamentos)) {
    throw new Error(
      "A consulta de alinhamentos retornou um formato inesperado."
    );
  }

  pendenciasObrigatorias = alinhamentos.filter(
    item => item.obrigatorio === true && !item.lido
  );

  return pendenciasObrigatorias;
}

// =============================================
// APRESENTAR PRÓXIMO ALINHAMENTO
// =============================================

function apresentarProximoAlinhamento() {
  if (!pendenciasObrigatorias.length) {
    fecharModalLeitura();
    return;
  }

  alinhamentoAtual = pendenciasObrigatorias[0];

  $("modalAlinhamentoTitulo").textContent =
    alinhamentoAtual.titulo || "Alinhamento";

  $("modalAlinhamentoVersao").textContent =
    `Versão ${alinhamentoAtual.versao}`;

  $("modalAlinhamentoConteudo").textContent =
    alinhamentoAtual.conteudo || "";

  $("modalLeituraProgresso").textContent =
    `${pendenciasObrigatorias.length} alinhamento(s) obrigatório(s) pendente(s)`;

  $("aceiteLeitura").checked = false;
  $("confirmarModalLeitura").disabled = true;

  mostrarErroLeitura("");

  $("modalLeituraCorpo").scrollTop = 0;

  abrirModalLeitura();
}

// =============================================
// VERIFICAR LEITURA OBRIGATÓRIA
// =============================================

async function verificarLeiturasObrigatorias() {
  verificacaoConcluida = false;

  // Enquanto a consulta estiver em andamento,
  // mantém a navegação da página inicial bloqueada.
  abrirModalLeitura();

  $("modalLeituraTitulo").textContent =
    "Verificando comunicados";

  $("modalLeituraProgresso").textContent =
    "Consultando alinhamentos obrigatórios...";

  $("modalAlinhamentoTitulo").textContent = "";
  $("modalAlinhamentoVersao").textContent = "";
  $("modalAlinhamentoConteudo").textContent = "";

  $("aceiteLeitura").checked = false;
  $("aceiteLeitura").disabled = true;

  $("confirmarModalLeitura").disabled = true;

  try {
    await consultarPendenciasObrigatorias();

    verificacaoConcluida = true;
    $("aceiteLeitura").disabled = false;

    $("modalLeituraTitulo").textContent =
      "Leitura obrigatória";

    if (pendenciasObrigatorias.length) {
      apresentarProximoAlinhamento();
    } else {
      fecharModalLeitura();
    }

  } catch (erro) {
    console.error(erro);

    $("modalLeituraTitulo").textContent =
      "Não foi possível verificar as leituras";

    $("modalLeituraProgresso").textContent =
      "A verificação precisa ser concluída para liberar a navegação.";

    mostrarErroLeitura(
      "Falha na consulta. Atualize a página para tentar novamente."
    );
  }
}

// =============================================
// CONFIRMAR CIÊNCIA
// =============================================

async function confirmarLeituraObrigatoria() {
  if (!verificacaoConcluida) return;
  if (!alinhamentoAtual) return;
  if (!($("aceiteLeitura").checked)) return;
  if (confirmandoLeitura) return;

  confirmandoLeitura = true;

  const botao = $("confirmarModalLeitura");
  const id = alinhamentoAtual.id;

  botao.disabled = true;
  botao.textContent = "Confirmando...";

  mostrarErroLeitura("");

  try {
    await api(
      `/api/alinhamentos/${id}/confirmar`,
      { method: "POST" }
    );

    // Reconsulta o servidor para evitar reaproveitar
    // uma lista desatualizada de versões ou leituras.
    await consultarPendenciasObrigatorias();

    await atualizarResumo();

    if (pendenciasObrigatorias.length) {
      apresentarProximoAlinhamento();
    } else {
      fecharModalLeitura();
      try {
        await liberarAdministracao();
      } catch (erroAdmin) {
        console.error("Falha ao carregar administração:", erroAdmin);
        // A leitura já foi confirmada. Uma atualização da página
        // permitirá tentar carregar o painel novamente.
        $("welcome").textContent =
          `Olá, ${me.nome} — ${me.perfil} (atualize a página se a administração não aparecer)`;
      }
    }

  } catch (erro) {
    console.error(erro);

    mostrarErroLeitura(
      `Não foi possível confirmar a leitura: ${erro.message}`
    );

    // O estado real será conferido novamente
    // ao recarregar a página.
    botao.disabled = !$("aceiteLeitura").checked;

  } finally {
    confirmandoLeitura = false;
    botao.textContent = "Confirmar ciência";
  }
}

// =============================================
// ADMINISTRAÇÃO DE USUÁRIOS
// =============================================

async function users() {
  const lista = await api("/api/usuarios");

  const linhas = lista.map(usuario => {
    const tr = document.createElement("tr");

    [
      usuario.nome,
      usuario.login,
      usuario.perfil,
      usuario.ativo ? "Ativo" : "Inativo"
    ].forEach(valor => {
      const td = document.createElement("td");
      td.textContent = valor ?? "";
      tr.appendChild(td);
    });

    return tr;
  });

  $("users").replaceChildren(...linhas);
}

// =============================================
// LIBERAR ADMINISTRAÇÃO APÓS LEITURAS
// =============================================

async function liberarAdministracao() {
  if (!me || me.perfil !== "administrador") return;
  if (!verificacaoConcluida || pendenciasObrigatorias.length) return;
  if (administracaoCarregada) return;

  // Só apresenta o painel depois de receber autorização da API.
  await users();
  $("adminLink").hidden = false;
  $("admin").hidden = false;
  administracaoCarregada = true;
}

// =============================================
// SAIR
// =============================================

async function sair() {
  try {
    await api(
      "/api/logout",
      { method: "POST" }
    );

    location.href = "/";

  } catch (erro) {
    console.error(erro);
    alert("Não foi possível encerrar a sessão.");
  }
}

// =============================================
// TROCAR SENHA
// =============================================

async function trocarSenha(evento) {
  evento.preventDefault();

  try {
    await api(
      "/api/trocar-senha",
      json("POST", {
        atual: $("atual").value,
        nova: $("nova").value
      })
    );

    $("senhaMsg").textContent =
      "Senha alterada com sucesso.";

    location.reload();

  } catch (erro) {
    $("senhaMsg").textContent = erro.message;
  }
}

// =============================================
// CADASTRAR USUÁRIO
// =============================================

async function cadastrarUsuario(evento) {
  evento.preventDefault();

  try {
    await api(
      "/api/usuarios",
      json("POST", {
        nome: $("nome").value,
        login: $("userLogin").value,
        senha: $("userSenha").value,
        perfil: $("perfil").value
      })
    );

    $("userMsg").textContent =
      "Usuário cadastrado.";

    $("userForm").reset();

    await users();

  } catch (erro) {
    $("userMsg").textContent = erro.message;
  }
}

// =============================================
// INICIALIZAR PORTAL
// =============================================

async function init() {
  try {
    me = await api("/api/me");

    $("welcome").textContent =
      `Olá, ${me.nome} — ${me.perfil}`;

    await atualizarResumo();

    // Troca obrigatória de senha tem prioridade.
    if (me.troca_senha) {
      $("senhaPanel").hidden = false;
      $("intro").hidden = true;
      return;
    }

    // Primeiro verifica comunicados obrigatórios.
    await verificarLeiturasObrigatorias();

    // Somente carrega administração se não houver leituras pendentes.
    // Caso haja pendências, a última confirmação chamará esta função.
    await liberarAdministracao();

  } catch (erro) {
    console.error("Erro ao iniciar portal:", erro);

    $("welcome").textContent =
      "Não foi possível carregar o portal.";
  }
}

// =============================================
// EVENTOS
// =============================================

$("sair").addEventListener("click", sair);

$("sairModalLeitura").addEventListener(
  "click", sair
);

$("senhaForm").addEventListener(
  "submit", trocarSenha
);

$("userForm").addEventListener(
  "submit", cadastrarUsuario
);

$("aceiteLeitura").addEventListener(
  "change", () => {
    $("confirmarModalLeitura").disabled =
      !$("aceiteLeitura").checked ||
      confirmandoLeitura ||
      !verificacaoConcluida;
  }
);

$("confirmarModalLeitura").addEventListener(
  "click", confirmarLeituraObrigatoria
);

document.addEventListener(
  "click", bloquearNavegacao, true
);

document.addEventListener(
  "keydown", protegerTeclado
);

// =============================================
// INICIAR
// =============================================

init();
