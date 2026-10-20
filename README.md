# Aula em Dia — app móvel

## Progresso de entrega

**Estimativa ponderada: 59%.** A barra é clicável: cada segmento abre a etapa, as evidências e o que falta.

[██████████](docs/progress.md#product-and-offline-architecture-10) [███████████████████████░░](docs/progress.md#local-storage-and-repositories-25) [████████████████████████░░░░░░░░░░░](docs/progress.md#student-app-35) [██░░░░░░░░░░░░░░░░░░](docs/progress.md#on-device-quality-20) [░░░░░░░░░░](docs/progress.md#installation-and-cloud-10)

> Número aproximado e ponderado do escopo, não prontidão de publicação. Cálculo: docs/progress.md.

App Android e iPhone para organizar aulas e o histórico escolar com funcionamento offline. O armazenamento local é a fonte de verdade nesta fase; não há cadastro, telemetria ou sincronização com servidor.

## Requisitos e execução

- Node.js LTS compatível com o Expo SDK do projeto
- Android Studio/emulador ou Expo Go num telemóvel
- Para compilar o binário iOS localmente é necessário macOS; em Windows, use Expo Go para pré-visualizar e um serviço de build quando chegar a hora de distribuir

```sh
npm install
npx expo start
```

Use `a` para abrir num emulador Android, ou leia o QR com Expo Go. A app abre na agenda semanal, com separadores para histórico e matérias; a base SQLite é local ao dispositivo. Limpar os dados/reinstalar a aplicação apaga o histórico; exporte antes uma cópia de segurança em Definições → Os seus dados.

## Produto e decisões

- [Estratégia offline, memória e evolução para nuvem](docs/offline-first.md)
- [Roadmap aluno/professor](docs/roadmap-mobile.md)
- [Checklist QA móvel](docs/qa-mobile.md)
- Continuação da visão aluno/professor: [produto original](https://github.com/MateusKraiewski/controle-aluno/blob/main/PRODUCT.md)

## Estado atual (Fase 1 em curso)

Implementado no código e coberto por TypeScript, testes automáticos em Node e bundle Android/iOS — **ainda não executado num aparelho ou emulador**:

- Agenda semanal (segunda a domingo) com navegação semana anterior/seguinte e “Hoje”; consulta limitada a 100 aulas por semana.
- Criar e editar aula: matéria, professor opcional, data, hora, duração, conteúdo planeado e, na edição, conteúdo realmente estudado (separado do plano).
- Presença registada pelo próprio aluno (Fui/Faltei/Pendente) no cartão e no editor.
- Cancelar aula como estado distinto de falta (motivo opcional; aula cancelada não aceita presença) e reativar.
- Excluir aula com confirmação explícita; numa repetição, escolher “só esta” ou “esta e as seguintes”.
- Repetição semanal ou quinzenal na criação: dias da semana + data final (até 1 ano, máximo 300 aulas), gravada numa única transação e ligada a `lesson_series`.
- Aviso de sobreposição no mesmo dia antes de guardar, com opção de guardar mesmo assim.
- Histórico (aulas até hoje) com paginação por cursor, “Carregar mais”, filtro por matéria e pesquisa local que ignora acentos e maiúsculas (“FISICA” encontra “Física”).
- Matérias: renomear (nome único sem diferenciar maiúsculas) e arquivar/reativar sem apagar aulas.
- Português do Brasil/Portugal, inglês, espanhol e tema sistema/claro/escuro, guardados localmente.
- Definições → Os seus dados: exportar cópia de segurança JSON versionada pela folha de partilha do sistema; restaurar a partir de JSON colado ou ficheiro escolhido, com validação estrita, pré-visualização de contagens, confirmação e substituição total numa única transação (ou nada muda); apagar todos os dados com confirmação em dois passos.
- SQLite com esquema v3 (migrações aditivas v1→v2→v3 testadas, incluindo backfill das colunas de pesquisa), transações, WAL, índices e limites de consulta.

Ainda não implementado: editar todas as ocorrências de uma série ou mudar a regra, feriados/exceções automáticas, calendário mensal, cor/ordem de matérias, apontamentos privados e tarefas, filtro por período, cifra local e cópia de segurança automática. Detalhes em `docs/offline-first.md` e `docs/progress.md`.

## Testes

```sh
npm run typecheck   # app + ficheiros de teste
npm test            # node --test: domínio, pesquisa, migrações, repositórios e cópia de segurança em node:sqlite
npx expo-doctor
npx expo export --platform android --platform ios --output-dir <pasta-temporária>
```

O app não sincroniza dados nem permite confirmação independente do professor. A lista completa de limites e decisões está em `docs/offline-first.md`.

## Instalação de teste

O perfil `preview` em `eas.json` está preparado para gerar APK Android e distribuição interna iOS. O build remoto ainda exige configurar o projeto/conta Expo; no iOS, instalar fora da App Store por distribuição Ad Hoc requer conta Apple Developer paga e registo do UDID dos dispositivos de teste. Consulte [QA móvel](docs/qa-mobile.md) antes de tratar os artefactos como releases.
