# Alô Cozinha v1.4.4

Aplicativo de pedidos entre áreas de envio e recebimento, com funcionamento local e sincronização por Google Apps Script.

## Novidades da v1.4.4

- Observações dos produtos e motivos de cancelamento agora ficam dentro de `Gerenciar Produtos`.
- Categorias aparecem antes de produtos no painel administrativo.
- Configurações básicas foram movidas para uma tela própria, deixando o painel principal mais compacto.
- O título isolado `Avançado` foi removido; o acesso às configurações avançadas continua disponível no painel.
- Tigela com a mesma aparência vermelha nativa em toda a interface.
- Seta de envio mais encorpada e seletor moderno por switches para as áreas de origem.
- Nova opção de área com tigela escura e colher.
- Cancelamentos piscam e emitem beep no setor solicitante até a confirmação, mesmo quando o som comum está desativado.
- Depois da confirmação, o status cancelado continua vermelho.
- A URL do Apps Script é validada antes de ser salva e já inicia a sincronização completa.
- Cardápio, áreas e configurações são recebidos automaticamente quando a revisão da nuvem muda.
- O comando manual de puxar dados foi removido; a publicação administrativa permanece protegida contra conflitos entre aparelhos.

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

> A v1.4.4 não altera o Google Apps Script. Quem já implantou o arquivo da v1.4.0 não precisa criar uma nova implantação.

1. Publique os arquivos do aplicativo no mesmo local de antes.
2. Abra o app conectado uma vez em cada aparelho para baixar a atualização. Os pedidos, produtos, categorias e observações existentes são mantidos.
3. Em um aparelho administrador, ajuste produtos ou áreas e use `Publicar Cardápio e Áreas` para compartilhar as alterações.

## Como a fila funciona

Um pedido novo é salvo primeiro no armazenamento do aparelho. Se não houver internet, ele aparece como `Aguardando internet` e será reenviado automaticamente ao abrir o app, voltar à tela ou recuperar a conexão. O mesmo ID é reutilizado em todas as tentativas, evitando duplicidade. O botão de conexão no cabeçalho força uma nova tentativa imediatamente.

## Teste recomendado antes do expediente

1. Em um tablet de Panelas, desligue o Wi-Fi, crie um pedido e confirme que ele aparece como aguardando internet.
2. Feche e reabra o app: o pedido deve continuar na lista.
3. Ligue o Wi-Fi e confirme que o indicador de fila desaparece e o pedido chega à Cozinha apenas uma vez.
4. Em dois aparelhos, altere pedidos diferentes e confira que as mudanças aparecem nos dois. Cardápio e áreas são recebidos automaticamente; alterações administrativas continuam sendo publicadas por um aparelho de cada vez.
