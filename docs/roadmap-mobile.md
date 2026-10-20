# Roadmap — app móvel offline

## Fase 0 — fundação local

**Em curso:** app Expo Android/iOS; agenda de 7 dias; várias aulas por dia; aula avulsa local; professor opcional; registo simples de presença pelo estudante; SQLite, migração versionada e primeira regra de consulta paginada.

**Aceite:** criar duas ou mais aulas com horários diferentes no mesmo dia, fechar/reabrir e ver os dados; registar presença sem rede; build JS para as duas plataformas; migração nunca apaga histórico.

## Fase 1 — rotina e histórico do aluno

**Em curso (código implementado, sem ensaio em aparelho).** Legenda: ✅ implementado · ◐ parcial · ○ por fazer.

- ◐ Cadastro/edição/arquivo de matérias com cor e ordem escolhidas — renomear e arquivar feitos; cor e ordem por fazer.
- ◐ Semana navegável, lista diária, calendário mensal e avisos de sobreposição que deixam a decisão explícita — semana navegável agrupada por dia e aviso de sobreposição feitos; calendário mensal por fazer.
- ◐ Recorrências semanais/quinzenais, exceções por feriado, e edição de uma/esta e próximas/todas — criação semanal/quinzenal, edição “só esta”, cancelar/excluir “esta e as seguintes” feitos; editar todas/seguintes, mudar a regra e feriados por fazer.
- ◐ Registo posterior de conteúdo realmente estudado, apontamentos privados, tarefa/revisão e estado da aula, separados do plano — conteúdo estudado e estado (planeada/cancelada) feitos; apontamentos e tarefas por fazer.
- ◐ Histórico com filtro por matéria/período, busca local e paginação por cursor composto — matéria, busca e cursor feitos; período por fazer.
- ○ Exportar/restaurar cópia local e eliminar os dados por iniciativa do aluno.

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

Vídeo, chat, pagamento, feeds, pontuação escolar automática, telemetria com conteúdo de aula, backup implícito de terceiros ou sync bidirecional sem consentimento. Evitar bibliotecas pesadas até haver um requisito concreto e medição que justifique o custo.
