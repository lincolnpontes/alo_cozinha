# Alô Cozinha v2.0.2

Aplicativo para operação de restaurante com dois módulos: pedidos entre áreas (KDS) e lista de atividades por setor.

## Novidades da v2

- A v2.0.2 reorganiza a Lista de Atividades em Hoje, Pendentes e Concluídas, com cores por estado e conclusão apenas por botão.
- Atividades concluídas podem ser desfeitas; lembretes abrem diretamente a atividade sem navegar quando a ação é feita no próprio aviso.
- A navegação dos módulos ganhou a assinatura Alô Cozinha e Gerenciar Áreas passou para Configurações KDS.
- A v2.0.1 adicionou confirmação explícita e suporte à tecla Enter em todos os acessos por senha.
- Senhas incorretas mostram uma mensagem no próprio modal, e salvar a senha mestra não abre mais um alerta bloqueante.
- Nova tela inicial para escolher entre `KDS - Sistema de Pedidos` e `Lista de Atividades`.
- O KDS anterior foi preservado dentro do módulo de pedidos.
- Atividades diárias, semanais ou únicas, com horário, prioridade, setor, responsável, instrução curta e alarme opcional.
- Funcionários cadastrados somente com nome, cargo, setor e estado ativo.
- A atividade pode ser iniciada, concluída ou marcada como não realizada.
- O tempo é medido somente quando a atividade foi iniciada antes da conclusão.
- Alarmes aparecem sobre qualquer módulo e permitem abrir a tarefa, iniciar, marcar como feita ou silenciar.
- Fila local persistente para atividades: ações sem internet são guardadas e reenviadas até a confirmação.
- Sincronização entre aparelhos com revisão, operação idempotente e proteção contra status atrasado.
- Relatórios de 7 ou 30 dias com total concluído, tempo médio, atrasos e conclusões sem medição.
- Painel reorganizado em `Configurações KDS`, `Configurações Tarefas` e `Configurações Avançadas`; áreas ficam dentro do KDS.

## Arquivos

- `index.html`: estrutura dos dois módulos e das configurações.
- `styles.css`: aparência do KDS.
- `tasks.css`: aparência responsiva do módulo de tarefas.
- `tasks.js`: tarefas, funcionários, alarmes, relatórios e fila de sincronização.
- `logic.js`: regras puras de pedidos e status.
- `storage.js`: armazenamento persistente dos pedidos.
- `api.js`: comunicação com o Google Apps Script.
- `audio.js`: alertas do KDS.
- `sync.js`: fila confiável dos pedidos.
- `catalog-sync.js`: publicação automática dos cadastros e configurações.
- `app.js`: interface e integração geral.
- `service-worker.js`: cache para abertura offline.
- `google-apps-script.gs`: servidor ligado à planilha.

## Atualizar sem perder dados

A v2 preserva pedidos, produtos, categorias, observações, áreas, configurações e histórico já existentes. O Google Apps Script cria uma aba `Atividades` separada para o novo módulo.

1. Substitua o conteúdo do projeto no Google Apps Script pelo arquivo `google-apps-script.gs` desta branch.
2. Em `Implantar > Gerenciar implantações`, edite a implantação atual e selecione `Nova versão`.
3. Implante mantendo o acesso como já estava configurado. A URL permanece a mesma.
4. Publique os arquivos web desta branch e abra o app conectado uma vez em cada aparelho.
5. Cadastre setores, funcionários e tarefas em `Configurações Tarefas`.

## Teste recomendado

1. Cadastre uma tarefa para alguns minutos à frente e confirme o alarme em outro módulo.
2. Use `Iniciar`, aguarde um pouco e conclua; o relatório deve mostrar o tempo gasto.
3. Desligue o Wi-Fi, conclua uma tarefa e confirme a indicação de envio pendente.
4. Feche e reabra o app ainda offline; a conclusão deve continuar salva.
5. Ligue o Wi-Fi e confira em outro aparelho que a atividade chega concluída apenas uma vez.
6. Com dois aparelhos, tente agir sobre a mesma tarefa e confirme que o status mais novo prevalece.

## Branch de teste

Esta versão é desenvolvida na branch `codex/v2-tarefas`. A branch `main` não recebe essas mudanças até a aprovação dos testes práticos.
