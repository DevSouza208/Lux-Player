# Configuração do catálogo de jogos

## Progresso entre dispositivos

Para ativar favoritos e “continuar assistindo” sincronizados, execute também
`progress_schema.sql` no SQL Editor e publique a função abaixo sem validação
JWT (ela valida o login atual do Lux Play no próprio servidor):

```bash
supabase functions deploy progress-sync --no-verify-jwt
```

O app continua funcionando offline: a cópia local é sempre usada primeiro e a
sincronização acontece em segundo plano no login e após alterações.

## Saves de jogos entre dispositivos

Execute `game_saves_schema.sql` no SQL Editor. Ele cria a tabela de metadados
e o bucket privado `game-saves`. Depois publique a função:

```bash
supabase functions deploy game-save-sync --no-verify-jwt
```

Ao fechar o jogo, escolha um dos três slots no diálogo do Lux Play. O app
salva primeiro no IndexedDB, separado por usuário, e aguarda o envio à nuvem.
Em caso de falha, mantém o save e informa que o envio está pendente. A fila
persiste ao fechar o app e tenta novamente no login, ao reconectar ou abrir um jogo.
O limite por save é 6 MB; saves maiores continuam somente neste dispositivo.
Os saves da barra nativa do emulador não passam por este fluxo: use os slots do Lux Play.

No outro dispositivo, entre na mesma conta, abra o jogo e escolha Continuar.
A data da listagem da nuvem é separada da data do arquivo local para permitir
baixar saves em dispositivos novos. O arquivo local mais recente é preservado.
Saves locais da implementação antiga não tinham identificação do usuário e
não são atribuídos automaticamente a uma conta; saves já enviados à nuvem
continuam acessíveis pela mesma chave de jogo.

A função usa o bucket privado game-saves e a tabela user_game_saves.
Execute novamente game_saves_schema.sql para instalar commit_game_save:
a troca da referência ao arquivo é atômica e só aceita um save mais recente.
Cada envio usa um objeto exclusivo; versões anteriores ficam no bucket,
permitindo manutenção posterior sem arriscar o save atual durante o envio.
Somente service_role pode executar a função SQL e acessar a tabela.

Validação: `node --test tests/game-saves.test.cjs`.

1. Execute `games_schema.sql` no **SQL Editor** do projeto Supabase.
2. No bucket `games`, habilite acesso de leitura compatível com o EmulatorJS. Para produção, prefira URLs assinadas emitidas por uma Edge Function; não libere escrita anônima.
3. Crie um aplicativo em <https://dev.twitch.tv/console/apps> e habilite o acesso à API IGDB.
4. Defina os segredos e publique a função:

```bash
supabase secrets set IGDB_CLIENT_ID=seu_client_id IGDB_CLIENT_SECRET=seu_client_secret
supabase functions deploy game-metadata
```

A busca de metadados é opcional: o formulário continua aceitando preenchimento manual quando a função não estiver configurada.

### Status compartilhado dos cores

Execute `core_statuses_schema.sql` no SQL Editor e publique a função:

```bash
supabase functions deploy core-statuses --no-verify-jwt
```

O painel Admin → Jogos salva os status dos cores para todos os dispositivos. A listagem pública carrega essa configuração no PC e no celular.

### Avaliações públicas dos jogos

Execute `game_ratings_schema.sql` no SQL Editor e publique a função:

```bash
supabase functions deploy game-ratings --no-verify-jwt
```

Cada conta/perfil possui uma única avaliação por jogo. Ao alterar as estrelas, a nota anterior é substituída e a média pública é recalculada.

# Upload de VODs para Cloudflare R2

Projeto Supabase: `fvcvshppvxihhttwyyvr` (Lux Player).
Bucket: `luxvod`.
Conta: `0573de45e60dd5d872067d619ce8d630`.
Domínio público: `https://pub-e7c51b64f286481c8772a8f345759fd9.r2.dev`.

### Secrets do servidor

No Supabase → Edge Functions → Secrets, configure:

- R2_ACCOUNT_ID: ID da conta acima.
- R2_BUCKET: luxvod.
- R2_PUBLIC_DOMAIN: domínio público acima.
- R2_ACCESS_KEY_ID: Access Key ID das credenciais S3 do Cloudflare.
- R2_SECRET_ACCESS_KEY: Secret Access Key das credenciais S3 do Cloudflare.

As três primeiras configurações foram cadastradas durante esta integração.
As duas chaves S3 ainda precisam ser cadastradas pelo responsável pela conta.
Use credenciais com permissão de leitura/escrita de objetos apenas em luxvod.
O URI do R2 Data Catalog não é utilizado para envio de vídeos.
O endpoint r2.cloudflarestorage.com é da API S3, não de reprodução pública.

Alternativamente, copie `.env.example` para `.env.local` nesta pasta,
preencha os valores e execute na raiz do projeto:

```powershell
supabase secrets set --env-file supabase/.env.local --project-ref fvcvshppvxihhttwyyvr
supabase functions deploy r2-upload-url --project-ref fvcvshppvxihhttwyyvr --no-verify-jwt --use-api
```

O arquivo local de secrets está ignorado pelo Git e fora do pacote Electron.
A chave publishable em js/script.js é pública. Credenciais R2 e service_role
permanecem somente no servidor. Não coloque chaves no HTML, JavaScript ou IPC.

### Autorização

O app usa login próprio na tabela usuarios, sem sessão Supabase Auth.
A função recebe username/password por HTTPS, valida ambos no servidor e exige
cargo=admin no registro. O campo role enviado pelo cliente ou nomes contendo
“admin” não concedem upload. Configure cargo=admin para administradores reais.
verify_jwt=false desliga a validação JWT do gateway; a autenticação continua
obrigatória dentro da função.

A autenticação legada consulta usuários/senhas pelo cliente. Para proteção
integral das contas, ela precisa ser migrada para Supabase Auth e as políticas
da tabela usuarios precisam impedir leitura de senhas e alteração anônima de
cargo/senha. Esta integração não migra os demais fluxos de login/admin.

### CORS do bucket

No Cloudflare → R2 → luxvod → Settings → CORS policy, aplique `r2-cors.json`.
AllowedOrigins=* atende também à origem opaca (null) do Electron via file://.
Nenhum cookie é enviado no PUT. A assinatura continua obrigatória para escrita.
Não desative webSecurity ou contextIsolation no Electron.

### Fluxo

O formulário chama supabaseClient.functions.invoke('r2-upload-url') com
fileName, contentType, bucket=luxvod, prefix e credenciais do login.
A resposta contém uploadUrl, publicUrl e objectKey. A assinatura dura 15 minutos.
Cada tentativa usa uma chave UUID. O arquivo vai direto ao R2 via PUT com o
mesmo Content-Type, sem atravessar o Supabase e sem ACL public-read.

Depois do PUT, o app salva uma cópia pendente local e publica o registro no
catálogo compartilhado. O arquivo continua no R2. Se a publicação falhar,
use **Publicar pendentes e atualizar** para tentar novamente sem reenviar o vídeo.
Esse botão também migra os cadastros da versão antiga; publicações repetidas
atualizam a mesma URL, sem duplicar o registro.

### Catálogo compartilhado para todos os usuários

Execute `vod_catalog_schema.sql` no SQL Editor e publique:

```powershell
supabase functions deploy vod-catalog --project-ref fvcvshppvxihhttwyyvr --no-verify-jwt --use-api
```

A tabela vod_catalog tem RLS ativo e nenhum acesso direto para anon/authenticated.
A função valida o login em usuarios: contas válidas podem listar; apenas cargo=admin
pode publicar ou remover. Contas vencidas não podem acessar a função.
Os vídeos são carregados no login e em Atualizar dados, mesmo sem playlist própria.
Recarregar a playlist preserva o catálogo compartilhado. A categoria mantém o filtro adulto.
Remover exclui a entrada compartilhada para todos, mas mantém o arquivo no R2.
Usuários de versões anteriores precisam atualizar o aplicativo para receber este catálogo.

### Validação

```powershell
node --check js/script.js
node --check electron/main.js
node --check electron/preload.js
node --check supabase/functions/r2-upload-url/index.ts
node --test tests/r2-upload.test.cjs
```

Node 24 valida a sintaxe TypeScript, mas não substitui o runtime Deno.
Os seis testes usam mocks; o deploy também valida o empacotamento no Supabase.
No endpoint publicado, OPTIONS retornou 204 com CORS e POST sem login retornou
401. O upload completo ainda depende das credenciais S3 e CORS do bucket.
Após configurá-los, envie um MP4 pequeno como admin, abra a URL e sincronize
no player. Uma conta sem cargo admin deve receber 403.

Referências oficiais: [URLs assinadas](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[CORS do R2](https://developers.cloudflare.com/r2/buckets/cors/) e
[configuração de Edge Functions](https://supabase.com/docs/guides/functions/function-configuration).

### Escolha entre save local e nuvem

Ao continuar um slot, o app compara o conteúdo dos saves. Se forem iguais,
não pergunta. Se houver versões diferentes, apresenta as datas e as opções
Usar deste dispositivo / Usar da nuvem. Cancelar mantém ambos sem alteração.
A escolha local cria uma nova versão para sincronizar; a escolha da nuvem
atualiza a cópia local. Sem internet, o save local continua disponível.

Envios pendentes guardam a versão da nuvem de onde partiram. Se outro dispositivo
alterar esse save, o envio fica pendente até a escolha do usuário. A função SQL
commit_game_save_checked confere a versão novamente ao gravar, protegendo contra
alterações feitas por outro dispositivo durante a consulta ou a escolha.
Reaplique game_saves_schema.sql e publique game-save-sync ao atualizar o servidor.

### Isolamento local de favoritos e histórico

Favoritos de mídia/jogos e progresso de filmes/séries usam chaves locais com
prefixo por usuário. As chaves de sincronização no servidor permanecem compatíveis.
Na primeira abertura, o app reconstrói a cópia local a partir dos registros de
sincronização já identificados por conta, mesmo offline. As chaves compartilhadas
antigas são preservadas, mas não são importadas automaticamente: não identificam
o dono e poderiam misturar contas.

Filmes registram a posição e agendam envio a cada atualização de aproximadamente
5 segundos de reprodução. Séries mantêm o episódio/temporada e a posição.
Mudanças pendentes ficam locais e são reenviadas no login, ao voltar a conexão ou
na próxima alteração. Envios são divididos em lotes de até 400 registros.
Respostas de uma sessão anterior são descartadas; alterações feitas enquanto
uma consulta está em andamento são preservadas.

Validação: `node --test tests/progress-sync.test.cjs`.

### Perfis por conta

Execute profiles_schema.sql e publique profiles, progress-sync e game-save-sync.
A tabela account_profiles é privada; o limite de quatro perfis é aplicado sob
bloqueio transacional por conta. Perfis existentes mantêm suas chaves de dados.
Novos perfis recebem um identificador único, evitando herdar favoritos, histórico
ou saves de um perfil excluído que ocupava a mesma posição.

O login abre Quem está assistindo após carregar os perfis. O ícone ao lado do nome
abre o mesmo painel, com criação, edição e Sair da conta. Fotos podem ser escolhidas
na criação ou edição: JPG, PNG e WebP de até 8 MB, recortadas ao centro e reduzidas
para 256 × 256 antes de sincronizar. Sem foto, o avatar usa a inicial do nome.

Criar, editar e excluir exige a senha de login. Pedir senha ao entrar em um perfil
é opcional e fica desligado por padrão; ative nos perfis adultos para restringir
sua abertura pelas crianças. Excluir exige confirmação e preserva pelo menos um
perfil na conta. A exclusão remove os registros de progresso e saves do perfil;
arquivos antigos de saves permanecem privados no storage, sem vínculo ativo.
Ao criar, o formulário fecha e a lista de perfis é atualizada automaticamente.

Perfis infantis filtram conteúdo identificado como adulto por flags, categoria,
nome, gêneros ou classificação disponível. Isso depende da identificação enviada
pelo catálogo e não equivale a uma classificação etária completa de cada obra.
A troca encerra players e reinicia a seleção de conteúdo.

Favoritos, progresso, saves e ordem das categorias são sincronizados por perfil.
Buscas recentes ficam separadas localmente. As funções validam conta, posição e
identificador do perfil antes de acessar dados. Distribua o app atualizado para
habilitar fotos, exclusão e acesso aos novos perfis.
