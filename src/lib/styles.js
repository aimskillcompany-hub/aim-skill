export const css = `
  :root {
    --bg: #F0F0EC;
    --surface: #FFFFFF;
    --surface2: #F8F8F6;
    --border: #E8E8E4;
    --border2: #D8D8D4;
    --text: #000000;
    --text2: #6B6B6B;
    --text3: #9A9A9A;
    --accent: #C7F33C;
    --green: #16A34A;
    --green-bg: #DCFCE7;
    --red: #DC2626;
    --red-bg: #FFE4E4;
    --blue: #2563EB;
    --blue-bg: #DBEAFE;
    --amber: #92400E;
    --amber-bg: #FEF3C7;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { overflow-x: hidden; max-width: 100vw; }
  body {
    font-family: 'Inter', sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    overflow-x: hidden; max-width: 100vw;
  }
  input, select, textarea, button { font-family: 'Inter', sans-serif; font-size: 16px; max-width: 100%; }
  textarea { resize: vertical; }
  html, body { height: 100%; }
  #root { height: 100%; overflow-x: hidden; }
  .app { display: flex; height: 100vh; overflow: hidden; max-width: 100vw; }

  /* ═══ SIDEBAR (desktop only) ═══ */
  .sidebar {
    width: 240px; min-width: 240px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
  }
  .sidebar-logo {
    padding: 24px 20px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; min-height: 72px;
  }
  .sidebar-logo img { max-width: 100%; height: auto; filter: brightness(0); }
  .sidebar-nav { padding: 16px 12px; flex: 1; overflow-y: auto; }
  .nav-section {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 1.2px; color: var(--text3); padding: 16px 12px 6px;
  }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    color: var(--text2); font-size: 14px; font-weight: 500;
    transition: all .15s ease; margin: 2px 0; user-select: none;
  }
  .nav-item:hover { background: var(--bg); color: var(--text); }
  .nav-item.active {
    background: #000000; color: #FFFFFF; font-weight: 600;
  }
  .nav-item i { font-size: 18px; width: 20px; text-align: center; }
  .sidebar-footer {
    padding: 16px 20px; border-top: 1px solid var(--border);
  }

  /* ═══ MAIN ═══ */
  .main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .page-inner { padding: 32px; flex: 1; max-width: 1400px; width: 100%; margin: 0 auto; }
  .page-header { margin-bottom: 28px; }
  .page-header h1 { font-size: 32px; font-weight: 600; color: var(--text); letter-spacing: -.5px; }
  .page-header p { font-size: 14px; color: var(--text2); margin-top: 6px; }

  /* ═══ CARDS ═══ */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 16px;
  }
  .card-title { font-size: 14px; font-weight: 600; color: var(--text2); margin-bottom: 16px; }

  /* ═══ KPI GRID ═══ */
  .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-bottom: 20px; }
  .kpi {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px;
  }
  .kpi-label { font-size: 13px; color: var(--text2); margin-bottom: 8px; font-weight: 500; }
  .kpi-value { font-size: 36px; font-weight: 700; letter-spacing: -.5px; color: var(--text); }
  .kpi-value.blue { color: var(--text); }
  .kpi-value.green { color: var(--green); }
  .kpi-value.red { color: var(--red); }
  .kpi-sub { font-size: 13px; color: var(--text2); margin-top: 4px; }

  /* ═══ FORMS ═══ */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group.full { grid-column: 1 / -1; }
  .form-group label { font-size: 13px; font-weight: 600; color: var(--text2); }
  .form-input {
    padding: 12px 14px; height: 48px;
    border: 1px solid var(--border); border-radius: 12px;
    background: var(--surface); color: var(--text);
    outline: none; transition: border-color .15s;
    font-size: 16px;
  }
  .form-input:focus { border-color: var(--text); }
  .form-input::placeholder { color: var(--text3); }
  textarea.form-input { height: auto; min-height: 48px; }

  /* ═══ BUTTONS ═══ */
  .btn {
    padding: 12px 20px; border-radius: 12px; border: none;
    cursor: pointer; font-size: 14px; font-weight: 600;
    transition: all .15s ease; min-height: 48px;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  }
  .btn:active { transform: scale(.97); }
  .btn-primary { background: #000000; color: #FFFFFF; }
  .btn-primary:hover { background: #1a1a1a; }
  .btn-primary:disabled { opacity: .4; cursor: default; transform: none; }
  .btn-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
  .btn-secondary:hover { background: var(--bg); }
  .btn-danger { background: var(--red-bg); color: var(--red); border: 1px solid #FCA5A5; }
  .btn-danger:hover { background: #FECACA; }
  .btn-sm { padding: 8px 14px; font-size: 13px; border-radius: 8px; min-height: 36px; }
  .btn-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }

  /* ═══ FILTERS ═══ */
  .filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
  .filters .form-input { min-width: 0; }
  .filter-search { min-width: 240px !important; }

  /* ═══ CHIPS ═══ */
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip { padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
  .chip-cnt { background: var(--bg); color: var(--text2); border: 1px solid var(--border); }
  .chip-inc { background: var(--green-bg); color: var(--green); }
  .chip-exp { background: var(--red-bg); color: var(--red); }
  .chip-pfd { background: var(--blue-bg); color: var(--blue); }

  /* ═══ TABLE ═══ */
  .tbl-wrap {
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    border: 1px solid var(--border); border-radius: 16px;
    background: var(--surface);
  }
  .tbl-wrap table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .tbl-wrap thead th {
    background: #F8F8F6; padding: 14px 16px;
    text-align: left; color: var(--text2);
    font-weight: 600; font-size: 12px; text-transform: uppercase;
    letter-spacing: .5px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap; position: sticky; top: 0; z-index: 1;
  }
  .tbl-wrap tbody tr { border-bottom: 1px solid #F0F0EC; transition: background .1s; }
  .tbl-wrap tbody tr:last-child { border-bottom: none; }
  .tbl-wrap tbody tr:hover { background: #FAFAF8; }
  .tbl-wrap tbody td { padding: 14px 16px; vertical-align: middle; }
  .amt-pos { color: var(--green); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .amt-neg { color: var(--red); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .amt-zero { color: var(--text3); }
  .trunc { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ═══ BADGES ═══ */
  .badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
  .badge-inc { background: var(--green-bg); color: var(--green); }
  .badge-exp { background: var(--red-bg); color: var(--red); }
  .badge-pfd { background: var(--blue-bg); color: var(--blue); }
  .badge-other { background: var(--bg); color: var(--text2); }
  .badge-active { background: var(--green-bg); color: var(--green); }
  .badge-completed { background: var(--blue-bg); color: var(--blue); }
  .badge-archived { background: var(--bg); color: var(--text3); }

  /* ═══ PAGINATION ═══ */
  .pagination { display: flex; gap: 6px; margin-top: 16px; align-items: center; flex-wrap: wrap; }
  .pagination span { font-size: 13px; color: var(--text2); margin-right: 8px; }
  .pg-btn {
    padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface); cursor: pointer; font-size: 13px;
    color: var(--text); font-weight: 500; transition: all .12s;
    min-width: 40px; min-height: 40px;
    display: flex; align-items: center; justify-content: center;
  }
  .pg-btn:hover:not(:disabled) { border-color: var(--text); }
  .pg-btn:disabled { opacity: .3; cursor: default; }
  .pg-btn.active { background: #000; color: #fff; border-color: #000; font-weight: 700; }

  /* ═══ MODAL ═══ */
  .modal-bg {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.3);
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    z-index: 200;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    animation: fadeIn .2s ease;
  }
  .modal {
    background: var(--surface);
    border-radius: 20px;
    padding: 28px;
    width: 100%; max-width: 600px; max-height: 90vh;
    overflow-y: auto;
    animation: modalIn .25s ease;
  }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 12px; }
  .modal-header h2 { font-size: 20px; font-weight: 700; letter-spacing: -.3px; }
  .modal-close {
    background: var(--bg); border: 1px solid var(--border);
    width: 36px; height: 36px; border-radius: 10px;
    font-size: 18px; cursor: pointer; color: var(--text2);
    display: flex; align-items: center; justify-content: center;
    line-height: 1; flex-shrink: 0; transition: all .12s;
  }
  .modal-close:hover { background: var(--red-bg); color: var(--red); border-color: #FCA5A5; }

  /* ═══ ALERTS ═══ */
  .alert { padding: 14px 18px; border-radius: 12px; font-size: 14px; margin-bottom: 16px; line-height: 1.5; }
  .alert-error { background: var(--red-bg); border: 1px solid #FCA5A5; color: var(--red); }
  .alert-info { background: var(--amber-bg); border: 1px solid #FDE68A; color: var(--amber); }
  .alert-success { background: var(--green-bg); border: 1px solid #86EFAC; color: var(--green); }

  /* ═══ DROP ZONE ═══ */
  .drop-zone {
    border: 2px dashed var(--border2); border-radius: 16px;
    padding: 48px 24px; text-align: center; cursor: pointer;
    transition: all .2s; background: var(--surface2);
  }
  .drop-zone:hover, .drop-zone.drag { border-color: var(--text); background: var(--bg); }

  /* ═══ SPINNER ═══ */
  .spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--text); border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 10px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
  @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

  /* ═══ EXTRACTED DATA ═══ */
  .extracted { background: var(--green-bg); border: 1px solid #86EFAC; border-radius: 16px; padding: 16px 18px; margin-bottom: 16px; }
  .extracted-title { font-size: 13px; font-weight: 600; color: var(--green); margin-bottom: 8px; }
  .extracted-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
  .ex-label { font-size: 11px; color: var(--green); }
  .ex-val { font-size: 13px; font-weight: 600; color: #064E3B; }

  /* ═══ ITEMS TABLE ═══ */
  .items-table { margin-top: 16px; }
  .items-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .items-table th { background: #F0FDF4; padding: 8px 12px; text-align: left; color: var(--green); font-weight: 600; }
  .items-table td { padding: 8px 12px; border-bottom: 1px solid #D1FAE5; }

  /* ═══ FILE PREVIEW ═══ */
  .file-preview { display: flex; align-items: center; gap: 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }

  /* ═══ AUTH ═══ */
  .auth-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg); }
  .auth-card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 40px; width: 100%; max-width: 420px; }

  /* ═══ TOAST ═══ */
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 14px 24px; border-radius: 12px; font-size: 14px; font-weight: 500; z-index: 500; animation: toastIn .3s ease; }
  .toast-success { background: #065F46; color: #D1FAE5; }
  .toast-error { background: #991B1B; color: #FEE2E2; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

  /* ═══ EMPTY STATE ═══ */
  .empty { text-align: center; padding: 56px 24px; color: var(--text3); }
  .empty p { font-size: 16px; line-height: 1.5; }

  /* ═══ PROJECT CARD ═══ */
  .proj-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 20px;
    display: flex; flex-direction: column; gap: 10px;
    transition: border-color .15s; cursor: pointer;
  }
  .proj-card:hover { border-color: var(--text); }
  .proj-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
  .proj-name { font-weight: 600; font-size: 16px; }
  .proj-meta { font-size: 13px; color: var(--text2); }

  /* ═══ P&L TABLE ═══ */
  .pl-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .pl-table th { background: var(--surface2); padding: 10px 12px; text-align: right; font-weight: 600; color: var(--text2); border-bottom: 1px solid var(--border); white-space: nowrap; }
  .pl-table th:first-child { text-align: left; min-width: 200px; }
  .pl-table td { padding: 8px 12px; border-bottom: 1px solid #F0F0EC; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pl-table td:first-child { text-align: left; }
  .pl-table .section td { background: var(--surface2); font-weight: 600; font-size: 12px; color: var(--text2); padding-top: 12px; }
  .pl-table .total td { font-weight: 700; border-top: 2px solid var(--border); }
  .pl-table .result td { font-weight: 700; font-size: 14px; background: var(--surface2); }
  .pl-table .total-col { background: #F0FDF4 !important; font-weight: 700; }

  /* ═══ REGISTRY: desktop table visible, mobile list hidden ═══ */
  .reg-mobile-list { display: none; }
  .reg-desktop-table { display: block; }

  /* ═══ DESKTOP RESPONSIVE ═══ */
  @media (max-width: 1024px) {
    .page-inner { padding: 24px; }
    .kpi-grid { grid-template-columns: repeat(2,1fr); }
    .proj-grid { grid-template-columns: repeat(2,1fr); }
  }
`

export const mobileCss = `
  /* ═══ MOBILE TOPBAR ═══ */
  .mobile-topbar {
    display: none;
    align-items: center; justify-content: center;
    padding: 0 16px; height: 56px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 100;
    width: 100%; max-width: 100vw;
  }
  .mobile-menu-btn {
    position: absolute; left: 8px;
    background: none; border: none; color: var(--text);
    font-size: 22px; cursor: pointer;
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 10px; -webkit-tap-highlight-color: transparent;
  }
  .mobile-menu-btn:active { background: var(--bg); }

  /* ═══ MOBILE BOTTOM NAV ═══ */
  .mobile-nav { display: none; }

  /* ═══ UPLOAD ACTIONS ═══ */
  .upload-actions { display: flex; gap: 12px; align-items: stretch; margin-bottom: 16px; }
  .camera-btn, .file-btn {
    flex: 1; border: 2px dashed var(--border2); border-radius: 16px;
    padding: 20px 12px; background: var(--surface2); cursor: pointer;
    text-align: center; color: var(--text); font-family: 'Inter', sans-serif;
    transition: all .15s; min-width: 0;
  }
  .camera-btn { border-color: var(--text); background: var(--bg); }

  /* ═══ AUTH PANEL ═══ */
  .auth-right-panel { display: flex; }
  @media (max-width: 768px) {
    .auth-right-panel { display: none !important; }
  }

  /* ═══ MOBILE < 768px ═══ */
  @media (max-width: 768px) {
    /* ── GLOBAL OVERFLOW FIX ── */
    .app { max-width: 100vw; overflow-x: hidden; }
    .main { max-width: 100vw; overflow-x: hidden; }

    /* Hide desktop sidebar */
    .app > .sidebar { display: none; }

    /* Show mobile topbar */
    .mobile-topbar { display: flex; }

    /* Main bottom padding for nav */
    .main { padding-bottom: calc(80px + env(safe-area-inset-bottom)); }

    /* Content padding — strict containment */
    .page-inner { padding: 16px; max-width: 100vw; overflow-x: hidden; }

    /* ── BOTTOM NAV ── */
    .mobile-nav {
      display: flex;
      justify-content: space-around;
      align-items: center;
      position: fixed; bottom: 0; left: 0; right: 0;
      width: 100%; max-width: 100vw;
      height: calc(64px + env(safe-area-inset-bottom));
      background: var(--surface);
      border-top: 1px solid var(--border);
      z-index: 200;
      padding: 0 4px;
      padding-bottom: env(safe-area-inset-bottom);
    }
    .mobile-nav-item {
      flex: 1;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 3px;
      background: none; border: none; cursor: pointer;
      color: var(--text3);
      padding: 6px 2px;
      font-family: 'Inter', sans-serif;
      position: relative;
      -webkit-tap-highlight-color: transparent;
      transition: color .15s;
      min-width: 0;
    }
    .mobile-nav-item:active { transform: scale(.92); }
    .mobile-nav-item.active { color: var(--text); }
    .mobile-nav-item.active::after {
      content: '';
      position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
      width: 6px; height: 6px; border-radius: 50%;
      background: #C7F33C;
    }
    .mobile-nav-item.primary {
      background: #000; color: #fff;
      width: 56px; height: 56px; min-width: 56px;
      border-radius: 50%;
      margin: 0 4px; flex: none;
    }
    .mobile-nav-item.primary .mobile-nav-label { display: none; }
    .mobile-nav-item.primary .mobile-nav-icon { font-size: 24px; }
    .mobile-nav-item.primary:active { transform: scale(.92); }
    .mobile-nav-item.primary.active { background: #1a1a1a; }
    .mobile-nav-item.primary.active::after { display: none; }
    .mobile-nav-icon { font-size: 22px; line-height: 1; }
    .mobile-nav-label { font-size: 10px; font-weight: 600; letter-spacing: .2px; }

    /* ── PAGE HEADER ── */
    .page-header { margin-bottom: 16px; display: flex; flex-direction: column; gap: 4px; }
    .page-header h1 { font-size: 24px; }
    .page-header p { font-size: 13px; }

    /* ── KPI GRID ── */
    .kpi-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
    .kpi { padding: 16px; min-width: 0; overflow: hidden; }
    .kpi-value { font-size: clamp(20px, 5vw, 32px); word-break: break-word; }
    .kpi-label { font-size: 12px; }

    /* ── CARDS ── */
    .card { padding: 16px; border-radius: 16px; max-width: 100%; overflow: hidden; }

    /* ── GRIDS ── */
    .proj-grid { grid-template-columns: 1fr; gap: 12px; }
    .form-grid { grid-template-columns: 1fr; gap: 12px; }
    .form-group.full { grid-column: 1; }

    /* ── BUTTONS ── */
    .btn { width: 100%; min-height: 48px; border-radius: 12px; font-size: 15px; }
    .btn-sm { min-height: 44px; width: auto; font-size: 14px; }
    .btn-row { flex-direction: column; gap: 8px; }

    /* ── INPUTS ── */
    .form-input { font-size: 16px; height: 48px; border-radius: 12px; padding: 12px 16px; width: 100%; max-width: 100%; }
    select.form-input {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239A9A9A' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      padding-right: 36px;
    }

    /* ── TABLE ── */
    .tbl-wrap { border-radius: 12px; max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .tbl-wrap table { min-width: 500px; }
    .tbl-wrap td, .tbl-wrap th { padding: 10px 12px; font-size: 13px; }
    .trunc { max-width: 120px; }

    /* ── MODAL → BOTTOM SHEET ── */
    .modal-bg { padding: 0; align-items: flex-end; }
    .modal {
      border-radius: 20px 20px 0 0;
      max-height: 90vh;
      padding: 16px;
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
      animation: sheetUp .3s ease;
      max-width: 100vw;
    }
    .modal::before {
      content: '';
      display: block;
      width: 40px; height: 4px; border-radius: 2px;
      background: var(--border2);
      margin: 0 auto 16px;
    }
    .modal-header h2 { font-size: 18px; }

    /* ── FILTERS ── */
    .filters { gap: 8px; flex-wrap: wrap; }
    .filters .form-input { min-width: 0; flex: 1 1 100%; }
    .filter-search { min-width: 0 !important; width: 100%; }

    /* ── CHIPS ── */
    .chips { gap: 6px; flex-wrap: wrap; }
    .chip { font-size: 12px; padding: 4px 10px; }

    /* ── PAGINATION ── */
    .pagination { justify-content: center; flex-wrap: wrap; }
    .pg-btn { min-width: 44px; min-height: 44px; }

    /* ── TOAST ── */
    .toast { bottom: calc(80px + env(safe-area-inset-bottom)); right: 16px; left: 16px; text-align: center; }

    /* ── UPLOAD ── */
    .upload-actions { flex-direction: column; }
    .camera-btn { padding: 24px 12px; }

    /* ── EXTRACTED ── */
    .extracted-grid { grid-template-columns: 1fr 1fr; }
    .items-table { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }

    /* ── PROJ CARD ── */
    .proj-card { max-width: 100%; overflow: hidden; }
    .proj-card:hover { border-color: var(--border); }

    /* ── REGISTRY MOBILE ── */
    .reg-desktop-table { display: none !important; }
    .reg-mobile-list { display: block !important; }
    .reg-actions { flex-direction: column; }
    .reg-actions .btn { width: 100%; }
    .dup-grid { grid-template-columns: 1fr !important; }

    /* ── INLINE STYLE OVERRIDES for Dashboard grids ── */
    div[style*="grid-template-columns: repeat(3"] { grid-template-columns: 1fr 1fr !important; gap: 12px !important; }
    div[style*="grid-template-columns: repeat(3"] > :first-child { grid-column: 1 / -1; }
    div[style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; gap: 12px !important; }

    /* ── EMPTY STATE ── */
    .empty { padding: 40px 16px; }
  }

  /* ═══ TINY PHONES < 380px ═══ */
  @media (max-width: 380px) {
    .page-inner { padding: 12px; }
    .kpi-value { font-size: clamp(18px, 4.5vw, 24px); }
    .mobile-nav-label { font-size: 9px; }
    .mobile-nav-icon { font-size: 20px; }
    .mobile-nav-item.primary { width: 48px; height: 48px; min-width: 48px; }
  }
`
