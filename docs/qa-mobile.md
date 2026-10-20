# QA móvel — checklist offline

## Automatizado nesta cópia

- `npm run typecheck` — app e ficheiros de teste.
- `npm test` — 47 casos com `node --test` (Node 24): validação de data/hora/duração, semanas e DST, geração semanal/quinzenal com limite de 300, sobreposição, escape de `LIKE`, normalização sem acentos/maiúsculas; migração (base nova, v1→v2 e v2→v3 com dados preservados e backfill acima de uma página, rollback com falha injetada em v2 e v3, versão futura recusada); repositórios (agenda, edição, cancelar sem registar falta, séries com “esta e as seguintes”, rollback de série inválida, histórico paginado sem duplicados, filtro, pesquisa com `%`/`_`/aspas, “FÍSICA”/“fisica” encontram “Física”, chaves de pesquisa atualizadas em criar/editar/série/renomear, renomear/arquivar matérias); cópia de segurança (formato sem colunas derivadas, exportação com mais de uma página, ida e volta exportar→validar→restaurar noutra base com todas as linhas iguais, restauro vazio, 33 variantes inválidas rejeitadas sem alterar dados, cópia de esquema mais recente recusada mesmo se entregue diretamente ao restauro, falha injetada na última inserção com rollback total) e eliminação total (contagens, base utilizável depois, rollback com falha injetada). Correm sobre `node:sqlite`, não sobre o SQLite nativo do aparelho.
- `npx expo-doctor`
- Bundle Android e iOS com `npx expo export --platform android --platform ios`
- `npm audit` analisado; ver a secção de dependências abaixo.

Última execução (20/10/2026, Windows, Node 24.18, depois de adicionar `expo-file-system` ~58.0.10 e `expo-sharing` ~58.0.19 com `npx expo install`): typecheck sem erros; `npm test` 47/47; `expo-doctor` 20/20; `expo export --platform android --platform ios` (para uma pasta temporária fora do repositório) concluído, bundles Hermes de 1,9 MB cada (iOS 701 módulos, Android 699). Não houve execução em emulador ou aparelho.

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
9. Atualizar a partir de instalações anteriores (esquema v1 e v2) com aulas gravadas: nenhuma aula desaparece, presença antiga mantém-se e a pesquisa sem acentos encontra aulas antigas (backfill v3).
10. Leitor de ecrã (TalkBack/VoiceOver) nos separadores, cartões, chips de presença e alertas; escala de texto grande; tema escuro.
11. Pesquisa: “FISICA”, “fisica” e “Física” dão o mesmo resultado; pesquisar nome de professor e conteúdo estudado com e sem acentos; renomear matéria e pesquisar pelo novo nome.
12. Exportar cópia: abre a folha de partilha; guardar em Ficheiros/Drive/e-mail; abrir o ficheiro e confirmar `format`, `schema_version` e ausência de idioma/tema. Testar sem apps de destino e em modo avião (guardar localmente).
13. Restaurar colando o JSON: “Verificar cópia” mostra data e contagens e as contagens atuais; “Voltar” no alerta não altera nada; confirmar substitui tudo; agenda, histórico e matérias atualizam sem reiniciar.
14. Restaurar escolhendo o ficheiro exportado (Android e iOS); cancelar o seletor não muda nada.
15. Restaurar texto truncado, JSON de outra app, cópia com `schema_version` maior e cópia com uma data inválida: mensagem clara e nenhum dado alterado.
16. Cópia grande (milhares de aulas): medir tempo e memória da exportação, colagem e restauro; matar a app durante o restauro e confirmar que reabre com os dados antigos ou os novos, nunca uma mistura.
17. “Apagar todos os meus dados”: “Voltar” em qualquer dos dois alertas não apaga; confirmar apaga matérias e aulas, mantém idioma e tema e a app continua utilizável.

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
