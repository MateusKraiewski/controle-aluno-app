# Progresso de entrega — Aula em Dia Mobile

Atualizado em 21/10/2026 (apoio à aprendizagem). O percentual mede o avanço dos marcos planeados, com pesos de escopo. Não significa que exista uma aplicação instalada ou pronta para distribuição.

**Progresso ponderado: 65%** (valor calculado 64,7%; era 64,5% no início deste incremento, 59% em 20/10/2026 e 36% em 18/10/2026).

[██████████](#product-and-offline-architecture-10) [███████████████████████░░](#local-storage-and-repositories-25) [█████████████████████████████░░░░░░](#student-app-35) [███░░░░░░░░░░░░░░░░░](#on-device-quality-20) [░░░░░░░░░░](#installation-and-cloud-10)

| Etapa | Peso | Conclusão | Contribuição |
|---|---:|---:|---:|
| Product and offline architecture | 10% | 100% | 10 p.p. |
| Local storage and repositories | 25% | 92% | 23,0 p.p. |
| Student app | 35% | 82% | 28,7 p.p. |
| On-device quality | 20% | 15% | 3,0 p.p. |
| Installation and cloud | 10% | 0% | 0 p.p. |
| **Total** | **100%** |  | **64,7% ≈ 65%** |

Justificação (recálculo honesto): o apoio à aprendizagem (objetivos por matéria, marcação nas aulas, sugestões de revisão explicáveis e exportação CSV) **acrescentou escopo** à etapa “Student app” e foi implementado no código com testes; por isso a etapa fica nos mesmos 82% — o que falta continua a ser o ensaio em aparelho, que agora cobre também estes ecrãs. “Local storage and repositories” mantém 92%: o esquema v5 e a cópia v5 são aditivos e testados em `node:sqlite`, mas a validação no SQLite do aparelho e a proteção de dados local continuam por fazer. “On-device quality” sobe de 14% para 15% apenas pela cobertura automática (68 → 91 casos); continua sem qualquer ensaio em emulador ou telefone. Instalação continua a 0%. O total quase não muda (64,5% → 64,7%), o que é o resultado esperado de acrescentar funcionalidades sem fechar critérios de aparelho.

## Product and offline architecture (10%)

**Concluído.** A estratégia offline-first, limites de memória e retenção, privacidade e fases de roadmap estão em docs/offline-first.md e docs/roadmap-mobile.md. A regra das sugestões de revisão (só datas registadas pelo aluno, nunca notas ou desempenho) está documentada em docs/offline-first.md.

## Local storage and repositories (25%)

**Parcial (92%).** SQLite é a fonte local, com esquema v5 por `PRAGMA user_version`: migrações aditivas numa transação (v2: estado/cancelamento, `lesson_series`, data original, `updated_at`, arquivo de matérias; v3: colunas de pesquisa preenchidas pela app com backfill paginado; v4: cor e ordem das matérias, modelo da série, apontamentos privados, próximo passo e marca “editada à parte”; v5: só cria `learning_objectives` e `lesson_objectives`, sem tocar em linhas ou colunas existentes). Repositórios com SQL estático e parâmetros ligados para agenda semanal, contagens por dia do mês, edição de séries, data final, cancelamento por período, histórico por cursor com filtros, matérias com cor/ordem e contagem de objetivos ativos, objetivos (listas limitadas a 200 por matéria, marcação só com objetivos da matéria da aula, candidatos à revisão limitados a 500, dispensa guardada), leitura do histórico para CSV em páginas por cursor (máx. 30 000 aulas, apontamentos só lidos quando pedidos), cópia de segurança v5 (aceita v3 e v4), restauro numa transação e eliminação total. `npm test` executa as migrações (base nova, v1→v2, v2→v3, v3→v4, v4→v5 com dados, rollbacks com falha injetada em v2, v3, v4 e v5, versão futura recusada) e os repositórios contra `node:sqlite`.

**Falta:** validar as migrações (backfill v3, derivação v4, criação v5, `String.prototype.normalize` do Hermes) no SQLite do expo-sqlite em Android/iOS reais com bases criadas pelas versões anteriores; proteção de dados local (cifra/proteção de ficheiros) e cópia de segurança automática.

## Student app (35%)

**Parcial (82%).** Implementado no código (sem ensaio em aparelho): agenda semanal navegável com “Hoje”; calendário mensal; criar/editar aula; conteúdo planeado, estudado, apontamentos privados e próximo passo separados; presença do próprio aluno; cancelar/reativar (cancelada não é falta); feriado/pausa por período; excluir com alcance; repetição semanal/quinzenal com edição “só esta”/“todas as futuras” e mudança da data final; aviso de sobreposição; histórico paginado com filtros e pesquisa; matérias com renomear/arquivar, cor e ordem; quatro idiomas e três temas; exportar/restaurar cópia e apagar todos os dados. **Apoio à aprendizagem (novo):** objetivos de aprendizagem por matéria (título até 200 caracteres, estado aberto/praticando/concluído escolhido pelo aluno, data do último trabalho e número de aulas marcadas); marcar no editor da aula quais objetivos foram trabalhados; até 5 sugestões de revisão no separador Matérias, cada uma com a data de origem (“Há 3 semanas sem rever X” · última aula com este objetivo), “Ver objetivos” e “Dispensar” persistente; exportar o histórico em CSV (apontamentos privados só com a opção marcada) pela folha de partilha.

**Falta:** ensaio de todos os fluxos em Android e iPhone (incluindo os novos ecrãs de objetivos, marcação, sugestões e o CSV aberto numa folha de cálculo real); seletores nativos de data/hora; aviso de sobreposição ao estender uma série; revisão de usabilidade/leitor de ecrã do calendário mensal, da lista de cores e dos chips de objetivos; apagar um objetivo (hoje só se renomeia ou conclui).

## On-device quality (20%)

**Inicial (15%).** Existem 91 testes automáticos em `npm test` (29 suites): regras de data/hora, recorrência, data final da série, intervalos, grelha mensal, sobreposição, normalização de pesquisa, migrações (incluindo v4→v5), repositórios (séries, feriados, histórico, cor/ordem, apontamentos, objetivos, marcação, último trabalho, dispensa), regra das sugestões de revisão, escape CSV (aspas, separadores, quebras de linha, injeção de fórmulas, ida e volta por um leitor RFC 4180) e leitura do histórico para CSV, cópia de segurança (ida e volta v5, restauro de cópias v3 e v4, variantes inválidas, falha injetada) e eliminação total; mais TypeScript, `expo-doctor` e bundle JS Android/iOS. Isso não substitui ensaios funcionais em Android e iPhone.

**Falta:** testar em dispositivos reais/emuladores (nenhum ensaio feito nesta máquina); acessibilidade com leitor de ecrã e escala de texto; desempenho e memória com anos de histórico e centenas de objetivos; migração v1–v4→v5 no SQLite do aparelho; abrir o CSV exportado em Excel/Google Sheets/Numbers; testes de componentes React Native.

## Installation and cloud (10%)

**Por iniciar.** Há configuração de EAS para builds de pré-visualização, mas nenhum APK/IPA de distribuição verificado. A sincronização cloud é opcional e fica para uma fase futura.

**Falta:** gerar e validar instalações Android/iOS e definir assinatura/distribuição; avaliar sincronização só depois de consolidar o modo offline.

## Como atualizar

Recalcular a soma ponderada ao fechar critérios observáveis. Funcionalidades novas acrescentam escopo: só sobem a percentagem quando o critério de aceite (incluindo ensaio em aparelho) fecha. Distinguir sempre bundle de desenvolvimento, binário instalável, ensaio em dispositivo e publicação.
