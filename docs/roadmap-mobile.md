# Roadmap — app móvel offline

## Fase 0 — fundação local

**Em curso:** app Expo Android/iOS; agenda de 7 dias; várias aulas por dia; aula avulsa local; professor opcional; registo simples de presença pelo estudante; SQLite, migração versionada e primeira regra de consulta paginada.

**Aceite:** criar duas ou mais aulas com horários diferentes no mesmo dia, fechar/reabrir e ver os dados; registar presença sem rede; build JS para as duas plataformas; migração nunca apaga histórico.

## Fase 1 — rotina e histórico do aluno

**Código completo, sem ensaio em aparelho.** Todos os itens abaixo estão implementados e cobertos por testes de domínio/repositório em `node:sqlite`; nenhum foi ensaiado em Android ou iPhone, por isso a fase não está “aceite”. Legenda: ✅ implementado (código) · ◐ parcial · ○ por fazer.

- ✅ Cadastro/edição/arquivo de matérias com cor e ordem escolhidas — renomear, arquivar, cor de paleta fixa acessível (sempre com nome) e ordem manual (subir/descer).
- ✅ Semana navegável, lista diária, calendário mensal e avisos de sobreposição que deixam a decisão explícita — calendário mensal com contagem por dia que abre a semana. Falta aviso de sobreposição ao estender uma série.
- ✅ Recorrências semanais/quinzenais, exceções por feriado, e edição de uma/todas — editar “só esta” ou “todas as futuras” (só ocorrências futuras, planeadas, sem registos e não editadas à parte), mudar a data final (estender idempotente / encurtar só futuras intactas), feriado/pausa por período, cancelar/excluir “esta e as seguintes”. Mudar dias da semana ou frequência de uma série existente continua fora do escopo (criar nova repetição).
- ✅ Registo posterior de conteúdo realmente estudado, apontamentos privados, tarefa/revisão (“próximo passo”) e estado da aula, separados do plano.
- ✅ Histórico com filtro por matéria/período, busca local (inclui apontamentos e próximo passo) e paginação por cursor composto.
- ✅ Exportar/restaurar cópia local (JSON versionado, hoje v5, aceita v3 e v4, validação estrita, substituição total numa transação) e eliminar todos os dados por iniciativa do aluno (confirmação em dois passos).
- ○ Seletores nativos de data/hora (hoje: texto validado `AAAA-MM-DD`/`HH:MM`).

**Aceite pendente:** executar o checklist “Testes manuais da Fase 1” de `docs/qa-mobile.md` em Android e iPhone (ou emuladores), incluindo atualização a partir de bases v1/v2/v3/v4.

## Fase 1b — apoio à aprendizagem (offline)

**Código completo, sem ensaio em aparelho.** Tudo local, coberto por testes em `node:sqlite`; nada ensaiado em Android ou iPhone.

- ✅ Objetivos de aprendizagem por matéria (título até 200 caracteres, estado aberto/praticando/concluído escolhido pelo aluno, datas de criação/atualização), esquema v5 aditivo.
- ✅ Marcar no editor da aula quais objetivos foram trabalhados (só objetivos da matéria da aula).
- ✅ Sugestões de revisão explicáveis calculadas por uma função pura testada (≥ 21 dias sem trabalhar um objetivo não concluído, com a data de origem), dispensáveis e persistentes; nunca inferem notas ou desempenho.
- ✅ Exportar o histórico em CSV pela folha de partilha (apontamentos privados só por opção), com escape RFC 4180 e proteção contra injeção de fórmulas.
- ✅ Cópia de segurança v5 com objetivos, marcas e dispensas (aceita v3 e v4).
- ○ Apagar/reordenar objetivos; separador “;” opcional no CSV.

**Aceite pendente:** checklist “Testes manuais do apoio à aprendizagem” (itens 26–31) de `docs/qa-mobile.md` em Android e iPhone.

## Fase 2 — confiabilidade e acessibilidade

- Testes de repositório em SQLite temporário e migração de versões anteriores — ◐ feitos em `node:sqlite` (`npm test`); falta repetir com o SQLite do expo-sqlite em aparelho.
- Android e iPhone: modo avião, persistência após reinício, datas locais, teclado, leitor de ecrã, tamanhos de texto e orientação.
- Conjunto de stress de anos de aulas; medir memória, tamanho do banco e tempo de consulta em aparelhos de entrada.
- Revisão de proteção de ficheiros e de backup do sistema operativo; documentar recuperação e exportação.

## Fase 3 — cloud opcional (só após decisão do utilizador)

- Criar identidade/conta opcional e consentimento antes de enviar conteúdo escolar.
- Outbox local idempotente, IDs globais, sincronização incremental e conflitos visíveis; nunca bloquear consulta local por falha de rede.
- Ações de pausar/desligar sync, exportar, apagar conta e apagar cópia remota.
- Professor e aluno só partilham matéria/aula por convite aceite; presença tem autoria e confirmação independente.

## Não fazer na fundação

Vídeo, chat, pagamento, feeds, pontuação escolar automática (as sugestões de revisão só usam datas, nunca notas ou desempenho), telemetria com conteúdo de aula, backup implícito de terceiros ou sync bidirecional sem consentimento. Evitar bibliotecas pesadas até haver um requisito concreto e medição que justifique o custo.
