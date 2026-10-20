# Progresso de entrega — Aula em Dia Mobile

Atualizado em 20/10/2026. O percentual mede o avanço dos marcos planeados, com pesos de escopo. Não significa que exista uma aplicação instalada ou pronta para distribuição.

**Progresso ponderado: 59%** (valor calculado 58,7%; era 53% no início do dia 20/10/2026 e 36% em 18/10/2026).

[██████████](#product-and-offline-architecture-10) [███████████████████████░░](#local-storage-and-repositories-25) [████████████████████████░░░░░░░░░░░](#student-app-35) [██░░░░░░░░░░░░░░░░░░](#on-device-quality-20) [░░░░░░░░░░](#installation-and-cloud-10)

| Etapa | Peso | Conclusão | Contribuição |
|---|---:|---:|---:|
| Product and offline architecture | 10% | 100% | 10 p.p. |
| Local storage and repositories | 25% | 90% | 22,5 p.p. |
| Student app | 35% | 68% | 23,8 p.p. |
| On-device quality | 20% | 12% | 2,4 p.p. |
| Installation and cloud | 10% | 0% | 0 p.p. |
| **Total** | **100%** |  | **58,7% ≈ 59%** |

Justificação da mudança: exportação/restauro, eliminação total e pesquisa sem acentos eram itens listados como “Falta” nas duas etapas de código e foram implementados com testes. Nada foi ensaiado em aparelho, por isso a etapa de qualidade em dispositivo só sobe pela cobertura automática (33 → 47 casos), e instalação continua a 0%.

## Product and offline architecture (10%)

**Concluído.** A estratégia offline-first, limites de memória e retenção, privacidade e fases de roadmap estão em docs/offline-first.md e docs/roadmap-mobile.md.

## Local storage and repositories (25%)

**Parcial (90%).** SQLite é a fonte local, com esquema v3 por `PRAGMA user_version`: migrações aditivas numa transação (v2: estado/cancelamento da aula, `lesson_series`, data original, `updated_at`, arquivo de matérias; v3: colunas de pesquisa `subjects.search_name` e `lessons.search_text` preenchidas pela app, com backfill paginado). Repositórios com SQL estático e parâmetros ligados para agenda semanal, edição, cancelamento, exclusão com alcance, criação de séries numa transação, histórico por cursor com filtro e pesquisa `LIKE` escapada sem acentos/maiúsculas, matérias, exportação paginada de uma cópia JSON versionada, restauro “substituir tudo” numa transação e eliminação de todos os dados numa transação. `npm test` executa as migrações (base nova, v1→v2 e v2→v3 com dados, rollbacks com falha injetada, versão futura recusada) e os repositórios contra `node:sqlite`.

**Falta:** validar as migrações (em especial o backfill v3 e `String.prototype.normalize` do Hermes) no SQLite do expo-sqlite em Android/iOS reais; proteção de dados local (cifra/proteção de ficheiros) e cópia de segurança automática.

## Student app (35%)

**Parcial (68%).** Implementado no código (sem ensaio em aparelho): agenda semanal navegável com “Hoje”; criar/editar aula; conteúdo estudado separado do planeado; presença do próprio aluno; cancelar/reativar (cancelada não é falta); excluir com confirmação e alcance “só esta”/“esta e as seguintes”; repetição semanal/quinzenal com dias e data final (máx. 300 aulas, 1 ano); aviso de sobreposição que deixa guardar; histórico paginado com filtro por matéria e pesquisa sem distinção de acentos e maiúsculas; matérias com renomear/arquivar; quatro idiomas e três temas. Nas definições: exportar cópia de segurança (folha de partilha do sistema), restaurar a partir de JSON colado ou ficheiro escolhido (validação, pré-visualização de contagens e confirmação) e “Apagar todos os meus dados” com confirmação em dois passos.

**Falta (Fase 1):** editar todas as ocorrências/alterar a regra da série, exceções por feriado, calendário mensal, cor e ordem das matérias, apontamentos privados e tarefas/revisões, filtro por período no histórico. Seletores nativos de data/hora ficaram de fora para evitar dependências; as datas usam texto validado.

## On-device quality (20%)

**Inicial (12%).** Existem testes automáticos (47 casos em `npm test`) para regras de data/hora, recorrência, sobreposição, normalização de pesquisa, migrações, repositórios, cópia de segurança (ida e volta, 33 variantes de cópia inválida sem alterar dados, falha injetada a meio do restauro) e eliminação total, mais TypeScript, `expo-doctor` e bundle JS Android/iOS. Isso não substitui ensaios funcionais em Android e iPhone.

**Falta:** testar em dispositivos reais/emuladores (nenhum ensaio feito nesta máquina), incluindo partilha/escolha de ficheiro e colar cópias grandes; acessibilidade com leitor de ecrã e escala de texto; desempenho e memória com anos de histórico (exportação até 30 000 aulas não medida); recuperação de falhas e migração v1/v2→v3 no SQLite do aparelho; testes de componentes React Native.

## Installation and cloud (10%)

**Por iniciar.** Há configuração de EAS para builds de pré-visualização, mas nenhum APK/IPA de distribuição verificado. A sincronização cloud é opcional e fica para uma fase futura.

**Falta:** gerar e validar instalações Android/iOS e definir assinatura/distribuição; avaliar sincronização só depois de consolidar o modo offline.

## Como atualizar

Recalcular a soma ponderada ao fechar critérios observáveis. Distinguir sempre bundle de desenvolvimento, binário instalável, ensaio em dispositivo e publicação.
