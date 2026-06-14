export const css = `
  :root {
    --bg: #f8f9fb;
    --surface: #ffffff;
    --surface2: #f3f5f7;
    --border: #e8eaed;
    --border2: #d4d7dc;
    --text: #111827;
    --text2: #5f6775;
    --text3: #9ca3af;
    --blue: #14df62;
    --blue-bg: #e8fdf1;
    --green: #15803d;
    --green-bg: #dcfce7;
    --red: #dc2626;
    --red-bg: #fee2e2;
    --amber: #92400e;
    --amber-bg: #fffbeb;
    --sidebar: #111318;
    --sidebar-text: #9ca3af;
    --sidebar-active: #14df62;
    --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
    --shadow-md: 0 2px 8px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
    --shadow-lg: 0 8px 24px rgba(0,0,0,.08), 0 2px 8px rgba(0,0,0,.04);
    --shadow-xl: 0 16px 48px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.06);
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --ease: cubic-bezier(.22,.68,0,1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); font-size: 14px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  input, select, textarea, button { font-family: inherit; font-size: 13px; }
  textarea { resize: vertical; }

  html, body { height: 100%; }
  #root { height: 100%; }
  .app { display: flex; height: 100vh; overflow: hidden; }

  /* ── Sidebar ─────────────────────────────────── */
  .sidebar { width: 224px; min-width: 224px; background: var(--sidebar); display: flex; flex-direction: column; border-right: 1px solid rgba(255,255,255,.06); }
  .sidebar-logo { padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,.06); display: flex; align-items: center; min-height: 68px; }
  .sidebar-logo img { max-width: 100%; height: auto; }
  .sidebar-nav { padding: 12px 10px; flex: 1; overflow-y: auto; }
  .nav-section { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #4b5563; padding: 14px 10px 6px; }
  .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; color: #8b919e; font-size: 13.5px; transition: all .15s var(--ease); margin: 2px 0; user-select: none; }
  .nav-item:hover { background: rgba(255,255,255,.06); color: #e5e7eb; }
  .nav-item.active { background: var(--sidebar-active); color: #0a2e17; font-weight: 600; box-shadow: 0 2px 8px rgba(20,223,98,.25); }
  .nav-item svg { width: 16px; height: 16px; flex-shrink: 0; }
  .sidebar-footer { padding: 14px 18px; border-top: 1px solid rgba(255,255,255,.06); font-size: 11px; color: #4b5563; }

  /* ── Main ─────────────────────────────────────── */
  .main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; scroll-behavior: smooth; }
  .page-inner { padding: 28px 32px; flex: 1; max-width: 1400px; width: 100%; margin: 0 auto; }
  .page-header { margin-bottom: 24px; }
  .page-header h1 { font-size: 22px; font-weight: 700; letter-spacing: -.3px; }
  .page-header p { font-size: 13.5px; color: var(--text2); margin-top: 4px; }

  /* ── Cards ────────────────────────────────────── */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; margin-bottom: 16px; box-shadow: var(--shadow-sm); transition: box-shadow .2s var(--ease); }
  .card:hover { box-shadow: var(--shadow-md); }
  .card-title { font-size: 13px; font-weight: 600; color: var(--text2); margin-bottom: 14px; letter-spacing: .1px; }

  /* ── KPI grid ─────────────────────────────────── */
  .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 18px; }
  .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px 18px; box-shadow: var(--shadow-sm); transition: all .2s var(--ease); }
  .kpi:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .kpi-label { font-size: 11.5px; color: var(--text2); margin-bottom: 6px; font-weight: 500; letter-spacing: .2px; }
  .kpi-value { font-size: 22px; font-weight: 700; letter-spacing: -.5px; }
  .kpi-value.blue { color: var(--blue); }
  .kpi-value.green { color: var(--green); }
  .kpi-value.red { color: var(--red); }
  .kpi-sub { font-size: 11px; color: var(--text3); margin-top: 3px; }

  /* ── Forms ────────────────────────────────────── */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .form-group { display: flex; flex-direction: column; gap: 5px; }
  .form-group.full { grid-column: 1 / -1; }
  .form-group label { font-size: 11.5px; font-weight: 600; color: #4b5563; letter-spacing: .2px; }
  .form-input { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); outline: none; transition: all .15s var(--ease); font-size: 13.5px; }
  .form-input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(20,223,98,.12); }
  .form-input::placeholder { color: var(--text3); }

  /* ── Buttons ──────────────────────────────────── */
  .btn { padding: 9px 18px; border-radius: var(--radius-sm); border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: all .15s var(--ease); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .btn:active { transform: scale(.97); }
  .btn-primary { background: var(--blue); color: #0a2e17; box-shadow: 0 1px 3px rgba(20,223,98,.2); }
  .btn-primary:hover { background: #0fc254; box-shadow: 0 2px 8px rgba(20,223,98,.3); }
  .btn-primary:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }
  .btn-secondary { background: var(--surface); color: var(--text); border: 1.5px solid var(--border); }
  .btn-secondary:hover { background: var(--surface2); border-color: var(--border2); }
  .btn-danger { background: var(--red-bg); color: var(--red); border: 1px solid #fca5a5; }
  .btn-danger:hover { background: #fecaca; }
  .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 7px; }
  .btn-row { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }

  /* ── Filters ──────────────────────────────────── */
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; align-items: center; }
  .filters .form-input { min-width: 0; }
  .filter-search { min-width: 220px !important; }

  /* ── Summary chips ───────────────────────────── */
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .chip { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: .1px; }
  .chip-cnt { background: var(--surface2); color: var(--text2); border: 1px solid var(--border); }
  .chip-inc { background: var(--green-bg); color: var(--green); }
  .chip-exp { background: var(--red-bg); color: var(--red); }
  .chip-pfd { background: var(--blue-bg); color: var(--blue); }

  /* ── Table ────────────────────────────────────── */
  .tbl-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); -webkit-overflow-scrolling: touch; }
  .tbl-wrap table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tbl-wrap thead th { background: var(--surface2); padding: 10px 14px; text-align: left; color: var(--text2); font-weight: 600; border-bottom: 1px solid var(--border); white-space: nowrap; position: sticky; top: 0; z-index: 1; font-size: 12px; letter-spacing: .2px; }
  .tbl-wrap tbody tr { border-bottom: 1px solid #f3f4f6; transition: background .1s; }
  .tbl-wrap tbody tr:last-child { border-bottom: none; }
  .tbl-wrap tbody tr:hover { background: #f8fafb; }
  .tbl-wrap tbody td { padding: 10px 14px; vertical-align: middle; }
  .amt-pos { color: var(--green); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .amt-neg { color: var(--red); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .amt-zero { color: var(--text3); }
  .trunc { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Badges ───────────────────────────────────── */
  .badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: .1px; }
  .badge-inc { background: var(--green-bg); color: var(--green); }
  .badge-exp { background: var(--red-bg); color: var(--red); }
  .badge-pfd { background: var(--blue-bg); color: var(--blue); }
  .badge-other { background: var(--surface2); color: var(--text2); }
  .badge-active { background: var(--green-bg); color: var(--green); }
  .badge-completed { background: var(--blue-bg); color: var(--blue); }
  .badge-archived { background: var(--surface2); color: var(--text3); }

  /* ── Pagination ───────────────────────────────── */
  .pagination { display: flex; gap: 5px; margin-top: 14px; align-items: center; flex-wrap: wrap; }
  .pagination span { font-size: 12px; color: var(--text2); margin-right: 6px; }
  .pg-btn { padding: 6px 12px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; font-size: 12px; color: var(--text); transition: all .12s var(--ease); font-weight: 500; }
  .pg-btn:hover:not(:disabled) { border-color: var(--blue); color: var(--blue); }
  .pg-btn:disabled { opacity: .35; cursor: default; }
  .pg-btn.active { background: var(--blue); color: #0a2e17; border-color: var(--blue); font-weight: 700; box-shadow: 0 1px 4px rgba(20,223,98,.2); }

  /* ── Modal ────────────────────────────────────── */
  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.4); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn .2s var(--ease); }
  .modal { background: var(--surface); border-radius: var(--radius-lg); padding: 24px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-xl); animation: slideUp .25s var(--ease); }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 12px; }
  .modal-header h2 { font-size: 17px; font-weight: 700; letter-spacing: -.2px; }
  .modal-close { background: var(--surface2); border: 1px solid var(--border); width: 32px; height: 32px; border-radius: 8px; font-size: 18px; cursor: pointer; color: var(--text2); display: flex; align-items: center; justify-content: center; line-height: 1; transition: all .12s; flex-shrink: 0; }
  .modal-close:hover { background: var(--red-bg); color: var(--red); border-color: #fca5a5; }

  /* ── Alerts ───────────────────────────────────── */
  .alert { padding: 12px 16px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 14px; display: flex; align-items: flex-start; gap: 8px; line-height: 1.45; }
  .alert-error { background: var(--red-bg); border: 1px solid #fca5a5; color: var(--red); }
  .alert-info { background: var(--amber-bg); border: 1px solid #fde68a; color: var(--amber); }
  .alert-success { background: var(--green-bg); border: 1px solid #86efac; color: var(--green); }

  /* ── Drop zone ───────────────────────────────── */
  .drop-zone { border: 2px dashed var(--border2); border-radius: var(--radius-md); padding: 40px 24px; text-align: center; cursor: pointer; transition: all .2s var(--ease); background: var(--surface2); }
  .drop-zone:hover, .drop-zone.drag { border-color: var(--blue); background: var(--blue-bg); transform: scale(1.005); }
  .drop-zone .dz-icon { font-size: 40px; margin-bottom: 10px; }
  .drop-zone .dz-title { font-weight: 600; margin-bottom: 4px; }
  .drop-zone .dz-hint { font-size: 12px; color: var(--text2); }

  /* ── Spinner ──────────────────────────────────── */
  .spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--blue); border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 10px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes slideUpSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }

  /* ── Extracted data card ──────────────────────── */
  .extracted { background: var(--blue-bg); border: 1px solid #86efb8; border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 16px; }
  .extracted-title { font-size: 12px; font-weight: 600; color: #0a6632; margin-bottom: 8px; }
  .extracted-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
  .ex-label { font-size: 10px; color: #0a6632; margin-bottom: 1px; }
  .ex-val { font-size: 12px; font-weight: 500; color: #0a2e17; }

  /* ── Items table ─────────────────────────────── */
  .items-table { margin-top: 14px; }
  .items-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .items-table th { background: #d1fae5; padding: 7px 10px; text-align: left; color: #0a6632; font-weight: 600; }
  .items-table td { padding: 7px 10px; border-bottom: 1px solid #d1fae5; }

  /* ── File preview ────────────────────────────── */
  .file-preview { display: flex; align-items: center; gap: 10px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 14px; }
  .file-preview .fp-name { font-weight: 500; }
  .file-preview .fp-size { font-size: 11px; color: var(--text2); }

  /* ── Document list item ──────────────────────── */
  .doc-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .doc-item:last-child { border-bottom: none; }
  .doc-item .doc-name { font-size: 12.5px; flex: 1; }
  .doc-item .doc-meta { font-size: 11px; color: var(--text3); }

  /* ── Auth page ───────────────────────────────── */
  .auth-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg); }
  .auth-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 32px; width: 100%; max-width: 400px; }
  .auth-logo { text-align: center; margin-bottom: 24px; }
  .auth-logo h1 { font-size: 20px; font-weight: 600; }
  .auth-logo p { font-size: 13px; color: var(--text2); margin-top: 4px; }

  /* ── Toast ────────────────────────────────────── */
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: var(--radius-md); font-size: 13.5px; font-weight: 500; z-index: 500; animation: toastIn .35s var(--ease); box-shadow: var(--shadow-lg); }
  .toast-success { background: #065f46; color: #d1fae5; }
  .toast-error { background: #991b1b; color: #fee2e2; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(12px) scale(.95); } to { opacity: 1; transform: translateY(0) scale(1); } }

  /* ── Empty state ─────────────────────────────── */
  .empty { text-align: center; padding: 52px 24px; color: var(--text3); }
  .empty-icon { font-size: 48px; margin-bottom: 12px; }
  .empty p { font-size: 14px; line-height: 1.5; }

  /* ── Project card ────────────────────────────── */
  .proj-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 18px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); transition: all .2s var(--ease); cursor: pointer; }
  .proj-card:hover { border-color: var(--blue); box-shadow: 0 2px 12px rgba(20,223,98,.1); transform: translateY(-2px); }
  .proj-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
  .proj-name { font-weight: 600; font-size: 14px; }
  .proj-meta { font-size: 12px; color: var(--text2); }

  /* ── P&L table ───────────────────────────────── */
  .pl-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .pl-table th { background: var(--surface2); padding: 8px 10px; text-align: right; font-weight: 500; color: var(--text2); border-bottom: 1px solid var(--border); white-space: nowrap; }
  .pl-table th:first-child { text-align: left; min-width: 180px; }
  .pl-table td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pl-table td:first-child { text-align: left; }
  .pl-table .section td { background: var(--surface2); font-weight: 600; font-size: 11px; color: var(--text2); padding-top: 10px; }
  .pl-table .total td { font-weight: 600; border-top: 2px solid var(--border); }
  .pl-table .result td { font-weight: 700; font-size: 13px; background: var(--surface2); }
  .pl-table .total-col { background: #e8fdf1 !important; font-weight: 600; }

  /* ── Desktop responsive ──────────────────────── */
  @media (max-width: 1024px) {
    .page-inner { padding: 24px 20px; }
    .kpi-grid { grid-template-columns: repeat(2,1fr); }
    .proj-grid { grid-template-columns: repeat(2,1fr); }
  }

  @media (max-width: 768px) {
    .kpi-grid { grid-template-columns: repeat(2,1fr); }
    .proj-grid { grid-template-columns: 1fr; }
    .form-grid { grid-template-columns: 1fr; }
    .form-group.full { grid-column: 1; }
  }
`

export const mobileCss = `
  /* ── Mobile top bar ─────────────────────────────── */
  .mobile-topbar {
    display: none;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: 56px;
    background: var(--sidebar);
    color: #f3f4f6;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
  }
  .mobile-menu-btn {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 22px;
    cursor: pointer;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    transition: all .12s;
  }
  .mobile-menu-btn:active { background: rgba(255,255,255,.1); transform: scale(.92); }

  /* ── Mobile bottom nav ──────────────────────────── */
  .mobile-nav { display: none; }

  /* ── Camera / upload buttons ────────────────────── */
  .upload-actions {
    display: flex;
    gap: 12px;
    align-items: stretch;
    margin-bottom: 14px;
  }
  .camera-btn, .file-btn {
    flex: 1;
    border: 2px dashed var(--border2);
    border-radius: var(--radius-md);
    padding: 20px 12px;
    background: var(--surface2);
    cursor: pointer;
    text-align: center;
    color: var(--text);
    transition: all .15s;
    font-family: inherit;
  }
  .camera-btn {
    border-color: var(--blue);
    background: var(--blue-bg);
    color: var(--blue);
  }
  .camera-btn:active, .camera-btn:hover { background: #dbeafe; }
  .file-btn:active, .file-btn:hover { border-color: var(--blue); background: var(--blue-bg); }
  .upload-or {
    display: flex;
    align-items: center;
    color: var(--text3);
    font-size: 13px;
    flex-shrink: 0;
  }

  /* Auth page right panel - hide on mobile */
  .auth-right-panel { display: flex; }
  @media (max-width: 768px) {
    .auth-right-panel { display: none !important; }
  }

  /* ── MEDIA: Mobile ──────────────────────────────── */
  @media (max-width: 768px) {
    /* Hide desktop sidebar */
    .app > .sidebar { display: none; }

    /* Show mobile top bar */
    .mobile-topbar { display: flex; }

    /* Main takes full width, add bottom padding for nav */
    .main { padding-bottom: 80px; }

    .page-inner { padding: 16px; }

    /* ── Mobile bottom navigation ─────────────────── */
    .mobile-nav {
      display: flex;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--surface);
      border-top: 1px solid var(--border);
      z-index: 200;
      padding: 6px 8px;
      padding-bottom: calc(6px + env(safe-area-inset-bottom));
      box-shadow: 0 -4px 16px rgba(0,0,0,.06);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      background: rgba(255,255,255,.92);
    }
    .mobile-nav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text3);
      padding: 8px 4px;
      border-radius: var(--radius-md);
      transition: all .15s var(--ease);
      font-family: inherit;
      position: relative;
      -webkit-tap-highlight-color: transparent;
    }
    .mobile-nav-item:active { transform: scale(.9); }
    .mobile-nav-item.active { color: var(--blue); }
    .mobile-nav-item.active::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 50%;
      transform: translateX(-50%);
      width: 20px;
      height: 3px;
      border-radius: 2px;
      background: var(--blue);
    }
    .mobile-nav-item.primary {
      background: var(--blue);
      color: #0a2e17;
      border-radius: 14px;
      margin: 4px 6px;
      box-shadow: 0 2px 8px rgba(20,223,98,.3);
    }
    .mobile-nav-item.primary:active { transform: scale(.92); }
    .mobile-nav-item.primary.active { background: #0fc254; }
    .mobile-nav-item.primary.active::after { display: none; }
    .mobile-nav-icon { font-size: 22px; line-height: 1; }
    .mobile-nav-label { font-size: 10px; font-weight: 600; letter-spacing: .2px; }

    /* ── Adaptive grids ──────────────────────────── */
    .kpi-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .proj-grid { grid-template-columns: 1fr; gap: 10px; }
    .form-grid { grid-template-columns: 1fr; gap: 12px; }
    .form-group.full { grid-column: 1; }
    .charts-row, .chart-row { grid-template-columns: 1fr; }
    .filters { gap: 6px; }
    .filters .form-input { font-size: 16px; min-width: 0; flex: 1; }
    .filter-search { min-width: 0 !important; width: 100%; }

    /* ── Better form inputs on mobile ────────────── */
    .form-input { font-size: 16px; padding: 11px 14px; border-radius: 10px; }
    select.form-input { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }

    /* Camera buttons — vertical on small screens */
    .upload-actions { flex-direction: column; }
    .upload-or { justify-content: center; padding: 4px 0; }
    .camera-btn { padding: 24px 12px; }

    /* ── Table mobile ─────────────────────────────── */
    .tbl-wrap { max-height: 420px; border-radius: var(--radius-md); }
    .tbl-wrap td, .tbl-wrap th { font-size: 12px; padding: 10px; }

    /* ── Modal → bottom sheet on mobile ───────────── */
    .modal-bg { padding: 0; align-items: flex-end; }
    .modal {
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      max-height: 94vh;
      padding: 20px 18px;
      padding-bottom: calc(20px + env(safe-area-inset-bottom));
      animation: slideUpSheet .3s var(--ease);
    }
    .modal::before {
      content: '';
      display: block;
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--border2);
      margin: 0 auto 16px;
    }

    /* ── Page header ──────────────────────────────── */
    .page-header { margin-bottom: 16px; }
    .page-header h1 { font-size: 20px; }

    /* ── Card padding ─────────────────────────────── */
    .card { padding: 16px; border-radius: var(--radius-md); }

    /* ── Touch targets ────────────────────────────── */
    .btn { min-height: 44px; padding: 10px 18px; font-size: 14px; border-radius: 10px; }
    .btn-sm { min-height: 38px; font-size: 13px; }
    .nav-item { min-height: 48px; }

    /* ── KPI mobile ───────────────────────────────── */
    .kpi { padding: 14px 16px; }
    .kpi-value { font-size: 18px; }

    /* ── Extracted card ────────────────────────────── */
    .extracted-grid { grid-template-columns: repeat(2,1fr); }

    /* ── Items table scroll ────────────────────────── */
    .items-table { overflow-x: auto; -webkit-overflow-scrolling: touch; }

    /* ── Chips ─────────────────────────────────────── */
    .chips { gap: 6px; }
    .chip { font-size: 11.5px; padding: 4px 10px; }

    /* ── Pagination ────────────────────────────────── */
    .pagination { justify-content: center; }
    .pg-btn { min-width: 36px; min-height: 36px; display: flex; align-items: center; justify-content: center; }

    /* ── Toast above bottom nav ────────────────────── */
    .toast { bottom: calc(80px + env(safe-area-inset-bottom)); right: 16px; left: 16px; text-align: center; }

    /* ── Empty state ───────────────────────────────── */
    .empty { padding: 40px 16px; }

    /* ── Project cards ─────────────────────────────── */
    .proj-card { padding: 16px; }
    .proj-card:hover { transform: none; }

    /* ── Badge ─────────────────────────────────────── */
    .badge { font-size: 10.5px; padding: 3px 8px; }
  }

  /* ── Tiny phones (< 380px) ──────────────────────── */
  @media (max-width: 380px) {
    .kpi-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
    .mobile-nav-label { font-size: 9px; }
    .mobile-nav-icon { font-size: 21px; }
    .mobile-nav-item { padding: 6px 2px; }
    .page-inner { padding: 12px; }
    .kpi-value { font-size: 16px; }
  }
`
