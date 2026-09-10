# Lux Play

## 1.4.0 — Leitura

Biblioteca e leitor de PDF, EPUB, CBR/CBZ e pastas JPG/PNG, com retomada de leitura, notas e dicionário. Consulte [recursos, limites e testes](docs/LEITURA-1.4.0.md).

O admin prepara coleções a partir de pastas e ZIP/RAR baixados do Drive, gera revistas CBZ e capas automaticamente, permite revisar metadados e envia o lote ao R2 para aprovação.

Aplicativo Electron com painel em abas: clientes, jogos, livros e VODs/R2.

## VODs no Cloudflare R2

A função `r2-upload-url` gera URLs assinadas de PUT para o bucket `luxvod`.
O formulário usa o Supabase e envia o vídeo diretamente ao R2. As credenciais
Cloudflare ficam somente nos secrets da Edge Function. A URL pública retornada
é salva no catálogo local existente; o botão Sincronizar a adiciona ao player.

Projeto Supabase: `fvcvshppvxihhttwyyvr`.
Domínio público: `https://pub-e7c51b64f286481c8772a8f345759fd9.r2.dev`.

Consulte [configuração e validação](supabase/README.md#upload-de-vods-para-cloudflare-r2)
e a [política CORS](supabase/r2-cors.json).

O upload exige `cargo=admin` na tabela `usuarios`. O catálogo continua local;
esta atualização não cria sincronização compartilhada de VODs no banco.

## Desenvolvimento

```powershell
npm install
npm start
node --check js/script.js
node --check electron/main.js
node --check electron/preload.js
node --check supabase/functions/r2-upload-url/index.ts
node --test tests/r2-upload.test.cjs
```

Os testes de lógica usam mocks para Supabase/R2. Um upload completo exige
secrets S3, CORS e acesso público configurados na conta Cloudflare.
