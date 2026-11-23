
"use strict";

// =============================================
// PORTAL IPASGO SAÚDE
// MÓDULO: GESTÃO DE ALINHAMENTOS
// =============================================

const $ = (id) => document.getElementById(id);

let usuarioAtual = null;
let meusAlinhamentos = [];
let relatorioAdmin = [];

// =============================================
// CONTROLE DE PERMISSÕES
// =============================================

function podeGerenciarAlinhamentos() {
  return ["administrador", "supervisor"].includes(
    usuarioAtual?.perfil
  );
}

// =============================================
// COMUNICAÇÃO COM A API
// =============================================

async function api(url, options = {}) {
  const resposta = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  if (resposta.status === 401) {
    window.location.href = "/";
    throw new Error("Sua sessão expirou.");
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(
      typeof dados.detail === "string"
        ? dados.detail
        : "Não foi possível concluir a operação."
    );
  }

  return dados;
}

function enviarJSON(dados) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dados)
  };
}

// =============================================
// ELEMENTOS AUXILIARES
// =============================================

function elemento(tag, texto, classe = "") {
  const el = document.createElement(tag);

  if (texto !== undefined && texto !== null) {
    el.textContent = String(texto);
  }

  if (classe) {
    el.className = classe;
  }

  return el;
}

function formatarData(valor) {
  if (!valor) {
    return "Não informado";
  }

  const data = new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return "Não informado";
  }

  return data.toLocaleString("pt-BR");
}

function mensagem(container, texto) {
  if (!container) return;

  container.replaceChildren(
    elemento("p", texto, "muted")
  );
}

function mostrarErro(erro) {
  console.error(erro);

  window.alert(
    erro.message || "Ocorreu um erro."
  );
}

// =============================================
// CARREGAR ALINHAMENTOS DO USUÁRIO
// =============================================

async function carregarAlinhamentos() {
  meusAlinhamentos = await api(
    "/api/alinhamentos"
  );

  const pendentes = meusAlinhamentos.filter(
    (item) => !item.lido
  ).length;

  const confirmados = meusAlinhamentos.filter(
    (item) => item.lido
  ).length;

  $("totalPendentes").textContent = pendentes;

  $("totalConfirmados").textContent = confirmados;

  $("totalAlinhamentos").textContent =
    meusAlinhamentos.length;

  renderizarAlinhamentos();
}

// =============================================
// RENDERIZAR COMUNICADOS
// =============================================

function renderizarAlinhamentos() {
  const container = $("listaAlinhamentos");

  container.replaceChildren();

  if (!meusAlinhamentos.length) {
    mensagem(
      container,
      "Nenhum alinhamento disponível para seu usuário."
    );
    return;
  }

  meusAlinhamentos.forEach((item) => {
    const card = elemento(
      "article",
      null,
      "alinhamento-item"
    );

    const titulo = elemento(
      "h3",
      item.titulo
    );

    const versao = elemento(
      "p",
      `Versão ${item.versao} · Publicado em ${formatarData(item.publicado_em)}`,
      "alinhamento-meta"
    );

    const conteudo = elemento(
      "div",
      item.conteudo,
      "alinhamento-conteudo"
    );

    const acoes = elemento(
      "div",
      null,
      "alinhamento-acoes"
    );

    const situacao = elemento(
      "span",
      item.lido
        ? `Leitura confirmada em ${formatarData(item.confirmado_em)}`
        : item.obrigatorio
          ? "Leitura obrigatória pendente"
          : "Leitura pendente",
      item.lido
        ? "status-confirmado"
        : "status-pendente"
    );

    acoes.appendChild(situacao);

    if (!item.lido) {
      const botao = elemento(
        "button",
        "Confirmar leitura"
      );

      botao.type = "button";

      botao.addEventListener(
        "click",
        async () => {
          const confirmado = window.confirm(
            `Você confirma que leu o alinhamento "${item.titulo}" (versão ${item.versao})?`
          );

          if (!confirmado) return;

          botao.disabled = true;
          botao.textContent = "Confirmando...";

          try {
            await api(
              `/api/alinhamentos/${item.id}/confirmar`,
              {
                method: "POST"
              }
            );

            await carregarAlinhamentos();

            // Atualizar relatório para gestores.
            if (podeGerenciarAlinhamentos()) {
              await carregarRelatorio();
            }

          } catch (erro) {
            mostrarErro(erro);

            botao.disabled = false;
            botao.textContent =
              "Confirmar leitura";
          }
        }
      );

      acoes.appendChild(botao);
    }

    card.append(
      titulo,
      versao,
      conteudo,
      acoes
    );

    container.appendChild(card);
  });
}

// =============================================
// PUBLICAR ALINHAMENTO
// =============================================

async function publicarAlinhamento(evento) {
  evento.preventDefault();

  if (!podeGerenciarAlinhamentos()) {
    window.alert(
      "Você não possui permissão para publicar alinhamentos."
    );
    return;
  }

  const formulario = $("formAlinhamento");

  const botao = formulario.querySelector(
    'button[type="submit"]'
  );

  const dados = {
    titulo: $("titulo").value.trim(),
    conteudo: $("conteudo").value.trim(),
    publico: $("publico").value,
    obrigatorio: $("obrigatorio").checked
  };

  if (
    dados.titulo.length < 3 ||
    dados.conteudo.length < 5
  ) {
    $("mensagemPublicacao").textContent =
      "Preencha o título e o conteúdo corretamente.";

    return;
  }

  botao.disabled = true;

  $("mensagemPublicacao").textContent =
    "Publicando...";

  try {
    const resultado = await api(
      "/api/alinhamentos",
      enviarJSON(dados)
    );

    $("mensagemPublicacao").textContent =
      `Alinhamento nº ${resultado.id} publicado com sucesso.`;

    formulario.reset();

    $("obrigatorio").checked = true;

    await carregarAlinhamentos();

    await carregarRelatorio();

  } catch (erro) {
    $("mensagemPublicacao").textContent =
      erro.message;

  } finally {
    botao.disabled = false;
  }
}

// =============================================
// RELATÓRIO ADMINISTRATIVO
// =============================================

async function carregarRelatorio() {
  if (!podeGerenciarAlinhamentos()) {
    return;
  }

  relatorioAdmin = await api(
    "/api/alinhamentos/administracao"
  );

  const tabela = $("tabelaRelatorio");

  tabela.replaceChildren();

  if (!relatorioAdmin.length) {
    const linha = document.createElement("tr");

    const celula = elemento(
      "td",
      "Nenhum alinhamento publicado."
    );

    celula.colSpan = 6;

    linha.appendChild(celula);

    tabela.appendChild(linha);

    return;
  }

  relatorioAdmin.forEach((item) => {
    const linha = document.createElement("tr");

    [
      item.titulo,
      item.versao,
      item.destinatarios,
      item.confirmados,
      item.pendentes
    ].forEach((valor) => {
      linha.appendChild(
        elemento("td", valor)
      );
    });

    const acoes = document.createElement("td");

    // =========================================
    // BOTÃO — VER LEITURAS
    // =========================================

    const botaoDetalhes = elemento(
      "button",
      "Ver leituras"
    );

    botaoDetalhes.type = "button";

    botaoDetalhes.addEventListener(
      "click",
      () => {
        carregarDestinatarios(item);
      }
    );

    // =========================================
    // BOTÃO — NOVA VERSÃO
    // =========================================

    const botaoVersao = elemento(
      "button",
      "Nova versão"
    );

    botaoVersao.type = "button";

    botaoVersao.style.marginLeft = "8px";

    botaoVersao.addEventListener(
      "click",
      () => {
        publicarNovaVersao(item);
      }
    );

    acoes.append(
      botaoDetalhes,
      botaoVersao
    );

    linha.appendChild(acoes);

    tabela.appendChild(linha);
  });
}

// =============================================
// DETALHAMENTO DE DESTINATÁRIOS
// =============================================

async function carregarDestinatarios(alinhamento) {
  if (!podeGerenciarAlinhamentos()) {
    window.alert(
      "Você não possui permissão para consultar destinatários."
    );
    return;
  }

  try {
    const lista = await api(
      `/api/alinhamentos/administracao/${alinhamento.id}/destinatarios`
    );

    $("detalhesDestinatarios").hidden = false;

    $("tituloDestinatarios").textContent =
      `Destinatários — ${alinhamento.titulo}`;

    const tabela = $("tabelaDestinatarios");

    tabela.replaceChildren();

    if (!lista.length) {
      const linha = document.createElement("tr");

      const celula = elemento(
        "td",
        "Nenhum destinatário encontrado."
      );

      celula.colSpan = 4;

      linha.appendChild(celula);

      tabela.appendChild(linha);

      return;
    }

    lista.forEach((usuario) => {
      const linha = document.createElement("tr");

      [
        usuario.nome,
        usuario.login,
        usuario.perfil,
        usuario.confirmado_em
          ? `Confirmado em ${formatarData(usuario.confirmado_em)}`
          : "Pendente"
      ].forEach((valor) => {
        linha.appendChild(
          elemento("td", valor)
        );
      });

      tabela.appendChild(linha);
    });

  } catch (erro) {
    mostrarErro(erro);
  }
}

// =============================================
// PUBLICAR NOVA VERSÃO
// =============================================

async function publicarNovaVersao(alinhamento) {
  if (!podeGerenciarAlinhamentos()) {
    window.alert(
      "Você não possui permissão para criar novas versões."
    );
    return;
  }

  const titulo = window.prompt(
    "Título da nova versão:",
    alinhamento.titulo
  );

  if (titulo === null) return;

  const conteudo = window.prompt(
    "Digite o conteúdo completo da nova versão:"
  );

  if (conteudo === null) return;

  if (
    titulo.trim().length < 3 ||
    conteudo.trim().length < 5
  ) {
    window.alert(
      "Título ou conteúdo inválido."
    );
    return;
  }

  const publico = window.prompt(
    "Público: todos, operador, supervisor ou administrador",
    "todos"
  );

  if (publico === null) return;

  const publicosValidos = [
    "todos",
    "operador",
    "supervisor",
    "administrador"
  ];

  const publicoNormalizado =
    publico.trim().toLowerCase();

  if (!publicosValidos.includes(
    publicoNormalizado
  )) {
    window.alert(
      "Público inválido."
    );
    return;
  }

  const obrigatorio = window.confirm(
    "A leitura da nova versão será obrigatória?"
  );

  const confirmar = window.confirm(
    `Publicar a versão ${Number(alinhamento.versao) + 1} deste alinhamento?`
  );

  if (!confirmar) return;

  try {
    await api(
      `/api/alinhamentos/${alinhamento.id}/nova-versao`,
      enviarJSON({
        titulo: titulo.trim(),
        conteudo: conteudo.trim(),
        publico: publicoNormalizado,
        obrigatorio
      })
    );

    window.alert(
      "Nova versão publicada com sucesso."
    );

    $("detalhesDestinatarios").hidden = true;

    await carregarAlinhamentos();

    await carregarRelatorio();

  } catch (erro) {
    mostrarErro(erro);
  }
}

// =============================================
// ENCERRAR SESSÃO
// =============================================

async function sair() {
  try {
    await api(
      "/api/logout",
      {
        method: "POST"
      }
    );

    window.location.href = "/";

  } catch (erro) {
    mostrarErro(erro);
  }
}

// =============================================
// INICIALIZAÇÃO
// =============================================

async function iniciarAlinhamentos() {
  try {
    // =========================================
    // 1. IDENTIFICAR USUÁRIO
    // =========================================

    usuarioAtual = await api("/api/me");

    $("welcome").textContent =
      `Olá, ${usuarioAtual.nome} — ${usuarioAtual.perfil}`;

    // =========================================
    // 2. TROCA OBRIGATÓRIA DE SENHA
    // =========================================

    if (usuarioAtual.troca_senha) {
      window.location.href = "/inicio";
      return;
    }

    // =========================================
    // 3. IDENTIFICAR PERMISSÕES
    // =========================================

    const podeGerenciar =
      podeGerenciarAlinhamentos();

    // =========================================
    // 4. CONTROLAR VISIBILIDADE
    // =========================================

    $("adminLink").hidden = !podeGerenciar;

    $("painelAdmin").hidden = !podeGerenciar;

    $("painelRelatorio").hidden = !podeGerenciar;

    // Ocultar detalhes ao iniciar.
    $("detalhesDestinatarios").hidden = true;

    // =========================================
    // 5. CARREGAR ALINHAMENTOS
    // =========================================

    await carregarAlinhamentos();

    // =========================================
    // 6. CARREGAR RELATÓRIO DOS GESTORES
    // =========================================

    if (podeGerenciar) {
      await carregarRelatorio();
    }

  } catch (erro) {
    console.error(
      "Erro ao iniciar Alinhamentos:",
      erro
    );

    mensagem(
      $("listaAlinhamentos"),
      `Erro ao carregar alinhamentos: ${erro.message}`
    );
  }
}

// =============================================
// EVENTOS
// =============================================

$("formAlinhamento").addEventListener(
  "submit",
  publicarAlinhamento
);

$("sair").addEventListener(
  "click",
  sair
);

// =============================================
// INICIAR MÓDULO
// =============================================

iniciarAlinhamentos();
