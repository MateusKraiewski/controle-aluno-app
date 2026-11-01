# Progresso de entrega — Aula em Dia Mobile

Atualizado em 21/10/2026 (anexos de aula e revisão de acessibilidade). O percentual mede o avanço dos marcos planeados, com pesos de escopo. Não significa que exista uma aplicação instalada ou pronta para distribuição.

**Progresso ponderado: 65%** (valor calculado 64,9%; era 64,7% antes dos anexos, 64,5% antes do apoio à aprendizagem, 59% em 20/10/2026 e 36% em 18/10/2026).

[██████████](#product-and-offline-architecture-10) [███████████████████████░░](#local-storage-and-repositories-25) [█████████████████████████████░░░░░░](#student-app-35) [███░░░░░░░░░░░░░░░░░](#on-device-quality-20) [░░░░░░░░░░](#installation-and-cloud-10)

| Etapa | Peso | Conclusão | Contribuição |
|---|---:|---:|---:|
| Product and offline architecture | 10% | 100% | 10 p.p. |
| Local storage and repositories | 25% | 92% | 23,0 p.p. |
| Student app | 35% | 82% | 28,7 p.p. |
| On-device quality | 20% | 16% | 3,2 p.p. |
| Installation and cloud | 10% | 0% | 0 p.p. |
| **Total** | **100%** |  | **64,9% ≈ 65%** |

Justificação (recálculo honesto, anexos e acessibilidade): os anexos de aula (ficheiros no diretório da app, metadados no esquema v6, fila transacional de remoção, política de cópia explícita) **acrescentaram escopo** a “Local storage and repositories” e a “Student app” e foram implementados com testes de regras e repositório; o seletor de documentos, a cópia de ficheiros e a folha de partilha nunca correram num aparelho, por isso nenhuma das duas etapas sobe (92% e 82%). A revisão de acessibilidade corrigiu no código alvos de toque, estados só por cor, rótulos/estados e movimento reduzido, mas o critério da etapa é o ensaio com TalkBack/VoiceOver e texto grande, que continua por fazer; não conta como fechado. “On-device quality” sobe de 15% para 16% só pela cobertura automática (91 → 112 casos) e pela lista escrita de pendências de acessibilidade. Instalação continua a 0%. Total 64,7% → 64,9%.

Justificação anterior (apoio à aprendizagem): o apoio à aprendizagem (objetivos por matéria, marcação nas aulas, sugestões de revisão explicáveis e exportação CSV) **acrescentou escopo** à etapa “Student app” e foi implementado no código com testes; por isso a etapa fica nos mesmos 82% — o que falta continua a ser o ensaio em aparelho, que agora cobre também estes ecrãs. “Local storage and repositories” mantém 92%: o esquema v5 e a cópia v5 são aditivos e testados em `node:sqlite`, mas a validação no SQLite do aparelho e a proteção de dados local continuam por fazer. “On-device quality” sobe de 14% para 15% apenas pela cobertura automática (68 → 91 casos); continua sem qualquer ensaio em emulador ou telefone. Instalação continua a 0%. O total quase não muda (64,5% → 64,7%), o que é o resultado esperado de acrescentar funcionalidades sem fechar critérios de aparelho.

## Product and offline architecture (10%)

**Concluído.** A estratégia offline-first, limites de memória e retenção, privacidade e fases de roadmap estão em docs/offline-first.md e docs/roadmap-mobile.md. A regra das sugestões de revisão (só datas registadas pelo aluno, nunca notas ou desempenho) está documentada em docs/offline-first.md.

## Local storage and repositories (25%)

**Parcial (92%).** SQLite é a fonte local, com esquema v6 por `PRAGMA user_version`: migrações aditivas numa transação (v2: estado/cancelamento, `lesson_series`, data original, `updated_at`, arquivo de matérias; v3: colunas de pesquisa preenchidas pela app com backfill paginado; v4: cor e ordem das matérias, modelo da série, apontamentos privados, próximo passo e marca “editada à parte”; v5: só cria `learning_objectives` e `lesson_objectives`; v6: só cria `lesson_attachments`, `attachment_trash` e o trigger que enfileira ficheiros a apagar, sem tocar em linhas ou colunas existentes). Anexos: bytes em ficheiros com nome UUID no diretório de documentos da app, nunca no SQLite; metadados validados (tipo por bytes mágicos, 1 B–5 MB, nome sanitizado até 120, máx. 10 por aula numa transação); remoção por fila transacional retomada no arranque e limpeza de ficheiros órfãos. Repositórios com SQL estático e parâmetros ligados para agenda semanal, contagens por dia do mês, edição de séries, data final, cancelamento por período, histórico por cursor com filtros, matérias com cor/ordem e contagem de objetivos ativos, objetivos (listas limitadas a 200 por matéria, marcação só com objetivos da matéria da aula, candidatos à revisão limitados a 500, dispensa guardada), leitura do histórico para CSV em páginas por cursor (máx. 30 000 aulas, apontamentos só lidos quando pedidos), cópia de segurança v5 (aceita v3 e v4; formato de cópia agora independente do esquema e sem anexos), restauro numa transação e eliminação total. `npm test` executa as migrações (base nova, v1→v2, v2→v3, v3→v4, v4→v5 e v5→v6 com dados, rollbacks com falha injetada em v2, v3, v4, v5 e v6, versão futura recusada) e os repositórios contra `node:sqlite`.

**Falta:** validar as migrações (backfill v3, derivação v4, criação v5 e v6, trigger em cascata, `String.prototype.normalize` do Hermes) no SQLite do expo-sqlite em Android/iOS reais com bases criadas pelas versões anteriores; validar `expo-file-system`/`expo-document-picker` com URIs reais (`content://`, iCloud) e o comportamento dos backups do sistema com a pasta de anexos; proteção de dados local (cifra/proteção de ficheiros) e cópia de segurança automática.

## Student app (35%)

**Parcial (82%).** Implementado no código (sem ensaio em aparelho): agenda semanal navegável com “Hoje”; calendário mensal; criar/editar aula; conteúdo planeado, estudado, apontamentos privados e próximo passo separados; presença do próprio aluno; cancelar/reativar (cancelada não é falta); feriado/pausa por período; excluir com alcance; repetição semanal/quinzenal com edição “só esta”/“todas as futuras” e mudança da data final; aviso de sobreposição; histórico paginado com filtros e pesquisa; matérias com renomear/arquivar, cor e ordem; separador Almoço que importa a ementa escolar em PDF (formato Loures/Uniself, incluindo as variantes de cabeçalho de novembro e dezembro) e mostra o calendário das refeições, com o prato escolhido em cada dia; editor de aula com seletores de dia, hora e duração por toque e detalhes opcionais recolhidos; quatro idiomas e três temas; exportar/restaurar cópia e apagar todos os dados. **Apoio à aprendizagem (novo):** objetivos de aprendizagem por matéria (título até 200 caracteres, estado aberto/praticando/concluído escolhido pelo aluno, data do último trabalho e número de aulas marcadas); marcar no editor da aula quais objetivos foram trabalhados; até 5 sugestões de revisão no separador Matérias, cada uma com a data de origem (“Há 3 semanas sem rever X” · última aula com este objetivo), “Ver objetivos” e “Dispensar” persistente; exportar o histórico em CSV (apontamentos privados só com a opção marcada) pela folha de partilha. **Anexos (novo):** no editor de uma aula guardada, adicionar PDF/imagem/texto até 5 MB (10 por aula), ver nome/tipo/tamanho, abrir ou partilhar, remover com confirmação e ver “Arquivo indisponível” quando o ficheiro falta; avisos de anexos ao excluir aulas, restaurar e apagar tudo. **Acessibilidade (revisão no código):** alvos de 44×44, “✓” em todos os estados selecionados, papéis/rótulos/estados em todos os controlos, modais marcados como tal e sem animação com “reduzir movimento”.

**Falta:** ensaio de todos os fluxos em Android e iPhone (incluindo os novos ecrãs de objetivos, marcação, sugestões e o CSV aberto numa folha de cálculo real); aviso de sobreposição ao estender uma série; ensaio com leitor de ecrã e texto grande de todos os ecrãs (a revisão no código está feita; pendências em `docs/qa-mobile.md`); grelha mensal em ecrãs estreitos; anúncio de erros no iOS; apagar um objetivo (hoje só se renomeia ou conclui); miniaturas e câmara nos anexos.

## On-device quality (20%)

**Inicial (16%).** Existem 112 testes automáticos em `npm test` (33 suites): regras de data/hora, recorrência, data final da série, intervalos, grelha mensal, sobreposição, normalização de pesquisa, migrações (incluindo v4→v5 e v5→v6), repositórios (séries, feriados, histórico, cor/ordem, apontamentos, objetivos, marcação, último trabalho, dispensa), regra das sugestões de revisão, escape CSV (aspas, separadores, quebras de linha, injeção de fórmulas, ida e volta por um leitor RFC 4180) e leitura do histórico para CSV, cópia de segurança (ida e volta v5, restauro de cópias v3 e v4, variantes inválidas, falha injetada) e eliminação total; anexos (bytes mágicos, sanitização de nomes, nomes UUID, limites, cascata para a fila de remoção, proteção nas edições de série, órfãos); mais TypeScript, `expo-doctor` e bundle JS Android/iOS. Isso não substitui ensaios funcionais em Android e iPhone.

A revisão de acessibilidade foi feita por leitura do código (lista do corrigido e do não corrigido em `docs/qa-mobile.md`).

**Falta:** testar em dispositivos reais/emuladores (nenhum ensaio feito nesta máquina); acessibilidade com leitor de ecrã e escala de texto (itens 43–47); anexos com seletor, cópia, partilha e crash a meio (itens 32–42); desempenho e memória com anos de histórico e centenas de objetivos; migração v1–v5→v6 no SQLite do aparelho; abrir o CSV exportado em Excel/Google Sheets/Numbers; testes de componentes React Native.

## Installation and cloud (10%)

**Por iniciar.** Há configuração de EAS para builds de pré-visualização, mas nenhum APK/IPA de distribuição verificado. A sincronização cloud é opcional e fica para uma fase futura.

**Falta:** gerar e validar instalações Android/iOS e definir assinatura/distribuição; avaliar sincronização só depois de consolidar o modo offline.

## Como atualizar

Recalcular a soma ponderada ao fechar critérios observáveis. Funcionalidades novas acrescentam escopo: só sobem a percentagem quando o critério de aceite (incluindo ensaio em aparelho) fecha. Distinguir sempre bundle de desenvolvimento, binário instalável, ensaio em dispositivo e publicação.
