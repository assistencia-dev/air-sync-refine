import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import { getMyProfile } from "@/lib/auth.functions";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/treasury")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "DBS TREASURY | Financeiro" },
      { name: "description", content: "Módulo Financeiro DBS TREASURY Enterprise Executive Suite" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TreasuryPage,
});

const NATIVE_ADMIN_USERNAMES = new Set(["DBS123", "DBSASSISTENCIA123"]);

// HTML completo do DBS TREASURY V10 fornecido pelo usuário
// Os links de CDN foram removidos das crases acidentais no original
const TREASURY_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DBS TREASURY - Enterprise Executive Suite</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <style>
        :root {
            --bg-main: #F8FAFC;
            --surface: #FFFFFF;
            --border: #E2E8F0;
            --border-light: #F1F5F9;
            --text-main: #0F172A;
            --text-muted: #64748B;
            --brand-primary: #2563EB;
            --brand-light: #EFF6FF;
            --emerald: #10B981;
            --emerald-light: #ECFDF5;
            --rose: #EF4444;
            --rose-light: #FEF2F2;
            --amber: #F59E0B;
            --amber-light: #FFFBEB;
            --radius-lg: 12px;
            --radius-md: 8px;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -1px rgba(0, 0, 0, 0.02);
        }

        * { box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; padding: 0; }
        body { background: var(--bg-main); color: var(--text-main); height: 100vh; overflow: hidden; display: flex; }

        .sidebar { width: 270px; background: #0F172A; color: #fff; display: flex; flex-direction: column; justify-content: space-between; flex-shrink: 0; overflow-y: auto; }
        .sidebar-brand { padding: 24px 20px; border-bottom: 1px solid #1E293B; }
        .sidebar-brand h2 { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 10px; letter-spacing: -0.2px; }
        .sidebar-brand span { font-size: 11px; color: #64748B; font-weight: 500; display: block; margin-top: 4px; }

        .menu-group { padding: 12px 0 4px 0; }
        .menu-title { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; padding: 0 20px 6px 20px; letter-spacing: 0.6px; }
        .nav-item { padding: 9px 20px; color: #94A3B8; text-decoration: none; font-size: 12.5px; font-weight: 500; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s; }
        .nav-item:hover { color: #F8FAFC; background: rgba(255,255,255,0.03); }
        .nav-item.active { background: rgba(37, 99, 235, 0.12); color: #60A5FA; font-weight: 600; border-right: 3px solid #3B82F6; }

        .sidebar-footer { padding: 16px 20px; background: #080D1A; font-size: 11px; color: #475569; border-top: 1px solid #1E293B; }

        .main-wrapper { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .top-navbar { background: var(--surface); padding: 14px 32px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; }
        .page-header h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
        .page-header p { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

        .content-area { padding: 28px 32px; display: flex; flex-direction: column; gap: 20px; max-width: 1500px; margin: 0 auto; width: 100%; }
        .module-section { display: none; flex-direction: column; gap: 20px; }
        .module-section.active { display: flex; }

        .alert-bar { background: var(--rose-light); border: 1px solid #FCA5A5; border-radius: var(--radius-md); padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #991B1B; }

        .btn { padding: 8px 14px; border-radius: var(--radius-md); border: 1px solid transparent; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; }
        .btn-primary { background: var(--brand-primary); color: white; box-shadow: var(--shadow-sm); }
        .btn-primary:hover { background: #1D4ED8; }
        .btn-secondary { background: var(--surface); border-color: var(--border); color: var(--text-main); }
        .btn-secondary:hover { background: var(--bg-main); border-color: #CBD5E1; }
        .btn-success { background: var(--emerald); color: white; }
        .btn-success:hover { background: #059669; }
        .btn-danger { background: var(--rose); color: white; }
        .btn-danger:hover { background: #DC2626; }
        .btn-dark { background: var(--text-main); color: white; }

        .btn-warning { background: var(--amber); color: white; }
        .btn-warning:hover { background: #D97706; }
        .bank-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
        .bank-status { font-size:10px; color:var(--text-muted); margin-top:3px; }
        .archived-item { opacity:.65; }

        .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
        .kpi-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-sm); cursor: pointer; transition: transform 0.2s; }
        .kpi-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .kpi-title { font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .kpi-value { font-size: 22px; font-weight: 700; margin-top: 8px; color: var(--text-main); letter-spacing: -0.5px; }
        .kpi-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

        .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 22px; box-shadow: var(--shadow-sm); }
        .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .panel-title { font-size: 14.5px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 10px; letter-spacing: -0.2px; }

        .filter-bar { background: var(--surface); padding: 14px 18px; border-radius: var(--radius-lg); border: 1px solid var(--border); display: flex; gap: 14px; align-items: center; flex-wrap: wrap; box-shadow: var(--shadow-sm); }
        .filter-group { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
        .filter-group label { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .filter-group input, .filter-group select { padding: 8px 11px; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12px; outline: none; background: var(--bg-main); }
        .filter-group input:focus, .filter-group select:focus { border-color: var(--brand-primary); background: #fff; }

        .contract-card { border: 1px solid var(--border); border-radius: var(--radius-lg); margin-bottom: 16px; background: #fff; overflow: hidden; box-shadow: var(--shadow-sm); }
        .contract-card-header { background: var(--bg-main); padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
        
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 11px 14px; font-size: 10.5px; font-weight: 700; color: var(--text-muted); border-bottom: 1px solid var(--border); background: var(--bg-main); text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 12px 14px; font-size: 12.5px; border-bottom: 1px solid var(--border-light); vertical-align: middle; color: var(--text-main); }
        tr:last-child td { border-bottom: none; }

        .badge { padding: 3px 8px; border-radius: 20px; font-size: 10.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
        .badge-pending { background: var(--amber-light); color: var(--amber); }
        .badge-paid { background: var(--emerald-light); color: var(--emerald); }
        .badge-overdue { background: var(--rose-light); color: var(--rose); }

        .dre-table { width: 100%; border-collapse: collapse; }
        .dre-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-light); font-size: 13px; }
        .dre-row-header td { background: var(--bg-main); font-weight: 700; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        .dre-row-total td { background: var(--brand-light); font-weight: 700; font-size: 14.5px; color: var(--brand-primary); }
        .dre-row-subtotal td { font-weight: 700; color: var(--text-main); background: var(--bg-main); }
        .dre-indent { padding-left: 32px !important; color: var(--text-muted); }
        .dre-val-neg { color: var(--rose); font-weight: 600; }
        .dre-val-pos { color: var(--emerald); font-weight: 600; }

        .projection-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 12px; }
        .proj-card { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; text-align: center; background: var(--surface); box-shadow: var(--shadow-sm); }
        .proj-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
        .proj-val { font-size: 20px; font-weight: 700; margin: 10px 0; }

        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(3px); display: none; justify-content: center; align-items: center; z-index: 1000; }
        .modal { background: white; padding: 26px; border-radius: var(--radius-lg); width: 100%; max-width: 520px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); max-height: 90vh; overflow-y: auto; }
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; font-size: 10.5px; font-weight: 700; margin-bottom: 5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 12.5px; outline: none; background: var(--bg-main); }
        .form-group input:focus, .form-group select:focus { border-color: var(--brand-primary); background: #fff; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        #toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; }
        .toast { background: #0F172A; color: white; padding: 12px 18px; border-radius: var(--radius-md); font-size: 12px; font-weight: 500; box-shadow: var(--shadow-md); display: flex; align-items: center; gap: 10px; animation: slideIn 0.2s ease-out; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

        @media print {
            body { background: white; color: black; }
            .sidebar, .top-navbar, .filter-bar, .btn, .no-print, .alert-bar { display: none !important; }
            .main-wrapper { overflow: visible; }
            .content-area { padding: 0; max-width: 100%; }
            .panel { border: none; box-shadow: none; padding: 0; }
        }


        /* ===== DBS TREASURY V7 — identidade visual e responsividade ===== */
        :root {
            /* Paleta financeira sóbria: azul, grafite, teal e violeta. */
            --rose: #64748B;
            --rose-light: #F1F5F9;
            --amber: #7C3AED;
            --amber-light: #F5F3FF;
        }
        .alert-bar { border-color: #CBD5E1 !important; color: #475569 !important; }
        .btn-danger { background: #475569 !important; color: #fff !important; }
        .btn-danger:hover { background: #334155 !important; }
        .btn-warning { background: #7C3AED !important; color: #fff !important; }
        .btn-warning:hover { background: #6D28D9 !important; }
        .badge-overdue { background: #F1F5F9 !important; color: #475569 !important; }
        .badge-pending { background: #F5F3FF !important; color: #6D28D9 !important; }
        .mobile-menu-toggle { display:none; }
        .mobile-overlay { display:none; }

        @media (max-width: 900px) {
            body { overflow: hidden; }
            .sidebar {
                position: fixed;
                left: 0;
                top: 0;
                bottom: 0;
                width: min(82vw, 300px);
                z-index: 1200;
                transform: translateX(-105%);
                transition: transform .22s ease;
                box-shadow: 10px 0 30px rgba(15,23,42,.14);
            }
            .sidebar.mobile-open { transform: translateX(0); }
            .mobile-overlay {
                position: fixed;
                inset: 0;
                background: rgba(15,23,42,.32);
                z-index: 1100;
                display: block;
                opacity: 0;
                pointer-events: none;
                transition: opacity .22s ease;
            }
            .mobile-overlay.active { opacity: 1; pointer-events: auto; }
            .main-wrapper { width:100%; min-width:0; overflow-y:auto; }
            .top-navbar {
                position: sticky;
                top:0;
                padding: 11px 14px;
                gap:10px;
                flex-wrap:wrap;
                z-index:100;
            }
            .page-header { min-width:0; flex:1; }
            .page-header h1 { font-size:16px; line-height:1.25; }
            .page-header p { font-size:10.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .top-navbar > div:last-child { width:auto; margin-left:auto; }
            .top-navbar > div:last-child > div:first-child { display:none !important; }
            .top-navbar > div:last-child .btn { padding:8px 10px; font-size:11px; }
            .mobile-menu-toggle {
                display:inline-flex;
                align-items:center;
                justify-content:center;
                width:38px;
                height:38px;
                flex:0 0 38px;
                border:1px solid var(--border);
                border-radius:var(--radius-md);
                background:var(--surface);
                color:var(--text-main);
                cursor:pointer;
            }
            .content-area { padding:16px 14px 28px; gap:14px; max-width:none; }
            .module-section { gap:14px; min-width:0; }
            .kpi-grid { grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; }
            .kpi-card { padding:14px; min-width:0; }
            .kpi-title { font-size:9px; }
            .kpi-value { font-size:18px; overflow-wrap:anywhere; }
            .kpi-sub { font-size:10px; }
            .panel { padding:15px; min-width:0; }
            .panel-header { gap:10px; flex-wrap:wrap; }
            .panel-title { font-size:13px; }
            .filter-bar { padding:12px; gap:10px; }
            .filter-group { min-width:calc(50% - 5px); }
            .form-row { grid-template-columns:1fr; gap:0; }
            .projection-grid { grid-template-columns:1fr; gap:10px; }
            .proj-card { padding:14px; }
            .contract-card-header { align-items:flex-start; gap:8px; flex-wrap:wrap; }
            .contract-card > div { min-width:0; }
            .contract-card table, .panel table, .dre-table { min-width:680px; }
            .contract-card > div[style*="overflow"], .panel > div[style*="overflow"] { overflow-x:auto !important; -webkit-overflow-scrolling:touch; }
            .bank-actions { gap:5px; }
            .bank-actions .btn { flex:1 1 auto; justify-content:center; }
            .btn { min-height:38px; padding:8px 11px; }
            .modal-overlay { padding:10px; align-items:flex-end; }
            .modal { width:100%; max-width:none; max-height:92vh; padding:18px; border-radius:14px 14px 0 0; }
            .toast { max-width:calc(100vw - 28px); }
            #toast-container { left:14px; right:14px; bottom:14px; }
            input, select, textarea { max-width:100%; }
        }

        @media (max-width: 560px) {
            .kpi-grid { grid-template-columns:1fr; }
            .filter-group { min-width:100%; }
            .page-header h1 { font-size:14px; }
            .page-header p { display:none; }
            .content-area { padding-left:10px; padding-right:10px; }
            .panel { padding:12px; border-radius:10px; }
            .panel-header { margin-bottom:12px; }
            .btn { font-size:11px; }
            .top-navbar { padding:9px 10px; }
            .sidebar-brand { padding:20px 18px; }
            .nav-item { padding:10px 18px; }
        }

        @media (prefers-reduced-motion: reduce) {
            .sidebar, .mobile-overlay, * { transition:none !important; animation:none !important; }
        }
    </style>

<style id="dbs-v10-professional">
/* ===== DBS TREASURY V13 — refinamento visual profissional ===== */
:root{
  --bg-main:#f5f7fb;
  --surface:#ffffff;
  --surface-soft:#f8fafc;
  --border:#e5e9f0;
  --border-light:#eef1f5;
  --text-main:#172033;
  --text-muted:#6b7688;
  --brand-primary:#1f5fd1;
  --brand-dark:#174da9;
  --brand-light:#eef5ff;
  --emerald:#168b67;
  --emerald-light:#eaf8f3;
  --radius-lg:14px;
  --radius-md:9px;
  --shadow-sm:0 1px 2px rgba(15,23,42,.035),0 4px 12px rgba(15,23,42,.025);
  --shadow-md:0 8px 24px rgba(15,23,42,.07);
}
*{font-family:'Inter','Plus Jakarta Sans',Arial,sans-serif;}
body{background:var(--bg-main);color:var(--text-main);letter-spacing:-.01em;}
.sidebar{width:252px;background:#111827;border-right:1px solid #202938;}
.sidebar-brand{padding:22px 20px 20px;border-bottom:1px solid #252d3b;}
.sidebar-brand h2{font-size:15px;letter-spacing:-.35px;}
.sidebar-brand h2 i{font-size:15px;}
.sidebar-brand span{font-size:10px;letter-spacing:.35px;color:#8490a3;}
.menu-group{padding:15px 0 3px;}
.menu-title{font-size:9px;color:#667287;padding:0 18px 7px;letter-spacing:1px;}
.nav-item{margin:2px 9px;padding:10px 11px;border-radius:8px;font-size:12px;gap:11px;color:#a7b0bf;}
.nav-item:hover{background:#192232;color:#eef2f7;}
.nav-item.active{background:#1b3155;color:#8bb7ff;border-right:0;box-shadow:inset 3px 0 0 #4f8ff7;}
.nav-item i{width:17px;text-align:center;font-size:12px;opacity:.9;}
.sidebar-footer{padding:14px 18px;background:#0c121d;border-top:1px solid #202938;font-size:10px;}
.main-wrapper{background:var(--bg-main);}
.top-navbar{position:sticky;top:0;padding:13px 30px;background:rgba(255,255,255,.96);border-bottom:1px solid var(--border);box-shadow:0 1px 0 rgba(15,23,42,.02);z-index:20;}
.page-header h1{font-size:17px;font-weight:750;letter-spacing:-.45px;}
.page-header p{font-size:11px;margin-top:3px;color:#7a8494;}
.content-area{padding:24px 30px 34px;gap:18px;max-width:1580px;}
.module-section{gap:18px;}
.panel,.contract-card,.filter-bar,.kpi-card{border-color:var(--border);box-shadow:var(--shadow-sm);}
.panel{padding:20px;border-radius:var(--radius-lg);}
.panel-header{margin-bottom:16px;}
.panel-title{font-size:14px;font-weight:750;letter-spacing:-.3px;}
.kpi-grid{gap:12px;}
.kpi-card{padding:17px 18px;border-radius:12px;}
.kpi-card:hover{transform:translateY(-1px);box-shadow:var(--shadow-md);}
.kpi-title{font-size:9.5px;letter-spacing:.7px;color:#7a8494;}
.kpi-value{font-size:21px;font-weight:750;margin-top:7px;letter-spacing:-.7px;}
.kpi-sub{font-size:10.5px;margin-top:5px;}
.filter-bar{padding:12px 15px;border-radius:11px;gap:11px;}
.filter-group{min-width:135px;gap:5px;}
.filter-group label,.form-group label{font-size:9.5px;letter-spacing:.65px;color:#7a8494;}
.filter-group input,.filter-group select,.form-group input,.form-group select,.form-group textarea{border-color:#dce2ea;background:#fafbfd;border-radius:8px;min-height:37px;font-size:12px;color:#263247;transition:border-color .15s,box-shadow .15s,background .15s;}
.filter-group input:focus,.filter-group select:focus,.form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:#7aa7ed;background:#fff;box-shadow:0 0 0 3px rgba(31,95,209,.08);}
.btn{min-height:34px;padding:7px 12px;border-radius:8px;font-size:11.5px;font-weight:650;letter-spacing:-.05px;box-shadow:none;}
.btn-primary{background:var(--brand-primary);box-shadow:0 2px 5px rgba(31,95,209,.16);}
.btn-primary:hover{background:var(--brand-dark);transform:translateY(-1px);}
.btn-secondary{background:#fff;border-color:#dce2ea;color:#344054;}
.btn-secondary:hover{background:#f8fafc;border-color:#cbd4df;}
.btn-success{background:#168b67;}
.btn-success:hover{background:#117455;}
.btn-dark{background:#202a3a;}
.alert-bar{border-radius:10px;padding:10px 15px;font-size:11.5px;box-shadow:var(--shadow-sm);}
.contract-card{border-radius:12px;margin-bottom:14px;}
.contract-card-header{padding:12px 15px;background:#f8fafc;}
.contract-card-header strong{font-size:12.5px;letter-spacing:-.2px;}
table{font-variant-numeric:tabular-nums;}
th{padding:10px 13px;font-size:9.5px;letter-spacing:.65px;background:#f8fafc;color:#778296;white-space:nowrap;}
td{padding:11px 13px;font-size:11.5px;color:#273247;}
tbody tr:hover td{background:#fbfcfe;}
td strong{font-weight:650;}
.badge{padding:4px 8px;font-size:9.5px;letter-spacing:-.05px;}
.dre-table td{padding:11px 15px;font-size:12px;}
.dre-row-header td{font-size:9.5px;letter-spacing:.7px;}
.dre-row-total td{font-size:14px;}
.projection-grid{gap:12px;margin-top:10px;}
.proj-card{padding:16px;border-radius:12px;}
.proj-title{font-size:9.5px;letter-spacing:.65px;}
.proj-val{font-size:19px;margin:8px 0;letter-spacing:-.5px;}
.modal-overlay{background:rgba(15,23,42,.52);backdrop-filter:blur(5px);}
.modal{padding:23px;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.18);border:1px solid rgba(255,255,255,.65);}
.form-group{margin-bottom:13px;}
.form-row{gap:11px;}
#toast-container{bottom:18px;right:18px;gap:7px;}
.toast{padding:11px 15px;border-radius:9px;font-size:11px;box-shadow:0 8px 24px rgba(15,23,42,.14);}
/* números financeiros mais legíveis */
.kpi-value,.proj-val,.dre-table td:last-child,table td:nth-last-child(2){font-variant-numeric:tabular-nums;}
/* barras/áreas com rolagem mais discretas */
::-webkit-scrollbar{width:8px;height:8px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:#cbd3df;border-radius:20px;}
::-webkit-scrollbar-thumb:hover{background:#aeb9c8;}
/* mobile: mantém a operação confortável sem transformar tudo em botões gigantes */
@media (max-width:900px){
 .sidebar{width:252px;}
 .top-navbar{padding:11px 15px;}
 .content-area{padding:17px 14px 25px;gap:14px;}
 .panel{padding:15px;}
 .kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
 .kpi-card{padding:14px;}
 .kpi-value{font-size:18px;}
 .projection-grid{grid-template-columns:1fr;}
 .contract-card-header{align-items:flex-start;gap:10px;}
 .modal{width:calc(100% - 20px);padding:19px;}
}
@media (max-width:560px){
 .kpi-grid{grid-template-columns:1fr;}
 .page-header h1{font-size:15px;}
 .page-header p{font-size:10px;}
 .btn{min-height:36px;}
 th,td{padding-left:10px;padding-right:10px;}
 .form-row{grid-template-columns:1fr;}
}
</style>

<style id="v13-usabilidade-css">
/* V13 — usabilidade, segurança operacional e filtros */
.period-filter-card{margin:0 0 16px;padding:14px;background:var(--bg-soft,#f8fafc);border:1px solid var(--border-light);border-radius:12px}
.period-filter-grid{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:space-between}
.period-filter-fields{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.period-filter-field label{display:block;font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--text-muted);margin-bottom:4px}
.period-filter-field input{min-width:145px}
.period-shortcuts{display:flex;gap:6px;flex-wrap:wrap}
.period-shortcuts button{border:1px solid var(--border-light);background:#fff;color:var(--text-secondary);padding:6px 9px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer}
.period-shortcuts button:hover{border-color:var(--brand-primary);color:var(--brand-primary)}
.high-value-warning{font-size:10.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;padding:7px 9px;border-radius:7px;margin-top:6px}
.ledger-estorno{opacity:.78;background:#fafafa}
.ledger-estorno td{font-style:italic}
.badge-adjustment{background:#eef2ff;color:#4338ca}
.security-note{font-size:10.5px;color:var(--text-muted);margin-top:6px}
.ledger-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px 14px;border-bottom:1px solid var(--border-light);background:var(--bg-soft,#f8fafc)}
.ledger-box{padding:10px 12px;border:1px solid var(--border-light);border-radius:10px;background:var(--surface,#fff)}
.ledger-label{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)}
.ledger-value{margin-top:3px;font-size:16px;font-weight:800;color:var(--text-main)}
.ledger-value.in{color:var(--emerald)} .ledger-value.out{color:var(--rose)}
.ledger-note{grid-column:1/-1;font-size:11px;color:var(--text-muted)}
.ledger-empty{padding:28px!important;text-align:center;color:var(--text-muted)}
.btn-danger-soft{color:#64748B !important;border-color:#CBD5E1 !important;background:#F8FAFC !important}
.btn-danger-soft:hover{color:#B91C1C !important;border-color:#FCA5A5 !important;background:#FFF1F2 !important}
.attachment-actions{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
@media(max-width:700px){.period-filter-grid,.period-filter-fields{display:grid;grid-template-columns:1fr;width:100%}.period-filter-field input{width:100%;box-sizing:border-box}.period-shortcuts{width:100%}.period-shortcuts button{flex:1}.ledger-summary{grid-template-columns:1fr}.ledger-note{grid-column:auto}}
</style>
</head>
<body>

<aside class="sidebar">
    <div>
        <div class="sidebar-brand">
            <h2><i class="fa-solid fa-vault" style="color: #60A5FA;"></i> DBS TREASURY</h2>
            <span>DBS AIR REFRIGERACAO LTDA</span>
        </div>

        <div class="menu-group">
            <div class="menu-title">Visão do Negócio</div>
            <div class="nav-item active" onclick="switchModule('mod-dash', this)">
                <i class="fa-solid fa-chart-pie"></i> Resumo de Caixa
            </div>
            <div class="nav-item" onclick="switchModule('mod-dre', this)">
                <i class="fa-solid fa-file-invoice-dollar"></i> Resultado da Empresa
            </div>
            <div class="nav-item" onclick="switchModule('mod-projecao', this)">
                <i class="fa-solid fa-chart-line"></i> Projeção de Fluxo (90 dias)
            </div>
        </div>

        <div class="menu-group">
            <div class="menu-title">Gestão Financeira</div>
            <div class="nav-item" onclick="switchModule('mod-caixa', this)">
                <i class="fa-solid fa-building-columns"></i> Caixa & Bancos
            </div>
            <div class="nav-item" onclick="switchModule('mod-pagar', this)">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Contas a Pagar
            </div>
            <div class="nav-item" onclick="switchModule('mod-receber', this)">
                <i class="fa-solid fa-arrow-down-left"></i> Contas a Receber
            </div>
            <div class="nav-item" onclick="switchModule('mod-passivos', this)">
                <i class="fa-solid fa-handshake"></i> Acordos e Dívidas
            </div>
            <div class="nav-item" onclick="switchModule('mod-recorrencias', this)">
                <i class="fa-solid fa-arrows-rotate"></i> Contas Fixas
            </div>
        </div>

        <div class="menu-group">
            <div class="menu-title">Segurança & Sistema</div>
            <div class="nav-item" onclick="switchModule('mod-auditoria', this)">
                <i class="fa-solid fa-shield-halved"></i> Auditoria & Atas
            </div>
            <div class="nav-item" onclick="switchModule('mod-backup', this)">
                <i class="fa-solid fa-database"></i> Backup & Sistema
            </div>
        </div>
    </div>

    <div class="sidebar-footer">
        <div>Empresa: <strong>DBS AIR REFRIGERACAO</strong></div>
        <div>Auditoria: <strong style="color:var(--emerald);">ATIVA</strong></div>
    </div>
</aside>

<main class="main-wrapper">
    <div class="top-navbar">
        <div class="page-header">
            <h1 id="view-title">Resumo do Caixa da Empresa</h1>
            <p id="view-sub">Visão consolidada do fluxo de caixa e saídas operacionais.</p>
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--text-muted);">
                <i class="fa-solid fa-calendar"></i> Mês:
                <input type="month" id="global-period-filter" onchange="render()" style="padding:6px 10px; border:1px solid var(--border); border-radius:var(--radius-md); font-size:12px; background:var(--bg-main);">
            </div>
            <button class="btn btn-secondary" onclick="openModalReceber()"><i class="fa-solid fa-plus"></i> Recebimento</button>
            <button class="btn btn-primary" onclick="openModalPagar()"><i class="fa-solid fa-plus"></i> Conta a Pagar</button>
            <button class="btn btn-dark" onclick="openModalPassivo()"><i class="fa-solid fa-plus"></i> Novo Acordo</button>
        </div>
    </div>

    <div class="content-area">

        <div id="alert-banner" class="alert-bar" style="display:none;">
            <span><i class="fa-solid fa-circle-exclamation"></i> <strong>Atenção Diretoria:</strong> Existem pendências financeiras ou títulos atrasados exigindo ação.</span>
            <button class="btn btn-dark" style="padding:5px 10px; font-size:11px;" onclick="switchModule('mod-passivos', document.querySelectorAll('.nav-item')[5])">Ver Pendências</button>
        </div>

        <!-- DASHBOARD -->
        <section id="mod-dash" class="module-section active">
            <div class="kpi-grid">
                <div class="kpi-card" onclick="switchModule('mod-receber', document.querySelectorAll('.nav-item')[4])">
                    <div class="kpi-title">Receber no Mês Selecionado</div>
                    <div class="kpi-value" style="color: var(--emerald);" id="kpi-receber-mes">R$ 0,00</div>
                    <div class="kpi-sub">Entradas confirmadas/previstas</div>
                </div>
                <div class="kpi-card" onclick="switchModule('mod-pagar', document.querySelectorAll('.nav-item')[3])">
                    <div class="kpi-title">Contas a Pagar no Mês</div>
                    <div class="kpi-value" style="color: var(--rose);" id="kpi-pagar-mes">R$ 0,00</div>
                    <div class="kpi-sub">Saídas operacionais do mês</div>
                </div>
                <div class="kpi-card" onclick="switchModule('mod-passivos', document.querySelectorAll('.nav-item')[5])">
                    <div class="kpi-title">Dívidas / Acordos em Aberto</div>
                    <div class="kpi-value" id="kpi-passivo-total">R$ 0,00</div>
                    <div class="kpi-sub">Saldo devedor total acumulado</div>
                </div>
                <div class="kpi-card" onclick="switchModule('mod-recorrencias', document.querySelectorAll('.nav-item')[6])">
                    <div class="kpi-title">Gastos Fixos Mensais</div>
                    <div class="kpi-value" style="color: var(--brand-primary);" id="kpi-recorrente-mrr">R$ 0,00</div>
                    <div class="kpi-sub">Sistemas, licenças e estrutura</div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title"><i class="fa-solid fa-chart-line" style="color:var(--brand-primary);"></i> Progresso de Quitação dos Acordos</div>
                    </div>
                    <div id="dash-passivos-progress" style="display: flex; flex-direction: column; gap: 14px;"></div>
                </div>

                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title"><i class="fa-solid fa-clock" style="color:var(--amber);"></i> Próximas Saídas de Caixa</div>
                    </div>
                    <div id="dash-recorrencias-proximas"></div>
                </div>
            </div>
        </section>

        <!-- DRE -->
        <section id="mod-dre" class="module-section">
            <div class="filter-bar no-print">
                <div class="filter-group">
                    <label>Faturamento Bruto Digitado Manualmente (R$)</label>
                    <input type="number" id="dre-input-receita" value="0.00" oninput="renderDRE()">
                </div>
                <div class="filter-group">
                    <label>Impostos & Taxas das Vendas (%)</label>
                    <input type="number" id="dre-input-impostos" value="12.0" step="0.5" oninput="renderDRE()">
                </div>
                <div class="filter-group">
                    <label>Custos Diretos Operacionais (R$)</label>
                    <input type="number" id="dre-input-custos" value="15000.00" oninput="renderDRE()">
                </div>
                <button class="btn btn-dark" onclick="window.print()"><i class="fa-solid fa-file-pdf"></i> Imprimir Relatório</button>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-wallet" style="color:var(--emerald);"></i> Demonstrativo Gerencial de Resultados (DRE)</div>
                </div>
                
                <table class="dre-table">
                    <tbody>
                        <tr class="dre-row-header"><td colspan="2">1. ENTRADAS & RECEITAS OPERACIONAIS</td></tr>
                        <tr><td class="dre-indent">Recebimentos Cadastrados no Sistema</td><td class="dre-val-pos" id="dre-val-rec-cadastrada">R$ 0,00</td></tr>
                        <tr><td class="dre-indent">Vendas Adicionais / Faturamento Digitado</td><td class="dre-val-pos" id="dre-val-recbruta">R$ 0,00</td></tr>
                        <tr><td class="dre-indent">(-) Impostos e Descontos sobre Vendas Digitadas</td><td class="dre-val-neg" id="dre-val-impostos">R$ 0,00</td></tr>
                        <tr class="dre-row-subtotal"><td>(=) RECEITA LÍQUIDA OPERACIONAL</td><td id="dre-val-recliquida">R$ 0,00</td></tr>

                        <tr class="dre-row-header"><td colspan="2">2. CUSTOS E DESPESAS OPERACIONAIS</td></tr>
                        <tr><td class="dre-indent">(-) Custos Diretos Operacionais</td><td class="dre-val-neg" id="dre-val-custos">R$ 0,00</td></tr>
                        <tr><td class="dre-indent">(-) Contas Fixas Mensais (Sistemas, Aluguel, etc.)</td><td class="dre-val-neg" id="dre-val-recorrencias">R$ 0,00</td></tr>
                        <tr><td class="dre-indent">(-) Contas a Pagar Lançadas no Mês</td><td class="dre-val-neg" id="dre-val-pagar-mes">R$ 0,00</td></tr>
                        <tr class="dre-row-subtotal"><td>(=) RESULTADO OPERACIONAL (EBITDA)</td><td id="dre-val-ebitda">R$ 0,00</td></tr>

                        <tr class="dre-row-header"><td colspan="2">3. SERVIÇO DA DÍVIDA & ACORDOS</td></tr>
                        <tr><td class="dre-indent">(-) Pagamento de Parcelamentos / Empréstimos</td><td class="dre-val-neg" id="dre-val-passivos">R$ 0,00</td></tr>
                        <tr class="dre-row-total"><td>(=) SOBRA FINAL NO CAIXA DA EMPRESA</td><td id="dre-val-liquido">R$ 0,00</td></tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- PROJEÇÃO -->
        <section id="mod-projecao" class="module-section">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-chart-column" style="color:var(--brand-primary);"></i> Projeção Estimada de Caixa (Próximos 90 Dias)</div>
                </div>
                <p style="font-size:12.5px; color:var(--text-muted);">Cálculo projetado considerando Contas a Receber (+) versus Contas a Pagar, Parcelas de Acordos e Contas Fixas (-).</p>

                <div class="projection-grid">
                    <div class="proj-card">
                        <div class="proj-title">Próximos 30 Dias</div>
                        <div class="proj-val" id="proj-30">R$ 0,00</div>
                        <span class="badge badge-pending" id="proj-30-sub">Saldo Previsto</span>
                    </div>
                    <div class="proj-card">
                        <div class="proj-title">Próximos 60 Dias</div>
                        <div class="proj-val" id="proj-60">R$ 0,00</div>
                        <span class="badge badge-pending" id="proj-60-sub">Saldo Acumulado</span>
                    </div>
                    <div class="proj-card">
                        <div class="proj-title">Próximos 90 Dias</div>
                        <div class="proj-val" id="proj-90">R$ 0,00</div>
                        <span class="badge badge-pending" id="proj-90-sub">Saldo Acumulado</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- CAIXA & BANCOS -->
        <section id="mod-caixa" class="module-section">
            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:20px;">
                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title"><i class="fa-solid fa-university" style="color:var(--brand-primary);"></i> Contas Bancárias</div>
                        <button class="btn btn-secondary" onclick="openModalConta()"><i class="fa-solid fa-plus"></i></button>
                    </div>
                    <div id="bancos-list" style="display:flex; flex-direction:column; gap:12px;"></div>
                </div>

                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title"><i class="fa-solid fa-book" style="color:var(--emerald);"></i> Livro Caixa & Movimentações</div>
                        <button class="btn btn-secondary" onclick="openModalTransferencia()"><i class="fa-solid fa-right-left"></i> Transferência</button>
                    </div>
                    <div id="caixa-resumo" class="ledger-summary"></div>
                    <table>
                        <thead>
                            <tr>
                                <th>DATA</th>
                                <th>DESCRIÇÃO</th>
                                <th>CONTA</th>
                                <th>TIPO</th>
                                <th>VALOR</th>
                            </tr>
                        </thead>
                        <tbody id="caixa-mov-list"></tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- CONTAS A PAGAR -->
        <section id="mod-pagar" class="module-section">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-receipt" style="color:var(--rose);"></i> Gestão de Contas a Pagar</div>
                    <button class="btn btn-primary" onclick="openModalPagar()"><i class="fa-solid fa-plus"></i> Nova Conta a Pagar</button>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>FORNECEDOR / CREDOR</th>
                            <th>DESCRIÇÃO</th>
                            <th>VENCIMENTO</th>
                            <th>VALOR</th>
                            <th>SITUAÇÃO</th>
                            <th>AÇÕES</th>
                        </tr>
                    </thead>
                    <tbody id="pagar-list"></tbody>
                </table>
            </div>
        </section>

        <!-- CONTAS A RECEBER -->
        <section id="mod-receber" class="module-section">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-hand-holding-dollar" style="color:var(--emerald);"></i> Recebimentos Previstos de Clientes</div>
                    <button class="btn btn-primary" onclick="openModalReceber()"><i class="fa-solid fa-plus"></i> Novo Recebimento</button>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>CLIENTE / ORIGEM</th>
                            <th>CATEGORIA</th>
                            <th>VENCIMENTO</th>
                            <th>VALOR</th>
                            <th>SITUAÇÃO</th>
                            <th>AÇÕES</th>
                        </tr>
                    </thead>
                    <tbody id="receber-list"></tbody>
                </table>
            </div>
        </section>

        <!-- PASSIVOS / DÍVIDAS -->
        <section id="mod-passivos" class="module-section">
            <div class="filter-bar" style="align-items:flex-end; flex-wrap:wrap; gap:12px;">
                <div class="filter-group">
                    <label>Buscar Acordo / Credor</label>
                    <input type="text" id="flt-passivo-search" placeholder="Digite para filtrar..." oninput="render()">
                </div>
                <div class="filter-group">
                    <label>Ver Situação</label>
                    <select id="flt-passivo-status" onchange="render()">
                        <option value="TODOS">Todas as Parcelas</option>
                        <option value="Pendente">Apenas A Pagar</option>
                        <option value="Pago">Apenas Pagas</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Data Inicial</label>
                    <input type="date" id="filtroDataInicio" class="form-control">
                </div>
                <div class="filter-group">
                    <label>Data Final</label>
                    <input type="date" id="filtroDataFim" class="form-control">
                </div>
                <button onclick="filtrarAcordosPorData()" class="btn btn-primary" style="padding:8px 14px;"><i class="fa-solid fa-filter"></i> Filtrar</button>
                <button onclick="limparFiltroData()" class="btn btn-secondary" style="padding:8px 12px;">Limpar</button>
                <button onclick="setAtalhoData('mesAtual')" class="btn btn-outline">Este Mês</button>
                <button onclick="setAtalhoData('mesAnterior')" class="btn btn-outline">Mês Passado</button>
                <button onclick="setAtalhoData('anoAtual')" class="btn btn-outline">Ano Atual</button>
                <button onclick="exportarRelatorioAcordosPDF()" class="btn btn-success" style="padding:8px 14px;"><i class="fa-solid fa-file-pdf"></i> PDF Oficial</button>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-list-check" style="color:var(--brand-primary);"></i> Acordos e Prazos de Pagamento</div>
                    <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="checkbox" id="flt-passivo-arquivados" onchange="render()"> Mostrar arquivados
                    </label>
                </div>
                <div id="passivos-list"></div>
            </div>
        </section>

        <!-- RECORRÊNCIAS -->
        <section id="mod-recorrencias" class="module-section">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-repeat" style="color:var(--brand-primary);"></i> Gestão de Contas Fixas e Estrutura</div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                        <label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="flt-rec-arquivadas" onchange="render()"> Mostrar arquivadas</label>
                        <button class="btn btn-secondary" onclick="openModalRecorrente()"><i class="fa-solid fa-plus"></i> Nova Conta Fixa</button>
                    </div>
                </div>
                <div id="recorrencias-list"></div>
            </div>
        </section>

        <!-- AUDITORIA -->
        <section id="mod-auditoria" class="module-section">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-shield-halved" style="color:var(--brand-primary);"></i> Trilha de Auditoria & Atas</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>DATA / HORA</th>
                            <th>AÇÃO</th>
                            <th>MÓDULO</th>
                            <th>DETALHES DA OPERAÇÃO</th>
                        </tr>
                    </thead>
                    <tbody id="auditoria-list"></tbody>
                </table>
            </div>
        </section>

        <!-- BACKUP E SISTEMA -->
        <section id="mod-backup" class="module-section">
            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title"><i class="fa-solid fa-database" style="color:var(--brand-primary);"></i> Segurança dos Dados & Sistema</div>
                </div>
                <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:16px;">Exporte periodicamente o backup para evitar perda de dados. A restauração substitui o banco local com validação.</p>
                <div style="display:flex; gap:12px; flex-wrap:wrap;">
                    <button class="btn btn-primary" onclick="exportarBackupJSON()"><i class="fa-solid fa-download"></i> Exportar Backup (JSON)</button>
                    <label class="btn btn-secondary" style="cursor:pointer;">
                        <i class="fa-solid fa-upload"></i> Restaurar Backup (JSON)
                        <input type="file" id="file-backup-restore" accept=".json" style="display:none;" onchange="restaurarBackupJSON(this)">
                    </label>
                    <button class="btn btn-success" onclick="exportarCSV('passivos')"><i class="fa-solid fa-file-excel"></i> CSV Acordos</button>
                    <button class="btn btn-success" onclick="exportarCSV('recebimentos')"><i class="fa-solid fa-file-excel"></i> CSV Recebimentos</button>
                </div>
            </div>
        </section>

    </div>
</main>

<!-- MODAIS -->
<div class="modal-overlay" id="modal-passivo">
    <div class="modal">
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Cadastrar Novo Acordo / Parcela</h3>
        <form onsubmit="salvarPassivo(event)">
            <div class="form-group"><label>Para quem vai pagar (Credor)</label><input type="text" id="add-p-credor" required placeholder="Ex: Receita Federal"></div>
            <div class="form-row">
                <div class="form-group"><label>Documento / Referência</label><input type="text" id="add-p-doc" required placeholder="Ex: Acordo 1234"></div>
                <div class="form-group">
                    <label>Categoria</label>
                    <select id="add-p-cat">
                        <option value="Impostos / Fiscal">Impostos / Fiscal</option>
                        <option value="Bancos / Empréstimos">Bancos / Empréstimos</option>
                        <option value="Fornecedores">Fornecedores</option>
                        <option value="Outros">Outros</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Qtd de Parcelas</label><input type="number" id="add-p-qtd" required placeholder="12"></div>
                <div class="form-group"><label>Valor por Parcela (R$)</label><input type="number" step="0.01" id="add-p-val" required placeholder="500.00"></div>
            </div>
            <div class="form-group"><label>Vencimento da 1ª Parcela</label><input type="date" id="add-p-data" required></div>
            <div class="form-group"><label>Conta para Pagamento das Parcelas</label><select id="add-p-banco" required></select></div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="closeModals()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Salvar Acordo</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-recorrente">
    <div class="modal">
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Cadastrar Conta Fixa</h3>
        <form onsubmit="salvarRecorrencia(event)">
            <div class="form-group"><label>Nome do Serviço / Conta</label><input type="text" id="add-r-nome" required placeholder="Ex: Internet, Aluguel"></div>
            <div class="form-row">
                <div class="form-group"><label>Valor (R$)</label><input type="number" step="0.01" id="add-r-val" required placeholder="1500.00"></div>
                <div class="form-group">
                    <label>Frequência</label>
                    <select id="add-r-freq">
                        <option value="Mensal">Mensal</option>
                        <option value="Trimestral">Trimestral</option>
                        <option value="Anual">Anual</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Data do Próximo Pagamento</label><input type="date" id="add-r-venc" required></div>
            <div class="form-group"><label>Conta para Pagamento</label><select id="add-r-banco" required></select></div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="closeModals()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Salvar Conta Fixa</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-receber">
    <div class="modal">
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Cadastrar Entradas / Recebimento</h3>
        <form onsubmit="salvarRecebimento(event)">
            <input type="hidden" id="edit-rec-id">
            <div class="form-group"><label>Nome do Cliente / Origem</label><input type="text" id="add-rec-cliente" required placeholder="Ex: Cliente ABC Ltda"></div>
            <div class="form-row">
                <div class="form-group"><label>Valor a Receber (R$)</label><input type="number" step="0.01" id="add-rec-val" required placeholder="3500.00"></div>
                <div class="form-group">
                    <label>Categoria</label>
                    <select id="add-rec-cat">
                        <option value="Honorários Mensais">Honorários Mensais</option>
                        <option value="Serviço Avulso">Serviço Avulso</option>
                        <option value="Venda de Contrato">Venda de Contrato</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Data Prevista</label><input type="date" id="add-rec-data" required></div>
            <div class="form-group"><label>Conta de Destino</label><select id="add-rec-banco" required></select></div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="closeModals()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Salvar Entrada</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-pagar">
    <div class="modal">
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Cadastrar Conta a Pagar</h3>
        <form onsubmit="salvarPagar(event)">
            <input type="hidden" id="edit-pag-id">
            <div class="form-group"><label>Fornecedor / Credor</label><input type="text" id="add-pag-fornecedor" required placeholder="Ex: Fornecedor de Peças"></div>
            <div class="form-group"><label>Descrição / Referência</label><input type="text" id="add-pag-desc" required placeholder="Ex: Compra de insumos"></div>
            <div class="form-row">
                <div class="form-group"><label>Valor (R$)</label><input type="number" step="0.01" id="add-pag-val" required placeholder="1200.00"></div>
                <div class="form-group"><label>Data de Vencimento</label><input type="date" id="add-pag-venc" required></div>
            </div>
            <div class="form-group"><label>Conta para Pagamento</label><select id="add-pag-banco" required></select></div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="closeModals()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Salvar Conta a Pagar</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-conta">
    <div class="modal">
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Nova Conta Bancária</h3>
        <form onsubmit="salvarContaBancaria(event)">
            <div class="form-group"><label>Nome do Banco / Carteira</label><input type="text" id="add-banco-nome" required placeholder="Ex: Itaú Empresas"></div>
            <div class="form-group"><label>Saldo Inicial (R$)</label><input type="number" step="0.01" id="add-banco-saldo" required placeholder="5000.00"></div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="closeModals()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Salvar Conta</button>
            </div>
        </form>
    </div>
</div>

<div class="modal-overlay" id="modal-transferencia">
    <div class="modal">
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Transferência Entre Contas</h3>
        <form onsubmit="salvarTransferencia(event)">
            <div class="form-group">
                <label>Conta Origem</label>
                <select id="transf-origem" required></select>
            </div>
            <div class="form-group">
                <label>Conta Destino</label>
                <select id="transf-destino" required></select>
            </div>
            <div class="form-group"><label>Valor (R$)</label><input type="number" step="0.01" id="transf-val" required placeholder="1000.00"></div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="closeModals()">Cancelar</button>
                <button type="submit" class="btn btn-primary">Realizar Transferência</button>
            </div>
        </form>
    </div>
</div>

<div id="toast-container"></div>

<script>
    let STATE = { passivos: [], recorrencias: [], recebimentos: [], contasPagar: [], bancos: [], movimentacoes: [], auditoria: [] };

    function formatMoney(value){ const n=Number(value); return (Number.isFinite(n)?n:0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function showToast(msg) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = \`<i class="fa-solid fa-circle-check" style="color:var(--emerald);"></i> \${msg}\`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }

    function logAuditoria(acao, modulo, detalhes) {
        STATE.auditoria.unshift({
            dataHora: new Date().toLocaleString('pt-BR'),
            acao, modulo, detalhes
        });
        save();
    }

    function init() {
        const now = new Date();
        const monthStr = \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}\`;
        document.getElementById('global-period-filter').value = monthStr;

        const local = localStorage.getItem('DBS_TREASURY_STATE_V3');
        if (local) localStorage.setItem('DBS_TREASURY_SNAPSHOT_BEFORE_V6', local);
        if (!local) {
            STATE = {
                recebimentos: [
                    { id: 'rec_in_1', cliente: 'Cliente Contratual S/A', valor: 25000.00, categoria: 'Honorários Mensais', data: \`\${monthStr}-15\`, status: 'Pendente' }
                ],
                contasPagar: [
                    { id: 'pag_1', fornecedor: 'Insumos Técnicos Ltda', descricao: 'Peças para Manutenção', valor: 3400.00, vencimento: \`\${monthStr}-20\`, status: 'Pendente' }
                ],
                bancos: [
                    { id: 'banco_1', nome: 'Santander Principal', saldo: 12500.00 },
                    { id: 'banco_2', nome: 'Caixa Física Empresarial', saldo: 1500.00 }
                ],
                movimentacoes: [
                    { id: 'mov_1', data: \`\${monthStr}-01\`, descricao: 'Aporte Inicial de Caixa', conta: 'Santander Principal', tipo: 'Entrada', valor: 12500.00 }
                ],
                auditoria: [],
                passivos: [
                    {
                        id: 'ac_santander_9778', credor: 'Banco Santander (Contrato 264039778)', doc: 'Acordo / Renegociação', categoria: 'Bancos / Empréstimos', valorTotal: 55255.25,
                        parcelas: Array.from({length: 61}, (_, i) => ({
                            id: \`p_sant1_\${i+1}\`, num: i + 1, vencimento: new Date(2026, 7 + i, 15).toISOString().split('T')[0], valor: 1055.04, status: (i === 0) ? 'Pago' : 'Pendente', comprovante: (i === 0) ? 'Comprovante_Agosto_1055,04.pdf' : null
                        }))
                    },
                    {
                        id: 'ac_santander_0653', credor: 'Banco Santander (Contrato 264040653)', doc: 'Acordo / Renegociação', categoria: 'Bancos / Empréstimos', valorTotal: 24780.36,
                        parcelas: Array.from({length: 61}, (_, i) => ({
                            id: \`p_sant2_\${i+1}\`, num: i + 1, vencimento: new Date(2026, 7 + i, 10).toISOString().split('T')[0], valor: 472.77, status: (i <= 1) ? 'Pago' : 'Pendente', comprovante: (i === 1) ? 'WhatsApp Image 2026-09-11 at 17.18.32.jpeg' : ((i === 0) ? 'Comprovante_Agosto_472,77.pdf' : null)
                        }))
                    },
                    {
                        id: 'ac_rfb_0211', credor: 'Receita Federal (RFB)', doc: 'Parcelamento Simplificado (0211.00012.0110471227.26-01)', categoria: 'Impostos / Fiscal', valorTotal: 3093.24,
                        parcelas: [
                            { id: 'rfb_1', num: 1, vencimento: '2026-08-31', valor: 515.54, status: 'Pago', comprovante: 'DARF_Quitado_Agosto_515,54.pdf' },
                            { id: 'rfb_2', num: 2, vencimento: '2026-09-20', valor: 515.54, status: 'Pendente', comprovante: null },
                            { id: 'rfb_3', num: 3, vencimento: '2026-10-20', valor: 515.54, status: 'Pendente', comprovante: null },
                            { id: 'rfb_4', num: 4, vencimento: '2026-11-20', valor: 515.54, status: 'Pendente', comprovante: null },
                            { id: 'rfb_5', num: 5, vencimento: '2026-12-20', valor: 515.54, status: 'Pendente', comprovante: null },
                            { id: 'rfb_6', num: 6, vencimento: '2027-01-20', valor: 515.54, status: 'Pendente', comprovante: null }
                        ]
                    }
                ],
                recorrencias: [
                    { id: 'rec_1', servico: 'Sistemas & Licenças Operacionais', valor: 1200.00, frequencia: 'Mensal', proximoVencimento: \`\${monthStr}-25\`, historico: [] }
                ]
            };
            save();
            logAuditoria('INICIALIZAÇÃO', 'Sistema', 'Banco de dados criado e preservado com sucesso.');
        } else {
            try {
                STATE = JSON.parse(local);
                if (!STATE || typeof STATE !== 'object') throw new Error('estado inválido');
                if (!Array.isArray(STATE.recebimentos)) STATE.recebimentos = [];
                if (!Array.isArray(STATE.contasPagar)) STATE.contasPagar = [];
                if (!Array.isArray(STATE.passivos)) STATE.passivos = [];
                if (!Array.isArray(STATE.recorrencias)) STATE.recorrencias = [];
                if (!Array.isArray(STATE.bancos)) STATE.bancos = [];
                if (!Array.isArray(STATE.movimentacoes)) STATE.movimentacoes = [];
                if (!Array.isArray(STATE.auditoria)) STATE.auditoria = [];
                STATE.bancos.forEach(b => { if (!b.status) b.status = 'Ativa'; });
            } catch (err) {
                alert('Não foi possível ler os dados salvos. O conteúdo original foi preservado. Use um Backup JSON para recuperação.');
                return;
            }
        }
        populateAllBankSelects();
        render();
    }

    function save() {
        localStorage.setItem('DBS_TREASURY_STATE_V3', JSON.stringify(STATE));
    }

    function getDaysDiff(dateString) {
        const target = new Date(dateString + 'T00:00:00');
        const today = new Date();
        today.setHours(0,0,0,0);
        return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    }

    function switchModule(modId, btn) {
        document.querySelectorAll('.module-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById(modId).classList.add('active');
        if (btn) btn.classList.add('active');
    }


    function getActiveBancos() {
        return (STATE.bancos || []).filter(b => b.status !== 'Arquivada');
    }

    function populateBankSelect(id, selectedId) {
        const el = document.getElementById(id);
        if (!el) return;
        const bancos = getActiveBancos();
        el.innerHTML = bancos.length
            ? bancos.map(b => \`<option value="\${b.id}">\${b.nome} — R$ \${Number(b.saldo || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</option>\`).join('')
            : '<option value="">Nenhuma conta ativa cadastrada</option>';
        if (selectedId && bancos.some(b => b.id === selectedId)) el.value = selectedId;
    }

    function populateAllBankSelects() {
        populateBankSelect('add-rec-banco');
        populateBankSelect('add-pag-banco');
        populateBankSelect('add-p-banco');
        populateBankSelect('add-r-banco');
    }

    function getPreferredBankId(item, fieldName) {
        if (item && item[fieldName]) return item[fieldName];
        const active = getActiveBancos();
        return active[0] ? active[0].id : '';
    }

    function getBankById(id) {
        return (STATE.bancos || []).find(b => b.id === id);
    }

    function openModalPassivo() { populateBankSelect('add-p-banco'); document.getElementById('modal-passivo').style.display = 'flex'; }
    function openModalRecorrente() { populateBankSelect('add-r-banco'); document.getElementById('modal-recorrente').style.display = 'flex'; }
    function openModalReceber() { populateBankSelect('add-rec-banco'); document.getElementById('modal-receber').style.display = 'flex'; }
    function openModalPagar() { populateBankSelect('add-pag-banco'); document.getElementById('modal-pagar').style.display = 'flex'; }
    function openModalConta() { document.getElementById('modal-conta').style.display = 'flex'; }
    function openModalTransferencia() {
        const orig = document.getElementById('transf-origem');
        const dest = document.getElementById('transf-destino');
        orig.innerHTML = STATE.bancos.map(b => \`<option value="\${b.id}">\${b.nome} (R$ \${formatMoney(b.saldo)})</option>\`).join('');
        dest.innerHTML = orig.innerHTML;
        document.getElementById('modal-transferencia').style.display = 'flex';
    }

    function closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    }

    // ===== Segurança operacional V13 =====
    const LIMITE_COMPROVANTE = 5000.00;
    const SENHA_ADMIN_OPERACIONAL = 'ADMIN123';

    function validarDataRetroativa(dataLancamento) {
        if (!dataLancamento) return true;
        const hoje = new Date();
        const limite = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const alvo = String(dataLancamento).includes('T') ? new Date(dataLancamento) : new Date(String(dataLancamento) + 'T00:00:00');
        if (Number.isNaN(alvo.getTime()) || alvo >= limite) return true;
        const senha = prompt('Atenção: esta data pertence a um período anterior ao mês atual. Digite a senha do Administrador para prosseguir:');
        if (senha !== SENHA_ADMIN_OPERACIONAL) {
            alert('Operação cancelada. O período anterior está protegido contra alterações acidentais.');
            return false;
        }
        return true;
    }

    function validarBaixaValorAlto(valor, anexoBase64) {
        if (Number(valor) >= LIMITE_COMPROVANTE && (!anexoBase64 || String(anexoBase64).trim() === '')) {
            alert(\`Segurança: pagamentos/recebimentos a partir de R$ \${formatMoney(LIMITE_COMPROVANTE)} exigem comprovante PDF ou imagem.\`);
            return false;
        }
        return true;
    }

    function anexarComprovanteLancamento(tipo, id, input) {
        const file = input?.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { alert('Comprovante muito grande. Limite: 5 MB.'); input.value=''; return; }
        const colecao = tipo === 'recebimento' ? STATE.recebimentos : STATE.contasPagar;
        const item = colecao.find(x => x.id === id);
        if (!item) return;
        if (item.comprovante && !confirm(\`Já existe um comprovante (\${item.comprovante}). Deseja substituí-lo?\`)) { input.value=''; return; }
        const reader = new FileReader();
        reader.onload = e => {
            item.comprovante = file.name;
            item.comprovanteData = e.target.result;
            item.comprovanteType = file.type || 'application/octet-stream';
            item.comprovanteSize = file.size;
            logAuditoria('ANEXO', tipo === 'recebimento' ? 'Recebimentos' : 'Contas a Pagar', \`Comprovante \${file.name} anexado ao registro \${id}\`);
            showToast('Comprovante anexado.');
            save(); render();
        };
        reader.onerror = () => alert('Não foi possível ler o comprovante.');
        reader.readAsDataURL(file);
    }

    function obterComprovanteLancamento(tipo, id) {
        const colecao = tipo === 'recebimento' ? STATE.recebimentos : STATE.contasPagar;
        return colecao.find(x => x.id === id);
    }
    function baixarComprovanteLancamento(tipo, id) {
        const item = obterComprovanteLancamento(tipo, id);
        if (!item?.comprovanteData) { alert('O arquivo deste comprovante não está armazenado.'); return; }
        const a=document.createElement('a'); a.href=item.comprovanteData; a.download=item.comprovante || 'comprovante'; document.body.appendChild(a); a.click(); a.remove();
        logAuditoria('DOWNLOAD','Comprovantes',\`Comprovante \${item.comprovante} baixado.\`);
    }
    function excluirComprovanteLancamento(tipo, id) {
        const item=obterComprovanteLancamento(tipo,id); if(!item?.comprovante) return;
        if(!confirm(\`Excluir o comprovante "\${item.comprovante}"? O lançamento será mantido.\`)) return;
        const nome=item.comprovante; item.comprovante=null; delete item.comprovanteData; delete item.comprovanteType; delete item.comprovanteSize;
        logAuditoria('EXCLUSÃO DE ANEXO', tipo==='recebimento'?'Recebimentos':'Contas a Pagar', \`Comprovante \${nome} removido.\`);
        save(); render(); showToast('Comprovante excluído. O lançamento foi preservado.');
    }

    function registrarAlteracaoValor(modulo, descricao, anterior, novo) {
        if (Number(anterior) !== Number(novo)) {
            logAuditoria('ALTERAÇÃO_VALOR', modulo, \`\${descricao}: de R$ \${formatMoney(anterior)} para R$ \${formatMoney(novo)}\`);
        }
    }

    function salvarRecebimento(e) {
        e.preventDefault();
        const id = document.getElementById('edit-rec-id').value;
        const cliente = document.getElementById('add-rec-cliente').value.trim();
        const valor = parseFloat(document.getElementById('add-rec-val').value);
        const categoria = document.getElementById('add-rec-cat').value;
        const data = document.getElementById('add-rec-data').value;
        const bancoId = document.getElementById('add-rec-banco').value;
        if (!cliente || !Number.isFinite(valor) || valor <= 0 || !data || !bancoId) { alert('Preencha os dados obrigatórios e escolha a conta.'); return; }

        if(id) {
            const item = STATE.recebimentos.find(x => x.id === id);
            if (!item) return;
            if (item.status === 'Recebido') { alert('Este recebimento já foi baixado. Desfaça a baixa antes de alterar dados financeiros.'); return; }
            if (!validarDataRetroativa(data)) return;
            registrarAlteracaoValor('Recebimentos', \`Entrada de \${cliente}\`, item.valor, valor);
            item.cliente = cliente; item.valor = valor; item.categoria = categoria; item.data = data; item.bancoId = bancoId;
            logAuditoria('EDIÇÃO', 'Recebimentos', \`Entrada de \${cliente} alterada.\`);
            showToast('Recebimento atualizado!');
        } else {
            STATE.recebimentos.push({ id: \`rec_in_\${Date.now()}\`, cliente, valor, categoria, data, status: 'Pendente', bancoId });
            logAuditoria('CADASTRO', 'Recebimentos', \`Nova entrada cadastrada: \${cliente} - R$ \${formatMoney(valor)}\`);
            showToast('Novo recebimento cadastrado!');
        }
        save(); closeModals(); render();
    }

    function salvarPagar(e) {
        e.preventDefault();
        const id = document.getElementById('edit-pag-id').value;
        const fornecedor = document.getElementById('add-pag-fornecedor').value.trim();
        const descricao = document.getElementById('add-pag-desc').value.trim();
        const valor = parseFloat(document.getElementById('add-pag-val').value);
        const vencimento = document.getElementById('add-pag-venc').value;
        const bancoId = document.getElementById('add-pag-banco').value;
        if (!fornecedor || !descricao || !Number.isFinite(valor) || valor <= 0 || !vencimento || !bancoId) { alert('Preencha os dados obrigatórios e escolha a conta.'); return; }

        if(id) {
            const item = STATE.contasPagar.find(x => x.id === id);
            if (!item) return;
            if (item.status === 'Pago') { alert('Esta conta já foi paga. Desfaça o pagamento antes de alterar dados financeiros.'); return; }
            if (!validarDataRetroativa(item.vencimento) || !validarDataRetroativa(vencimento)) return;
            registrarAlteracaoValor('Contas a Pagar', \`Conta de \${fornecedor}\`, item.valor, valor);
            item.fornecedor = fornecedor; item.descricao = descricao; item.valor = valor; item.vencimento = vencimento; item.bancoId = bancoId;
            logAuditoria('EDIÇÃO', 'Contas a Pagar', \`Conta de \${fornecedor} alterada.\`);
            showToast('Conta a pagar atualizada!');
        } else {
            STATE.contasPagar.push({ id: \`pag_\${Date.now()}\`, fornecedor, descricao, valor, vencimento, status: 'Pendente', bancoId });
            logAuditoria('CADASTRO', 'Contas a Pagar', \`Nova conta cadastrada: \${fornecedor} - R$ \${formatMoney(valor)}\`);
            showToast('Conta a pagar cadastrada!');
        }
        save(); closeModals(); render();
    }

    function salvarPassivo(e) {
        e.preventDefault();
        const credor = document.getElementById('add-p-credor').value.trim();
        const doc = document.getElementById('add-p-doc').value.trim();
        const categoria = document.getElementById('add-p-cat').value;
        const qtd = parseInt(document.getElementById('add-p-qtd').value);
        const val = parseFloat(document.getElementById('add-p-val').value);
        const dataStr = document.getElementById('add-p-data').value;
        const bancoId = document.getElementById('add-p-banco').value;
        if (!credor || !doc || !Number.isInteger(qtd) || qtd <= 0 || !Number.isFinite(val) || val <= 0 || !dataStr || !bancoId) { alert('Preencha os dados obrigatórios e escolha a conta.'); return; }

        const base = new Date(dataStr + 'T00:00:00');
        const parcelas = [];
        const stamp = Date.now();
        for (let i = 0; i < qtd; i++) {
            let d = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
            parcelas.push({
                id: \`p_\${stamp}_\${i}\`, num: i + 1, vencimento: d.toISOString().split('T')[0], valor: val, status: 'Pendente', comprovante: null, bancoId
            });
        }

        STATE.passivos.push({ id: \`pass_\${stamp}\`, credor, doc, categoria, valorTotal: qtd * val, parcelas });
        logAuditoria('CADASTRO', 'Acordos', \`Novo acordo: \${credor} com \${qtd} parcelas\`);
        showToast('Acordo cadastrado com sucesso!');
        save(); closeModals(); render();
    }

    function arquivarAcordo(id) {
        const pass = STATE.passivos.find(x => x.id === id);
        if (!pass) return;
        if (!confirm(\`Arquivar o acordo de "\${pass.credor}"? Ele sairá da visão ativa, mas todos os dados e comprovantes serão preservados.\`)) return;
        pass.arquivado = true;
        logAuditoria('ARQUIVAMENTO', 'Acordos', \`Acordo arquivado: \${pass.credor}\`);
        save(); render(); showToast('Acordo arquivado.');
    }

    function restaurarAcordo(id) {
        const pass = STATE.passivos.find(x => x.id === id);
        if (!pass) return;
        pass.arquivado = false;
        logAuditoria('RESTAURAÇÃO', 'Acordos', \`Acordo restaurado: \${pass.credor}\`);
        save(); render(); showToast('Acordo restaurado.');
    }

    function excluirAcordo(id) {
        const idx = STATE.passivos.findIndex(x => x.id === id);
        if (idx < 0) return;
        const pass = STATE.passivos[idx];
        const temHistorico = (pass.parcelas || []).some(p => p.status === 'Pago' || p.comprovante || p.comprovanteData || p.dataPagamento) ||
            (STATE.movimentacoes || []).some(m => m.origemTipo === 'parcela_acordo' && (pass.parcelas || []).some(p => p.id === m.origemId));
        if (temHistorico) {
            alert('Este acordo possui histórico financeiro ou comprovantes. Para preservar a integridade do histórico, ele não pode ser apagado. Use Arquivar.');
            return;
        }
        if (!confirm(\`Excluir definitivamente o acordo de "\${pass.credor}"? Esta ação não poderá ser desfeita.\`)) return;
        STATE.passivos.splice(idx, 1);
        logAuditoria('EXCLUSÃO', 'Acordos', \`Acordo excluído: \${pass.credor}\`);
        save(); render(); showToast('Acordo excluído.');
    }

    function arquivarRecorrencia(id) {
        const rec = STATE.recorrencias.find(x => x.id === id);
        if (!rec) return;
        if (!confirm(\`Arquivar a conta fixa "\${rec.servico}"? Ela deixará de gerar previsão e ficará preservada no histórico.\`)) return;
        rec.arquivado = true;
        logAuditoria('ARQUIVAMENTO', 'Recorrências', \`Conta fixa arquivada: \${rec.servico}\`);
        save(); render(); showToast('Conta fixa arquivada.');
    }

    function restaurarRecorrencia(id) {
        const rec = STATE.recorrencias.find(x => x.id === id);
        if (!rec) return;
        rec.arquivado = false;
        logAuditoria('RESTAURAÇÃO', 'Recorrências', \`Conta fixa restaurada: \${rec.servico}\`);
        save(); render(); showToast('Conta fixa restaurada.');
    }

    function excluirRecorrencia(id) {
        const idx = STATE.recorrencias.findIndex(x => x.id === id);
        if (idx < 0) return;
        const rec = STATE.recorrencias[idx];
        const temHistorico = (rec.historico || []).length > 0 || (STATE.movimentacoes || []).some(m => m.origemTipo === 'recorrencia' && m.origemId === rec.id);
        if (temHistorico) {
            alert('Esta conta fixa possui histórico financeiro. Para não perder informações, ela não pode ser apagada. Use Arquivar.');
            return;
        }
        if (!confirm(\`Excluir definitivamente a conta fixa "\${rec.servico}"?\`)) return;
        STATE.recorrencias.splice(idx, 1);
        logAuditoria('EXCLUSÃO', 'Recorrências', \`Conta fixa excluída: \${rec.servico}\`);
        save(); render(); showToast('Conta fixa excluída.');
    }

    function salvarRecorrencia(e) {
        e.preventDefault();
        const servico = document.getElementById('add-r-nome').value.trim();
        const valor = parseFloat(document.getElementById('add-r-val').value);
        const frequencia = document.getElementById('add-r-freq').value;
        const proximoVencimento = document.getElementById('add-r-venc').value;
        const bancoId = document.getElementById('add-r-banco').value;
        if (!servico || !Number.isFinite(valor) || valor <= 0 || !proximoVencimento || !bancoId) { alert('Preencha os dados obrigatórios e escolha a conta.'); return; }

        STATE.recorrencias.push({ id: \`rec_\${Date.now()}\`, servico, valor, frequencia, proximoVencimento, bancoId, historico: [] });
        logAuditoria('CADASTRO', 'Recorrências', \`Conta fixa adicionada: \${servico}\`);
        showToast('Conta fixa salva!');
        save(); closeModals(); render();
    }

    function salvarContaBancaria(e) {
        e.preventDefault();
        const nome = document.getElementById('add-banco-nome').value.trim();
        const saldo = parseFloat(document.getElementById('add-banco-saldo').value);
        if (!nome || !Number.isFinite(saldo) || saldo < 0) { alert('Informe um nome e um saldo inicial válido.'); return; }
        STATE.bancos.push({ id: \`banco_\${Date.now()}\`, nome, saldo, status: 'Ativa' });
        logAuditoria('CADASTRO', 'Bancos', \`Nova conta bancária: \${nome}\`);
        showToast('Conta bancária registrada!');
        save(); closeModals(); render();
    }

    function editarContaBancaria(id) {
        const b = getBankById(id);
        if (!b) return;
        const nome = prompt('Nome da conta:', b.nome);
        if (nome === null) return;
        if (!nome.trim()) { alert('O nome não pode ficar vazio.'); return; }
        b.nome = nome.trim();
        logAuditoria('EDIÇÃO', 'Bancos', \`Conta bancária renomeada para \${b.nome}\`);
        save(); render(); showToast('Conta bancária atualizada!');
    }

    function arquivarContaBancaria(id) {
        const b = getBankById(id);
        if (!b) return;
        if (b.status === 'Arquivada') return;
        if ((STATE.bancos || []).filter(x => x.status !== 'Arquivada').length <= 1) { alert('Mantenha pelo menos uma conta ativa.'); return; }
        if (!confirm(\`Arquivar a conta "\${b.nome}"? Os lançamentos históricos serão preservados.\`)) return;
        b.status = 'Arquivada';
        logAuditoria('ARQUIVAMENTO', 'Bancos', \`Conta arquivada: \${b.nome}\`);
        save(); render(); showToast('Conta arquivada. Histórico preservado.');
    }

    function restaurarContaBancaria(id) {
        const b = getBankById(id);
        if (!b) return;
        b.status = 'Ativa';
        logAuditoria('RESTAURAÇÃO', 'Bancos', \`Conta restaurada: \${b.nome}\`);
        save(); render(); showToast('Conta restaurada!');
    }

    function excluirContaBancaria(id) {
        const b = getBankById(id);
        if (!b) return;
        const referenciada = (STATE.movimentacoes || []).some(m => m.bancoId === id || m.conta === b.nome)
            || (STATE.recebimentos || []).some(r => r.bancoId === id)
            || (STATE.contasPagar || []).some(p => p.bancoId === id)
            || (STATE.passivos || []).some(p => (p.bancoId === id) || (p.parcelas || []).some(x => x.bancoId === id))
            || (STATE.recorrencias || []).some(r => r.bancoId === id);
        if (referenciada) { alert('Esta conta possui histórico ou lançamentos vinculados. Ela será arquivada em vez de apagada para não quebrar o histórico financeiro.'); arquivarContaBancaria(id); return; }
        if (!confirm(\`Excluir definitivamente a conta "\${b.nome}"?\`)) return;
        STATE.bancos = STATE.bancos.filter(x => x.id !== id);
        logAuditoria('EXCLUSÃO', 'Bancos', \`Conta excluída: \${b.nome}\`);
        save(); render(); showToast('Conta excluída!');
    }

    function salvarTransferencia(e) {
        e.preventDefault();
        const origId = document.getElementById('transf-origem').value;
        const destId = document.getElementById('transf-destino').value;
        const valor = parseFloat(document.getElementById('transf-val').value);

        if(origId === destId) { alert('Escolha contas diferentes!'); return; }
        let orig = STATE.bancos.find(b => b.id === origId);
        let dest = STATE.bancos.find(b => b.id === destId);

        if(orig.saldo < valor) { alert('Saldo insuficiente na conta de origem!'); return; }

        orig.saldo -= valor;
        dest.saldo += valor;

        const hoje = new Date().toISOString().split('T')[0];
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: hoje, descricao: \`Transferência para \${dest.nome}\`, conta: orig.nome, bancoId: orig.id, tipo: 'Transferência', valor, sinal: -1, origemTipo: 'transferencia' });
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}_2\`, data: hoje, descricao: \`Transferência de \${orig.nome}\`, conta: dest.nome, bancoId: dest.id, tipo: 'Transferência', valor, sinal: 1, origemTipo: 'transferencia' });

        logAuditoria('TRANSFERÊNCIA', 'Bancos', \`Transferência de R$ \${valor} de \${orig.nome} para \${dest.nome}\`);
        showToast('Transferência realizada!');
        save(); closeModals(); render();
    }

    function confirmarRecebimento(id) {
        const item = STATE.recebimentos.find(x => x.id === id);
        if (!item || item.status === 'Recebido') return;
        if (!validarBaixaValorAlto(item.valor, item.comprovanteData)) return;
        const banco = getBankById(getPreferredBankId(item, 'bancoId'));
        if (!banco || banco.status === 'Arquivada') { alert('Escolha uma conta bancária ativa.'); return; }
        item.bancoId = banco.id;
        item.status = 'Recebido';
        item.dataRecebimento = new Date().toISOString().split('T')[0];
        item.valorRecebido = item.valor;
        banco.saldo += item.valor;
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: item.dataRecebimento, descricao: \`Recebimento: \${item.cliente}\`, conta: banco.nome, bancoId: banco.id, tipo: 'Entrada', valor: item.valor, sinal: 1, origemId: item.id, origemTipo: 'recebimento' });
        logAuditoria('BAIXA', 'Recebimentos', \`Entrada confirmada: R$ \${formatMoney(item.valor)} de \${item.cliente} na conta \${banco.nome}\`);
        showToast('Recebimento confirmado no Caixa!');
        save(); render();
    }

    function desfazerRecebimento(id) {
        const item = STATE.recebimentos.find(x => x.id === id);
        if (!item || item.status !== 'Recebido') return;
        if (!confirm('Desfazer este recebimento e estornar o valor da conta?')) return;
        const banco = getBankById(item.bancoId);
        if (banco) banco.saldo -= item.valorRecebido ?? item.valor;
        const valor = item.valorRecebido ?? item.valor;
        item.status = 'Pendente';
        item.dataRecebimento = null;
        item.valorRecebido = null;
        anularUltimoMovimento(item.id, 'recebimento');
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: new Date().toISOString().split('T')[0], descricao: \`Estorno de recebimento: \${item.cliente}\`, conta: banco?.nome || 'Conta', bancoId: banco?.id, tipo: 'Saída', valor, sinal: -1, estorno: true, origemId: item.id, origemTipo: 'recebimento' });
        logAuditoria('REVERSÃO', 'Recebimentos', \`Recebimento desfeito: \${item.cliente} - R$ \${formatMoney(valor)}\`);
        save(); render(); showToast('Recebimento desfeito e estornado!');
    }

    function confirmarPagamentoConta(id) {
        const item = STATE.contasPagar.find(x => x.id === id);
        if (!item || item.status === 'Pago') return;
        if (!validarBaixaValorAlto(item.valor, item.comprovanteData)) return;
        const banco = getBankById(getPreferredBankId(item, 'bancoId'));
        if (!banco || banco.status === 'Arquivada') { alert('Escolha uma conta bancária ativa.'); return; }
        if (Number(banco.saldo) < Number(item.valor)) { alert(\`Saldo insuficiente em \${banco.nome}. Saldo disponível: R$ \${formatMoney(Number(banco.saldo))}\`); return; }
        item.bancoId = banco.id;
        item.status = 'Pago';
        item.dataPagamento = new Date().toISOString().split('T')[0];
        banco.saldo -= item.valor;
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: item.dataPagamento, descricao: \`Pagamento: \${item.fornecedor}\`, conta: banco.nome, bancoId: banco.id, tipo: 'Saída', valor: item.valor, sinal: -1, origemId: item.id, origemTipo: 'conta_pagar' });
        logAuditoria('BAIXA', 'Contas a Pagar', \`Pagamento efetuado: R$ \${formatMoney(item.valor)} para \${item.fornecedor} pela conta \${banco.nome}\`);
        showToast('Conta quitada no Caixa!');
        save(); render();
    }

    function desfazerPagamentoConta(id) {
        const item = STATE.contasPagar.find(x => x.id === id);
        if (!item || item.status !== 'Pago') return;
        if (!confirm('Desfazer este pagamento e devolver o valor à conta?')) return;
        const valor = item.valor;
        const banco = getBankById(item.bancoId);
        if (banco) banco.saldo += valor;
        item.status = 'Pendente';
        item.dataPagamento = null;
        anularUltimoMovimento(item.id, 'conta_pagar');
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: new Date().toISOString().split('T')[0], descricao: \`Estorno de pagamento: \${item.fornecedor}\`, conta: banco?.nome || 'Conta', bancoId: banco?.id, tipo: 'Entrada', valor, sinal: 1, estorno: true, origemId: item.id, origemTipo: 'conta_pagar' });
        logAuditoria('REVERSÃO', 'Contas a Pagar', \`Pagamento desfeito: \${item.fornecedor} - R$ \${formatMoney(valor)}\`);
        save(); render(); showToast('Pagamento desfeito e estornado!');
    }

    function baixarParcela(passId, parcId) {
        const pass = STATE.passivos.find(x => x.id === passId);
        const p = pass?.parcelas.find(x => x.id === parcId);
        if (!pass || !p || p.status === 'Pago') return;
        if (!validarBaixaValorAlto(p.valor, p.comprovanteData)) return;
        const banco = getBankById(getPreferredBankId(p, 'bancoId'));
        if (!banco || banco.status === 'Arquivada') { alert('Escolha uma conta bancária ativa para esta parcela.'); return; }
        if (Number(banco.saldo) < Number(p.valor)) { alert(\`Saldo insuficiente em \${banco.nome}. Saldo disponível: R$ \${formatMoney(Number(banco.saldo))}\`); return; }
        p.bancoId = banco.id;
        p.status = 'Pago';
        p.dataPagamento = new Date().toISOString().split('T')[0];
        if(!p.comprovante) p.comprovante = "Baixa_Manual.pdf";
        banco.saldo -= p.valor;
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: p.dataPagamento, descricao: \`Parcela #\${p.num} - \${pass.credor}\`, conta: banco.nome, bancoId: banco.id, tipo: 'Saída', valor: p.valor, sinal: -1, origemId: p.id, origemTipo: 'parcela_acordo' });
        logAuditoria('BAIXA', 'Acordos', \`Parcela #\${p.num} quitada de \${pass.credor} pela conta \${banco.nome}\`);
        showToast('Parcela baixada com sucesso!');
        save(); render();
    }

    function desfazerPagamentoParcela(passId, parcId) {
        if(!confirm('Deseja realmente desfazer o pagamento desta parcela? O saldo será estornado e o comprovante será preservado.')) return;
        const pass = STATE.passivos.find(x => x.id === passId);
        const p = pass?.parcelas.find(x => x.id === parcId);
        if (!pass || !p || p.status !== 'Pago') return;
        const valor = p.valor;
        const banco = getBankById(p.bancoId);
        if (banco) banco.saldo += valor;
        p.status = 'Pendente';
        p.dataPagamento = null;
        anularUltimoMovimento(p.id, 'parcela_acordo');
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: new Date().toISOString().split('T')[0], descricao: \`Estorno parcela #\${p.num} - \${pass.credor}\`, conta: banco?.nome || 'Conta', bancoId: banco?.id, tipo: 'Entrada', valor, sinal: 1, estorno: true, origemId: p.id, origemTipo: 'parcela_acordo' });
        logAuditoria('REVERSÃO', 'Acordos', \`Pagamento desfeito da parcela #\${p.num} de \${pass.credor}; comprovante preservado\`);
        showToast('Pagamento desfeito; comprovante preservado!');
        save(); render();
    }

    function handleFilePassivo(passId, parcId, input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];
        const pass = STATE.passivos.find(x => x.id === passId);
        const p = pass?.parcelas.find(x => x.id === parcId);
        if (!pass || !p) return;
        if (p.comprovante && !confirm(\`Já existe um comprovante (\${p.comprovante}). Deseja substituí-lo por "\\${file.name}"?\`)) { input.value=''; return; }
        if (file.size > 5 * 1024 * 1024) { alert('Comprovante muito grande. Limite para armazenamento direto: 5 MB.'); input.value=''; return; }
        const reader = new FileReader();
        reader.onload = function(e) {
            p.comprovante = file.name;
            p.comprovanteData = e.target.result;
            p.comprovanteType = file.type || 'application/octet-stream';
            p.comprovanteSize = file.size;
            logAuditoria('ANEXO', 'Acordos', \`Comprovante \${file.name} anexado à parcela #\${p.num}\`);
            showToast('Comprovante anexado e armazenado!');
            save(); render();
        };
        reader.onerror = function(){ alert('Não foi possível ler o comprovante.'); };
        reader.readAsDataURL(file);
    }

    function obterComprovante(obj) {
        if (!obj) return null;
        if (obj.comprovanteData) return { name: obj.comprovante || 'comprovante', data: obj.comprovanteData, type: obj.comprovanteType || '' };
        return null;
    }

    function localizarComprovante(objId, tipo, historicoId) {
        if (tipo === 'parcela') {
            for (const pass of (STATE.passivos || [])) {
                const obj = pass.parcelas?.find(p => p.id === objId);
                if (obj) return { obj, modulo: 'Acordos', descricao: \`parcela #\${obj.num} de \${pass.credor}\` };
            }
        } else if (tipo === 'recorrencia') {
            const rec = (STATE.recorrencias || []).find(r => r.id === objId);
            const obj = rec?.historico?.find(h => h.id === historicoId);
            if (obj) return { obj, modulo: 'Recorrências', descricao: \`pagamento de \${rec.servico}\` };
        }
        return null;
    }

    function excluirComprovante(objId, tipo, historicoId) {
        const alvo = localizarComprovante(objId, tipo, historicoId);
        if (!alvo || !alvo.obj.comprovante) return;
        const nome = alvo.obj.comprovante;
        const pergunta = \`Excluir o comprovante "\\${nome}"?\\n\\nO pagamento/registro será mantido. Somente o arquivo e a referência do comprovante serão removidos.\`;
        if (!confirm(pergunta)) return;
        alvo.obj.comprovante = null;
        delete alvo.obj.comprovanteData;
        delete alvo.obj.comprovanteType;
        delete alvo.obj.comprovanteSize;
        logAuditoria('EXCLUSÃO DE ANEXO', alvo.modulo, \`Comprovante \${nome} removido de \${alvo.descricao}\`);
        save();
        render();
        showToast('Comprovante excluído. O lançamento foi preservado.');
    }

    function baixarComprovante(objId, tipo, historicoId) {
        let obj = null;
        if (tipo === 'parcela') {
            for (const pass of (STATE.passivos || [])) { obj = pass.parcelas?.find(p => p.id === objId); if (obj) break; }
        } else if (tipo === 'recorrencia') {
            const rec = (STATE.recorrencias || []).find(r => r.id === objId);
            obj = rec?.historico?.find(h => h.id === historicoId);
        }
        const arq = obterComprovante(obj);
        if (!arq) { alert('Este comprovante foi registrado apenas pelo nome. O arquivo original não está armazenado nesta versão do sistema.'); return; }
        const a = document.createElement('a');
        a.href = arq.data; a.download = arq.name; document.body.appendChild(a); a.click(); a.remove();
        logAuditoria('DOWNLOAD', tipo === 'parcela' ? 'Acordos' : 'Recorrências', \`Comprovante \${arq.name} baixado\`);
    }

    function visualizarComprovante(objId, tipo, historicoId) {
        let obj = null;
        if (tipo === 'parcela') {
            for (const pass of (STATE.passivos || [])) { obj = pass.parcelas?.find(p => p.id === objId); if (obj) break; }
        } else if (tipo === 'recorrencia') {
            const rec = (STATE.recorrencias || []).find(r => r.id === objId);
            obj = rec?.historico?.find(h => h.id === historicoId);
        }
        const arq = obterComprovante(obj);
        if (!arq) { alert('O arquivo deste comprovante não está armazenado. Apenas o nome foi preservado.'); return; }
        const win = window.open('', '_blank');
        if (!win) { alert('O navegador bloqueou a visualização. Permita pop-ups para este sistema.'); return; }
        if ((arq.type || '').startsWith('image/') || arq.type === 'application/pdf') {
            win.document.write(\`<title>\${arq.name}</title><style>html,body{margin:0;height:100%;background:#111}embed,img{width:100%;height:100%;object-fit:contain;border:0}</style>\${arq.type === 'application/pdf' ? \`<embed src="\${arq.data}" type="application/pdf">\` : \`<img src="\${arq.data}" alt="\${arq.name}">\`}\`);
            win.document.close();
        } else {
            win.location.href = arq.data;
        }
    }

    function baixarRecorrencia(recId) {
        const rec = STATE.recorrencias.find(x => x.id === recId);
        if (!rec) return;
        if (rec.arquivado) { alert('Esta conta fixa está arquivada. Restaure-a para registrar um novo pagamento.'); return; }
        if (Number(rec.valor) >= LIMITE_COMPROVANTE && !document.getElementById(\`file-rec-\${recId}\`)?.files?.[0]) { alert(\`Segurança: esta baixa de R$ \${formatMoney(rec.valor)} exige comprovante. Anexe o PDF ou imagem antes de confirmar.\`); return; }
        const banco = getBankById(getPreferredBankId(rec, 'bancoId'));
        if (!banco || banco.status === 'Arquivada') { alert('Escolha uma conta bancária ativa.'); return; }
        if (Number(banco.saldo) < Number(rec.valor)) { alert(\`Saldo insuficiente em \${banco.nome}.\`); return; }
        const fileInput = document.getElementById(\`file-rec-\${recId}\`);
        const file = (fileInput && fileInput.files && fileInput.files[0]) ? fileInput.files[0] : null;
        if (file && file.size > 5 * 1024 * 1024) { alert('Recibo muito grande. Limite para armazenamento direto: 5 MB.'); return; }
        const hoje = new Date().toISOString().split('T')[0];
        rec.bancoId = banco.id;
        rec.historico = rec.historico || [];
        const historico = { id: \`rh_\${Date.now()}\`, dataPagamento: hoje, valor: rec.valor, comprovante: file ? file.name : 'Recibo.pdf', bancoId: banco.id };
        const concluirPagamento = (data) => {
            if (data) { historico.comprovanteData = data; historico.comprovanteType = file.type || 'application/octet-stream'; historico.comprovanteSize = file.size; }
            rec.historico.push(historico);
            banco.saldo -= rec.valor;
            STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: hoje, descricao: \`Gasto Fixo: \${rec.servico}\`, conta: banco.nome, bancoId: banco.id, tipo: 'Saída', valor: rec.valor, sinal: -1, origemId: rec.id, origemTipo: 'recorrencia', origemHistoricoId: historico.id });
            let d = new Date(rec.proximoVencimento + 'T00:00:00');
            if (rec.frequencia === 'Mensal') d.setMonth(d.getMonth() + 1);
            else if (rec.frequencia === 'Trimestral') d.setMonth(d.getMonth() + 3);
            else if (rec.frequencia === 'Anual') d.setFullYear(d.getFullYear() + 1);
            rec.proximoVencimento = d.toISOString().split('T')[0];
            logAuditoria('BAIXA', 'Recorrências', \`Gasto fixo quitado: \${rec.servico}\`);
            showToast('Gasto fixo quitado!');
            save(); render();
        };
        if (file) {
            const reader = new FileReader();
            reader.onload = e => concluirPagamento(e.target.result);
            reader.onerror = () => alert('Não foi possível ler o recibo.');
            reader.readAsDataURL(file);
        } else { concluirPagamento(null); }
    }

    function desfazerRecorrencia(recId, histId) {
        const rec = STATE.recorrencias.find(x => x.id === recId);
        if (!rec || !rec.historico?.length) return;
        const idx = histId ? rec.historico.findIndex(h => h.id === histId) : rec.historico.length - 1;
        if (idx < 0) return;
        const h = rec.historico[idx];
        if (!confirm(\`Desfazer o pagamento de R$ \${formatMoney(Number(h.valor))}?\`)) return;
        const banco = getBankById(h.bancoId || rec.bancoId);
        if (banco) banco.saldo += Number(h.valor);
        rec.historico.splice(idx, 1);
        let d = new Date(rec.proximoVencimento + 'T00:00:00');
        if (rec.frequencia === 'Mensal') d.setMonth(d.getMonth() - 1);
        else if (rec.frequencia === 'Trimestral') d.setMonth(d.getMonth() - 3);
        else if (rec.frequencia === 'Anual') d.setFullYear(d.getFullYear() - 1);
        rec.proximoVencimento = d.toISOString().split('T')[0];
        anularUltimoMovimento(rec.id, 'recorrencia', h.id);
        STATE.movimentacoes.unshift({ id: \`mov_\${Date.now()}\`, data: new Date().toISOString().split('T')[0], descricao: \`Estorno de gasto fixo: \${rec.servico}\`, conta: banco?.nome || 'Conta', bancoId: banco?.id, tipo: 'Entrada', valor: Number(h.valor), sinal: 1, estorno: true, origemId: rec.id, origemTipo: 'recorrencia' });
        logAuditoria('REVERSÃO', 'Recorrências', \`Pagamento desfeito: \${rec.servico}\`);
        save(); render(); showToast('Pagamento da conta fixa desfeito!');
    }

    function editarRecebimentoModal(id) {
        const item = STATE.recebimentos.find(x => x.id === id);
        document.getElementById('edit-rec-id').value = item.id;
        document.getElementById('add-rec-cliente').value = item.cliente;
        document.getElementById('add-rec-val').value = item.valor;
        document.getElementById('add-rec-cat').value = item.categoria;
        document.getElementById('add-rec-data').value = item.data;
        openModalReceber();
        populateBankSelect('add-rec-banco', getPreferredBankId(item, 'bancoId'));
    }

    function editarPagarModal(id) {
        const item = STATE.contasPagar.find(x => x.id === id);
        document.getElementById('edit-pag-id').value = item.id;
        document.getElementById('add-pag-fornecedor').value = item.fornecedor;
        document.getElementById('add-pag-desc').value = item.descricao;
        document.getElementById('add-pag-val').value = item.valor;
        document.getElementById('add-pag-venc').value = item.vencimento;
        openModalPagar();
        populateBankSelect('add-pag-banco', getPreferredBankId(item, 'bancoId'));
    }

    function excluirRecebimento(id) {
        const item = STATE.recebimentos.find(x => x.id === id);
        if (!item) return;
        if ((STATE.movimentacoes||[]).some(m => m.origemId === id && m.origemTipo === 'recebimento') || item.status === 'Recebido') { alert('Este recebimento possui histórico financeiro. Não pode ser apagado; desfaça a baixa para corrigir.'); return; }
        if (!validarDataRetroativa(item.data)) return;
        if(!confirm('Confirma a exclusão deste recebimento?')) return;
        STATE.recebimentos = STATE.recebimentos.filter(x => x.id !== id);
        logAuditoria('EXCLUSÃO', 'Recebimentos', \`Registro excluído ID: \${id}\`);
        showToast('Registro excluído!');
        save(); render();
    }

    function excluirContaPagar(id) {
        const item = STATE.contasPagar.find(x => x.id === id);
        if (!item) return;
        if ((STATE.movimentacoes||[]).some(m => m.origemId === id && m.origemTipo === 'conta_pagar') || item.status === 'Pago') { alert('Esta conta possui histórico financeiro. Não pode ser apagada; desfaça o pagamento para corrigir.'); return; }
        if (!validarDataRetroativa(item.vencimento)) return;
        if(!confirm('Confirma a exclusão desta conta a pagar?')) return;
        STATE.contasPagar = STATE.contasPagar.filter(x => x.id !== id);
        logAuditoria('EXCLUSÃO', 'Contas a Pagar', \`Registro excluído ID: \${id}\`);
        showToast('Registro excluído!');
        save(); render();
    }

    function calcularProjecao(dias) {
        const hoje = new Date();
        hoje.setHours(0,0,0,0);
        const limite = new Date();
        limite.setDate(hoje.getDate() + dias);

        let entradas = 0;
        STATE.recebimentos.forEach(r => {
            let d = new Date(r.data + 'T00:00:00');
            if (d >= hoje && d <= limite) entradas += r.valor;
        });

        let saidas = 0;
        STATE.contasPagar.forEach(p => {
            let d = new Date(p.vencimento + 'T00:00:00');
            if (p.status === 'Pendente' && d >= hoje && d <= limite) saidas += p.valor;
        });

        STATE.passivos.filter(p => !p.arquivado).forEach(p => {
            p.parcelas.forEach(parc => {
                let d = new Date(parc.vencimento + 'T00:00:00');
                if (parc.status === 'Pendente' && d >= hoje && d <= limite) saidas += parc.valor;
            });
        });

        STATE.recorrencias.filter(rec => !rec.arquivado).forEach(rec => {
            let d = new Date(rec.proximoVencimento + 'T00:00:00');
            if (d >= hoje && d <= limite) saidas += rec.valor;
        });

        return entradas - saidas;
    }

    function exportarBackupJSON() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(STATE, null, 2));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", \`DBS_TREASURY_BACKUP_\${new Date().toISOString().split('T')[0]}.json\`);
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        logAuditoria('BACKUP', 'Sistema', 'Backup do banco exportado via JSON');
        showToast('Backup JSON exportado!');
    }

    function restaurarBackupJSON(input) {
        if (!input.files || !input.files[0]) return;
        if (!confirm('Esta ação substituirá os dados atuais pelo arquivo selecionado. Continuar?')) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedState = JSON.parse(e.target.result);
                STATE = importedState;
                save(); render();
                showToast('Banco restaurado com sucesso!');
                logAuditoria('RESTAURAÇÃO', 'Sistema', 'Banco restaurado via JSON');
            } catch(err) {
                alert('Arquivo de backup inválido!');
            }
        };
        reader.readAsText(input.files[0]);
    }

    function exportarCSV(tipo) {
        let csvContent = "data:text/csv;charset=utf-8,";
        if (tipo === 'passivos') {
            csvContent += "Credor,Documento,Categoria,Parcela,Vencimento,Valor,Status\\n";
            STATE.passivos.forEach(p => {
                p.parcelas.forEach(parc => {
                    csvContent += \`"\${p.credor}","\${p.doc}","\${p.categoria || 'Geral'}",\${parc.num},\${parc.vencimento},\${parc.valor},\${parc.status}\\n\`;
                });
            });
        } else {
            csvContent += "Cliente,Categoria,Data,Valor,Status\\n";
            STATE.recebimentos.forEach(r => {
                csvContent += \`"\${r.cliente}","\${r.categoria}",\${r.data},\${r.valor},\${r.status}\\n\`;
            });
        }

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", \`relatorio_\${tipo}.csv\`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // ===== Filtro de Acordos por período =====
    function formatarDataBR(dataString){
        if(!dataString) return '-';
        const str=String(dataString);
        if(str.includes('/')) return str;
        const partes=str.split('T')[0].split('-');
        return partes.length===3 ? \`\${partes[2]}/\${partes[1]}/\${partes[0]}\` : str;
    }
    function parseDataBR(dataStr){
        if(!dataStr) return null;
        const str=String(dataStr);
        if(str.includes('/')){ const [dia,mes,ano]=str.split('/'); return new Date(Number(ano),Number(mes)-1,Number(dia)); }
        const [ano,mes,dia]=str.split('-');
        return new Date(Number(ano),Number(mes)-1,Number(dia));
    }
    function setAtalhoData(tipo){
        const hoje=new Date(); let inicio,fim;
        if(tipo==='mesAtual'){ inicio=new Date(hoje.getFullYear(),hoje.getMonth(),1); fim=new Date(hoje.getFullYear(),hoje.getMonth()+1,0); }
        else if(tipo==='mesAnterior'){ inicio=new Date(hoje.getFullYear(),hoje.getMonth()-1,1); fim=new Date(hoje.getFullYear(),hoje.getMonth(),0); }
        else { inicio=new Date(hoje.getFullYear(),0,1); fim=new Date(hoje.getFullYear(),11,31); }
        document.getElementById('filtroDataInicio').value=\`\${inicio.getFullYear()}-\${String(inicio.getMonth()+1).padStart(2,'0')}-\${String(inicio.getDate()).padStart(2,'0')}\`;
        document.getElementById('filtroDataFim').value=\`\${fim.getFullYear()}-\${String(fim.getMonth()+1).padStart(2,'0')}-\${String(fim.getDate()).padStart(2,'0')}\`;
        filtrarAcordosPorData();
    }
    function limparFiltroData(){ document.getElementById('filtroDataInicio').value=''; document.getElementById('filtroDataFim').value=''; filtrarAcordosPorData(); }
    function getAcordosFiltrados(){
        const ini=document.getElementById('filtroDataInicio')?.value;
        const fim=document.getElementById('filtroDataFim')?.value;
        if(!ini&&!fim) return STATE.passivos||[];
        const dIni=ini?new Date(ini+'T00:00:00'):new Date(2000,0,1);
        const dFim=fim?new Date(fim+'T23:59:59'):new Date(2099,11,31,23,59,59);
        return (STATE.passivos||[]).filter(pass=>(pass.parcelas||[]).some(p=>{ const d=parseDataBR(p.vencimento); return d&&d>=dIni&&d<=dFim; }));
    }
    function filtrarAcordosPorData(){ render(); showToast('Filtro por período aplicado.'); }

    function exportarRelatorioAcordosPDF(){
        const lista=getAcordosFiltrados().filter(p=>!p.arquivado || document.getElementById('flt-passivo-arquivados')?.checked);
        if(!lista.length){ showToast('Nenhum acordo encontrado para o período selecionado.'); return; }
        const ini=document.getElementById('filtroDataInicio')?.value, fim=document.getElementById('filtroDataFim')?.value;
        const periodo=(ini||fim)?\`Período: \${formatarDataBR(ini)} até \${formatarDataBR(fim)}\`:'Todos os Registros';
        let totalContratos=0,totalPago=0,totalSaldo=0,linhas='';
        lista.forEach(ac=>{
            const valorTotal=Number(ac.valorTotal)||0,totalParcelas=Number(ac.parcelas?.length)||1;
            const parcelasFiltradas=(ac.parcelas||[]).filter(p=>{const d=parseDataBR(p.vencimento); if(!ini&&!fim)return true; const a=ini?new Date(ini+'T00:00:00'):new Date(2000,0,1); const b=fim?new Date(fim+'T23:59:59'):new Date(2099,11,31,23,59,59); return d&&d>=a&&d<=b;});
            const valorParcela=Number(ac.parcelas?.[0]?.valor)||0;
            const pagasTotal=(ac.parcelas||[]).filter(p=>p.status==='Pago').reduce((s,p)=>s+(Number(p.valor)||0),0);
            const pagoPeriodo=parcelasFiltradas.filter(p=>p.status==='Pago').reduce((s,p)=>s+(Number(p.valor)||0),0);
            const saldoDevedor=Math.max(0,valorTotal-pagasTotal);
            const pct=valorTotal>0?(pagasTotal/valorTotal*100).toFixed(1):'0.0';
            totalContratos+=valorTotal; totalPago+=pagasTotal; totalSaldo+=saldoDevedor;
            linhas+=\`<tr><td><strong>\${ac.credor}</strong><br><small>\${ac.categoria||'Acordo'}</small></td><td>\${parcelasFiltradas.length}/\${totalParcelas}</td><td>R$ \${formatMoney(valorParcela)}</td><td>R$ \${formatMoney(valorTotal)}</td><td>R$ \${formatMoney(pagasTotal)}</td><td>R$ \${formatMoney(saldoDevedor)}</td><td>\${pct}%</td><td>\${parcelasFiltradas.length?formatarDataBR(parcelasFiltradas[0].vencimento):'-'}</td></tr>\`;
        });
        const pctGeral=totalContratos>0?(totalPago/totalContratos*100).toFixed(1):'0.0';
        const win=window.open('','_blank','width=950,height=700');
        if(!win){alert('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.');return;}
        win.document.write(\`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatorio_Passivos_DBS_Air</title><style>body{font-family:Arial,sans-serif;padding:25px;color:#1e293b;font-size:11px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0284c7;padding-bottom:12px}.logo{font-size:18px;font-weight:bold;color:#0284c7}.sub{color:#64748b;font-size:10px}.title{text-align:center;font-size:15px;font-weight:bold;margin:15px 0 4px;text-transform:uppercase}.period{text-align:center;color:#0369a1;font-weight:bold;margin-bottom:15px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:8px;text-align:left;font-size:9px}td{padding:8px;border-bottom:1px solid #e2e8f0}.kpis{display:flex;gap:8px;margin:15px 0}.kpi{flex:1;background:#f8fafc;border:1px solid #cbd5e1;padding:10px;text-align:center}.kv{font-weight:bold;font-size:13px;margin-top:3px}.total{font-weight:bold;background:#f8fafc;border-top:2px solid #0284c7}@media print{@page{size:landscape;margin:1cm}body{padding:0}}</style></head><body><div class="header"><div><div class="logo">DBS AIR REFRIGERAÇÃO LTDA</div><div class="sub">CNPJ: 13.352.707/0001-09</div></div><div class="sub"><strong>DBS TREASURY</strong><br>Emissão: \${new Date().toLocaleString('pt-BR')}</div></div><div class="title">Relatório Gerencial de Acordos e Passivos</div><div class="period">\${periodo}</div><div class="kpis"><div class="kpi">Montante Total<br><div class="kv">R$ \${formatMoney(totalContratos)}</div></div><div class="kpi">Total Pago<br><div class="kv">R$ \${formatMoney(totalPago)}</div></div><div class="kpi">Saldo Devedor<br><div class="kv">R$ \${formatMoney(totalSaldo)}</div></div><div class="kpi">Amortização<br><div class="kv">\${pctGeral}%</div></div></div><table><thead><tr><th>Credor</th><th>Parc. no filtro</th><th>Valor Parcela</th><th>Total Contrato</th><th>Total Pago</th><th>Saldo</th><th>% Pago</th><th>Próx. Venc.</th></tr></thead><tbody>\${linhas}<tr class="total"><td>TOTALIZADORES</td><td>-</td><td>-</td><td>R$ \${formatMoney(totalContratos)}</td><td>R$ \${formatMoney(totalPago)}</td><td>R$ \${formatMoney(totalSaldo)}</td><td>\${pctGeral}%</td><td>-</td></tr></tbody></table><script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}<\\/script></body></html>\`);
        win.document.close();
        logAuditoria('EXPORTAÇÃO_PDF','Acordos',\`Gerou relatório PDF de passivos. \${periodo}\`);
    }

    function renderDRE() {
        const selectedPeriod = document.getElementById('global-period-filter').value;
        let [selY, selM] = selectedPeriod.split('-');

        let recCadastrada = 0;
        STATE.recebimentos.forEach(r => {
            let [y, m] = r.data.split('-');
            if (y === selY && m === selM) recCadastrada += r.valor;
        });

        let contasPagarMes = 0;
        STATE.contasPagar.forEach(p => {
            let [y, m] = p.vencimento.split('-');
            if (y === selY && m === selM) contasPagarMes += p.valor;
        });

        const recBrutaManual = parseFloat(document.getElementById('dre-input-receita').value) || 0;
        const pctImp = parseFloat(document.getElementById('dre-input-impostos').value) || 0;
        const custosDir = parseFloat(document.getElementById('dre-input-custos').value) || 0;

        const impostosManual = recBrutaManual * (pctImp / 100);
        const recTotalLiquida = (recCadastrada + recBrutaManual) - impostosManual;

        let totalRecorrencias = 0;
        STATE.recorrencias.filter(r => !r.arquivado).forEach(r => {
            if (r.frequencia === 'Mensal') totalRecorrencias += r.valor;
            else if (r.frequencia === 'Trimestral') totalRecorrencias += (r.valor / 3);
            else if (r.frequencia === 'Anual') totalRecorrencias += (r.valor / 12);
        });

        const ebitda = recTotalLiquida - custosDir - totalRecorrencias - contasPagarMes;

        let totalPassivosMes = 0;
        STATE.passivos.forEach(pass => {
            pass.parcelas.forEach(p => {
                let [y, m] = p.vencimento.split('-');
                if (y === selY && m === selM) totalPassivosMes += p.valor;
            });
        });

        const liquido = ebitda - totalPassivosMes;

        document.getElementById('dre-val-rec-cadastrada').innerText = \`R$ \${recCadastrada.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('dre-val-recbruta').innerText = \`R$ \${recBrutaManual.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('dre-val-impostos').innerText = \`R$ \${impostosManual.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('dre-val-recliquida').innerText = \`R$ \${recTotalLiquida.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('dre-val-custos').innerText = \`R$ \${custosDir.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('dre-val-recorrencias').innerText = \`R$ \${totalRecorrencias.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('dre-val-pagar-mes').innerText = \`R$ \${contasPagarMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        
        const ebitdaEl = document.getElementById('dre-val-ebitda');
        ebitdaEl.innerText = \`R$ \${ebitda.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        ebitdaEl.className = ebitda >= 0 ? 'dre-val-pos' : 'dre-val-neg';

        document.getElementById('dre-val-passivos').innerText = \`R$ \${totalPassivosMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        
        const liqEl = document.getElementById('dre-val-liquido');
        liqEl.innerText = \`R$ \${liquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        liqEl.className = liquido >= 0 ? 'dre-val-pos' : 'dre-val-neg';
    }

    // ===== Livro Caixa: motor de conciliação =====
    function normalizarMovimento(m){
        if(!m) return null;
        if(!m.bancoId && m.conta){ const b=STATE.bancos.find(x=>x.nome===m.conta); if(b) m.bancoId=b.id; }
        let sinal=Number(m.sinal);
        if(sinal!==1 && sinal!==-1){
            if(m.tipo==='Entrada') sinal=1;
            else if(m.tipo==='Saída') sinal=-1;
            else if(m.tipo==='Transferência') sinal=(String(m.descricao||'').toLowerCase().includes('para ')?-1:1);
            else sinal=1;
            m.sinal=sinal;
        }
        m.valor=Number(m.valor)||0;
        return m;
    }
    // ===== Livro Caixa: leitura financeira SEM alterar o STATE =====
    function getMovimentacoesAtivas(){
        return (STATE.movimentacoes||[])
            .map(m => normalizarMovimento(Object.assign({}, m)))
            .filter(m => !!m);
    }

    function isSaldoInicialTecnico(m){
        return m && m.id === 'mov_1' && m.descricao === 'Aporte Inicial de Caixa';
    }

    function getLivroCaixaOperacional(){
        return getMovimentacoesAtivas().filter(m => !isSaldoInicialTecnico(m));
    }

    function getSaldoBancosAtivos(){
        return (STATE.bancos||[])
            .filter(b => b.status !== 'Arquivada')
            .reduce((total,b) => total + (Number(b.saldo)||0), 0);
    }

    function getSaldoInicialCalculadoBanco(bancoId){
        const banco = (STATE.bancos||[]).find(b => b.id === bancoId);
        if(!banco) return 0;
        const movimentos = getLivroCaixaOperacional()
            .filter(m => m.bancoId === bancoId)
            .reduce((total,m) => total + ((Number(m.sinal) || 0) * (Number(m.valor) || 0)), 0);
        return (Number(banco.saldo)||0) - movimentos;
    }
    function anularUltimoMovimento(origemId, origemTipo, origemHistoricoId){
        const mov=(STATE.movimentacoes||[]).find(m=>!m.estorno&&!m.anulado&&m.origemId===origemId&&(!origemTipo||m.origemTipo===origemTipo)&&(!origemHistoricoId||m.origemHistoricoId===origemHistoricoId));
        if(mov){ mov.anulado=true; return mov; }
        return null;
    }

    function render() {
        const selectedPeriod = document.getElementById('global-period-filter').value;
        let [selY, selM] = selectedPeriod.split('-');

        let tPassivoTotal = 0, tPassivoMes = 0, qtdAtrasados = 0;
        let tMRR = 0, tReceberMes = 0, tPagarMes = 0;

        STATE.recebimentos.forEach(r => {
            let [y, m] = r.data.split('-');
            if (y === selY && m === selM) tReceberMes += r.valor;
        });

        STATE.contasPagar.forEach(p => {
            let [y, m] = p.vencimento.split('-');
            if (y === selY && m === selM) tPagarMes += p.valor;
            let diff = getDaysDiff(p.vencimento);
            if(p.status === 'Pendente' && diff < 0) qtdAtrasados++;
        });

        STATE.passivos.filter(p => !p.arquivado).forEach(p => {
            tPassivoTotal += p.valorTotal;
            p.parcelas.forEach(x => {
                let diff = getDaysDiff(x.vencimento);
                if (x.status === 'Pendente' && diff < 0) qtdAtrasados++;
                let [y, m] = x.vencimento.split('-');
                if (y === selY && m === selM) tPassivoMes += x.valor;
            });
        });

        STATE.recorrencias.filter(r => !r.arquivado).forEach(r => {
            if (r.frequencia === 'Mensal') tMRR += r.valor;
            else if (r.frequencia === 'Trimestral') tMRR += (r.valor / 3);
            else if (r.frequencia === 'Anual') tMRR += (r.valor / 12);
        });

        document.getElementById('alert-banner').style.display = qtdAtrasados > 0 ? 'flex' : 'none';

        document.getElementById('kpi-receber-mes').innerText = \`R$ \${tReceberMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('kpi-pagar-mes').innerText = \`R$ \${tPagarMes.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('kpi-passivo-total').innerText = \`R$ \${tPassivoTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
        document.getElementById('kpi-recorrente-mrr').innerText = \`R$ \${tMRR.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;

        [30, 60, 90].forEach(dias => {
            let val = calcularProjecao(dias);
            let el = document.getElementById(\`proj-\${dias}\`);
            el.innerText = \`R$ \${val.toLocaleString('pt-BR', {minimumFractionDigits:2})}\`;
            el.style.color = val >= 0 ? 'var(--emerald)' : 'var(--rose)';
        });

        // Tabela Recebimentos
        document.getElementById('receber-list').innerHTML = STATE.recebimentos.map(r => \`
            <tr>
                <td><strong>\${r.cliente}</strong></td>
                <td><span class="badge badge-pending">\${r.categoria}</span></td>
                <td>\${formatarDataBR(r.data)}</td>
                <td>R$ \${formatMoney(r.valor)}</td>
                <td><span class="badge \${r.status === 'Recebido' ? 'badge-paid' : 'badge-pending'}">\${r.status}</span></td>
                <td>
                    \${r.status === 'Recebido' ? \`<button class="btn btn-secondary" onclick="desfazerRecebimento('\${r.id}')"><i class="fa-solid fa-rotate-left"></i></button>\` : \`<button class="btn btn-success" onclick="confirmarRecebimento('\${r.id}')"><i class="fa-solid fa-check"></i></button>\`}
                    <button class="btn btn-secondary" onclick="editarRecebimentoModal('\${r.id}')"><i class="fa-solid fa-pen"></i></button>
                    \${r.comprovante ? \`<span title="\${r.comprovante}" style="font-size:11px;color:var(--brand-primary);"><i class="fa-solid fa-paperclip"></i></span><button class="btn btn-secondary" style="padding:4px 6px;font-size:10px" title="Baixar comprovante" onclick="baixarComprovanteLancamento('recebimento','\${r.id}')"><i class="fa-solid fa-download"></i></button><button class="btn btn-secondary btn-danger-soft" style="padding:4px 6px;font-size:10px" title="Excluir comprovante" onclick="excluirComprovanteLancamento('recebimento','\${r.id}')"><i class="fa-solid fa-trash"></i></button>\` : \`<input type="file" id="file-rec-lanc-\${r.id}" accept=".pdf,image/*" style="max-width:150px;font-size:10px" onchange="anexarComprovanteLancamento('recebimento','\${r.id}',this)">\`}
                    <button class="btn btn-danger" onclick="excluirRecebimento('\${r.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        \`).join('');

        // Tabela Contas a Pagar
        document.getElementById('pagar-list').innerHTML = STATE.contasPagar.map(p => {
            let diff = getDaysDiff(p.vencimento);
            let tag = p.status === 'Pago' ? \`<span class="badge badge-paid">Pago</span>\` :
                      (diff < 0 ? \`<span class="badge badge-overdue">\${Math.abs(diff)}d atraso</span>\` : \`<span class="badge badge-pending">A Pagar</span>\`);
            return \`
                <tr>
                    <td><strong>\${p.fornecedor}</strong></td>
                    <td>\${p.descricao}</td>
                    <td>\${formatarDataBR(p.vencimento)}</td>
                    <td>R$ \${formatMoney(p.valor)}</td>
                    <td>\${tag}</td>
                    <td>
                        \${p.status === 'Pago' ? \`<button class="btn btn-secondary" onclick="desfazerPagamentoConta('\${p.id}')"><i class="fa-solid fa-rotate-left"></i></button>\` : \`<button class="btn btn-success" onclick="confirmarPagamentoConta('\${p.id}')"><i class="fa-solid fa-check"></i></button>\`}
                        <button class="btn btn-secondary" onclick="editarPagarModal('\${p.id}')"><i class="fa-solid fa-pen"></i></button>
                        \${p.comprovante ? \`<span title="\${p.comprovante}" style="font-size:11px;color:var(--brand-primary);"><i class="fa-solid fa-paperclip"></i></span><button class="btn btn-secondary" style="padding:4px 6px;font-size:10px" title="Baixar comprovante" onclick="baixarComprovanteLancamento('conta_pagar','\${p.id}')"><i class="fa-solid fa-download"></i></button><button class="btn btn-secondary btn-danger-soft" style="padding:4px 6px;font-size:10px" title="Excluir comprovante" onclick="excluirComprovanteLancamento('conta_pagar','\${p.id}')"><i class="fa-solid fa-trash"></i></button>\` : \`<input type="file" id="file-pag-lanc-\${p.id}" accept=".pdf,image/*" style="max-width:150px;font-size:10px" onchange="anexarComprovanteLancamento('conta_pagar','\${p.id}',this)">\`}
                        <button class="btn btn-danger" onclick="excluirContaPagar('\${p.id}')"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            \`;
        }).join('');

        // Lista de Bancos e Caixa Movimentações
        document.getElementById('bancos-list').innerHTML = STATE.bancos.map(b => \`
            <div class="\${b.status === 'Arquivada' ? 'archived-item' : ''}" style="padding:12px; border:1px solid var(--border); border-radius:var(--radius-md);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div><strong>\${b.nome}</strong><div class="bank-status">\${b.status || 'Ativa'}</div></div>
                    <div style="font-size:15px; font-weight:700; color:var(--brand-primary);">R$ \${formatMoney(Number(b.saldo || 0))}</div>
                </div>
                <div class="bank-actions">
                    <button class="btn btn-secondary" style="padding:5px 8px;" onclick="editarContaBancaria('\${b.id}')"><i class="fa-solid fa-pen"></i> Editar</button>
                    \${b.status === 'Arquivada'
                        ? \`<button class="btn btn-success" style="padding:5px 8px;" onclick="restaurarContaBancaria('\${b.id}')"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>\`
                        : \`<button class="btn btn-warning" style="padding:5px 8px;" onclick="arquivarContaBancaria('\${b.id}')"><i class="fa-solid fa-box-archive"></i> Arquivar</button>\`}
                    <button class="btn btn-danger" style="padding:5px 8px;" onclick="excluirContaBancaria('\${b.id}')"><i class="fa-solid fa-trash"></i> Excluir</button>
                </div>
            </div>
        \`).join('');

        const ledger = getLivroCaixaOperacional().sort((a,b)=>String(b.data).localeCompare(String(a.data)));
        const totalEntradas = ledger.filter(m=>m.sinal>0).reduce((s,m)=>s+(Number(m.valor)||0),0);
        const totalSaidas = ledger.filter(m=>m.sinal<0).reduce((s,m)=>s+(Number(m.valor)||0),0);
        const saldoConsolidado = getSaldoBancosAtivos();
        const fluxoLiquido = totalEntradas - Math.abs(totalSaidas);
        document.getElementById('caixa-resumo').innerHTML = \`
            <div class="ledger-box"><div class="ledger-label">Entradas reais</div><div class="ledger-value in">+ R$ \${formatMoney(totalEntradas)}</div></div>
            <div class="ledger-box"><div class="ledger-label">Saídas reais</div><div class="ledger-value out">− R$ \${formatMoney(Math.abs(totalSaidas))}</div></div>
            <div class="ledger-box"><div class="ledger-label">Fluxo líquido</div><div class="ledger-value" style="color:\${fluxoLiquido>=0?'var(--emerald)':'var(--rose)'}">\${fluxoLiquido>=0?'+':'−'} R$ \${formatMoney(Math.abs(fluxoLiquido))}</div></div>
            <div class="ledger-box"><div class="ledger-label">Saldo atual dos bancos</div><div class="ledger-value">R$ \${formatMoney(saldoConsolidado)}</div></div>
            <div class="ledger-note"><i class="fa-solid fa-shield-halved"></i> Saldo de abertura não é contado como entrada. Transferências internas não aumentam o caixa consolidado. Estornos aparecem como lançamentos de compensação e também ficam registrados na Auditoria.</div>\`;
        document.getElementById('caixa-mov-list').innerHTML = ledger.slice(0, 30).map(m => \`
            <tr class="\${m.estorno ? 'ledger-estorno' : ''}">
                <td>\${formatarDataBR(m.data)}</td>
                <td><strong>\${m.descricao}</strong>\${m.anulado ? ' <span class="badge badge-adjustment">Anulado</span>' : ''}</td>
                <td>\${m.conta || '—'}</td>
                <td><span class="badge \${m.estorno ? 'badge-adjustment' : (m.sinal > 0 ? 'badge-paid' : 'badge-overdue')}">\${m.estorno ? 'Estorno' : (m.sinal > 0 ? 'Entrada' : 'Saída')}</span></td>
                <td style="font-weight:800; color:\${m.sinal > 0 ? 'var(--emerald)' : 'var(--rose)'};">\${m.sinal > 0 ? '+' : '−'} R$ \${formatMoney(m.valor)}</td>
            </tr>
        \`).join('');
        if(!ledger.length) document.getElementById('caixa-mov-list').innerHTML = '<tr><td colspan="5" class="ledger-empty">Nenhuma movimentação financeira registrada ainda.</td></tr>';

        // Dashboard Progresso
        const dashProg = document.getElementById('dash-passivos-progress');
        const dashRec = document.getElementById('dash-recorrencias-proximas');
        dashProg.innerHTML = ''; dashRec.innerHTML = '';

        STATE.passivos.forEach(pass => {
            let pago = pass.parcelas.filter(x => x.status === 'Pago').reduce((a,b) => a+b.valor, 0);
            let pct = pass.valorTotal > 0 ? ((pago / pass.valorTotal) * 100).toFixed(1) : 0;
            dashProg.innerHTML += \`
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600;">
                        <span>\${pass.credor} <span style="color:var(--text-muted); font-weight:400;">(\${pass.doc})</span></span>
                        <span>R$ \${formatMoney(pago)} / R$ \${formatMoney(pass.valorTotal)} (\${pct}%)</span>
                    </div>
                    <div style="height:7px; background:var(--bg-main); border-radius:4px; overflow:hidden; margin-top:5px; border:1px solid var(--border-light);">
                        <div style="width:\${pct}%; height:100%; background:var(--emerald);"></div>
                    </div>
                </div>
            \`;
        });

        STATE.recorrencias.filter(r => !r.arquivado).forEach(r => {
            let diff = getDaysDiff(r.proximoVencimento);
            let tag = diff < 0 ? \`<span class="badge badge-overdue">\${Math.abs(diff)} dias em atraso</span>\` : \`<span class="badge badge-pending">Vence em \${diff} dias</span>\`;
            dashRec.innerHTML += \`
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-light); font-size:12.5px;">
                    <div><strong>\${r.servico}</strong> <div style="margin-top:2px;">\${tag}</div></div>
                    <div style="text-align:right;"><strong>R$ \${formatMoney(r.valor)}</strong><div style="font-size:11px; color:var(--text-muted);">\${formatarDataBR(r.proximoVencimento)}</div></div>
                </div>
            \`;
        });

        // Passivos
        const passContainer = document.getElementById('passivos-list');
        passContainer.innerHTML = '';
        const fltPassSearch = document.getElementById('flt-passivo-search').value.toLowerCase();
        const fltPassStatus = document.getElementById('flt-passivo-status').value;

        const mostrarPassArquivados = document.getElementById('flt-passivo-arquivados')?.checked;
        getAcordosFiltrados().forEach(pass => {
            if (!!pass.arquivado !== !!mostrarPassArquivados) return;
            if (!pass.credor.toLowerCase().includes(fltPassSearch) && !pass.doc.toLowerCase().includes(fltPassSearch)) return;

            let rows = pass.parcelas.filter(x => fltPassStatus === 'TODOS' || x.status === fltPassStatus).map(p => {
                let diff = getDaysDiff(p.vencimento);
                let agingTag = p.status === 'Pago' ? \`<span class="badge badge-paid">Pago</span>\` :
                               (diff < 0 ? \`<span class="badge badge-overdue">\${Math.abs(diff)} dias atraso</span>\` : 
                               (diff === 0 ? \`<span class="badge badge-pending">Vence Hoje</span>\` : \`<span class="badge badge-pending">Faltam \${diff} dias</span>\`));

                return \`
                    <tr>
                        <td>Parcela #\${p.num}</td>
                        <td>\${formatarDataBR(p.vencimento)}</td>
                        <td>\${agingTag}</td>
                        <td>R$ \${formatMoney(p.valor)}</td>
                        <td>\${p.comprovante ? \`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="color:var(--brand-primary);font-weight:600;"><i class="fa-solid fa-paperclip"></i> \${p.comprovante}</span><button class="btn btn-secondary" style="padding:4px 7px;font-size:11px;" title="Visualizar comprovante" onclick="visualizarComprovante('\${p.id}','parcela')"><i class="fa-solid fa-eye"></i></button><button class="btn btn-secondary" style="padding:4px 7px;font-size:11px;" title="Baixar comprovante" onclick="baixarComprovante('\${p.id}','parcela')"><i class="fa-solid fa-download"></i></button><button class="btn btn-secondary btn-danger-soft" style="padding:4px 7px;font-size:11px;" title="Excluir comprovante" onclick="excluirComprovante('\${p.id}','parcela')"><i class="fa-solid fa-trash"></i></button></div>\` : \`<input type="file" style="font-size:11px;" accept=".pdf,image/*" onchange="handleFilePassivo('\${pass.id}', '\${p.id}', this)">\`}</td>
                        <td style="display:flex; gap:6px;">
                            \${p.status === 'Pago' ? 
                                \`<button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="desfazerPagamentoParcela('\${pass.id}', '\${p.id}')"><i class="fa-solid fa-rotate-left"></i> Desfazer</button>\` :
                                \`<button class="btn btn-success" style="padding:4px 8px; font-size:11px;" onclick="baixarParcela('\${pass.id}', '\${p.id}')"><i class="fa-solid fa-check"></i> Baixar</button>\`
                            }
                        </td>
                    </tr>
                \`;
            }).join('');

            passContainer.innerHTML += \`
                <div class="contract-card">
                    <div class="contract-card-header">
                        <div><strong>\${pass.credor}</strong> <span style="font-size:12px; color:var(--text-muted); margin-left:8px;">[\${pass.doc}] — \${pass.categoria || 'Geral'}</span> \${pass.arquivado ? '<span class="badge badge-pending">Arquivado</span>' : ''}</div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            \${pass.arquivado ? \`<button class="btn btn-secondary" style="padding:5px 8px;font-size:11px;" onclick="restaurarAcordo('\${pass.id}')"><i class="fa-solid fa-box-open"></i> Restaurar</button>\` : \`<button class="btn btn-secondary" style="padding:5px 8px;font-size:11px;" onclick="arquivarAcordo('\${pass.id}')"><i class="fa-solid fa-box-archive"></i> Arquivar</button>\`}
                            <button class="btn btn-secondary btn-danger-soft" style="padding:5px 8px;font-size:11px;" onclick="excluirAcordo('\${pass.id}')"><i class="fa-solid fa-trash"></i> Excluir</button>
                        </div>
                    </div>
                    <div style="max-height:300px; overflow-y:auto;">
                        <table>
                            <thead><tr><th>PARCELA</th><th>VENCIMENTO</th><th>SITUAÇÃO</th><th>VALOR</th><th>COMPROVANTE</th><th>AÇÕES</th></tr></thead>
                            <tbody>\${rows}</tbody>
                        </table>
                    </div>
                </div>
            \`;
        });

        // Recorrências Lista
        const recContainer = document.getElementById('recorrencias-list');
        recContainer.innerHTML = '';
        STATE.recorrencias.filter(r => !r.arquivado).forEach(r => {
            let diff = getDaysDiff(r.proximoVencimento);
            let agingBadge = diff < 0 ? \`<span class="badge badge-overdue">\${Math.abs(diff)} dias em atraso</span>\` : \`<span class="badge badge-pending">Vence em \${diff} dias</span>\`;

            recContainer.innerHTML += \`
                <div class="contract-card">
                    <div class="contract-card-header">
                        <div><strong>\${r.servico}</strong> <span class="badge badge-pending" style="margin-left:8px;">\${r.frequencia}</span> \${r.arquivado ? '<span class="badge badge-pending">Arquivada</span>' : ''}</div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            \${r.arquivado ? \`<button class="btn btn-secondary" style="padding:5px 8px;font-size:11px;" onclick="restaurarRecorrencia('\${r.id}')"><i class="fa-solid fa-box-open"></i> Restaurar</button>\` : \`<button class="btn btn-secondary" style="padding:5px 8px;font-size:11px;" onclick="arquivarRecorrencia('\${r.id}')"><i class="fa-solid fa-box-archive"></i> Arquivar</button>\`}
                            <button class="btn btn-secondary btn-danger-soft" style="padding:5px 8px;font-size:11px;" onclick="excluirRecorrencia('\${r.id}')"><i class="fa-solid fa-trash"></i> Excluir</button>
                        </div>
                    </div>
                    <div style="padding:18px; display:grid; grid-template-columns: 1fr 2fr; gap:20px;">
                        <div>
                            <div style="font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">VALOR DA CONTA</div>
                            <div style="font-size:18px; font-weight:700; margin-top:2px;">R$ \${formatMoney(r.valor)}</div>
                            <div style="font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-top:10px;">PRÓXIMO VENCIMENTO</div>
                            <div style="font-size:12.5px; font-weight:600; margin-top:2px;">\${formatarDataBR(r.proximoVencimento)} \${agingBadge}</div>
                            
                            <div style="margin-top:14px;">
                                <label style="font-size:10px; font-weight:700; color:var(--text-muted); display:block; margin-bottom:4px;">RECIBO DA CONTA</label>
                                <input type="file" id="file-rec-\${r.id}" accept=".pdf,image/*" style="font-size:11px; width:100%; margin-bottom:8px;"><div style="font-size:10px;color:var(--text-muted);margin-top:-4px;margin-bottom:8px;">PDF ou imagem até 5 MB. O arquivo fica armazenado para visualizar ou baixar depois.</div>
                                <button class="btn btn-success" style="width:100%; justify-content:center;" onclick="baixarRecorrencia('\${r.id}')">Confirmar Pagamento</button>
                            </div>
                        </div>
                        <div>
                            <div style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">HISTÓRICO DE QUITAÇÃO</div>
                            <table>
                                <thead><tr><th>DATA PAGTO</th><th>VALOR</th><th>RECIBO</th></tr></thead>
                                <tbody>
                                    \${r.historico.length === 0 ? '<tr><td colspan="3" style="color:var(--text-muted);">Nenhum pagamento registrado.</td></tr>' : r.historico.map(h => \`
                                        <tr><td>\${formatarDataBR(h.dataPagamento)}</td><td>R$ \${formatMoney(Number(h.valor))}</td><td><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;"><span><i class="fa-solid fa-paperclip"></i> \${h.comprovante}</span>\${h.comprovante ? \`<button class="btn btn-secondary" style="padding:3px 6px;" title="Visualizar" onclick="visualizarComprovante('\${r.id}','recorrencia','\${h.id || ''}')"><i class="fa-solid fa-eye"></i></button><button class="btn btn-secondary" style="padding:3px 6px;" title="Baixar" onclick="baixarComprovante('\${r.id}','recorrencia','\${h.id || ''}')"><i class="fa-solid fa-download"></i></button><button class="btn btn-secondary btn-danger-soft" style="padding:3px 6px;" title="Excluir comprovante" onclick="excluirComprovante('\${r.id}','recorrencia','\${h.id || ''}')"><i class="fa-solid fa-trash"></i></button>\` : ''}<button class="btn btn-secondary" style="padding:3px 6px;" onclick="desfazerRecorrencia('\${r.id}','\${h.id || ''}')"><i class="fa-solid fa-rotate-left"></i></button></div></td></tr>
                                    \`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            \`;
        });

        // Auditoria
        document.getElementById('auditoria-list').innerHTML = STATE.auditoria.slice(0, 30).map(a => \`
            <tr>
                <td>\${a.dataHora}</td>
                <td><span class="badge badge-pending">\${a.acao}</span></td>
                <td><strong>\${a.modulo}</strong></td>
                <td>\${a.detalhes}</td>
            </tr>
        \`).join('');

        renderDRE();
    }

    init();
</script>

<script>
(function(){
    function setupMobileNavigation(){
        const sidebar=document.querySelector('.sidebar');
        const navbar=document.querySelector('.top-navbar');
        if(!sidebar || !navbar || document.getElementById('mobile-menu-toggle')) return;
        const overlay=document.createElement('div');
        overlay.className='mobile-overlay';
        overlay.id='mobile-menu-overlay';
        document.body.appendChild(overlay);
        const btn=document.createElement('button');
        btn.className='mobile-menu-toggle';
        btn.id='mobile-menu-toggle';
        btn.type='button';
        btn.setAttribute('aria-label','Abrir menu');
        btn.innerHTML='<i class="fa-solid fa-bars"></i>';
        navbar.insertBefore(btn, navbar.firstElementChild);
        function close(){ sidebar.classList.remove('mobile-open'); overlay.classList.remove('active'); btn.innerHTML='<i class="fa-solid fa-bars"></i>'; btn.setAttribute('aria-label','Abrir menu'); }
        function open(){ sidebar.classList.add('mobile-open'); overlay.classList.add('active'); btn.innerHTML='<i class="fa-solid fa-xmark"></i>'; btn.setAttribute('aria-label','Fechar menu'); }
        btn.addEventListener('click',()=> sidebar.classList.contains('mobile-open') ? close() : open());
        overlay.addEventListener('click',close);
        sidebar.addEventListener('click',e=>{ if(e.target.closest('.nav-item') && window.innerWidth<=900) close(); });
        window.addEventListener('resize',()=>{ if(window.innerWidth>900) close(); });
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',setupMobileNavigation); else setupMobileNavigation();
})();
</script>
</body>
</html>`;

function TreasuryPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);

  // Redireciona usuários não autorizados (não-admin) de volta ao portal
  useEffect(() => {
    if (!profile.data) return;
    const role = profile.data.role_key;
    const native = NATIVE_ADMIN_USERNAMES.has(profile.data.username ?? "");
    const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN_OPERACIONAL" || native;
    if (!isAdmin) {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.data, navigate]);

  // Previne que a tecla Escape feche o iframe acidentalmente
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#090D16", fontFamily: "'Inter',system-ui,sans-serif" }}>
      {/* Cabeçalho do app React (acima do iframe) — barra de navegação de volta */}
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-800 bg-[#0F172A]/90 px-4 shadow-sm backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <img
            src={logoAsset.url}
            alt="DBS Air"
            className="h-10 w-auto max-w-[190px] object-contain"
          />
          <span className="hidden h-7 w-px bg-slate-700 sm:block" />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#F59E0B" }}>
            Módulo Financeiro · DBS TREASURY
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 sm:inline-flex">
            <Shield className="h-3.5 w-3.5" /> Acesso restrito
          </span>
          <button
            onClick={() => navigate({ to: "/admin" })}
            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao painel
          </button>
        </div>
      </header>

      {/* Container do iframe — isolamento total de CSS/JS */}
      <main className="relative flex-1 w-full bg-[#f5f7fb]" style={{ minHeight: "calc(100vh - 72px)" }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
              <p className="text-sm font-semibold text-slate-600">
                Carregando DBS TREASURY Enterprise Executive Suite…
              </p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="DBS TREASURY"
          srcDoc={TREASURY_HTML}
          onLoad={() => setLoading(false)}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          style={{
            width: "100%",
            height: "calc(100vh - 72px)",
            border: "none",
            display: "block",
            background: "#f5f7fb",
          }}
        />
      </main>
    </div>
  );
}
