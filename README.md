# Alô Cozinha v1.3.4

Aplicativo de pedidos entre Panelas e Cozinha, com funcionamento local e sincronização por Google Apps Script.

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

1. Publique os arquivos do aplicativo no mesmo local de antes.
2. No Apps Script existente, substitua o código pelo conteúdo de `google-apps-script.gs`.
3. Em `Implantar > Gerenciar implantações`, edite a implantação atual, escolha `Nova versão` e implante. Isso preserva a mesma URL.
4. Abra o app conectado uma vez em cada aparelho para baixar a atualização. Os pedidos, produtos, categorias e observações existentes são mantidos.

## Como a fila funciona

Um pedido novo é salvo primeiro no armazenamento do aparelho. Se não houver internet, ele aparece como `Aguardando internet` e será reenviado automaticamente ao abrir o app, voltar à tela ou recuperar a conexão. O mesmo ID é reutilizado em todas as tentativas, evitando duplicidade. O botão de conexão no cabeçalho força uma nova tentativa imediatamente.

## Teste recomendado antes do expediente

1. Em um tablet de Panelas, desligue o Wi-Fi, crie um pedido e confirme que ele aparece como aguardando internet.
2. Feche e reabra o app: o pedido deve continuar na lista.
3. Ligue o Wi-Fi e confirme que o indicador de fila desaparece e o pedido chega à Cozinha apenas uma vez.
4. Em dois aparelhos, altere pedidos diferentes e confira que as mudanças aparecem nos dois. Para cardápio/configurações, sempre puxe antes de editar e salvar.
