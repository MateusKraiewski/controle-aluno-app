# QA móvel — checklist offline

## Automatizado nesta cópia

- `npm run typecheck` — app e ficheiros de teste.
- `npm test` — 112 casos (33 suites) com `node --test` (Node 24): validação de data/hora/duração (incluindo apontamentos e próximo passo), semanas e DST, geração semanal/quinzenal com limite de 300, planeamento da data final da série (estender só datas futuras depois do fim antigo, sem duplicar; erros de formato, início, 1 ano e 300 aulas), intervalos de datas, grelha mensal (viragem de ano, meses de 4–6 linhas), sobreposição, escape de `LIKE`, normalização sem acentos/maiúsculas; migração (base nova, v1→v2, v2→v3, v3→v4, v4→v5 e v5→v6 com dados preservados coluna a coluna, derivação do modelo da série e das ocorrências editadas à parte, restrições das tabelas de objetivos, restrições e cascata da tabela de anexos para a fila de ficheiros, rollback com falha injetada em v2, v3, v4, v5 e v6, versão futura recusada); anexos (tipo pelos bytes mágicos de PDF, PNG, JPEG, WebP e texto UTF-8, recusa de ZIP/DOCX, executável, GIF, NUL, UTF-8 inválido, sobrelongo e substitutos, carácter cortado no fim da amostra, limites de 0 B e 5 MB; sanitização de nomes com caminhos, controlo/bidi, caracteres reservados, extensão incoerente, nome vazio/reservado e limite de 120 caracteres sem partir emoji; nomes UUID v4 e recusa de nomes não gerados; repositório só com metadados, limite de 10 por aula, aula inexistente e metadados inválidos sem escrita, fila preenchida ao remover anexo, ao excluir aula, “esta e as seguintes”, restauro e eliminação total, ocorrência futura com anexo protegida de “todas as futuras” e de encurtar a série, cópia sem dados de anexos, referências em lotes e lista de órfãos); repositórios (agenda, edição, cancelar sem registar falta, séries com “esta e as seguintes”, “todas as futuras” sem tocar em aulas passadas, já começadas hoje, registadas, canceladas, com estudado/próximo passo ou editadas à parte, “só esta” marcando a exceção, estender/encurtar/reestender com pré-visualização e rollback com falha injetada, feriado/pausa com limites inclusivos e aulas registadas intactas, histórico paginado sem duplicados com filtro por matéria, período e pesquisa, pesquisa em apontamentos e próximo passo, cor de matéria recusando chaves desconhecidas, ordem manual dentro de ativas/arquivadas, contagens por dia); objetivos (título 1–200 normalizado, SQL com texto hostil guardado literalmente, ordem praticando/aberto/concluído, limite de 200 por matéria, marcação só com objetivos da matéria da aula e idempotente, último trabalho ignorando aulas futuras, canceladas e com falta, marcas retiradas ao mudar a aula de matéria, ocorrência futura marcada protegida de “encurtar série”, candidatos à revisão sem matérias arquivadas nem concluídos, dispensa por data-base); regra das sugestões de revisão (limiar de 21 dias, fonte = última aula ou criação, concluídos e datas futuras ignorados, dispensa só da mesma data-base, ordem e limite); CSV (aspas, vírgula, ponto e vírgula, CR/LF, espaços nas pontas, apóstrofo, injeção de fórmulas `= + - @`, BOM e CRLF, ida e volta por um leitor RFC 4180, cabeçalho e colunas com/sem apontamentos, fim depois da meia-noite, leitura paginada do histórico até hoje, apontamentos só lidos com a opção, recusa acima de 30 000 aulas); cópia de segurança (exportação v5 com todos os campos, ida e volta com apontamentos, cor, ordem, objetivos, marcas e dispensa, restauro de cópias v3 e v4 sem objetivos, variantes inválidas v3/v4/v5 rejeitadas sem alterar dados — incluindo estado desconhecido, campo de nota, marca entre matérias e marca repetida —, cópia de esquema mais recente recusada, falha injetada no restauro com rollback total) e eliminação total. Correm sobre `node:sqlite`, não sobre o SQLite nativo do aparelho.
- `npx expo-doctor`
- Bundle Android e iOS com `npx expo export --platform android --platform ios`
- `npm audit` analisado; ver a secção de dependências abaixo.

Última execução (21/10/2026, Windows, Node 24.18, depois dos anexos, do esquema v6 e da revisão de acessibilidade): `npm run typecheck` sem erros (código de saída 0); `npm test` 112/112 (33 suites, 0 falhas); `npx expo-doctor` 20/20 verificações; `npx expo export --platform android --platform ios --output-dir <pasta temporária fora do repositório>` concluído, bundles Hermes de 2,1 MB cada (Android 716 módulos, iOS 718). Não houve execução em emulador ou aparelho; o CSV não foi aberto numa folha de cálculo real; o seletor de documentos, a cópia de ficheiros e a folha de partilha dos anexos não foram executados.

Execução anterior (21/10/2026, apoio à aprendizagem, esquema v5): typecheck sem erros; 91/91 testes (29 suites); expo-doctor 20/20; bundles Android 709 e iOS 706 módulos.

Não há ainda testes de componentes React Native nem testes ponta a ponta; os ecrãs só foram verificados por TypeScript e bundling.

## Testes manuais da Fase 1 (pendentes em aparelho)

1. Agenda: navegar semana anterior/seguinte e “Hoje”; aulas agrupadas por dia; contador ignora canceladas.
2. Editar uma aula (matéria, professor, data, hora, duração, previsto, estudado), fechar e reabrir a app; confirmar persistência.
3. Criar aula sobreposta a outra no mesmo dia: aparece o aviso; “Rever” não grava; “Guardar mesmo assim” grava.
4. Repetição semanal (2 dias) e quinzenal com data final: contagem prevista confere com a agenda; tentar fim antes do início, mais de 1 ano e nenhum dia escolhido.
5. Cancelar aula com motivo: badge “Cancelada”, sem botões de presença, não conta no contador; reativar. Numa série, cancelar “esta e as seguintes”.
6. Excluir: aparece confirmação; “Voltar” não apaga; numa série, “Só esta” e “Esta e as seguintes”.
7. Histórico: aulas até hoje, mais recentes primeiro; “Carregar mais” sem duplicados; filtro por matéria; pesquisar `100%`, `_`, apóstrofo e acentos.
8. Matérias: renomear para nome existente (com outra capitalização) mostra erro; arquivar esconde das sugestões e não apaga aulas; “Mostrar arquivadas”.
9. Atualizar a partir de instalações anteriores (esquema v1, v2 e v3) com aulas gravadas: nenhuma aula desaparece, presença antiga mantém-se, a pesquisa sem acentos encontra aulas antigas (backfill v3) e ocorrências de séries editadas antes (outro horário, data movida, outro plano) não mudam com “todas as futuras” (derivação v4).
10. Leitor de ecrã (TalkBack/VoiceOver) nos separadores, cartões, chips de presença e alertas; escala de texto grande; tema escuro.
11. Pesquisa: “FISICA”, “fisica” e “Física” dão o mesmo resultado; pesquisar nome de professor e conteúdo estudado com e sem acentos; renomear matéria e pesquisar pelo novo nome.
12. Exportar cópia: abre a folha de partilha; guardar em Ficheiros/Drive/e-mail; abrir o ficheiro e confirmar `format`, `schema_version` e ausência de idioma/tema. Testar sem apps de destino e em modo avião (guardar localmente).
13. Restaurar colando o JSON: “Verificar cópia” mostra data e contagens e as contagens atuais; “Voltar” no alerta não altera nada; confirmar substitui tudo; agenda, histórico e matérias atualizam sem reiniciar.
14. Restaurar escolhendo o ficheiro exportado (Android e iOS); cancelar o seletor não muda nada.
15. Restaurar texto truncado, JSON de outra app, cópia com `schema_version` maior e cópia com uma data inválida: mensagem clara e nenhum dado alterado.
16. Cópia grande (milhares de aulas): medir tempo e memória da exportação, colagem e restauro; matar a app durante o restauro e confirmar que reabre com os dados antigos ou os novos, nunca uma mistura.
17. “Apagar todos os meus dados”: “Voltar” em qualquer dos dois alertas não apaga; confirmar apaga matérias e aulas, mantém idioma e tema e a app continua utilizável.
18. Série: numa aula futura da repetição mudar a hora e escolher “Todas as futuras”; o diálogo mostra a contagem; confirmar que mudam só as aulas futuras sem registo; aulas passadas, com presença, canceladas, com estudado/próximo passo ou editadas à parte ficam iguais. Repetir com “Só esta” e verificar que essa aula deixa de seguir a série. “Voltar” não grava nada.
19. Série: estender a data final (contagem “criadas” confere com a agenda; repetir a mesma data não duplica); encurtar (só somem aulas futuras sem registo; as registadas ficam); data inválida, antes do início, mais de 1 ano e mais de 300 aulas mostram mensagem.
20. Feriado/pausa: intervalo com aulas planeadas, uma com presença e uma com estudado; o alerta mostra a contagem certa; “Voltar” não muda nada; confirmar cancela só as planeadas sem registo com o motivo; nenhuma conta como falta; reativar uma; intervalo sem aulas mostra “Nenhuma aula…”.
21. Histórico: “Período” com só “De”, só “Até”, ambos, data inválida (mensagem, filtro anterior mantém-se) e “Até” no futuro (nunca aparecem aulas futuras); combinar com matéria e pesquisa; “Carregar mais” sem duplicados; “Limpar período”.
22. Matérias: escolher cor (rótulo com nome em cada opção; “Sem cor”), ver a cor no cartão da agenda/histórico nos dois temas; subir/descer (setas desativadas nas pontas e entre ativas/arquivadas); a ordem aparece nos filtros do histórico e nas sugestões do editor.
23. Apontamentos privados e próximo passo: gravar, reabrir, pesquisar sem acentos; o próximo passo aparece no cartão e os apontamentos não; exportar e restaurar mantém ambos.
24. Calendário mensal: navegar meses (incluindo viragem de ano) e “Hoje”; números conferem com a agenda; canceladas aparecem como “−N”; tocar num dia abre a semana; leitor de ecrã lê data, contagem e canceladas; texto grande não corta a grelha.
25. Restaurar uma cópia exportada pela versão anterior (`schema_version` 3): aceita, campos novos vazios.

## Testes manuais do apoio à aprendizagem (pendentes em aparelho)

26. Matérias → “Objetivos (0)”: adicionar objetivo vazio (mensagem), com 200 caracteres (aceita) e com espaços/quebras (fica numa linha); renomear; mudar Aberto/Praticando/Concluído; concluído some até “Mostrar concluídos”; o número no chip da matéria acompanha os não concluídos.
27. Editor de uma aula passada: a secção “Objetivos trabalhados nesta aula” lista só objetivos da matéria; marcar/desmarcar grava sem “Guardar” (fechar e reabrir confirma); matéria sem objetivos mostra o texto de ajuda; mudar a matéria da aula e guardar retira as marcas da matéria antiga.
28. Sugestões de revisão: com o relógio do aparelho ou dados de teste, um objetivo trabalhado há ≥ 21 dias aparece com “Há N semanas sem rever …” e a data da última aula; objetivo nunca trabalhado mostra a data de criação; “Dispensar” remove e continua removido após reiniciar; marcar o objetivo numa aula nova faz a sugestão desaparecer; aulas futuras, canceladas ou com “Faltei” não contam; matéria arquivada não gera sugestões. Confirmar que nenhum texto fala em nota ou desempenho.
29. Exportar histórico (CSV) sem e com “Incluir apontamentos privados”: abrir em Excel, Google Sheets e Numbers; acentos corretos (BOM), quebras de linha dentro de células, vírgulas/aspas preservadas, conteúdo começado por `=`/`-` aparece com apóstrofo e não é calculado; sem a opção, nenhuma coluna de apontamentos. Folha de cálculo em português com separador “;”: verificar se pede importação manual.
30. Cópia de segurança com objetivos: exportar, apagar tudo, restaurar; objetivos, estados, marcas e dispensas voltam. Restaurar uma cópia v4 (versão anterior): aceita, sem objetivos.
31. Atualizar a partir de uma instalação v4 com aulas: tudo continua igual e “Objetivos (0)” aparece em cada matéria.

## Testes manuais dos anexos (pendentes em aparelho)

32. Editor de uma aula guardada → “Anexos (0 de 10)”: adicionar um PDF, uma foto JPEG, um PNG, um WebP e um .txt pelo seletor (Android: Ficheiros, Drive e Galeria; iOS: Ficheiros e iCloud); cada um aparece com nome, tipo e tamanho; fechar e reabrir a app mantém tudo.
33. Recusas: ficheiro de 0 B, maior do que 5 MB, DOCX, GIF, HEIC, PDF renomeado para `.jpg` (aceite como PDF, nome corrigido para `….jpg.pdf`) e `.exe` renomeado para `.pdf` (recusado); mensagem clara e nada gravado. Cancelar o seletor não muda nada.
34. Limite: com 10 anexos o botão fica desativado e aparece “Limite de 10 anexos nesta aula”.
35. “Abrir ou partilhar”: abre a folha de partilha com o nome original; abrir num visualizador de PDF/imagens, guardar em Ficheiros/Drive; em modo avião continua a funcionar para apps locais.
36. Remover anexo: “Voltar” não apaga; confirmar apaga a linha e o ficheiro (verificar o espaço da app ou, em emulador, a pasta `files/lesson-attachments`).
37. Excluir uma aula com anexos (e “esta e as seguintes” numa série): o alerta avisa os anexos; os ficheiros desaparecem da pasta.
38. Matar a app logo depois de remover um anexo/excluir a aula e reabrir: nenhuma linha “indisponível” criada pela app; o ficheiro é apagado no arranque. Matar a app durante “Copiando…”: ao reabrir não aparece anexo novo e a pasta não fica com o ficheiro.
39. Apagar à mão um ficheiro da pasta (emulador/adb): a linha mostra “Arquivo indisponível” com aviso em texto, sem “Abrir”, e pode ser removida.
40. Cópia de segurança com anexos: exportar (o JSON não tem anexos), restaurar — a pré-visualização e o alerta dizem quantos anexos serão apagados; depois do restauro a pasta fica vazia. “Apagar todos os meus dados” diz quantos anexos e remove a pasta.
41. Série: uma aula futura com anexo não muda com “todas as futuras” nem desaparece ao encurtar a série.
42. Atualizar a partir de uma instalação v5 com dados: tudo igual e a secção “Anexos (0 de 10)” aparece no editor.

## Testes manuais de acessibilidade (pendentes em aparelho)

43. TalkBack e VoiceOver em todos os ecrãs: cada botão/chip anuncia nome, função e estado (selecionado, marcado, desativado, ocupado, expandido); campos anunciam o rótulo uma vez; indicadores de carregamento anunciam “Carregando…”; ícones decorativos (⚙, ✳) não são lidos.
44. Modais (aula, feriado, mês, objetivos, definições): o foco começa no topo (título e “Fechar”) e não sai para o ecrã de trás; alertas de confirmação recebem o foco.
45. Texto grande (Android 200%, iOS tamanhos de acessibilidade): nada fica cortado em chips, botões, cartões, separadores e grelha mensal; medir alvos ≥ 44×44.
46. Estados sem cor: chips/opções selecionados mostram “✓”, objetivos marcados “☑”, anexo indisponível tem texto e “⚠”, hoje no calendário fica sublinhado; confirmar em escala de cinzentos.
47. “Reduzir movimento” (iOS) / “Remover animações” (Android): os modais abrem sem deslizar.

## Revisão de acessibilidade no código (21/10/2026)

Feita por leitura de todos os ecrãs e componentes, **sem leitor de ecrã nem aparelho**. Corrigido:

- Alvos de toque: chips com mínimo 44×44 (eram 36 de altura com `hitSlop`), “Fechar” dos modais, botão de definições e botões da semana com `minWidth`/`minHeight` 44 em vez de altura fixa; células do calendário com largura mínima 44 e margem menor.
- Altura fixa à volta de texto: botões de definições e navegação passaram a `minHeight` (o texto cresce com a escala de fonte). Nenhum `allowFontScaling={false}` no projeto.
- Estado só por cor: chips, opções de idioma/tema, estado do objetivo e cor da matéria selecionados mostram “✓”; hoje no calendário é sublinhado além da borda; anexo indisponível tem texto e “⚠”.
- Papéis, rótulos e estados: `accessibilityState` (desativado/ocupado) em todos os botões de ação (guardar, data final, cancelar, reativar, excluir, carregar mais, escolher ficheiro, verificar cópia, anexos); rótulos explícitos no botão “Adicionar aula” vazio, “Carregar mais”, guardar, opções de idioma/tema e caixa “Incluir apontamentos”; grupos `radiogroup` com rótulo para idioma e tema; “Período” anuncia expandido/fechado; títulos de secção do editor como cabeçalhos.
- Leitor de ecrã: rótulo visível dos campos escondido (o `TextInput` já o tem, para não ser lido duas vezes); ícones ⚙ e ✳ escondidos; pastilha “OFFLINE” lida como um elemento; `ActivityIndicator` com rótulo “Carregando…”.
- Modais: `accessibilityViewIsModal` no contentor de cada modal (no iOS deve impedir o VoiceOver de sair para o ecrã de trás; por ensaiar); ordem de foco = ordem visual (título, Fechar, campos, ações).
- Movimento reduzido: com “reduzir movimento” ativo no sistema (`AccessibilityInfo`), os modais abrem sem animação. Não há outras animações na app além do indicador de carregamento do sistema.

**Não corrigido (registado):**

- A grelha mensal tem 7 colunas: em ecrãs com menos de ~360 pt de largura as células ficam abaixo de 44 de largura e, com texto muito grande, os números podem ficar apertados. Uma vista em lista por semana seria a alternativa.
- Os cartões da agenda/histórico mostram no máximo 2 linhas de planeado/estudado/próximo passo (`numberOfLines`); o texto inteiro está no editor.
- Mensagens de erro usam `accessibilityRole="alert"` e `accessibilityLiveRegion` (só Android); no iOS podem não ser anunciadas automaticamente — falta `AccessibilityInfo.announceForAccessibility` e mover o foco para o erro.
- O foco ao fechar um modal volta para onde o sistema decidir; não há gestão programática do foco.
- Os alertas de confirmação são nativos (`Alert`): ordem de foco e leitura dependem do sistema; no Android cabem só três botões.
- Datas e horas continuam em campos de texto (`AAAA-MM-DD`, `HH:MM`), mais difíceis com leitor de ecrã do que seletores nativos.
- O contraste dos botões desativados (opacidade 0,6) e dos placeholders não foi medido.
- O indicador de carregamento do sistema continua animado com “reduzir movimento” (componente nativo).

## Testes manuais antes de chamar uma instalação de pronta

1. Abrir sem rede, criar duas matérias/aulas em horários distintos no mesmo dia e reiniciar a app.
2. Confirmar persistência da agenda e do estado de presença em modo avião.
3. Fechar o app a meio do formulário; confirmar que o que ainda não foi guardado não aparece como aula.
4. Testar data inválida, duração fora do intervalo e campos opcionais vazios.
5. Criar strings com apóstrofo, acentos e caracteres longos; confirmar que permanecem texto literal.
6. Gerar muitos registos locais e confirmar que a agenda continua limitada e o histórico não carrega tudo.
7. Atualizar schema de uma base antiga e validar que nenhuma ocorrência desaparece; testar rollback de migração com falha injetada.
8. Validar Android e iOS em aparelhos/emuladores, teclado, escala de texto e leitor de ecrã.
9. Alterar idioma/tema, fechar e reabrir a app; validar as quatro línguas e os três modos de tema.

## Limites conhecidos da interface

- Datas e horas são campos de texto validados (`AAAA-MM-DD`, `HH:MM`); não há seletor nativo para evitar dependências nativas novas.
- “Todas as futuras” usa o relógio do aparelho para decidir o que é futuro; um relógio errado muda o conjunto afetado (o diálogo mostra a contagem antes de gravar).
- Estender uma série não mostra aviso de sobreposição para as datas criadas.
- A grelha mensal usa 7 colunas; com escala de texto muito grande pode ficar apertada (por ensaiar).
- `SafeAreaView` do React Native continua em uso (como na fundação); avaliar `react-native-safe-area-context` se houver problemas de recorte em aparelhos com notch.
- O Android mostra no máximo três botões num alerta; os diálogos de alcance usam exatamente três (Voltar, Só esta, Esta e as seguintes).
- O botão de voltar do Android fecha modais; nos separadores, sai da app.
- Restauro por colagem: um `TextInput` com vários MB pode ficar lento e a área de transferência pode cortar o texto; para cópias grandes usar “Escolher ficheiro”. Limite de 10 milhões de caracteres por cópia.
- A cópia exportada (JSON ou CSV) fica em `cache/backup-export/` (privado da app) até à exportação seguinte ou à eliminação total; o ficheiro não é cifrado.
- O CSV usa vírgula como separador; algumas folhas de cálculo em português esperam “;” e podem abrir tudo numa coluna (por ensaiar). Texto começado por `=`, `+`, `-` ou `@` sai com um apóstrofo inicial.
- Não há “apagar objetivo”: só renomear ou concluir. As sugestões dependem do relógio do aparelho e mostram no máximo 5.
- Anexos: um ficheiro de cada vez, sem câmara e sem miniaturas; abrir passa sempre pela folha de partilha. A cópia de segurança JSON não leva anexos e o restauro apaga os atuais (o alerta avisa). Backups do sistema operativo podem ou não incluir a pasta (não verificado).

## Limites desta validação inicial

O workspace desta sessão não tem Android SDK/emulador disponível. O bundle JS e o TypeScript podem ser verificados, mas não equivale a instalar um APK. Build/teste nativo iOS requer macOS local ou um serviço remoto de builds autenticado. Não afirmar validação física até realizá-la.

## Instalação interna

`eas.json` prepara o perfil `preview`: Android gera APK instalável; iOS usa distribuição interna Ad Hoc. O primeiro build ainda precisa de login/configuração de projeto no EAS. Para iOS sem App Store, cada iPhone de teste precisa de UDID registado e a assinatura requer uma conta Apple Developer paga. A instalação pode ser partilhada por URL depois de assinar; isso ainda não foi executado nesta cópia.

## Dependências

No arranque do projeto, `npm audit` apontou advisories transitivos na árvore do Expo CLI/Metro e React Native (`braces`, `node-forge`, `uuid`). A correção automática não encontra atualização segura e `npm audit fix --force` sugere rebaixar o Expo para 44.0.6; isso quebraria o SDK atual e foi recusado. Reavaliar quando o Expo atualizar essas dependências.

O estado observado em 18/10/2026 foi 22 advisories na árvore completa (15 high, 7 moderate). O audit aponta dependências transitivas e não prova que todas entram no binário final; não ocultar os avisos nem afirmar que o binário foi auditado. A instalação local/bundle não substitui uma revisão de segurança antes da distribuição. A distribuição deve aguardar atualização do framework ou uma análise de impacto que trate esses advisories individualmente.

## Teste em aparelho real — 21/10/2026

Moto G06 (Android 15), APK de teste gerado localmente (`assembleRelease` só para arm64-v8a, assinado com a chave de debug, não é versão de loja) e instalado por `adb install`.

- Funcionou: abrir o app offline, criar aula, marcar presença, registrar conteúdo estudado, anexar PDF pelo seletor do sistema, abrir/compartilhar pelo menu do Android, remover anexo com confirmação, histórico, cor da matéria, calendário do mês, série semanal (24 aulas) e reabrir o app após forçar a paragem com os dados preservados. Nenhum crash no logcat.
- Encontrado e corrigido: cabeçalho e títulos dos modais por baixo da barra de status (Android 15 desenha edge-to-edge) e data com "De" maiúsculo. A primeira correção usava `react-native-safe-area-context`, que não compila em Windows por exceder 260 caracteres de caminho; foi trocada pela altura de `StatusBar` no Android.
- Pendente: confirmar a correção no aparelho (APK corrigido em `E:\tools\aula-em-dia-teste.apk`), barra de abas ainda encosta ligeiramente na barra de gestos, TalkBack não testado, iPhone não testado.

### Gerar o APK de teste no Windows

JDK 17 portátil em `E:\tools\jdk-17`; copiar o projeto para um caminho curto (ex.: `E:\am`), `npm ci`, `npx expo prebuild --platform android --no-install`, depois em `android\`: `gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` com `JAVA_HOME` e `ANDROID_HOME` definidos.
