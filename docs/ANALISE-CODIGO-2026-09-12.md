# Análise do Lux Play — 12/09/2026

O projeto tem funcionalidades bem desenvolvidas, especialmente persistência e sincronização de leitura e saves. A prioridade técnica é corrigir a autenticação legada e o tratamento de conteúdo externo antes de ampliar funcionalidades.

## Escopo e limites

Revisão ampla da estrutura, configuração, login, administração, player, perfis, jogos, controles, leitor, sincronização e schemas SQL. Os caminhos de maior risco receberam leitura detalhada; os demais receberam inspeção direcionada e verificações automáticas. Isto não equivale a uma auditoria exaustiva de cada linha.

Bibliotecas de terceiros, bundles gerados e instaladores não foram auditados internamente. Não consultei registros de clientes, permissões efetivas do banco de produção, secrets ou serviços IPTV. Não executei auditoria de vulnerabilidades de dependências nem testes de carga. Os problemas dependentes de produção estão identificados abaixo. Nenhum código da aplicação foi alterado nesta revisão.

## Validação executada

- `npm test`: 69 testes passaram; nenhuma falha.
- `npm run test:reader`: PASS no Electron, com arquivos sintéticos e perfil isolado. Cobriu PDF, EPUB, CBR, CBZ, imagens, retomada, notas, isolamento de scripts EPUB, importação e administração de leitura.
- `node scripts/test-game-admin-electron.cjs`: PASS no Electron, com backend simulado e sem gravações remotas.
- Sintaxe: 55 arquivos JavaScript/CJS verificados com Node; 13 arquivos TypeScript analisados com o parser do esbuild. Isso não representa verificação de tipos ou execução no Deno. A tentativa inicial de usar `node --check` para todos os TS encontrou uma limitação de interpretação em dois arquivos; ambos passaram no parser TypeScript.
- Duas reproduções em memória confirmaram o problema de jogador e a concorrência de downloads descritos abaixo.

Os testes existentes usam simulações em vários pontos. Seu sucesso não comprova as permissões reais do Supabase nem cobre os problemas novos identificados.

## Achados por prioridade

### 1. Crítica — Login depende de baixar os usuários e suas senhas

Referências: `js/script.js:1213`, `js/script.js:1228`, `js/script.js:1318`.

`fetchUsersFromSupabase()` executa `usuarios.select('*')` antes de autenticar. O navegador transforma as linhas em contas e compara usuário/senha com `users.find(...)`. A resposta inclui campos como senha, credenciais IPTV e PIN adulto.

Se o login funciona com esse fluxo, o cliente recebe as credenciais das contas retornadas. Restringir essa leitura no banco, sem substituir o login, quebra a autenticação atual. O código da consulta e da comparação está confirmado; a quantidade de registros e as políticas atualmente publicadas não foram verificadas.

Correção: autenticar no servidor, retornar somente os dados necessários da própria conta e bloquear a leitura pública da tabela. Planejar a migração junto com as permissões para evitar indisponibilidade.

### 2. Alta — Administração usa o mesmo cliente público do login

Referências: `js/script.js:3`, `js/script.js:1565`, `js/script.js:1595`, `js/script.js:1770`, `js/script.js:1889`, `supabase/games_schema.sql`.

Criação/exclusão de usuários e gravação de jogos acessam tabelas diretamente com `supabaseClient`. O login próprio não estabelece uma sessão Supabase Auth. Portanto, o cargo mantido em JavaScript não fornece identidade administrativa às políticas do banco. O schema de jogos também não instala RLS para essa tabela.

Se as permissões públicas permitem essas operações para viabilizar o painel, outros clientes com a mesma chave pública podem realizá-las. Se as proíbem, o painel falha. As permissões de produção precisam ser verificadas para determinar a exposição efetiva.

Correção: mover essas operações para funções que verifiquem a identidade e o cargo no servidor, ou integrar Supabase Auth e políticas RLS correspondentes. Uma chave publicável no frontend é esperada; o problema é a autorização das operações.

### 3. Alta — Senha reutilizável fica persistida no navegador

Referências: `js/script.js:1334`, `js/script.js:521`, `supabase/functions/_shared/reading-auth.ts:8`.

O app grava a senha em `localStorage` e a recupera para login automático. As funções comparam a senha recebida diretamente com `usuarios.senha`; não há hashing nesse fluxo. Uma execução de JavaScript no contexto da aplicação pode ler a senha persistida, incluindo a do administrador.

Correção: substituir a senha persistida por uma sessão revogável e adotar armazenamento de senha com hash apropriado no servidor. Fazer isso em conjunto com a correção do login.

### 4. Alta — Fallback de conexão envia credenciais IPTV a terceiros

Referências: `js/script.js:1054`, `js/script.js:2082`, `js/script.js:3941`.

`smartFetch()` tenta proxies públicos quando a conexão direta falha. As chamadas Xtream incluem `username` e `password` na URL; a URL inteira é encaminhada aos proxies. Codificar com `encodeURIComponent` não oculta essas informações do destinatário.

Impacto: uma falha de CORS ou de rede pode causar compartilhamento automático das credenciais IPTV com operadores externos.

Correção: retirar proxies públicos desse fluxo. Usar um serviço sob controle do projeto, com autenticação, validação de destinos e limites, ou uma integração direta compatível com o provedor.

### 5. Alta — HTML externo é inserido sem escape

Referências: `js/script.js:1531`, `js/script.js:3912`, `js/script.js:3955`.

O painel interpola `u.nome`, `u.usuario` e outros campos em `innerHTML`; o usuário também entra em um `onclick` inline. O EPG insere título e descrição vindos do provedor como HTML. `decodeEpgText()` apenas decodifica Base64: não sanitiza HTML.

Um título EPG contendo uma imagem com manipulador de erro, por exemplo, chega a um ponto de execução de HTML no contexto da aplicação. Isso pode se combinar com a senha persistida. O caminho de dados foi verificado estaticamente; nenhum conteúdo malicioso foi enviado a servidores.

Correção: usar `textContent` para texto e `addEventListener` para ações. Sanitizar somente os campos que precisam aceitar HTML. A proteção já usada no leitor não protege automaticamente o restante da interface.

### 6. Alta — Vencimento não é validado de maneira consistente

Referências: `supabase/functions/profiles/index.ts:15`, `supabase/functions/game-save-sync/index.ts:50`, `supabase/functions/vod-catalog/index.ts:24`, `supabase/functions/game-ratings/index.ts:61`, `supabase/functions/progress-sync/index.ts:35`.

Perfis, saves, VOD e avaliações só tratam datas separadas por `/`. Uma data vencida em ISO, como `2000-01-01`, não entra nessa condição. `progress-sync` nem seleciona o vencimento. A função compartilhada de leitura já aceita os dois formatos, evidenciando a divergência.

Impacto: uma conta vencida pode continuar usando certos endpoints, dependendo do formato da data e da função chamada.

Correção: compartilhar a validação de identidade/vencimento entre os endpoints e definir o comportamento para datas inválidas. Cobrir os dois formatos em cada fluxo relevante.

### 7. Média — Avaliações incompatíveis com o schema de jogos

Referências: `supabase/games_schema.sql:5`, `supabase/game_ratings_schema.sql:2`, `supabase/functions/game-ratings/index.ts:11`.

Uma instalação nova cria `games.id` como UUID. Entretanto, `game_ratings.game_id` é `bigint` e a função só aceita dígitos positivos. A chave estrangeira tem tipos incompatíveis; mesmo corrigindo apenas o SQL, a função rejeitaria um UUID com “Jogo inválido”.

Um banco legado com IDs numéricos pode não apresentar esse problema, mas os arquivos do repositório não descrevem uma instalação nova consistente.

Correção: padronizar o tipo entre tabela, referência, função e cliente; validar a migração em um banco vazio e considerar os dados existentes.

### 8. Média — Downloads concorrentes disputam o mesmo evento

Referência: `electron/main.js:88`.

Cada pedido registra `session.once('will-download', ...)` na mesma sessão. Dois pedidos anteriores ao primeiro evento instalam dois callbacks; ambos recebem o mesmo item. Na reprodução local, um único evento abriu dois diálogos, um com cada nome solicitado. Uma falha anterior ao evento também pode deixar um callback pendente para outro download.

Correção: associar cada item ao pedido correto, controlar concorrência e remover callbacks pendentes em falhas. Validar remetente/frame do IPC, como já ocorre no handler de dicionário.

### 9. Média — Controle conectado como jogador 2 pode comandar jogador 1

Referências: `js/lux-gamepad-host.js:152`, `js/lux-gamepad-host.js:188`.

O host escolhe o jogador pelo campo `packet.player`, sem vinculá-lo ao `peer.player` que estabeleceu a conexão. A reprodução em memória usou um peer do jogador 2 e um pacote declarando jogador 1; `simulateInput` recebeu o índice 0.

Correção: determinar o jogador a partir do peer e validar os demais valores recebidos. Também é necessário liberar botões pressionados ao desconectar para evitar comandos presos.

### 10. Média — Pareamento remoto sobrevive ao logout

Referências: `js/script.js:1360`, `js/lux-gamepad-host.js:285`, `js/lux-gamepad-host.js:428`, `js/lux-remote-host.js:69`, `js/lux-remote-host.js:81`.

O logout limpa a conta e fecha conteúdo, mas não encerra os canais/peers dos controles. O encerramento está vinculado a troca de código e fechamento da página. Trocar de conta sem fechar o aplicativo pode preservar o controle remoto conectado na sessão anterior.

Correção: expor um método de encerramento para os hosts e chamá-lo ao sair da conta; definir explicitamente a política para troca de perfil e renovar o código quando necessário.

## Arquitetura, manutenção e pontos a validar

- `js/script.js` tem 4.717 linhas e mistura login, administração, sincronização e reprodução. Extrair esses domínios reduz o impacto de mudanças; começar pela autenticação evita reproduzir o problema em mais módulos.
- `index.html:11` carrega dependências remotas, incluindo versões `latest`. O lockfile não fixa essas URLs. Empacotar versões definidas melhora a reprodutibilidade e reduz dependência da rede para iniciar.
- Não há CSP geral no HTML/configuração examinados, e o teste Electron registrou esse aviso. O processo principal também não configura bloqueio explícito de navegação e novas janelas. Há `contextIsolation: true` e `nodeIntegration: false`, mas eles não substituem a correção dos pontos de HTML inseguro.
- `supabase/config.toml` não inclui `core-statuses` e `game-ratings`. Verificar se o modo de validação JWT publicado corresponde ao fluxo de autenticação escolhido; não foi consultado o deploy.
- Os hosts WebRTC usam STUN, sem TURN configurado. Validar pareamento em redes restritas e entre Wi-Fi/4G, além da rede local. Os códigos de seis dígitos em canais públicos não oferecem a mesma proteção que uma sessão autenticada; avaliar expiração e confirmação de pareamento.
- O carregamento mobile em `js/ui-motion.js` depende da largura no início. Abrir largo e depois reduzir/girar pode não carregar os módulos. Reproduzir em aparelhos reais e reagir a mudanças de `matchMedia` se essa transição fizer parte do uso esperado.
- `controller/sw.js:12` apaga todos os caches de nomes diferentes do atual na origem, sem filtrar o prefixo do módulo. Restringir a limpeza aos caches do Controller para evitar interferência com outros módulos presentes ou futuros.
- O backend mantém versões antigas dos saves por decisão documentada. Definir retenção e limpeza segura para controlar crescimento do armazenamento, preservando objetos ainda referenciados.
- Arquivos comprimidos de leitura possuem limites e validação de caminhos. A sincronização possui testes de conflitos e troca de conta; esses são pontos positivos que devem ser preservados.

## Sequência sugerida de correção

1. Substituir o login público e proteger operações administrativas no servidor.
2. Remover senhas persistidas, proxies públicos com credenciais e interpolações HTML inseguras.
3. Unificar vencimento e corrigir os tipos de ID das avaliações.
4. Corrigir concorrência de downloads, identidade de jogador e encerramento do pareamento.
5. Adicionar testes para os casos encontrados e verificar permissões reais em ambiente controlado.
6. Modularizar o núcleo e melhorar empacotamento, políticas do Electron e validação mobile.
