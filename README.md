# 🎬 LUX Play - Web Streaming Platform

<p align="center">
  <img src="https://img.shields.io/badge/Status-Concluído-success?style=for-the-badge">
  <img src="https://img.shields.io/badge/PWA-Suportado-purple?style=for-the-badge">
  <img src="https://img.shields.io/badge/TailwindCSS-v3-blue?style=for-the-badge">
</p>

O **LUX Play** é um player web de streaming moderno, leve e responsivo, desenvolvido para gerenciar listas M3U e conexões Xtream Codes (XC) integrado a uma planilha de controle de usuários.

---

## ✨ Funcionalidades Principais

* **📱 Experiência Mobile First & Desktop:** Navegação em etapas otimizada para toque em celulares e layout clássico de múltiplas colunas em telas grandes.
* **🎥 Player Nativo com HLS.js:** Suporte robusto a reprodução de fluxos ao vivo (`.m3u8`) e arquivos de vídeo VOD (`.mp4`, `.mkv`).
* **⏯️ Continuar Assistindo:** Histórico integrado via `localStorage` que lembra exatamente onde o usuário parou de assistir a um filme ou episódio.
* **🔒 Controle Parental (+18):** Proteção inteligente por PIN para restringir o acesso a conteúdos adultos.
* **🖼️ Fallbacks de Imagem:** Tratamento automático de capas e logos corrompidos, substituindo por ícones e cartazes tipográficos elegantes.
* **📥 PWA Nativo:** Instalação facilitada na tela inicial de dispositivos Android e iOS com banner de recomendação automático.
* **📊 Painel Integrado via Google Sheets:** Autenticação e controle de validade de clientes baseados em banco de dados em planilha online.

---

## 🚀 Tecnologias Utilizadas

* **HTML5 / CSS3** (Com animações personalizadas e estilização customizada de scrollbars).
* **JavaScript (Vanilla ES6+)** (Arquitetura limpa sem frameworks pesados, garantindo carregamento instantâneo).
* **Tailwind CSS** (Via CDN para estilização rápida e responsiva).
* **HLS.js** (Para reprodução de streams de vídeo adaptativos).
* **Lucide Icons** (Biblioteca de ícones moderna e minimalista).

---

## ⚙️ Como Usar / Instalar

1. Clone ou baixe os arquivos do projeto.
2. Certifique-se de que o arquivo principal se chama `index.html`.
3. Configure o ID da sua planilha Google no topo do script JS (`const SHEET_ID = 'SEU_SHEET_ID'`).
4. Hospede gratuitamente em plataformas como **Vercel**, **Netlify**, **GitHub Pages** ou qualquer servidor web estático.

---

## 🛡️ Licença

Projeto desenvolvido para fins educacionais e de gerenciamento de mídia pessoal. Todos os direitos reservados.
