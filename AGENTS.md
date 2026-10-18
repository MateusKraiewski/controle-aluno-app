# Aula em Dia — app móvel

Leia `docs/offline-first.md` antes de alterar persistência, histórico ou rede. A aplicação é offline-first: o SQLite local é a fonte de verdade e nenhuma ação principal depende de internet.

## Limites de arquitetura

- Interface em `App.tsx`; modelos e acesso a dados por funcionalidade em `src/features/`; inicialização e migrações SQLite em `src/db/`.
- Não executar SQL na interface. Usar repositórios e parâmetros ligados; não concatenar valores de utilizador em SQL.
- Usar APIs assíncronas do expo-sqlite, transações curtas, consultas limitadas e índices baseados nos filtros reais.
- Não apagar o histórico automaticamente. Não guardar imagens/PDFs como BLOB/base64.
- Não declarar a presença/falta do professor pelo aluno como fato confirmado; o estado atual é um registo do próprio aluno.
- Antes de alterar SQLite, ler a skill instalada `node_modules/expo-sqlite/skills/expo-sqlite/SKILL.md` e atualizar migrações sem apagar dados.
- Diferenciar claramente funcionalidades já executáveis de propostas de nuvem/professor.

## Comandos

- `npm start` — pré-visualização Expo
- `npm run typecheck` — validação TypeScript
- `npx expo-doctor` — compatibilidade do projeto e módulos nativos
- `npx expo export --platform android --platform ios` — validar bundle JS para os dois destinos

Este projeto foi separado da aplicação web. Não mover ou misturar o banco PostgreSQL/web. O esquema local evolui por `PRAGMA user_version` e migrações aditivas.
