(function (global) {
    const daily = (times, alarm = true) => times.map((time, index) => ({
        id: index === 0 ? 'principal' : `horario_modelo_${index + 1}`,
        horario: time,
        recorrencia: 'diaria',
        dias: [0, 1, 2, 3, 4, 5, 6],
        dataUnica: '',
        alarme: alarm
    }));
    const weekly = (time, days = [1], alarm = true) => [{
        id: 'principal', horario: time, recorrencia: 'semanal', dias: days, dataUnica: '', alarme: alarm
    }];
    const monthly = (time, day = 1, alarm = true) => [{
        id: 'principal', horario: time, recorrencia: 'mensal', diaMes: day, dias: [], dataUnica: '', alarme: alarm
    }];
    const everyMonths = (time, months, alarm = true) => [{
        id: 'principal', horario: time, recorrencia: 'intervalo_meses', intervaloMeses: months,
        dataInicio: new Date().toISOString().slice(0, 10), dias: [], dataUnica: '', alarme: alarm
    }];

    const templates = [
        {
            id: 'higienizar_bancadas', icon: '🧽', category: 'Cozinha', group: 'Higienização', areaHint: 'cozinha',
            name: 'Higienizar bancadas', expected: 15, pop: true, schedules: daily(['07:30', '16:00']),
            summary: 'Antes do preparo e após o turno.',
            procedure: '<ol><li>Retire alimentos, embalagens e utensílios.</li><li>Remova os resíduos sem espalhar a sujeira.</li><li>Lave com produto indicado para a superfície.</li><li>Enxágue quando o fabricante determinar.</li><li>Aplique o saneante indicado, respeitando o rótulo, a diluição e o tempo de contato.</li><li>Finalize conforme o fabricante e deixe a bancada protegida contra nova contaminação.</li><li>Recoloque apenas materiais limpos.</li></ol>'
        },
        {
            id: 'higienizar_piso', icon: '🧹', category: 'Ambientes', group: 'Higienização', areaHint: 'cozinha',
            name: 'Higienizar piso', expected: 25, pop: true, schedules: daily(['15:00', '22:00']),
            summary: 'Após os picos e no fechamento.',
            procedure: '<ol><li>Isole e sinalize a área.</li><li>Retire os resíduos maiores.</li><li>Faça limpeza úmida, evitando levantar partículas perto de alimentos.</li><li>Trabalhe do ponto mais limpo para o mais sujo.</li><li>Remova ou enxágue o produto conforme o rótulo.</li><li>Aplique desinfecção quando prevista no POP.</li><li>Confira ralos, cantos e ausência de água acumulada antes de liberar a área.</li></ol>'
        },
        {
            id: 'higienizar_equipamentos', icon: '⚙️', category: 'Cozinha', group: 'Higienização', areaHint: 'cozinha',
            name: 'Higienizar equipamentos e utensílios', expected: 25, pop: true, schedules: daily(['22:00']),
            summary: 'Após o uso ou no encerramento.',
            procedure: '<ol><li>Desligue o equipamento e confirme que a operação é segura.</li><li>Retire alimentos e desmonte somente conforme o manual.</li><li>Remova os resíduos.</li><li>Lave peças e superfícies com utensílios próprios.</li><li>Enxágue quando indicado.</li><li>Aplique saneante compatível com a superfície e com contato com alimentos.</li><li>Respeite o rótulo do produto.</li><li>Seque, remonte e confira antes de liberar para uso.</li></ol>'
        },
        {
            id: 'higienizar_hortifruti', icon: '🥬', category: 'Alimentos', group: 'Alimentos', areaHint: 'cozinha',
            name: 'Higienizar frutas, verduras e hortaliças', expected: 25, pop: true, schedules: daily(['08:00']),
            summary: 'Por lote, antes do preparo ou consumo cru.',
            procedure: '<ol><li>Higienize mãos, bancada e utensílios.</li><li>Selecione e descarte partes deterioradas.</li><li>Lave folhas uma a uma e frutas ou legumes individualmente em água corrente potável.</li><li>Prepare a solução apenas com produto regularizado e indicado para alimentos.</li><li>Siga exatamente a diluição e o tempo de contato do fabricante.</li><li>Enxágue quando o rótulo determinar.</li><li>Escorra protegendo contra recontaminação.</li><li>Corte com utensílios limpos e refrigere quando necessário.</li></ol>'
        },
        {
            id: 'higienizar_reservatorio', icon: '💧', category: 'Manutenção', group: 'Água', areaHint: 'manutenção',
            name: 'Higienizar caixa d’água ou cisterna', expected: 180, pop: true,
            schedules: [{ id: 'principal', horario: '07:00', recorrencia: 'intervalo_meses', intervaloMeses: 6, dataInicio: new Date().toISOString().slice(0, 10), dias: [], dataUnica: '', alarme: true }],
            summary: 'Programação semestral e registro obrigatório.',
            procedure: '<ol><li>Programe a interrupção sem comprometer alimentos e higiene.</li><li>Inspecione tampa, rachaduras, infiltrações e vazamentos.</li><li>Execute esvaziamento, limpeza e desinfecção conforme o POP aprovado.</li><li>Impeça a entrada de sujeira durante o serviço.</li><li>Restabeleça o abastecimento e confira as condições da água.</li><li>Registre responsável, execução e próxima data.</li><li>Anexe certificado ou laudo quando o serviço for terceirizado.</li></ol>'
        },
        {
            id: 'higienizar_banheiro', icon: '🚻', category: 'Ambientes', group: 'Higienização', areaHint: 'banheiro',
            name: 'Higienizar banheiro', expected: 15, pop: true, schedules: daily(['08:00', '12:00', '16:00', '20:00']),
            summary: 'Verificações periódicas e sempre que necessário.',
            procedure: '<ol><li>Sinalize e restrinja o acesso.</li><li>Use uniforme e materiais exclusivos do banheiro.</li><li>Retire os resíduos.</li><li>Limpe vaso, pia, torneiras, maçanetas e pontos de contato.</li><li>Higienize o piso do ponto mais limpo para o mais sujo.</li><li>Aplique os produtos conforme o rótulo.</li><li>Reponha sabonete, papel higiênico e material para secagem das mãos.</li><li>Libere o ambiente somente quando estiver seguro.</li></ol>'
        },
        {
            id: 'higienizar_salao', icon: '🪑', category: 'Salão', group: 'Higienização', areaHint: 'salão',
            name: 'Higienizar e organizar salão', expected: 20, pop: true, schedules: daily(['10:30', '22:00']),
            summary: 'Antes da abertura e no fechamento.',
            procedure: '<ol><li>Retire resíduos e louças.</li><li>Limpe mesas, cadeiras, cardápios e superfícies tocadas.</li><li>Aplique produto compatível conforme o fabricante.</li><li>Higienize o piso sem contaminar mesas ou alimentos.</li><li>Confira lixeiras, lavatórios e pontos de apoio.</li><li>Libere mesas somente limpas, secas e organizadas.</li></ol>'
        },
        {
            id: 'inspecionar_instalacoes', icon: '🏢', category: 'Gestão', group: 'Infraestrutura', areaHint: 'gestão',
            name: 'Inspecionar instalações', expected: 30, pop: true, schedules: weekly('07:00', [1]),
            procedure: '<ol><li>Confira piso, paredes e teto: integridade, infiltrações, bolor, rachaduras e descascamentos.</li><li>Confira portas, fechamento automático, janelas, telas e ralos.</li><li>Verifique iluminação protegida, ventilação, exaustão e ausência de condensação sobre alimentos.</li><li>Confirme que não há animais, objetos em desuso ou cruzamento de fluxos com risco de contaminação.</li><li>Verifique lavatórios exclusivos para as mãos e os insumos necessários.</li><li>Registre cada não conformidade, responsável pela correção e prazo.</li></ol>'
        },
        {
            id: 'manutencao_calibracao', icon: '🛠️', category: 'Gestão', group: 'Infraestrutura', areaHint: 'gestão',
            name: 'Revisar manutenção e calibração', expected: 45, pop: true, schedules: everyMonths('08:00', 3),
            procedure: '<ol><li>Liste equipamentos, utensílios e instrumentos de medição em uso.</li><li>Confira conservação, funcionamento, ferrugem, trincas, frestas e superfícies danificadas.</li><li>Verifique manutenção preventiva vencida ou próxima do vencimento.</li><li>Teste ou encaminhe termômetros e instrumentos para calibração conforme o plano do estabelecimento.</li><li>Retire de uso o que possa contaminar alimentos ou gerar medição insegura.</li><li>Registre serviço, resultado, responsável e próxima data.</li></ol>'
        },
        {
            id: 'triagem_saude_manipuladores', icon: '🩺', category: 'Gestão', group: 'Manipuladores', areaHint: 'gestão',
            name: 'Verificar saúde dos manipuladores', expected: 10, pop: true, schedules: daily(['07:00']),
            procedure: '<ol><li>Antes do início do trabalho, verifique se alguém relata vômito, diarreia, febre, infecção, lesão exposta ou outro sintoma que possa comprometer os alimentos.</li><li>Observe ferimentos nas mãos e condições que impeçam manipulação segura.</li><li>Afaste da preparação de alimentos quem apresentar condição de risco enquanto ela persistir.</li><li>Direcione a pessoa para avaliação e atividade compatível conforme a gestão do estabelecimento.</li><li>Registre somente a verificação e a providência adotada; dados médicos devem permanecer em controle restrito.</li></ol>'
        },
        {
            id: 'controle_saude_documental', icon: '🗂️', category: 'Gestão', group: 'Manipuladores', areaHint: 'gestão',
            name: 'Atualizar controle de saúde da equipe', expected: 30, pop: true, schedules: monthly('09:00', 1),
            procedure: '<ol><li>Confira se o controle de saúde de cada manipulador está vigente conforme a legislação aplicável.</li><li>Verifique pendências de avaliações periódicas e retornos.</li><li>Confirme que afastamentos e liberações foram tratados antes do retorno à manipulação.</li><li>Mantenha documentos de saúde em acesso restrito.</li><li>Registre a conferência, as pendências e os prazos sem expor diagnóstico no checklist operacional.</li></ol>'
        },
        {
            id: 'apresentacao_manipuladores', icon: '🧑‍🍳', category: 'Operação', group: 'Manipuladores', areaHint: 'cozinha',
            name: 'Conferir higiene e uniforme da equipe', expected: 10, pop: true, schedules: daily(['07:05']),
            procedure: '<ol><li>Confira uniforme limpo, conservado, de uso interno e trocado diariamente.</li><li>Confirme cabelos protegidos, unhas curtas e sem esmalte, ausência de adornos e asseio pessoal.</li><li>Verifique se objetos pessoais estão no local reservado.</li><li>Reforce lavagem das mãos ao chegar, antes e depois de manipular alimentos, após interrupções, materiais contaminados e sanitários.</li><li>Confirme que não se fuma, fala desnecessariamente, canta, assobia, espirra ou tosse sobre alimentos.</li><li>Corrija a não conformidade antes de liberar a manipulação.</li></ol>'
        },
        {
            id: 'inspecionar_lavatorios', icon: '🧼', category: 'Operação', group: 'Manipuladores', areaHint: 'cozinha',
            name: 'Conferir lavatórios e higiene das mãos', expected: 8, pop: true, schedules: daily(['07:10', '15:00']),
            procedure: '<ol><li>Confira água corrente e funcionamento do lavatório exclusivo.</li><li>Reponha sabonete líquido inodoro, antisséptico quando previsto e material higiênico para secagem.</li><li>Confira coletor de papel sem contato manual.</li><li>Verifique cartazes de orientação e acesso desobstruído.</li><li>Remova materiais estranhos e registre falta ou defeito.</li></ol>'
        },
        {
            id: 'capacitar_manipuladores', icon: '🎓', category: 'Gestão', group: 'Manipuladores', areaHint: 'gestão',
            name: 'Capacitar manipuladores', expected: 90, pop: true, schedules: everyMonths('09:00', 6),
            procedure: '<ol><li>Realize capacitação em contaminantes alimentares, doenças transmitidas por alimentos, manipulação higiênica e Boas Práticas.</li><li>Inclua os procedimentos específicos do estabelecimento e as falhas observadas no período.</li><li>Verifique compreensão com demonstração ou avaliação simples.</li><li>Registre conteúdo, data, carga horária, instrutor e participantes.</li><li>Programe reforço quando houver mudança de função, procedimento ou não conformidade recorrente.</li></ol>'
        },
        {
            id: 'inspecionar_pragas', icon: '🔎', category: 'Gestão', group: 'Pragas e resíduos', areaHint: 'gestão',
            name: 'Inspecionar vetores e pragas', expected: 20, pop: true, schedules: weekly('07:15', [1, 4]),
            procedure: '<ol><li>Procure fezes, ninhos, insetos, roeduras, trilhas, odores e embalagens danificadas.</li><li>Confira telas, portas, ralos, frestas e outros pontos de acesso.</li><li>Verifique áreas externas, depósitos, resíduos e locais que ofereçam alimento, água ou abrigo.</li><li>Não aplique produto químico por conta própria nas áreas de alimento.</li><li>Isole produtos afetados e acione a empresa especializada quando necessário.</li><li>Registre achados, local, correção e acompanhamento.</li></ol>'
        },
        {
            id: 'controle_profissional_pragas', icon: '🛡️', category: 'Gestão', group: 'Pragas e resíduos', areaHint: 'gestão',
            name: 'Revisar controle profissional de pragas', expected: 30, pop: true, schedules: monthly('08:00', 1),
            procedure: '<ol><li>Confira validade do contrato, cronograma e licença da empresa especializada.</li><li>Revise mapa de pontos, evidências encontradas e medidas preventivas.</li><li>Na aplicação química, registre produto, princípio ativo, concentração, locais, cuidados antes e depois e responsável técnico.</li><li>Proteja alimentos, equipamentos e utensílios conforme as orientações do serviço.</li><li>Confira o relatório de execução e programe as correções estruturais indicadas.</li></ol>'
        },
        {
            id: 'manejar_residuos', icon: '🗑️', category: 'Operação', group: 'Pragas e resíduos', areaHint: 'cozinha',
            name: 'Retirar e armazenar resíduos', expected: 12, pop: true, schedules: daily(['10:00', '15:00', '22:00']),
            procedure: '<ol><li>Recolha resíduos antes de transbordar e sempre que necessário.</li><li>Feche os sacos sem encostar em alimentos ou superfícies limpas.</li><li>Higienize as mãos após o manejo.</li><li>Limpe os coletores com tampa e acionamento sem contato manual.</li><li>Leve os resíduos para local fechado e isolado das áreas de preparação e armazenamento.</li><li>Confira ausência de vazamentos, odores e atração de pragas.</li></ol>'
        },
        {
            id: 'receber_materias_primas', icon: '📦', category: 'Estoque', group: 'Alimentos', areaHint: 'estoque',
            name: 'Conferir recebimento de alimentos', expected: 20, pop: true, schedules: daily(['08:00']),
            procedure: '<ol><li>Receba em área protegida e limpa.</li><li>Confira fornecedor, validade, lote, integridade da embalagem, rotulagem e condições do transporte.</li><li>Meça a temperatura dos perecíveis conforme o padrão do estabelecimento e do produto.</li><li>Recuse itens vencidos, violados, sujos, com sinais de pragas, descongelamento ou temperatura inadequada.</li><li>Registre produto, fornecedor, resultado e providência.</li><li>Guarde rapidamente os itens aprovados nas condições corretas.</li></ol>'
        },
        {
            id: 'conferir_estoque_validade', icon: '🏷️', category: 'Estoque', group: 'Alimentos', areaHint: 'estoque',
            name: 'Conferir estoque, validade e identificação', expected: 20, pop: true, schedules: daily(['09:00']),
            procedure: '<ol><li>Organize pela validade e ordem de entrada.</li><li>Confira produtos abertos ou fracionados: nome, data de abertura ou fracionamento e prazo de validade.</li><li>Mantenha alimentos protegidos, afastados do piso e com espaço para ventilação e limpeza.</li><li>Separe saneantes, descartáveis e itens reprovados dos alimentos.</li><li>Retire vencidos, danificados ou sem identificação segura.</li><li>Registre perdas e correções.</li></ol>'
        },
        {
            id: 'registrar_temperaturas_equipamentos', icon: '🌡️', category: 'Operação', group: 'Alimentos', areaHint: 'cozinha',
            name: 'Registrar temperaturas de conservação', expected: 12, pop: true, schedules: daily(['08:00', '16:00', '22:00']),
            procedure: '<ol><li>Use termômetro limpo e verificado.</li><li>Meça câmaras, geladeiras, freezers e equipamentos de manutenção quente.</li><li>Compare com os limites definidos no Manual de Boas Práticas e na legislação aplicável.</li><li>Repita a medição quando houver resultado duvidoso.</li><li>Corrija imediatamente desvio que possa comprometer alimentos.</li><li>Registre equipamento, horário, temperatura, responsável e ação corretiva.</li></ol>'
        },
        {
            id: 'controle_termico_preparo', icon: '🍲', category: 'Operação', group: 'Alimentos', areaHint: 'cozinha',
            name: 'Controlar cocção e manutenção quente', expected: 15, pop: true, schedules: daily(['11:00', '18:00']),
            procedure: '<ol><li>Higienize o termômetro antes e depois de cada medição.</li><li>Meça o centro ou a parte mais fria do alimento.</li><li>Confirme tratamento térmico de pelo menos 70 °C em todas as partes, salvo processo validado com outra combinação de tempo e temperatura.</li><li>Na conservação quente, mantenha acima de 60 °C por no máximo 6 horas.</li><li>Registre alimento, lote, horário, temperatura e ação corretiva.</li></ol>'
        },
        {
            id: 'controlar_resfriamento', icon: '❄️', category: 'Operação', group: 'Alimentos', areaHint: 'cozinha',
            name: 'Controlar resfriamento e identificação', expected: 20, pop: true, schedules: daily(['14:00', '20:00']),
            procedure: '<ol><li>Divida ou acondicione o alimento para resfriar com rapidez e sem contaminação cruzada.</li><li>Monitore a redução de 60 °C para 10 °C em até 2 horas.</li><li>Depois, mantenha sob refrigeração abaixo de 5 °C ou congele a -18 °C ou menos.</li><li>Identifique nome, data de preparo e prazo de validade.</li><li>Registre horários, temperaturas e ação adotada em caso de desvio.</li></ol>'
        },
        {
            id: 'conferir_exposicao_alimentos', icon: '🍽️', category: 'Salão', group: 'Alimentos', areaHint: 'salão',
            name: 'Conferir exposição e distribuição', expected: 15, pop: true, schedules: daily(['11:15', '18:15']),
            procedure: '<ol><li>Confira organização e higiene da área de exposição.</li><li>Proteja os alimentos contra aproximação, toque, saliva, poeira e outras fontes de contaminação.</li><li>Verifique utensílios exclusivos e em quantidade suficiente.</li><li>Monitore tempo e temperatura dos alimentos expostos.</li><li>Confirme que funcionários de recebimento de dinheiro não manipulam alimento preparado sem a higiene necessária.</li><li>Registre desvios e correções.</li></ol>'
        },
        {
            id: 'conferir_transporte_delivery', icon: '🛵', category: 'Delivery', group: 'Alimentos', areaHint: 'delivery',
            name: 'Conferir transporte e delivery', expected: 12, pop: true, schedules: daily(['11:00', '18:00']),
            procedure: '<ol><li>Identifique alimentos com nome, data de preparo e prazo de validade quando aplicável.</li><li>Confira embalagem íntegra e proteção contra contaminantes.</li><li>Verifique limpeza do compartimento ou veículo e ausência de pragas.</li><li>Mantenha tempo e temperatura compatíveis com a segurança do alimento.</li><li>Não transporte junto com carga que possa contaminar.</li><li>Registre temperatura ou condição de saída conforme o plano do estabelecimento.</li></ol>'
        },
        {
            id: 'revisar_manual_pops', icon: '📚', category: 'Gestão', group: 'Gestão', areaHint: 'gestão',
            name: 'Revisar Manual de Boas Práticas e POPs', expected: 60, pop: true, schedules: monthly('10:00', 1),
            procedure: '<ol><li>Confira se o Manual de Boas Práticas corresponde à operação atual.</li><li>Revise os POPs de higienização, pragas, reservatório e higiene e saúde dos manipuladores.</li><li>Confirme instruções sequenciais, frequência, responsáveis, aprovação, data e assinatura.</li><li>Verifique se documentos estão acessíveis à equipe e disponíveis para a autoridade sanitária.</li><li>Confira registros dos últimos 30 dias ou pelo prazo maior exigido localmente.</li><li>Registre revisões, pendências e responsáveis.</li></ol>'
        },
        {
            id: 'revisar_responsavel_boas_praticas', icon: '✅', category: 'Gestão', group: 'Gestão', areaHint: 'gestão',
            name: 'Conferir responsável por Boas Práticas', expected: 20, pop: true, schedules: everyMonths('10:00', 6),
            procedure: '<ol><li>Confirme proprietário ou funcionário formalmente designado para as atividades de manipulação.</li><li>Verifique comprovante de capacitação em contaminantes, doenças transmitidas por alimentos, manipulação higiênica e Boas Práticas.</li><li>Atualize substituto e contatos para períodos de ausência.</li><li>Registre validade dos documentos e necessidade de reciclagem.</li></ol>'
        },
        {
            id: 'controlar_potabilidade_agua', icon: '🚰', category: 'Gestão', group: 'Água', areaHint: 'gestão',
            name: 'Conferir potabilidade da água', expected: 30, pop: true, schedules: everyMonths('08:00', 6),
            procedure: '<ol><li>Confirme origem da água e integridade do sistema de abastecimento.</li><li>Quando houver solução alternativa, confira laudos e controles exigidos pela legislação de potabilidade.</li><li>Verifique gelo e vapor que entram em contato com alimentos.</li><li>Confira registros de higienização do reservatório e providências após interrupção ou suspeita de contaminação.</li><li>Registre documento verificado, resultado, responsável e próxima data.</li></ol>'
        }
    ];

    global.AloTaskTemplates = Object.freeze({
        templates,
        sources: [
            { label: 'RDC Anvisa 216/2004', url: 'https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2004/res0216_15_09_2004.html' },
            { label: 'Portaria GM/MS 888/2021', url: 'https://bvsms.saude.gov.br/bvs/saudelegis/gm/2021/prt0888_24_05_2021_rep.html' }
        ]
    });
})(window);
