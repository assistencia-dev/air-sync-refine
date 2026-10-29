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
      'atendimentos': 'tab-pwa',
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
    document.querySelectorAll('#dbs-employee-bottom-nav [data-dbs-target]').forEach(button => {
      const active = button.getAttribute('data-dbs-target') === id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const titleMap = {
      'tab-dashboard': ['Meu painel', 'Progresso e operação do colaborador'],
      'tab-pwa': ['Atendimentos', 'Execução das ordens atribuídas ao colaborador'],
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

  function syncIssueVisibility() {
    const params = new URLSearchParams(window.location.search);
    const canIssue = params.get('can_issue_os') === '1' && params.get('base_active') !== '0';
    const issueItems = document.querySelectorAll('aside .nav-item[data-employee-issue-visible="true"]');
    issueItems.forEach(item => {
      item.hidden = !canIssue;
      item.setAttribute('aria-hidden', canIssue ? 'false' : 'true');
      item.style.setProperty('display', canIssue ? 'flex' : 'none', 'important');
    });
    const issueBottomItems = document.querySelectorAll('#dbs-employee-bottom-nav [data-employee-issue-nav="true"]');
    issueBottomItems.forEach(item => {
      item.hidden = !canIssue;
      item.setAttribute('aria-hidden', canIssue ? 'false' : 'true');
      item.style.setProperty('display', canIssue ? 'flex' : 'none', 'important');
    });
    document.body.classList.toggle('dbs-control-can-issue-os', canIssue);
    const issueCta = document.getElementById('dbs-employee-issue-cta');
    if (issueCta) {
      issueCta.hidden = true;
      issueCta.setAttribute('aria-hidden', 'true');
    }
    return canIssue;
  }

  function install() {
    if (window.__dbsEmployeeNavigationInstalled) return;
    if (!document.body.classList.contains('dbs-control-employee-mode')) return;
    window.__dbsEmployeeNavigationInstalled = true;
    syncIssueVisibility();
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
    window.setTimeout(syncIssueVisibility, 0);
  }

  if (document.readyState === 'loading') {
    // O script é carregado no fim do HTML; instalar já garante precedência
    // sobre os handlers legados que também escutam a navegação em captura.
    install();
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else install();
})();
