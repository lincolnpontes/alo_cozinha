(function (global) {
    const daily = (times, alarm = true) => times.map((time, index) => ({
        id: index === 0 ? 'principal' : `horario_modelo_${index + 1}`,
        horario: time,
        recorrencia: 'diaria',
        dias: [0, 1, 2, 3, 4, 5, 6],
        dataUnica: '',
        alarme: alarm
    }));

    const templates = [
        {
            id: 'higienizar_bancadas', icon: '🧽', category: 'Cozinha', areaHint: 'cozinha',
            name: 'Higienizar bancadas', expected: 15, pop: true, schedules: daily(['07:30', '16:00']),
            summary: 'Antes do preparo e após o turno.',
            procedure: '<ol><li>Retire alimentos, embalagens e utensílios.</li><li>Remova os resíduos sem espalhar a sujeira.</li><li>Lave com produto indicado para a superfície.</li><li>Enxágue quando o fabricante determinar.</li><li>Aplique o saneante indicado, respeitando o rótulo, a diluição e o tempo de contato.</li><li>Finalize conforme o fabricante e deixe a bancada protegida contra nova contaminação.</li><li>Recoloque apenas materiais limpos.</li></ol>'
        },
        {
            id: 'higienizar_piso', icon: '🧹', category: 'Ambientes', areaHint: 'cozinha',
            name: 'Higienizar piso', expected: 25, pop: true, schedules: daily(['15:00', '22:00']),
            summary: 'Após os picos e no fechamento.',
            procedure: '<ol><li>Isole e sinalize a área.</li><li>Retire os resíduos maiores.</li><li>Faça limpeza úmida, evitando levantar partículas perto de alimentos.</li><li>Trabalhe do ponto mais limpo para o mais sujo.</li><li>Remova ou enxágue o produto conforme o rótulo.</li><li>Aplique desinfecção quando prevista no POP.</li><li>Confira ralos, cantos e ausência de água acumulada antes de liberar a área.</li></ol>'
        },
        {
            id: 'higienizar_equipamentos', icon: '⚙️', category: 'Cozinha', areaHint: 'cozinha',
            name: 'Higienizar equipamentos e utensílios', expected: 25, pop: true, schedules: daily(['22:00']),
            summary: 'Após o uso ou no encerramento.',
            procedure: '<ol><li>Desligue o equipamento e confirme que a operação é segura.</li><li>Retire alimentos e desmonte somente conforme o manual.</li><li>Remova os resíduos.</li><li>Lave peças e superfícies com utensílios próprios.</li><li>Enxágue quando indicado.</li><li>Aplique saneante compatível com a superfície e com contato com alimentos.</li><li>Respeite o rótulo do produto.</li><li>Seque, remonte e confira antes de liberar para uso.</li></ol>'
        },
        {
            id: 'higienizar_hortifruti', icon: '🥬', category: 'Alimentos', areaHint: 'cozinha',
            name: 'Higienizar frutas, verduras e hortaliças', expected: 25, pop: true, schedules: daily(['08:00']),
            summary: 'Por lote, antes do preparo ou consumo cru.',
            procedure: '<ol><li>Higienize mãos, bancada e utensílios.</li><li>Selecione e descarte partes deterioradas.</li><li>Lave folhas uma a uma e frutas ou legumes individualmente em água corrente potável.</li><li>Prepare a solução apenas com produto regularizado e indicado para alimentos.</li><li>Siga exatamente a diluição e o tempo de contato do fabricante.</li><li>Enxágue quando o rótulo determinar.</li><li>Escorra protegendo contra recontaminação.</li><li>Corte com utensílios limpos e refrigere quando necessário.</li></ol>'
        },
        {
            id: 'higienizar_reservatorio', icon: '💧', category: 'Manutenção', areaHint: 'manutenção',
            name: 'Higienizar caixa d’água ou cisterna', expected: 180, pop: true,
            schedules: [{ id: 'principal', horario: '07:00', recorrencia: 'intervalo_meses', intervaloMeses: 6, dataInicio: new Date().toISOString().slice(0, 10), dias: [], dataUnica: '', alarme: true }],
            summary: 'Programação semestral e registro obrigatório.',
            procedure: '<ol><li>Programe a interrupção sem comprometer alimentos e higiene.</li><li>Inspecione tampa, rachaduras, infiltrações e vazamentos.</li><li>Execute esvaziamento, limpeza e desinfecção conforme o POP aprovado.</li><li>Impeça a entrada de sujeira durante o serviço.</li><li>Restabeleça o abastecimento e confira as condições da água.</li><li>Registre responsável, execução e próxima data.</li><li>Anexe certificado ou laudo quando o serviço for terceirizado.</li></ol>'
        },
        {
            id: 'higienizar_banheiro', icon: '🚻', category: 'Ambientes', areaHint: 'banheiro',
            name: 'Higienizar banheiro', expected: 15, pop: true, schedules: daily(['08:00', '12:00', '16:00', '20:00']),
            summary: 'Verificações periódicas e sempre que necessário.',
            procedure: '<ol><li>Sinalize e restrinja o acesso.</li><li>Use uniforme e materiais exclusivos do banheiro.</li><li>Retire os resíduos.</li><li>Limpe vaso, pia, torneiras, maçanetas e pontos de contato.</li><li>Higienize o piso do ponto mais limpo para o mais sujo.</li><li>Aplique os produtos conforme o rótulo.</li><li>Reponha sabonete, papel higiênico e material para secagem das mãos.</li><li>Libere o ambiente somente quando estiver seguro.</li></ol>'
        },
        {
            id: 'higienizar_salao', icon: '🪑', category: 'Salão', areaHint: 'salão',
            name: 'Higienizar e organizar salão', expected: 20, pop: true, schedules: daily(['10:30', '22:00']),
            summary: 'Antes da abertura e no fechamento.',
            procedure: '<ol><li>Retire resíduos e louças.</li><li>Limpe mesas, cadeiras, cardápios e superfícies tocadas.</li><li>Aplique produto compatível conforme o fabricante.</li><li>Higienize o piso sem contaminar mesas ou alimentos.</li><li>Confira lixeiras, lavatórios e pontos de apoio.</li><li>Libere mesas somente limpas, secas e organizadas.</li></ol>'
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
