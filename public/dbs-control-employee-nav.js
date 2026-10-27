(function dbsControlEmployeeNavigation(){
  'use strict';
  if (window.__dbsControlEmployeeNavigation) return;
  window.__dbsControlEmployeeNavigation = true;

  function targetId(item) {
    const explicit = item.getAttribute('data-dbs-target') || item.getAttribute('data-tab');
    if (explicit) return explicit;
    const inline = item.getAttribute('onclick') || '';
    const match = inline.match(/switchTab\(\s*['"]([^'"]+)['"]/);
    if (match) return match[1];
    const text = (item.textContent || '').trim().toLocaleLowerCase('pt-BR');
    return ({
      'dashboard': 'tab-dashboard',
      'dashboard principal': 'tab-dashboard',
      'meu painel': 'tab-dashboard',
      'minhas os': 'tab-pwa',
      'emitir os': 'tab-nova-os'
    })[text] || '';
  }

  function activate(id, item) {
    const target = document.getElementById(id);
    if (!target) return false;
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view === target);
    });
    document.querySelectorAll('aside .nav-item').forEach(navItem => {
      navItem.classList.toggle('active', navItem === item);
      if (navItem === item) navItem.setAttribute('aria-current', 'page');
      else navItem.removeAttribute('aria-current');
    });
    const titleMap = {
      'tab-dashboard': ['Meu painel', 'Progresso e operação do colaborador'],
      'tab-pwa': ['Minhas OS', 'Execução das Ordens de Serviço do colaborador'],
      'tab-nova-os': ['Emitir OS', 'Nova ordem dentro da base vinculada']
    };
    const meta = titleMap[id];
    if (meta) {
      const title = document.getElementById('view-title');
      const subtitle = document.getElementById('view-subtitle');
      if (title) title.textContent = meta[0];
      if (subtitle) subtitle.textContent = meta[1];
    }
    try {
      if (typeof window.renderizarAbaAtiva === 'function') window.renderizarAbaAtiva(id);
      else if (id === 'tab-pwa' && typeof window.renderizarPWAScreen === 'function') window.renderizarPWAScreen();
    } catch (error) {
      console.warn('DBS CONTROL: falha ao renderizar a aba do colaborador', error);
    }
    return true;
  }

  function install() {
    if (!document.body.classList.contains('dbs-control-employee-mode')) return;
    document.addEventListener('click', function(event) {
      const item = event.target && event.target.closest ? event.target.closest('aside .nav-item') : null;
      if (!item) return;
      const id = targetId(item);
      if (!id) return;
      const allowed = id === 'tab-dashboard' || id === 'tab-pwa'
        || (document.body.classList.contains('dbs-control-can-issue-os') && id === 'tab-nova-os');
      if (!allowed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activate(id, item);
    }, true);
    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target && event.target.closest ? event.target.closest('aside .nav-item') : null;
      if (!item) return;
      const id = targetId(item);
      if (!id) return;
      const allowed = id === 'tab-dashboard' || id === 'tab-pwa'
        || (document.body.classList.contains('dbs-control-can-issue-os') && id === 'tab-nova-os');
      if (!allowed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activate(id, item);
    }, true);
    const dashboardNav = document.querySelector('aside .nav-item[data-employee-dashboard-visible="true"]');
    if (dashboardNav) activate('tab-dashboard', dashboardNav);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
