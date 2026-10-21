# Aula em Dia — app móvel

Leia `docs/offline-first.md` antes de alterar persistência, histórico ou rede. A aplicação é offline-first: o SQLite local é a fonte de verdade e nenhuma ação principal depende de internet.

## Limites de arquitetura

- `App.tsx` só monta o `SQLiteProvider`, preferências, tema e separadores. Ecrãs em `src/screens/`, componentes em `src/components/`, tema em `src/theme/`; modelos, regras puras (`domain.ts`, sem React/Expo) e repositórios por funcionalidade em `src/features/`; inicialização e migrações SQLite em `src/db/` (`migrations.ts` sem imports do Expo para poder ser testado).
- Todo texto visível vai para `src/lib/locales.ts` nas quatro línguas (pt-BR, pt-PT, en, es); o tipo `Translations` falha a compilação se faltar uma chave.
- Não executar SQL na interface. Usar repositórios e parâmetros ligados; não concatenar valores de utilizador em SQL.
- Usar APIs assíncronas do expo-sqlite, transações curtas, consultas limitadas e índices baseados nos filtros reais.
- Não apagar o histórico automaticamente. Não guardar imagens/PDFs como BLOB/base64: anexos são ficheiros em `lesson-attachments/` com nome UUID e só metadados no SQLite; qualquer remoção passa pela fila `attachment_trash` (`src/features/attachments/`).
- Não declarar a presença/falta do professor pelo aluno como fato confirmado; o estado atual é um registo do próprio aluno.
- Antes de alterar SQLite, ler a skill instalada `node_modules/expo-sqlite/skills/expo-sqlite/SKILL.md` e atualizar migrações sem apagar dados.
- Diferenciar claramente funcionalidades já executáveis de propostas de nuvem/professor.

## Comandos

- `npm start` — pré-visualização Expo
- `npm run typecheck` — validação TypeScript (app e, com `tsconfig.test.json`, ficheiros de teste)
- `npm test` — `node --test` (Node 24, sem dependências extra) para `src/**/*.test.ts`: domínio, migrações e repositórios sobre `node:sqlite` através de `src/testing/nodeSqlite.ts` (o código de ficheiros/seletor/partilha em `files.ts` não é testável aqui)
- `npx expo-doctor` — compatibilidade do projeto e módulos nativos
- `npx expo export --platform android --platform ios` — validar bundle JS para os dois destinos

Este projeto foi separado da aplicação web. Não mover ou misturar o banco PostgreSQL/web. O esquema local evolui por `PRAGMA user_version` e migrações aditivas.
