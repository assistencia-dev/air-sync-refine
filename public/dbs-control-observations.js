/* DBS Control — exibição segura do histórico de observações técnicas. */
(function installDbsObservationHistory() {
  'use strict';

  const fields = [
    'observacaoTecnico',
    'observacoesTecnico',
    'observacao',
    'observacaoComplementarTecnico',
    'observacoes',
    'obs',
    'observation',
  ];

  function renderObservationHistory() {
    const modal = document.getElementById('dbs-os-detail-modal');
    if (!modal || modal.querySelector('.dbs-os-observation-history')) return;

    const sections = [...modal.querySelectorAll('section')];
    const execution = sections.find((section) =>
      section.querySelector('b')?.textContent.trim() === 'Execução de campo'
    );
    if (!execution) return;

    const title = modal.querySelector('strong')?.textContent || '';
    const orderId = title.replace(/^OS\s*/i, '').split(' · ')[0].trim();
    const activeState = typeof ERP_STATE !== 'undefined' ? ERP_STATE : window.ERP_STATE;
    const order = (activeState?.ordens || []).find((item) => String(item.id) === orderId);
    if (!order) return;

    const observations = [...new Set(fields
      .map((field) => String(order[field] ?? '').trim())
      .filter(Boolean))];

    const panel = document.createElement('div');
    panel.className = 'dbs-os-observation-history';
    const heading = document.createElement('strong');
    heading.textContent = 'Observações do técnico';
    const content = document.createElement('p');
    content.textContent = observations.length
      ? observations.join('\n\n')
      : 'Nenhuma observação registrada.';
    panel.append(heading, content);
    execution.appendChild(panel);
  }

  const observer = new MutationObserver(renderObservationHistory);
  observer.observe(document.body, { childList: true, subtree: true });
  renderObservationHistory();
})();
