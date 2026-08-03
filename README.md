# Alô Cozinha v1.4.1

Aplicativo de pedidos entre áreas de envio e recebimento, com funcionamento local e sincronização por Google Apps Script.

## Novidades da v1.4.1

- Ações visíveis com cores claras: aceitar, enviar, vir buscar, cancelar e desfazer.
- Produtos podem ser solicitados por várias áreas e continuam tendo uma única área de destino.
- Emoji configurável para cada área e indicação da origem na tela que recebe o pedido.
- Exclusão individual visível no Histórico de Hoje.
- Configurações sempre abrem no topo da tela.
- Categorias mais quadradas e barra de Últimos Pedidos mais compacta.
- Produtos antigos migrados automaticamente para `Panelas → Cozinha`.
- Relatório abre com os dados locais e atualiza somente o período escolhido em segundo plano.

## Arquivos

- `index.html`: estrutura da tela.
- `styles.css`: aparência do aplicativo.
- `logic.js`: regras puras de pedidos e status.
- `storage.js`: armazenamento local persistente e migração dos dados antigos.
- `api.js`: comunicação com o Apps Script.
- `audio.js`: alertas e volume.
- `sync.js`: fila persistente, reenvio e confirmação de pedidos.
- `app.js`: interface e eventos.
- `service-worker.js`: permite abrir o aplicativo sem internet.
- `google-apps-script.gs`: servidor ligado à planilha.

## Atualização sem perder dados

> A v1.4.1 não altera o Google Apps Script. Quem já implantou o arquivo da v1.4.0 não precisa criar uma nova implantação.

1. Publique os arquivos do aplicativo no mesmo local de antes.
2. Abra o app conectado uma vez em cada aparelho para baixar a atualização. Os pedidos, produtos, categorias e observações existentes são mantidos.
3. Em um aparelho administrador, use `Gerenciar Áreas`, ajuste as rotas dos produtos e salve tudo na nuvem para compartilhar a configuração.

## Como a fila funciona

Um pedido novo é salvo primeiro no armazenamento do aparelho. Se não houver internet, ele aparece como `Aguardando internet` e será reenviado automaticamente ao abrir o app, voltar à tela ou recuperar a conexão. O mesmo ID é reutilizado em todas as tentativas, evitando duplicidade. O botão de conexão no cabeçalho força uma nova tentativa imediatamente.

## Teste recomendado antes do expediente

1. Em um tablet de Panelas, desligue o Wi-Fi, crie um pedido e confirme que ele aparece como aguardando internet.
2. Feche e reabra o app: o pedido deve continuar na lista.
3. Ligue o Wi-Fi e confirme que o indicador de fila desaparece e o pedido chega à Cozinha apenas uma vez.
4. Em dois aparelhos, altere pedidos diferentes e confira que as mudanças aparecem nos dois. Para cardápio/configurações, sempre puxe antes de editar e salvar.
