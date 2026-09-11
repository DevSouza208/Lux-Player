# Lux Play

**Lux Play** é uma central multimídia feita para reunir **TV ao vivo, filmes, séries, jogos retrô, leitura e controles móveis** em uma única experiência.

A aplicação funciona como **web app**, pode ser distribuída como **PWA** em módulos móveis e também possui versão desktop empacotada com **Electron** para Windows.

> Versão atual: **1.5.0**

---

## Visão geral

O projeto começou como um player para listas IPTV e evoluiu para uma plataforma completa de entretenimento pessoal.

Hoje o Lux Play possui:

- TV ao vivo.
- Filmes e séries.
- Suporte a listas M3U e credenciais Xtream Codes.
- Busca global.
- Favoritos.
- Continuar assistindo.
- Perfis de usuário.
- Catálogo e biblioteca personalizados.
- Jogos retrô no próprio aplicativo.
- Saves locais e sincronização de saves.
- Biblioteca de leitura.
- Upload e administração de conteúdo.
- Controle remoto pelo celular.
- Gamepad pelo celular.
- Aplicativo Windows em Electron.
- Atualização automática do aplicativo desktop.
- Backend e sincronização com Supabase.
- Armazenamento de mídia via Cloudflare R2.

---

# Streaming

## TV ao vivo

O Lux Play possui uma área dedicada para canais ao vivo, com navegação por categorias e player integrado.

Recursos disponíveis:

- Lista de canais.
- Categorias.
- Reprodução ao vivo.
- Informações do canal atual.
- Guia EPG.
- Troca de canal pelo Lux Control.
- Próximo canal / canal anterior.
- Controle de volume e mute remotamente.

## Filmes e séries

O catálogo VOD possui suporte para filmes e séries provenientes da lista principal e também para conteúdo adicional cadastrado na infraestrutura própria.

Recursos:

- Catálogo por gênero.
- Busca global.
- Favoritos.
- Player integrado.
- Continuar assistindo.
- Histórico/progresso.
- Banner principal com conteúdo em destaque.
- Recomendações e lançamentos na Home.
- Conteúdo adicional via Cloudflare R2.

## Home

A tela inicial reúne diferentes partes do ecossistema:

- Conteúdo em alta.
- Banner principal interativo.
- Continuar assistindo.
- Jogos e esportes ao vivo.
- Filmes em lançamento.
- Atalhos para as principais áreas.

---

# Jogos retrô

O Lux Play possui uma central de jogos retrô integrada ao aplicativo.

A emulação é baseada no **EmulatorJS** e atualmente contempla layouts e suporte para:

- Game Boy.
- Game Boy Color.
- Game Boy Advance.
- NES.
- SNES.
- Mega Drive / Genesis.
- Nintendo 64.

## Recursos do emulador

- Execução diretamente dentro do Lux Play.
- Catálogo de jogos.
- Metadados e capas.
- Favoritos.
- Saves locais.
- Saves em nuvem.
- Slots de save.
- Sincronização de save por usuário/perfil.
- Controle por teclado/controle físico.
- Lux Pad pelo celular.
- Suporte a dois jogadores no sistema de controle remoto.
- Tempo de jogo.

Arquivos principais:

```text
js/emulator.js
js/game-save-store.js
js/lux-gamepad-host.js
```

---

# Lux Controller

A versão 1.5.0 adiciona um sistema próprio de controle pelo celular.

O módulo mobile fica em:

```text
/controller
```

Ele funciona como **PWA** e foi projetado para ser instalado na tela inicial do celular.

## Lux Pad

O **Lux Pad** transforma o celular em um gamepad para os emuladores do Lux Play.

Fluxo de conexão:

1. O Lux Play cria uma sessão.
2. O aplicativo exibe um QR Code e um código de 6 dígitos.
3. O celular abre o Lux Controller.
4. O usuário escolhe Jogador 1 ou Jogador 2.
5. O pareamento é realizado.
6. Os inputs são enviados em baixa latência ao host.

### Layouts disponíveis

- GB / GBC.
- GBA.
- NES.
- SNES.
- Mega Drive 3 botões.
- Mega Drive 6 botões.
- N64.

O protocolo aceita inputs digitais e analógicos, permitindo layouts como o analógico do Nintendo 64.

## Lux Control

O **Lux Control** transforma o celular em um controle remoto para navegar pelo próprio Lux Play.

Entre os comandos disponíveis estão:

- Direcional.
- OK / selecionar.
- Voltar.
- Home.
- TV.
- Filmes.
- Séries.
- Jogos.
- Leitura.
- Play / pause.
- Avançar e retroceder.
- Próximo / anterior.
- Próximo canal / canal anterior.
- Volume + / -.
- Mute.
- Favoritar.

A navegação remota também reconhece cards, banner da Home, modais e diferentes seções do aplicativo.

## Transporte

O controle usa:

- **Supabase Realtime** para sinalização da sessão.
- **WebRTC DataChannel** para os comandos em baixa latência.

O banco não é utilizado para inserir cada botão pressionado.

---

# Leitura

O Lux Play também possui uma biblioteca e leitor integrado.

Formatos suportados:

- PDF.
- EPUB.
- CBR.
- CBZ.
- Pastas com JPG/PNG.

Recursos:

- Biblioteca pessoal.
- Busca.
- Categorias.
- Autor.
- Ordenação.
- Importação de arquivos.
- Importação de pastas.
- Retomada de leitura.
- Progresso.
- Notas.
- Comentários.
- Preferências de leitura.
- Dicionário.
- Sincronização por perfil.
- Catálogo remoto.

Os arquivos pessoais permanecem no computador quando importados localmente; progresso e informações sincronizáveis podem acompanhar o perfil.

Principais módulos:

```text
js/reader.js
js/reader-engine.js
js/reader-store.js
js/reader-cloud.js
js/reader-extras.js
js/reader-archive-worker.js
js/reading-admin.js
```

Mais detalhes históricos da versão de leitura estão em:

```text
docs/LEITURA-1.4.0.md
```

---

# Perfis

O sistema possui suporte a perfis dentro da conta principal.

Recursos relacionados:

- Seleção de perfil.
- Avatar.
- Galeria de avatares.
- Dados de progresso por perfil.
- Leitura por perfil.
- Saves vinculados ao usuário/perfil.

Arquivos:

```text
js/profiles.js
js/avatar-gallery.js
```

---

# Painel administrativo

Usuários autorizados podem acessar ferramentas administrativas dentro do próprio Lux Play.

O painel possui áreas para:

- Clientes.
- Jogos.
- Livros.
- Fotos de perfil.
- VODs / Cloudflare R2.

## Administração de clientes

Permite cadastrar e gerenciar clientes e informações relacionadas ao acesso ao Lux Play.

## Administração de jogos

Permite cadastrar catálogo e metadados de jogos utilizados pela central retrô.

## Administração de leitura

Ferramentas de preparação de biblioteca incluem suporte para:

- Coleções.
- Pastas.
- ZIP/RAR.
- Geração de CBZ.
- Capas.
- Revisão de metadados.
- Envio para armazenamento remoto.

## Administração de VODs

O Lux Play pode utilizar o **Cloudflare R2** como biblioteca adicional de mídia.

A Edge Function `r2-upload-url` gera URLs assinadas para upload direto ao bucket, evitando expor credenciais privadas do Cloudflare no cliente.

Fluxo:

```text
Lux Play
   ↓
Supabase Edge Function
   ↓
URL assinada
   ↓
Upload direto para Cloudflare R2
```

---

# Backend e sincronização

O projeto utiliza **Supabase** como principal camada de backend.

As Edge Functions atuais incluem:

```text
game-metadata
game-save-sync
profiles
progress-sync
r2-upload-url
reading-catalog
reading-sync
vod-catalog
```

Elas atendem funcionalidades como:

- Metadados de jogos.
- Saves em nuvem.
- Perfis.
- Progresso.
- Biblioteca de leitura.
- Catálogo VOD.
- Upload de conteúdo.

---

# Tecnologias

## Frontend

- HTML.
- CSS.
- JavaScript.
- Tailwind via interface existente do projeto.
- Lucide Icons.
- Web APIs modernas.

## Desktop

- Electron.
- Electron Builder.
- Electron Updater.

## Jogos

- EmulatorJS.
- WebRTC DataChannel para Lux Pad.

## Leitura

- PDF.js.
- EPUB.js.
- JSZip.
- node-unrar-js.
- Marked.
- DOMPurify.

## Backend

- Supabase.
- Supabase Edge Functions.
- Supabase Realtime.

## Armazenamento

- Cloudflare R2.

## Deploy web

- Vercel.

---

# Estrutura principal

```text
Lux-Player/
│
├── index.html                  # Interface principal
├── package.json                # Versão, scripts e configuração Electron
├── electron-builder.store.cjs # Build para Microsoft Store
│
├── css/                        # Estilos da aplicação
│
├── js/
│   ├── script.js               # Núcleo principal do Lux Play
│   ├── emulator.js             # Emulação
│   ├── game-save-store.js      # Saves
│   ├── profiles.js             # Perfis
│   ├── avatar-gallery.js       # Avatares
│   ├── lux-gamepad-host.js     # Host do Lux Pad
│   ├── lux-remote-host.js      # Host do Lux Control
│   ├── ui-motion.js            # Transições e carregamento dos módulos móveis
│   ├── reader.js               # Interface do leitor
│   ├── reader-engine.js        # Engine de leitura
│   ├── reader-store.js         # Persistência da biblioteca
│   ├── reader-cloud.js         # Sincronização de leitura
│   ├── reader-extras.js        # Recursos adicionais
│   └── reading-admin.js        # Administração da biblioteca
│
├── controller/
│   ├── index.html              # PWA Lux Controller
│   ├── gamepad-core.js         # Lux Pad
│   ├── gamepad-layout.css      # Layouts dos controles
│   ├── hub.js                  # Hub/PWA e Lux Control
│   ├── hub.css                 # Interface mobile
│   ├── orientation.js          # Orientação portrait/landscape
│   ├── manifest.json           # Manifest PWA
│   └── sw.js                   # Service Worker
│
├── electron/
│   ├── main.js                 # Processo principal
│   └── preload.js              # Bridge segura do Electron
│
├── supabase/
│   ├── functions/              # Edge Functions
│   └── ...                     # Configurações e documentação
│
├── scripts/                    # Scripts de build e suporte
├── tests/                      # Testes automatizados
└── docs/                       # Documentação adicional
```

---

# Desenvolvimento

## Requisitos

- Node.js compatível com as dependências do projeto.
- npm.

Clone o repositório e instale as dependências:

```bash
git clone https://github.com/DevSouza208/Lux-Player.git
cd Lux-Player
npm install
```

## Executar o Electron em desenvolvimento

```bash
npm start
```

O script de pré-execução também prepara o bundle do leitor.

## Testes

```bash
npm test
```

Teste específico do leitor Electron:

```bash
npm run test:reader
```

## Gerar bundle do leitor

```bash
npm run build:reader
```

---

# Build para Windows

A versão atual do aplicativo é definida em:

```json
"version": "1.5.0"
```

Para gerar o instalador do Windows:

```bash
npm run dist
```

O Electron Builder gera o instalador em:

```text
release/
```

Com o padrão:

```text
Lux Play-Setup-1.5.0.exe
```

## Publicação com Electron Updater

Para gerar e publicar usando a configuração de releases:

```bash
npm run publish
```

O desktop possui suporte ao `electron-updater` para verificar, baixar e instalar novas versões.

---

# Build para Microsoft Store

Existe também uma configuração específica em:

```text
electron-builder.store.cjs
```

O build utiliza os valores públicos da identidade configurada no Partner Center através das variáveis:

```text
LUX_STORE_IDENTITY
LUX_STORE_PUBLISHER
LUX_STORE_PUBLISHER_NAME
```

Para gerar:

```bash
npm run dist:store
```

---

# Segurança e arquitetura

Algumas decisões importantes do projeto:

- O Electron utiliza `contextIsolation`.
- `nodeIntegration` permanece desativado na interface web.
- Credenciais privadas de Cloudflare não devem ficar no frontend.
- Uploads para R2 utilizam URLs assinadas.
- Lux Pad e Lux Control usam WebRTC para os comandos em tempo real.
- Supabase Realtime é usado como sinalização, não como transporte de cada input.
- PWA e módulos de controle ficam separados do núcleo principal sempre que possível.

Nunca publique no repositório:

```text
senhas
service_role keys
segredos S3/R2
tokens privados
credenciais de clientes
```

---

# Conteúdo e responsabilidade

O Lux Play é uma plataforma/player. O uso de listas, ROMs, livros, vídeos ou outros conteúdos deve respeitar as autorizações, licenças e direitos aplicáveis a cada material.

---

# Autor

Desenvolvido por **DevSouza208**.

Projeto em evolução contínua — da reprodução de mídia até jogos, leitura e integração entre dispositivos dentro do mesmo ecossistema Lux Play.
