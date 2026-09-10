# Lux Play 1.4.0 — Leitura

## Leitor

PDF, EPUB, CBR/CBZ e pastas JPG/PNG, com ordenação numérica, temas, zoom/fonte e retomada por página ou CFI no EPUB. Efeitos Livro, Deslizar e Sem efeito respeitam a preferência por movimento reduzido. PDF mantém suas páginas originais; não é convertido em texto refluível.

O botão Comentários permite marcadores coloridos por página, destaque na posição correspondente e navegação até a anotação. O notebook geral tem Markdown, negrito, itálico, títulos, listas, citações, emojis, prévia e cores (`[cor=#ff8800]texto[/cor]`). A prévia é sanitizada.

O dicionário consulta o Wikcionário e oferece link externo para o Dicio. Não há integração com uma API oficial do Dicio nem extração de suas páginas.

## Arquivos pessoais e nuvem

Arquivos pessoais ficam no IndexedDB deste computador: **não são enviados ao R2**. Somente progresso, preferências, notebook e comentários são sincronizados. Para continuar um arquivo pessoal em outro computador, importe o mesmo arquivo; sua identidade SHA-256 permite recuperar o estado.

A chave inclui conta, identidade interna do perfil e conteúdo da obra. Nomes iguais não compartilham estado. Alterações ficam salvas localmente e aguardam conexão na fila de sincronização. A interface informa pendências. Conflitos de texto entre dispositivos preservam uma versão recuperável nas notas.

Remover a cópia local pela biblioteca preserva notas e progresso. Limpar os dados do app elimina arquivos locais e alterações ainda não sincronizadas. Arquivos pessoais precisam ser reimportados.

**Limitação importante:** a autenticação legada depende da tabela pública de usuários. A separação funcional foi testada, mas não garante proteção contra exploração desse login. Leia a [auditoria de isolamento](ISOLAMENTO-1.4.0.md).

## Admin e R2

A aba Livros aceita upload em lote de PDF, EPUB, CBR e CBZ, além de preparar ZIP/RAR e pastas completas. Título, autores, coleção/série, categoria, descrição, capa, editora, ano, ISBN e classificação são editáveis. A pesquisa consulta Google Books com alternativa no Open Library; revise os resultados. Artigos podem ser cadastrados manualmente.

### Importar uma coleção baixada do Drive

1. Baixe o conteúdo do Drive no computador.
2. No admin, abra Livros e use **Importar pasta completa**, ou **Selecionar obras** para escolher arquivos ZIP/RAR e publicações individuais.
3. Aguarde a preparação. Cada publicação dentro de um pacote vira um item da fila. Cada pasta com páginas JPG/PNG vira uma revista CBZ, ordenada numericamente pelo nome. As imagens são armazenadas sem recompressão. Pastas distintas viram revistas distintas; imagens soltas na mesma pasta são agrupadas juntas.
4. Revise o campo **Coleção / série**, usando `/` entre os níveis. Exemplo: `Deadpool/[2013] Deadpool Mata Deadpool`. O nome do ZIP/RAR também compõe a hierarquia. Remova da fila itens que não sejam publicações, como uma pasta de miniaturas detectada como revista.
5. A primeira página gera a capa de PDF, CBR/CBZ e revistas. No EPUB, o importador procura a capa declarada e usa uma imagem como alternativa. Se não conseguir gerar a capa, a fila avisa e o campo URL continua disponível. Capas geradas ficam locais até o envio.
6. Se desejar sugestões automáticas, marque **Sugerir metadados da internet ao preparar** antes de selecionar os arquivos. A busca é opcional e pode ser lenta para coleções grandes; título e coleção são preservados. Também é possível pesquisar uma obra individualmente. Confira as sugestões antes da aprovação.
7. Use **Enviar lote para revisão** e depois aprove as obras. A biblioteca apresenta as coleções como capas agrupadas, com navegação pelos níveis e edições ordenadas numericamente dentro da coleção.

Mantenha o app aberto durante preparação e upload. O botão Parar interrompe o processamento após o arquivo atual; falhas permanecem na fila para nova tentativa. A fila de arquivos ainda não enviados não é persistida ao fechar o aplicativo: selecione-os novamente. Arquivos idênticos já presentes no catálogo são reaproveitados pelo hash, preservando a organização e metadados existentes; não são duplicados em outra coleção.

Conforme a escolha feita para esta etapa, **não há conexão por link com o Google Drive nem transferência com o app fechado**. O processamento ocorre no computador; não exige VPS, chave Google ou um novo serviço de nuvem.

O envio apresenta progresso e erros por arquivo, com nova tentativa e pausa após o arquivo atual. O servidor confirma tamanho e tipo do objeto. A obra fica pendente até aprovação individual ou em lote; use Ler para revisar antes de publicar. Usuários comuns recebem apenas obras aprovadas com upload confirmado.

Foi reutilizado o bucket `luxvod`, prefixo `reading/`. Não é necessário outro bucket para organização. Uploads usam URLs assinadas, com credenciais no servidor. O leitor confere o hash ao baixar.

Novos uploads organizados usam `reading/collections/<coleção>/<série>/<id>.<formato>`. As capas JPEG ficam ao lado da obra. Editar a coleção de uma obra já enviada atualiza sua posição na biblioteca sem mover o objeto existente no R2.

**A aprovação controla o catálogo, não a privacidade do arquivo:** o bucket atual é público. Quem tiver a URL de um rascunho poderá baixá-lo. Acesso restrito exige armazenamento privado e downloads autorizados; uma pasta não fornece esse controle. Referência: https://developers.cloudflare.com/r2/buckets/public-buckets/.

## Limites

- Até 256 MB por PDF/EPUB/CBR/CBZ; imagens: 2.000 páginas, 40 MB por imagem e 512 MB descompactados.
- ZIP/RAR para preparação: até 256 MB por pacote, 512 MB descompactados acumulados, 10.000 entradas e três níveis de arquivos compactados aninhados. Para downloads maiores do Drive, extraia no computador e selecione a pasta completa.
- Revistas geradas no admin: até 2.000 imagens, 40 MB por imagem e 256 MB por CBZ final. A importação pessoal de imagens conserva seu limite anterior de 512 MB e não envia arquivos à nuvem.
- Arquivos ZIP/RAR corrompidos, protegidos por senha, multipartes ou acima dos limites precisam ser extraídos separadamente. A preparação tem limite de dois minutos por operação de descompactação.
- Sem DRM, OCR, arquivos com senha, CBR multipartes ou desenho sobre páginas. Comentários são vinculados à posição.
- Paginação EPUB varia com fonte e janela; percentual aproximado por capítulos.
- Temas preservam cores originais de PDF/HQs. Serviços online dependem de conexão.

## Implantação e testes

O schema `supabase/reading_schema.sql` foi aplicado no projeto vinculado. Foram publicadas `reading-sync`, `reading-catalog` e a atualização de `progress-sync`. Não houve migração para Supabase Auth.

A extensão `supabase/reading_collections_schema.sql` também foi aplicada, e `reading-catalog` foi republicada para aceitar coleções e capas. O schema principal inclui a coluna para instalações novas. A autenticação permanece no escopo da 1.5.0.

```powershell
npm run build:reader
npm test
npm run test:reader
```

Validação atual: 58 testes unitários aprovados; teste Electron com os cinco formatos, retomada, comentários EPUB, Markdown, extração real ZIP/RAR, pastas, capas PDF/CBR/CBZ, navegação por coleções e admin em lote aprovado. Uploads desta nova etapa foram simulados no teste; não foram enviados arquivos do usuário. Capturas: `release/reader-validation`.

Na etapa anterior foi executado `scripts/test-reading-live.cjs` com `LUX_READING_LIVE=1`: contas/perfis sintéticos, conflitos de revisão, rejeição de arquivos no endpoint de estado, upload real R2, integridade, aprovação e isolamento do progresso de mídia. Contas, registros e objeto temporários foram removidos. Esse teste altera serviços reais e não integra o npm test; não foi repetido nesta extensão de coleções/capas.

Dependências e licenças são empacotadas localmente por `scripts/build-reader.cjs`. EPUB usa iframe sem scripts e sanitização; arquivos compactados são extraídos em worker. Nenhum instalador 1.4.0 foi gerado ou publicado nesta etapa.

Alertas de desenvolvimento preexistentes de Electron 37 e extract-zip continuam pendentes de atualização validada nos demais módulos.
