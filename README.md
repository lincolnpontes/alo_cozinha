# Alô Cozinha v2.0.14

Aplicativo para operação de restaurante com dois módulos: pedidos entre áreas (KDS) e checklist por setor.

## Novidades da v2

- A v2.0.14 compacta a correção de status isolada e refina os indicadores dos seletores de área.
- A v2.0.13 deixa os seletores compactos, separa as preferências locais dos módulos e uniformiza as ações de conclusão.
- A v2.0.12 iguala os seletores de setor, estabiliza os filtros sanitários e mantém a área de trabalho local em cada equipamento.
- A v2.0.11 uniformiza os nomes dos setores, reorganiza funcionários e amplia os modelos sanitários para os controles da RDC 216.
- A v2.0.10 identifica KDS e Checklist nos cabeçalhos, remove programações automáticas de tarefas novas e refina alarmes, frequências e switches.
- A v2.0.9 leva a troca de setor para o cabeçalho das atividades e permite vários horários e frequências na mesma tarefa.
- A biblioteca sanitária oferece modelos editáveis com base na RDC Anvisa 216/2004, sem fixar diluição ou tempo de contato de saneantes.
- Tarefas podem ter foto de referência sincronizada pelo Google Drive e QR Code para consulta do procedimento e das últimas execuções.
- Alarmes, controles e cores foram redesenhados com superfícies translúcidas e ações mais compactas.
- A v2.0.8 mostra o marcador imediatamente em linhas vazias, limita o alinhamento à linha ou seleção atual e mantém o marcador junto ao texto à direita.
- Os separadores de estado ganharam faixas semânticas mais nítidas, o Total ficou compacto e o seletor de áreas do KDS foi redesenhado com emojis e função de cada área.
- A confirmação de atividade não realizada agora usa somente a pergunta e as ações Cancelar/Confirmar.
- A v2.0.7 refina a Lista de Atividades com estados visuais, filtro de execução, popover de edição e procedimentos formatados corretamente.
- O editor usa um único controle de alinhamento visual, preserva marcadores centralizados e reconhece automaticamente procedimentos antigos em HTML.
- Confirmações e entradas rápidas agora usam janelas do próprio app; o seletor de área do KDS ganhou emojis e opções responsivas.
- O detalhe da atividade ganhou ações operacionais por estado e um lápis separado para retomar a execução ou excluir o registro e voltar para pendente.
- As abas exibem os totais do dia e substituem a antiga faixa de resumo, liberando mais espaço para as atividades.
- As configurações do cabeçalho abrem apenas o módulo atual; o painel completo e as configurações avançadas ficam no novo botão da tela inicial.
- O histórico gerencial não repete o procedimento e mostra a observação registrada na conclusão somente quando ela existe.
- A v2.0.5 deixa os cartões operacionais compactos: sem procedimento, estado escrito, POP ou duração na lista inicial.
- Atividades em execução podem voltar para pendente pelos detalhes, com ações de retorno mais claras.
- Procedimentos agora têm formato explícito: texto, bolinhas, numeração ou tracinhos, preservando blocos separados por linhas em branco.
- Relatórios agrupam e filtram registros por área, integram registros POP na mesma lista e oferecem períodos de até um ano.
- O histórico abre acima do relatório, pode ser impresso e mantém funcionário, área, data, horário, duração, POP e observação.
- A v2.0.4 alinha `Hoje`, `Pendentes` e `Concluídas` ao dia atual, evitando contagens diferentes entre as abas.
- Qualquer cartão de atividade abre seus detalhes e o procedimento, sem alterar o estado; somente os botões iniciam ou concluem.
- Procedimentos aceitam parágrafos, linhas em branco, marcadores com `-` e etapas numeradas.
- Relatórios permitem abrir o histórico de cada tarefa com executor, data, horário, duração, POP e observação.
- O cabeçalho do KDS identifica o módulo e os cartões não ocupam mais espaço com mensagens extensas de sincronização.
- A v2.0.3 remove o cargo do cadastro de funcionários e deixa somente nome, setor e estado ativo.
- `Hoje` mostra todas as atividades do dia; `Concluídas` mostra somente as concluídas do mesmo dia.
- Tocar numa atividade concluída abre seu registro e permite voltar para execução, continuando o tempo anterior, ou voltar para pendente.
- Tarefas configuradas como remarcáveis podem ser levadas para outra data sem perder o registro da data original.
- Tarefas com registro POP exigem o funcionário ao concluir e guardam procedimento, observação, data, hora e duração.
- A v2.0.2 reorganiza a Lista de Atividades em Hoje, Pendentes e Concluídas, com cores por estado e conclusão apenas por botão.
- Atividades concluídas podem ser desfeitas; lembretes abrem diretamente a atividade sem navegar quando a ação é feita no próprio aviso.
- A navegação dos módulos ganhou a assinatura Alô Cozinha e Gerenciar Áreas passou para Configurações KDS.
- A v2.0.1 adicionou confirmação explícita e suporte à tecla Enter em todos os acessos por senha.
- Senhas incorretas mostram uma mensagem no próprio modal, e salvar a senha mestra não abre mais um alerta bloqueante.
- Nova tela inicial para escolher entre `KDS - Sistema de Pedidos` e `Checklist`.
- O KDS anterior foi preservado dentro do módulo de pedidos.
- Atividades diárias, semanais ou únicas, com horário, prioridade, setor, responsável, instrução curta e alarme opcional.
- Funcionários cadastrados somente com nome, setor e estado ativo.
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

A v2 preserva pedidos, produtos, categorias, observações, áreas, configurações e histórico já existentes. O Google Apps Script cria a aba `Atividades` quando necessário e acrescenta as novas colunas de POP e remarcação ao fim da aba existente.

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
7. Marque uma tarefa como remarcável, leve-a para amanhã e confirme que ela sai de `Hoje`, mas continua em `Pendentes`.
8. Marque uma tarefa como POP, conclua com um funcionário e confira o registro em `Relatórios por Tarefas`.

## Branch de teste

Esta versão é desenvolvida na branch `codex/v2-tarefas`. A branch `main` não recebe essas mudanças até a aprovação dos testes práticos.
