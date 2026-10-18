# Aula em Dia — app móvel

## Progresso de entrega

**Estimativa ponderada: 36%.** A barra é clicável: cada segmento abre a etapa, as evidências e o que falta.

[██████████](docs/progress.md#product-and-offline-architecture-10) [█████████████████░░░░░░░░](docs/progress.md#local-storage-and-repositories-25) [█████████░░░░░░░░░░░░░░░░░░░░░░░░░](docs/progress.md#student-app-35) [░░░░░░░░░░░░░░░░░░](docs/progress.md#on-device-quality-20) [░░░░░░░░░░](docs/progress.md#installation-and-cloud-10)

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

Use `a` para abrir num emulador Android, ou leia o QR com Expo Go. O primeiro ecrã permite criar aulas e registar a própria presença; a base SQLite é local ao dispositivo. Limpar os dados/reinstalar a aplicação pode apagar o histórico se não houver uma cópia de segurança do dispositivo.

## Produto e decisões

- [Estratégia offline, memória e evolução para nuvem](docs/offline-first.md)
- [Roadmap aluno/professor](docs/roadmap-mobile.md)
- [Checklist QA móvel](docs/qa-mobile.md)
- Continuação da visão aluno/professor: [produto original](https://github.com/MateusKraiewski/controle-aluno/blob/main/PRODUCT.md)

## Estado do primeiro incremento

- Agenda local de sete dias, com várias matérias e aulas no mesmo dia.
- Criação de aula com matéria, professor opcional, data, hora, duração e conteúdo planeado.
- Marcação do estado de presença pelo aluno.
- Português do Brasil/Portugal, inglês, espanhol e tema sistema/claro/escuro, guardados localmente.
- SQLite com migração de esquema, transações, WAL, índices de agenda e limites de consulta.
- Histórico preparado no repositório com paginação por data; o ecrã de histórico e edição ainda fazem parte dos próximos incrementos.

O app não sincroniza dados nem permite confirmação independente do professor. A lista completa de limites e decisões está em `docs/offline-first.md`.

## Instalação de teste

O perfil `preview` em `eas.json` está preparado para gerar APK Android e distribuição interna iOS. O build remoto ainda exige configurar o projeto/conta Expo; no iOS, instalar fora da App Store por distribuição Ad Hoc requer conta Apple Developer paga e registo do UDID dos dispositivos de teste. Consulte [QA móvel](docs/qa-mobile.md) antes de tratar os artefactos como releases.
