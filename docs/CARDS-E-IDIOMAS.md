# Cards de jogos e idiomas

O card e os detalhes de cada jogo exibem o máximo de jogadores. O selo Co-op aparece apenas quando o administrador marca explicitamente o modo cooperativo. Jogos antigos começam com cooperação não informada. O campo descreve o jogo; não habilita multiplayer ou jogo em rede no emulador.

O editor restaura os valores ao abrir um jogo, limpa-os no próximo cadastro e rejeita cooperação com apenas um jogador. Importações de várias ROMs continuam pendentes com os valores padrão, para revisão individual.

Migração aditiva do banco: `supabase/game_features_schema.sql`. Não modifica dados de jogos existentes.

O leitor não oferece tradução de EPUB e não exibe mais o selo Aa. A coluna legada `translation_available` permanece no banco para compatibilidade; novos metadados não ativam esse recurso.

As bandeiras são SVGs locais em `js/flags`, representando o idioma, não a nacionalidade do autor. Português, inglês, espanhol, francês e alemão têm bandeiras; `pt-PT` e `en-US` preservam a região. Idiomas desconhecidos usam um globo, sem inventar uma identificação.

EPUBs importados localmente têm o idioma declarado lido antes da primeira abertura. O importador administrativo também preserva esse metadado. Obras sem idioma declarado podem ser identificadas pelo texto ao abrir ou revisadas no campo “Idioma da obra” do administrador. Obras antigas sem idioma não são baixadas automaticamente só para identificar a bandeira.

Validação: `npm test`, `npm run test:reader` e `node scripts/test-game-admin-electron.cjs`. Os testes Electron usam arquivos sintéticos e não alteram contas ou catálogos remotos.
