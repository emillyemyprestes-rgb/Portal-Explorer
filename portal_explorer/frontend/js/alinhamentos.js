
"use strict";

// =============================================
// EXPLORER HUB — GESTÃO DE ALINHAMENTOS
// =============================================

const $ = (id) => document.getElementById(id);

let usuarioAtual = null;
let meusAlinhamentos = [];
let relatorioAdmin = [];
let alinhamentoEmEdicao = null;

// =============================================
// API E PERMISSÕES
// =============================================

function podeGerenciarAlinhamentos() {
  return ["administrador", "supervisor"].includes(
    usuarioAtual?.perfil
  );
}

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
// FUNÇÕES AUXILIARES
// =============================================

function elemento(tag, texto, classe = "") {
  const el = document.createElement(tag);

  if (texto !== undefined && texto !== null) {
    el.textContent = String(texto);
  }

  if (classe) el.className = classe;

  return el;
}

function formatarData(valor) {
  if (!valor) return "Não informado";

  const data = new Date(valor);

  return Number.isNaN(data.getTime())
    ? "Não informado"
    : data.toLocaleString("pt-BR");
}

function mensagem(container, texto) {
  if (!container) return;

  container.replaceChildren(
    elemento("p", texto, "muted")
  );
}

function mostrarErro(erro) {
  console.error(erro);
  window.alert(erro.message || "Ocorreu um erro.");
}

function criarBotao(texto, acao, classe = "") {
  const botao = elemento("button", texto, classe);
  botao.type = "button";
  botao.addEventListener("click", acao);
  return botao;
}

function adicionarCampo(form, titulo, id, tipo = "text") {
  const label = elemento("label", titulo);
  label.htmlFor = id;

  const campo = document.createElement(
    tipo === "textarea" ? "textarea" : "input"
  );

  campo.id = id;

  if (tipo !== "textarea") campo.type = tipo;

  if (tipo === "textarea") campo.rows = 8;

  campo.required = true;

  form.append(label, campo);

  return campo;
}

function adicionarOpcao(select, valor, texto) {
  const option = document.createElement("option");
  option.value = valor;
  option.textContent = texto;
  select.appendChild(option);
}

// =============================================
// MEUS ALINHAMENTOS
// =============================================

async function carregarAlinhamentos() {
  meusAlinhamentos = await api("/api/alinhamentos");

  $("totalPendentes").textContent =
    meusAlinhamentos.filter(item => !item.lido).length;

  $("totalConfirmados").textContent =
    meusAlinhamentos.filter(item => item.lido).length;

  $("totalAlinhamentos").textContent =
    meusAlinhamentos.length;

  renderizarAlinhamentos();
}

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

  meusAlinhamentos.forEach(item => {
    const card = elemento(
      "article", null, "alinhamento-item"
    );

    const titulo = elemento("h3", item.titulo);

    const meta = elemento(
      "p",
      `Versão ${item.versao} · Publicado em ${formatarData(item.publicado_em)}`,
      "alinhamento-meta"
    );

    const conteudo = elemento(
      "div", item.conteudo, "alinhamento-conteudo"
    );

    const acoes = elemento(
      "div", null, "alinhamento-acoes"
    );

    const situacao = elemento(
      "span",
      item.lido
        ? `Leitura confirmada em ${formatarData(item.confirmado_em)}`
        : item.obrigatorio
          ? "Leitura obrigatória pendente"
          : "Leitura pendente",
      item.lido ? "status-confirmado" : "status-pendente"
    );

    acoes.appendChild(situacao);

    if (!item.lido) {
      const botao = criarBotao(
        "Confirmar leitura",
        async () => {
          const confirmou = window.confirm(
            `Você confirma que leu "${item.titulo}" (versão ${item.versao})?`
          );

          if (!confirmou) return;

          botao.disabled = true;
          botao.textContent = "Confirmando...";

          try {
            await api(
              `/api/alinhamentos/${item.id}/confirmar`,
              { method: "POST" }
            );

            await carregarAlinhamentos();

            if (podeGerenciarAlinhamentos()) {
              await carregarRelatorio();
            }
          } catch (erro) {
            mostrarErro(erro);
            botao.disabled = false;
            botao.textContent = "Confirmar leitura";
          }
        }
      );

      acoes.appendChild(botao);
    }

    card.append(titulo, meta, conteudo, acoes);
    container.appendChild(card);
  });
}

// =============================================
// PUBLICAR NOVO ALINHAMENTO
// =============================================

async function publicarAlinhamento(evento) {
  evento.preventDefault();

  if (!podeGerenciarAlinhamentos()) return;

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

  if (dados.titulo.length < 3 || dados.conteudo.length < 5) {
    $("mensagemPublicacao").textContent =
      "Preencha o título e o conteúdo corretamente.";
    return;
  }

  botao.disabled = true;
  $("mensagemPublicacao").textContent = "Publicando...";

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
    $("mensagemPublicacao").textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
}

// =============================================
// RELATÓRIO ADMINISTRATIVO
// =============================================

async function carregarRelatorio() {
  if (!podeGerenciarAlinhamentos()) return;

  relatorioAdmin = await api(
    "/api/alinhamentos/administracao"
  );

  const tabela = $("tabelaRelatorio");
  tabela.replaceChildren();

  if (!relatorioAdmin.length) {
    const linha = document.createElement("tr");
    const celula = elemento(
      "td", "Nenhum alinhamento publicado."
    );

    celula.colSpan = 6;
    linha.appendChild(celula);
    tabela.appendChild(linha);
    return;
  }

  relatorioAdmin.forEach(item => {
    const linha = document.createElement("tr");

    [
      item.titulo,
      item.versao,
      item.destinatarios,
      item.confirmados,
      item.pendentes
    ].forEach(valor => {
      linha.appendChild(elemento("td", valor));
    });

    const acoes = elemento(
      "td", null, "acoes-relatorio"
    );

    acoes.append(
      criarBotao(
        "Ver leituras",
        () => carregarDestinatarios(item)
      ),
      criarBotao(
        "Nova versão",
        () => abrirFormularioVersao(item)
      ),
      criarBotao(
        "Ver histórico",
        () => carregarHistorico(item),
        "botao-historico"
      )
    );

    linha.appendChild(acoes);
    tabela.appendChild(linha);
  });
}

// =============================================
// DESTINATÁRIOS E LEITURAS
// =============================================

async function carregarDestinatarios(alinhamento) {
  if (!podeGerenciarAlinhamentos()) return;

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
        "td", "Nenhum destinatário encontrado."
      );

      celula.colSpan = 4;
      linha.appendChild(celula);
      tabela.appendChild(linha);
      return;
    }

    lista.forEach(usuario => {
      const linha = document.createElement("tr");

      [
        usuario.nome,
        usuario.login,
        usuario.perfil,
        usuario.confirmado_em
          ? `Confirmado em ${formatarData(usuario.confirmado_em)}`
          : "Pendente"
      ].forEach(valor => {
        linha.appendChild(elemento("td", valor));
      });

      tabela.appendChild(linha);
    });

  } catch (erro) {
    mostrarErro(erro);
  }
}

// =============================================
// CONSULTAR HISTÓRICO DE VERSÕES
// =============================================

async function consultarHistorico(id) {
  return await api(
    `/api/alinhamentos/administracao/${id}/historico`
  );
}

async function carregarHistorico(alinhamento) {
  if (!podeGerenciarAlinhamentos()) return;

  let painel = $("painelHistorico");

  if (!painel) {
    painel = elemento(
      "section", null, "panel painel-historico"
    );

    painel.id = "painelHistorico";

    $("painelRelatorio").insertAdjacentElement(
      "afterend", painel
    );
  }

  painel.hidden = false;
  painel.replaceChildren();

  const cabecalho = elemento(
    "div", null, "historico-cabecalho"
  );

  const titulo = elemento(
    "h2",
    `Histórico de versões — ${alinhamento.titulo}`
  );

  const fechar = criarBotao(
    "Fechar histórico",
    () => { painel.hidden = true; }
  );

  cabecalho.append(titulo, fechar);
  painel.appendChild(cabecalho);

  const carregando = elemento(
    "p", "Carregando histórico...", "muted"
  );

  painel.appendChild(carregando);

  try {
    const versoes = await consultarHistorico(
      alinhamento.id
    );

    carregando.remove();

    if (!Array.isArray(versoes) || !versoes.length) {
      painel.appendChild(
        elemento("p", "Nenhuma versão encontrada.", "muted")
      );
      return;
    }

    versoes.forEach(versao => {
      const card = elemento(
        "article", null, "historico-item"
      );

      const destinatarios = Number(
        versao.destinatarios || 0
      );

      const confirmados = Number(
        versao.confirmados || 0
      );

      const pendentes = Math.max(
        0, destinatarios - confirmados
      );

      card.append(
        elemento(
          "h3",
          `Versão ${versao.versao} — ${versao.titulo}`
        ),
        elemento(
          "p",
          `Publicado em: ${formatarData(versao.publicado_em)}`,
          "alinhamento-meta"
        ),
        elemento(
          "p",
          `Responsável: ${versao.nome_publicador || "Não informado"}`,
          "alinhamento-meta"
        ),
        elemento(
          "p",
          `Público: ${versao.publico}`,
          "alinhamento-meta"
        ),
        elemento(
          "p",
          versao.obrigatorio
            ? "Leitura obrigatória"
            : "Leitura não obrigatória",
          "alinhamento-meta"
        ),
        elemento(
          "p",
          `Destinatários: ${destinatarios} | Confirmados: ${confirmados} | Pendentes: ${pendentes}`,
          "alinhamento-meta"
        ),
        elemento("h4", "Conteúdo publicado"),
        elemento(
          "div",
          versao.conteudo,
          "alinhamento-conteudo"
        )
      );

      painel.appendChild(card);
    });

    painel.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (erro) {
    carregando.remove();
    mostrarErro(erro);

    painel.appendChild(
      elemento(
        "p",
        `Erro ao consultar histórico: ${erro.message}`,
        "status-pendente"
      )
    );
  }
}

// =============================================
// FORMULÁRIO DE NOVA VERSÃO
// =============================================

function criarFormularioVersao() {
  let painel = $("painelNovaVersao");

  if (painel) return painel;

  painel = elemento(
    "section", null, "panel painel-nova-versao"
  );

  painel.id = "painelNovaVersao";
  painel.hidden = true;

  const cabecalho = elemento(
    "div", null, "historico-cabecalho"
  );

  const titulo = elemento(
    "h2", "Publicar nova versão"
  );

  const fechar = criarBotao(
    "Cancelar",
    fecharFormularioVersao,
    "botao-secundario"
  );

  cabecalho.append(titulo, fechar);

  const informacao = elemento(
    "p", "", "muted"
  );

  informacao.id = "informacaoVersao";

  const formulario = elemento("form");
  formulario.id = "formNovaVersao";

  const campoTitulo = adicionarCampo(
    formulario,
    "Título do alinhamento",
    "versaoTitulo"
  );

  campoTitulo.minLength = 3;
  campoTitulo.maxLength = 200;

  const campoConteudo = adicionarCampo(
    formulario,
    "Conteúdo da nova versão",
    "versaoConteudo",
    "textarea"
  );

  campoConteudo.minLength = 5;

  const labelPublico = elemento(
    "label", "Destinatários"
  );

  labelPublico.htmlFor = "versaoPublico";

  const selectPublico = document.createElement("select");
  selectPublico.id = "versaoPublico";

  adicionarOpcao(
    selectPublico, "todos", "Todos os colaboradores"
  );

  adicionarOpcao(
    selectPublico, "operador", "Operadores"
  );

  adicionarOpcao(
    selectPublico, "supervisor", "Supervisores"
  );

  adicionarOpcao(
    selectPublico, "administrador", "Administradores"
  );

  formulario.append(labelPublico, selectPublico);

  const labelObrigatorio = elemento(
    "label", null, "alinhamento-check"
  );

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "versaoObrigatorio";
  checkbox.checked = true;

  labelObrigatorio.append(
    checkbox,
    document.createTextNode("Leitura obrigatória")
  );

  formulario.appendChild(labelObrigatorio);

  const aviso = elemento(
    "p",
    "Ao publicar, será criada uma nova versão. As confirmações anteriores permanecerão no histórico, e os destinatários da nova versão precisarão confirmar a leitura novamente.",
    "muted"
  );

  formulario.appendChild(aviso);

  const acoes = elemento(
    "div", null, "formulario-versao-acoes"
  );

  const cancelar = criarBotao(
    "Cancelar",
    fecharFormularioVersao,
    "botao-secundario"
  );

  const publicar = elemento(
    "button", "Publicar nova versão"
  );

  publicar.type = "submit";
  publicar.id = "botaoPublicarVersao";

  acoes.append(cancelar, publicar);
  formulario.appendChild(acoes);

  const status = elemento("p", "");
  status.id = "mensagemNovaVersao";
  status.setAttribute("role", "status");

  formulario.addEventListener(
    "submit", publicarNovaVersao
  );

  painel.append(
    cabecalho,
    informacao,
    formulario,
    status
  );

  $("painelRelatorio").insertAdjacentElement(
    "afterend", painel
  );

  return painel;
}

async function abrirFormularioVersao(alinhamento) {
  if (!podeGerenciarAlinhamentos()) {
    window.alert(
      "Você não possui permissão para criar novas versões."
    );
    return;
  }

  const painel = criarFormularioVersao();

  alinhamentoEmEdicao = null;
  painel.hidden = false;

  $("informacaoVersao").textContent =
    `Carregando versão atual de "${alinhamento.titulo}"...`;

  $("formNovaVersao").hidden = true;
  $("mensagemNovaVersao").textContent = "";

  painel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  try {
    const historico = await consultarHistorico(
      alinhamento.id
    );

    // Busca a versão atual exata do alinhamento.
    const atual = historico.find(
      item => Number(item.versao) === Number(alinhamento.versao)
    );

    if (!atual) {
      throw new Error(
        "A versão atual não foi encontrada no histórico."
      );
    }

    alinhamentoEmEdicao = alinhamento;

    $("versaoTitulo").value = atual.titulo || "";
    $("versaoConteudo").value = atual.conteudo || "";
    $("versaoPublico").value = atual.publico || "todos";
    $("versaoObrigatorio").checked =
      Boolean(atual.obrigatorio);

    $("informacaoVersao").textContent =
      `Alinhamento nº ${alinhamento.id} · Versão atual: ${alinhamento.versao} · Próxima versão: ${Number(alinhamento.versao) + 1}`;

    $("formNovaVersao").hidden = false;

  } catch (erro) {
    $("informacaoVersao").textContent =
      `Não foi possível carregar a versão: ${erro.message}`;

    mostrarErro(erro);
  }
}

function fecharFormularioVersao() {
  const painel = $("painelNovaVersao");

  if (painel) painel.hidden = true;

  alinhamentoEmEdicao = null;
}

async function publicarNovaVersao(evento) {
  evento.preventDefault();

  if (!podeGerenciarAlinhamentos()) return;
  if (!alinhamentoEmEdicao) return;

  const dados = {
    titulo: $("versaoTitulo").value.trim(),
    conteudo: $("versaoConteudo").value.trim(),
    publico: $("versaoPublico").value,
    obrigatorio: $("versaoObrigatorio").checked
  };

  if (dados.titulo.length < 3) {
    $("mensagemNovaVersao").textContent =
      "O título deve ter pelo menos 3 caracteres.";
    return;
  }

  if (dados.conteudo.length < 5) {
    $("mensagemNovaVersao").textContent =
      "O conteúdo deve ter pelo menos 5 caracteres.";
    return;
  }

  const proximaVersao =
    Number(alinhamentoEmEdicao.versao) + 1;

  const confirmou = window.confirm(
    `Deseja publicar a versão ${proximaVersao} do alinhamento "${alinhamentoEmEdicao.titulo}"?\n\nOs destinatários receberão a nova versão e precisarão confirmar a leitura novamente.`
  );

  if (!confirmou) return;

  const id = alinhamentoEmEdicao.id;
  const botao = $("botaoPublicarVersao");

  botao.disabled = true;
  botao.textContent = "Publicando...";

  $("mensagemNovaVersao").textContent =
    "Publicando nova versão...";

  try {
    const resultado = await api(
      `/api/alinhamentos/${id}/nova-versao`,
      enviarJSON(dados)
    );

    fecharFormularioVersao();

    const historico = $("painelHistorico");

    if (historico) historico.hidden = true;

    $("detalhesDestinatarios").hidden = true;

    await carregarAlinhamentos();
    await carregarRelatorio();

    window.alert(
      `Versão ${resultado.versao} publicada com sucesso!`
    );

  } catch (erro) {
    $("mensagemNovaVersao").textContent =
      erro.message;

    mostrarErro(erro);

  } finally {
    botao.disabled = false;
    botao.textContent = "Publicar nova versão";
  }
}

// =============================================
// ENCERRAR SESSÃO
// =============================================

async function sair() {
  try {
    await api(
      "/api/logout",
      { method: "POST" }
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
    usuarioAtual = await api("/api/me");

    $("welcome").textContent =
      `Olá, ${usuarioAtual.nome} — ${usuarioAtual.perfil}`;

    if (usuarioAtual.troca_senha) {
      window.location.href = "/inicio";
      return;
    }

    const podeGerenciar =
      podeGerenciarAlinhamentos();

    $("adminLink").hidden = !podeGerenciar;
    $("painelAdmin").hidden = !podeGerenciar;
    $("painelRelatorio").hidden = !podeGerenciar;
    $("detalhesDestinatarios").hidden = true;

    await carregarAlinhamentos();

    if (podeGerenciar) {
      await carregarRelatorio();
    }

  } catch (erro) {
    console.error(
      "Erro ao iniciar Alinhamentos:", erro
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
  "submit", publicarAlinhamento
);

$("sair").addEventListener(
  "click", sair
);

iniciarAlinhamentos();
