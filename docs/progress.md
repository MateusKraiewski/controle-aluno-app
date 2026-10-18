# Progresso de entrega — Aula em Dia Mobile

Atualizado em 18/10/2026. O percentual mede o avanço dos marcos planeados, com pesos de escopo. Não significa que exista uma aplicação instalada ou pronta para distribuição.

**Progresso ponderado: 36%** (valor calculado 36,25%, arredondado ao inteiro mais próximo).

[██████████](#product-and-offline-architecture-10) [█████████████████░░░░░░░░](#local-storage-and-repositories-25) [█████████░░░░░░░░░░░░░░░░░░░░░░░░░](#student-app-35) [░░░░░░░░░░░░░░░░░░](#on-device-quality-20) [░░░░░░░░░░](#installation-and-cloud-10)

| Etapa | Peso | Conclusão | Contribuição |
|---|---:|---:|---:|
| Product and offline architecture | 10% | 100% | 10 p.p. |
| Local storage and repositories | 25% | 70% | 17,5 p.p. |
| Student app | 35% | 25% | 8,75 p.p. |
| On-device quality | 20% | 0% | 0 p.p. |
| Installation and cloud | 10% | 0% | 0 p.p. |
| **Total** | **100%** |  | **36,25% → 36%** |

## Product and offline architecture (10%)

**Concluído.** A estratégia offline-first, limites de memória e retenção, privacidade e fases de roadmap estão em docs/offline-first.md e docs/roadmap-mobile.md.

## Local storage and repositories (25%)

**Parcial (70%).** SQLite é a fonte local, há migrações, índices, WAL e repositório com leitura paginada; não há telemetria nem chamadas obrigatórias à rede.

**Falta:** validar recuperação e migrações em dispositivos reais, cópia de segurança/exportação e proteção de dados local.

## Student app (35%)

**Parcial (25%).** A primeira tela permite criar aulas e registar a própria presença; há calendário curto, tema e idiomas.

**Falta:** editar/excluir aulas, matérias, recorrência completa, registos detalhados de aula, histórico navegável e exportação. A paginação do repositório ainda não equivale a uma tela de histórico.

## On-device quality (20%)

**Por iniciar.** As verificações estáticas e os bundles JS não substituem ensaios funcionais em Android e iPhone.

**Falta:** testar em dispositivos reais, acessibilidade, desempenho e consumo de memória após uso prolongado, recuperação de falhas e migração de dados.

## Installation and cloud (10%)

**Por iniciar.** Há configuração de EAS para builds de pré-visualização, mas nenhum APK/IPA de distribuição verificado. A sincronização cloud é opcional e fica para uma fase futura.

**Falta:** gerar e validar instalações Android/iOS e definir assinatura/distribuição; avaliar sincronização só depois de consolidar o modo offline.

## Como atualizar

Recalcular a soma ponderada ao fechar critérios observáveis. Distinguir sempre bundle de desenvolvimento, binário instalável, ensaio em dispositivo e publicação.
