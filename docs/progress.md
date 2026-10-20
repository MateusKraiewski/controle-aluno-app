# Progresso de entrega — Aula em Dia Mobile

Atualizado em 20/10/2026. O percentual mede o avanço dos marcos planeados, com pesos de escopo. Não significa que exista uma aplicação instalada ou pronta para distribuição.

**Progresso ponderado: 53%** (valor calculado 53,0%; era 36% em 18/10/2026).

[██████████](#product-and-offline-architecture-10) [████████████████████░░░░░](#local-storage-and-repositories-25) [█████████████████████░░░░░░░░░░░░░░](#student-app-35) [██░░░░░░░░░░░░░░░░░░](#on-device-quality-20) [░░░░░░░░░░](#installation-and-cloud-10)

| Etapa | Peso | Conclusão | Contribuição |
|---|---:|---:|---:|
| Product and offline architecture | 10% | 100% | 10 p.p. |
| Local storage and repositories | 25% | 80% | 20 p.p. |
| Student app | 35% | 60% | 21 p.p. |
| On-device quality | 20% | 10% | 2 p.p. |
| Installation and cloud | 10% | 0% | 0 p.p. |
| **Total** | **100%** |  | **53%** |

## Product and offline architecture (10%)

**Concluído.** A estratégia offline-first, limites de memória e retenção, privacidade e fases de roadmap estão em docs/offline-first.md e docs/roadmap-mobile.md.

## Local storage and repositories (25%)

**Parcial (80%).** SQLite é a fonte local, com esquema v2 por `PRAGMA user_version`: migração aditiva numa transação (estado/cancelamento da aula, `lesson_series`, data original, `updated_at`, arquivo de matérias). Repositórios com SQL estático e parâmetros ligados para agenda semanal, edição, cancelamento, exclusão com alcance, criação de séries numa transação, histórico por cursor com filtro e pesquisa `LIKE` escapada, e matérias. `npm test` executa as migrações (base nova, upgrade v1→v2 com dados, rollback com falha injetada) e os repositórios contra `node:sqlite`.

**Falta:** validar as migrações no SQLite do expo-sqlite em Android/iOS reais, cópia de segurança/exportação/restauro, eliminação de todos os dados por iniciativa do aluno e proteção de dados local.

## Student app (35%)

**Parcial (60%).** Implementado no código (sem ensaio em aparelho): agenda semanal navegável com “Hoje”; criar/editar aula; conteúdo estudado separado do planeado; presença do próprio aluno; cancelar/reativar (cancelada não é falta); excluir com confirmação e alcance “só esta”/“esta e as seguintes”; repetição semanal/quinzenal com dias e data final (máx. 300 aulas, 1 ano); aviso de sobreposição que deixa guardar; histórico paginado com filtro por matéria e pesquisa; matérias com renomear/arquivar; quatro idiomas e três temas. App.tsx foi dividido em `src/screens`, `src/components` e `src/theme`.

**Falta (Fase 1):** editar todas as ocorrências/alterar a regra da série, exceções por feriado, calendário mensal, cor e ordem das matérias, apontamentos privados e tarefas/revisões, filtro por período no histórico, pesquisa sem distinção de acentos, exportar/restaurar e eliminar os dados. Seletores nativos de data/hora ficaram de fora para evitar dependências; as datas usam texto validado.

## On-device quality (20%)

**Inicial (10%).** Existem testes automáticos (33 casos em `npm test`) para regras de data/hora, recorrência, sobreposição, migrações e repositórios, mais TypeScript e bundle JS Android/iOS. Isso não substitui ensaios funcionais em Android e iPhone.

**Falta:** testar em dispositivos reais/emuladores (nenhum ensaio feito nesta máquina), acessibilidade com leitor de ecrã e escala de texto, desempenho e memória com anos de histórico, recuperação de falhas e migração da v1 no SQLite do aparelho; testes de componentes React Native.

## Installation and cloud (10%)

**Por iniciar.** Há configuração de EAS para builds de pré-visualização, mas nenhum APK/IPA de distribuição verificado. A sincronização cloud é opcional e fica para uma fase futura.

**Falta:** gerar e validar instalações Android/iOS e definir assinatura/distribuição; avaliar sincronização só depois de consolidar o modo offline.

## Como atualizar

Recalcular a soma ponderada ao fechar critérios observáveis. Distinguir sempre bundle de desenvolvimento, binário instalável, ensaio em dispositivo e publicação.
