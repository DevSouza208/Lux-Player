# Lux Player 0 — Cloudflare (branch lux-player-0)

A branch main e o Original publicado na Vercel continuam independentes.

Esta é a base da migração. O HTML/CSS/JS original foi preservado, e a API nova usa
Pages Functions com D1 e R2 por bindings. Nenhuma Edge Function do Supabase foi
apagada. Nao considerar a migracao concluida enquanto os modulos legados
continuarem usando Supabase.

## Criar o preview Cloudflare Pages

1. Workers & Pages > Create > Pages > Connect to Git.
2. Repositorio: DevSouza208/Lux-Player. Para previa, escolha a branch de
   producao lux-player-0 em um NOVO projeto Pages, separado do Original.
3. Framework preset: None; build command: vazio; output directory: .
   (a raiz contem index.html, assets e functions/).
4. Settings > Bindings: adicione o D1 existente no binding DB.
5. Settings > Bindings: associe o bucket R2 existente no binding MEDIA_BUCKET.
6. Redeploy para propagar bindings. Sem IDs de D1/bucket em repositorio.
7. Instale a migracao no D1 criado (e somente nele):
   npx wrangler d1 execute NOME_DO_SEU_D1 --remote --file=./migrations/0001_lux_cloudflare.sql
8. Teste /api/health: deve aparecer d1Bound:true, r2Bound:true.
   /api/catalog responde lista vazia ate cadastrar os itens publicos.

GET /api/assets/public/... e o unico espaco R2 exposto em leitura;
saves, listas e ROMs privadas nao ficam publicos. D1 expoe apenas itens
published = 1 sem credenciais de IPTV.

## Estado da migracao

- Base do Original: mantida intacta em main; branch isolada.
- Cloudflare API: health, catalogo publico read-only, objetos public/ do R2.
- D1: esquema inicial; nao migramos dados do Supabase.
- Auth: adiada; novos endpoints nao aceitam escrita anonima.
- Streaming: ainda sera validado em Electron e navegador. Cloudflare Pages
  HTTPS nao reproduz automaticamente canais HTTP via mixed content. D1 e R2
  nao sao transcodificadores FFmpeg. Nao armazenar playlists privadas em
  D1 publico nem em Git.
- Login antigo e Edge Functions: modulos do Original ainda precisam ser
  migrados gradualmente, com testes, antes de excluir o Supabase.

## Desenvolvimento

npm test executa os testes existentes. Testes especificos:
node --test tests/cloudflare-baseline.test.cjs
Para desenvolvimento local de Pages com bindings:
npx wrangler pages dev . --d1=DB --r2=MEDIA_BUCKET
