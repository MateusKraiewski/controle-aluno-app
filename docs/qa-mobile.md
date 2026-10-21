# QA móvel — checklist offline

## Automatizado nesta cópia

- `npm run typecheck` — app e ficheiros de teste.
- `npm test` — 68 casos com `node --test` (Node 24): validação de data/hora/duração (incluindo apontamentos e próximo passo), semanas e DST, geração semanal/quinzenal com limite de 300, planeamento da data final da série (estender só datas futuras depois do fim antigo, sem duplicar; erros de formato, início, 1 ano e 300 aulas), intervalos de datas, grelha mensal (viragem de ano, meses de 4–6 linhas), sobreposição, escape de `LIKE`, normalização sem acentos/maiúsculas; migração (base nova, v1→v2, v2→v3 e v3→v4 com dados preservados coluna a coluna, derivação do modelo da série e das ocorrências editadas à parte, rollback com falha injetada em v2, v3 e v4, versão futura recusada); repositórios (agenda, edição, cancelar sem registar falta, séries com “esta e as seguintes”, “todas as futuras” sem tocar em aulas passadas, já começadas hoje, registadas, canceladas, com estudado/próximo passo ou editadas à parte, “só esta” marcando a exceção, estender/encurtar/reestender com pré-visualização e rollback com falha injetada, feriado/pausa com limites inclusivos e aulas registadas intactas, histórico paginado sem duplicados com filtro por matéria, período e pesquisa, pesquisa em apontamentos e próximo passo, cor de matéria recusando chaves desconhecidas, ordem manual dentro de ativas/arquivadas, contagens por dia); cópia de segurança (exportação v4 com todos os campos, ida e volta com apontamentos, cor e ordem, restauro de cópia v3 com estado derivado, variantes inválidas v3/v4 rejeitadas sem alterar dados, cópia de esquema mais recente recusada, falha injetada no restauro com rollback total) e eliminação total. Correm sobre `node:sqlite`, não sobre o SQLite nativo do aparelho.
- `npx expo-doctor`
- Bundle Android e iOS com `npx expo export --platform android --platform ios`
- `npm audit` analisado; ver a secção de dependências abaixo.

Última execução (21/10/2026, Windows, Node 24.18, depois de todo o código da Fase 1 e do esquema v4): `npm run typecheck` sem erros; `npm test` 68/68 (24 suites); `npx expo-doctor` 20/20 verificações; `npx expo export --platform android --platform ios --output-dir <pasta temporária fora do repositório>` concluído, bundles Hermes de ~2 MB cada (Android 702 módulos, iOS 704). Não houve execução em emulador ou aparelho.

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
- A cópia exportada fica em `cache/backup-export/` (privado da app) até à exportação seguinte ou à eliminação total; o ficheiro não é cifrado.

## Limites desta validação inicial

O workspace desta sessão não tem Android SDK/emulador disponível. O bundle JS e o TypeScript podem ser verificados, mas não equivale a instalar um APK. Build/teste nativo iOS requer macOS local ou um serviço remoto de builds autenticado. Não afirmar validação física até realizá-la.

## Instalação interna

`eas.json` prepara o perfil `preview`: Android gera APK instalável; iOS usa distribuição interna Ad Hoc. O primeiro build ainda precisa de login/configuração de projeto no EAS. Para iOS sem App Store, cada iPhone de teste precisa de UDID registado e a assinatura requer uma conta Apple Developer paga. A instalação pode ser partilhada por URL depois de assinar; isso ainda não foi executado nesta cópia.

## Dependências

No arranque do projeto, `npm audit` apontou advisories transitivos na árvore do Expo CLI/Metro e React Native (`braces`, `node-forge`, `uuid`). A correção automática não encontra atualização segura e `npm audit fix --force` sugere rebaixar o Expo para 44.0.6; isso quebraria o SDK atual e foi recusado. Reavaliar quando o Expo atualizar essas dependências.

O estado observado em 18/10/2026 foi 22 advisories na árvore completa (15 high, 7 moderate). O audit aponta dependências transitivas e não prova que todas entram no binário final; não ocultar os avisos nem afirmar que o binário foi auditado. A instalação local/bundle não substitui uma revisão de segurança antes da distribuição. A distribuição deve aguardar atualização do framework ou uma análise de impacto que trate esses advisories individualmente.
