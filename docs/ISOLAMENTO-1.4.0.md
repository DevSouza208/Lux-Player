# Auditoria de isolamento — 1.4.0

## Resultado

A separação funcional por conta e perfil passou nos testes de leitura, favoritos, progresso de filmes/séries e saves de jogos. Isso **não equivale a isolamento seguro contra acesso malicioso**: a autenticação legada possui uma exposição crítica ainda não corrigida.

## Exposição encontrada

A inspeção do banco vinculado em 10/09/2026 encontrou RLS desabilitado em `usuarios` e `games`. Os papéis anon e authenticated possuem permissões amplas, incluindo SELECT, INSERT, UPDATE e DELETE. O frontend consulta usuarios diretamente antes de validar o login.

Isso permite exposição de credenciais e alterações indevidas de usuários ou do catálogo pela API pública. As novas funções validam conta, senha, cargo e perfil no servidor, mas dependem dessas credenciais legadas; essa vulnerabilidade limita sua proteção efetiva.

As permissões não foram revogadas nesta atualização porque login e administração das versões existentes dependem delas. É necessária migração coordenada antes de fechar esse acesso. A auditoria não precisou consultar senhas ou conteúdo real de usuários.

## Separação verificada

| Dados | Identidade |
| --- | --- |
| Leitura local | Conta + identidade interna do perfil + hash da obra |
| Leitura no servidor | user_name + profile_key + book_id + record_key |
| Favoritos e progresso de mídia | Conta + namespace do perfil |
| Saves de jogos | Conta + perfil + jogo + slot |

Ana na conta Reginaldo e Ana em outra conta têm chaves distintas. Os testes incluem troca de perfil, resposta atrasada de outra conta e recriação no mesmo slot. O catálogo de jogos é compartilhado por intenção; saves são individuais.

RLS está habilitado em account_profiles, user_progress, user_game_saves, reading_records e reading_catalog. As tabelas novas de leitura não permitem acesso direto de anon/authenticated; as funções usam service_role. Isso não elimina a exposição do login.

## Correções realizadas

- Validação de perfil e cargo no backend de leitura; perfil infantil não administra catálogo.
- Removida a inferência de administrador pelo nome de usuário no frontend; exige cargo admin.
- Atualização atômica do progresso de mídia por timestamp para evitar sobrescrita concorrente antiga.
- Revisões por registro de leitura, recuperação de conflitos de texto e fila local.
- Troca de conta/perfil interrompe upload administrativo e fecha leitura; respostas atrasadas não restauram estado na conta seguinte.
- Endpoint de estado aceita somente campos limitados de texto/preferências, nunca arquivos PDF ou similares.

## Próxima migração necessária

Substituir consulta pública de credenciais por autenticação no servidor ou Supabase Auth; migrar administração para endpoints autorizados; atualizar clientes; revogar grants públicos de usuarios/games e aplicar RLS; rotacionar credenciais potencialmente expostas. Validar conjuntamente login, administração, mídia, jogos e leitura antes da liberação.

O bucket R2 atual é público: pendências ficam ocultas no catálogo, mas uma URL conhecida permite download. Restrição real requer armazenamento privado ou entrega autorizada.

Evidências: scripts/check-isolation.sql, scripts/check-reading-backend.sql, testes de perfis, saves e reading-cloud, e scripts/test-reading-live.cjs. Resultado final: 53 testes unitários aprovados, além de Electron e integração real com dados temporários.
