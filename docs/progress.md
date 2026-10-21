# Progresso de entrega — Aula em Dia Mobile

Atualizado em 21/10/2026. O percentual mede o avanço dos marcos planeados, com pesos de escopo. Não significa que exista uma aplicação instalada ou pronta para distribuição.

**Progresso ponderado: 65%** (valor calculado 64,5%; era 59% em 20/10/2026, 53% no início desse dia e 36% em 18/10/2026).

[██████████](#product-and-offline-architecture-10) [███████████████████████░░](#local-storage-and-repositories-25) [█████████████████████████████░░░░░░](#student-app-35) [███░░░░░░░░░░░░░░░░░](#on-device-quality-20) [░░░░░░░░░░](#installation-and-cloud-10)

| Etapa | Peso | Conclusão | Contribuição |
|---|---:|---:|---:|
| Product and offline architecture | 10% | 100% | 10 p.p. |
| Local storage and repositories | 25% | 92% | 23,0 p.p. |
| Student app | 35% | 82% | 28,7 p.p. |
| On-device quality | 20% | 14% | 2,8 p.p. |
| Installation and cloud | 10% | 0% | 0 p.p. |
| **Total** | **100%** |  | **64,5% ≈ 65%** |

Justificação da mudança: todos os itens de código da Fase 1 que estavam como “Falta” (editar todas as ocorrências e a data final da série, feriados/pausas, filtro por período, cor e ordem das matérias, apontamentos privados e próximo passo, calendário mensal) foram implementados, com esquema v4 e testes. A etapa “Student app” não passa de 82% porque nada foi ensaiado em aparelho (ecrãs só verificados por TypeScript e bundle) e as datas continuam em campos de texto. “On-device quality” só sobe pela cobertura automática (47 → 68 casos); continua sem qualquer ensaio em emulador ou telefone. Instalação continua a 0%.

## Product and offline architecture (10%)

**Concluído.** A estratégia offline-first, limites de memória e retenção, privacidade e fases de roadmap estão em docs/offline-first.md e docs/roadmap-mobile.md.

## Local storage and repositories (25%)

**Parcial (92%).** SQLite é a fonte local, com esquema v4 por `PRAGMA user_version`: migrações aditivas numa transação (v2: estado/cancelamento, `lesson_series`, data original, `updated_at`, arquivo de matérias; v3: colunas de pesquisa preenchidas pela app com backfill paginado; v4: cor e ordem das matérias, modelo da série — professor e plano —, apontamentos privados, próximo passo e marca “editada à parte” por ocorrência, derivada para dados antigos sem reescrever colunas existentes). Repositórios com SQL estático e parâmetros ligados para agenda semanal, contagens por dia do mês, edição só desta/de todas as futuras não registadas, alteração da data final da série (estender idempotente, encurtar só futuras intactas, pré-visualização), cancelamento por período, histórico por cursor com filtros de matéria, período e pesquisa sem acentos, matérias com cor/ordem, cópia de segurança v4 (aceita v3), restauro numa transação e eliminação total. `npm test` executa as migrações (base nova, v1→v2, v2→v3, v3→v4 com dados, rollbacks com falha injetada em v2, v3 e v4, versão futura recusada) e os repositórios contra `node:sqlite`.

**Falta:** validar as migrações (backfill v3, derivação v4, `String.prototype.normalize` do Hermes) no SQLite do expo-sqlite em Android/iOS reais com bases criadas pelas versões anteriores; proteção de dados local (cifra/proteção de ficheiros) e cópia de segurança automática.

## Student app (35%)

**Parcial (82%).** Implementado no código (sem ensaio em aparelho): agenda semanal navegável com “Hoje”; calendário mensal com contagem por dia que abre a semana escolhida; criar/editar aula; conteúdo planeado, conteúdo estudado, apontamentos privados e próximo passo/tarefa como campos separados; presença do próprio aluno; cancelar/reativar (cancelada não é falta); feriado/pausa que cancela, num período, as aulas planeadas sem registo (pré-visualização da contagem e confirmação); excluir com alcance “só esta”/“esta e as seguintes”; repetição semanal/quinzenal (máx. 300 aulas, 1 ano); editar “só esta” ou “todas as futuras” (horário, duração, professor e plano, sem tocar em aulas passadas, registadas, canceladas ou editadas à parte); mudar a data final da série com contagem de aulas criadas/removidas; aviso de sobreposição que deixa guardar; histórico paginado com filtro por matéria, período e pesquisa (inclui apontamentos e próximo passo); matérias com renomear/arquivar, cor de uma paleta acessível (sempre com nome) e ordem manual usada na agenda, histórico e filtros; quatro idiomas e três temas; exportar/restaurar cópia e apagar todos os dados.

**Falta:** ensaio de todos os fluxos em Android e iPhone; seletores nativos de data/hora (as datas usam texto validado para evitar dependências nativas); aviso de sobreposição ao estender uma série; revisão de usabilidade/leitor de ecrã do calendário mensal e da lista de cores.

## On-device quality (20%)

**Inicial (14%).** Existem 68 testes automáticos em `npm test`: regras de data/hora, recorrência, planeamento da data final da série, intervalos de datas, grelha mensal, sobreposição, normalização de pesquisa, migrações (incluindo v3→v4), repositórios (edição de série com todas as exclusões, estender/encurtar/reestender, rollback, feriados, período no histórico, cor/ordem, contagens por dia, apontamentos), cópia de segurança (ida e volta com campos v4, restauro de cópia v3, variantes inválidas, falha injetada) e eliminação total; mais TypeScript, `expo-doctor` e bundle JS Android/iOS. Isso não substitui ensaios funcionais em Android e iPhone.

**Falta:** testar em dispositivos reais/emuladores (nenhum ensaio feito nesta máquina); acessibilidade com leitor de ecrã e escala de texto (sobretudo a grelha mensal com 7 colunas); desempenho e memória com anos de histórico; migração v1/v2/v3→v4 no SQLite do aparelho; testes de componentes React Native.

## Installation and cloud (10%)

**Por iniciar.** Há configuração de EAS para builds de pré-visualização, mas nenhum APK/IPA de distribuição verificado. A sincronização cloud é opcional e fica para uma fase futura.

**Falta:** gerar e validar instalações Android/iOS e definir assinatura/distribuição; avaliar sincronização só depois de consolidar o modo offline.

## Como atualizar

Recalcular a soma ponderada ao fechar critérios observáveis. Distinguir sempre bundle de desenvolvimento, binário instalável, ensaio em dispositivo e publicação.
