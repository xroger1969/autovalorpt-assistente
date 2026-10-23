// Visual adjustments only. Keyboard positioning belongs to ios-keyboard-fix.js.
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    .free-question-action,.general-request-action{width:100%;min-height:52px;margin:12px 0;padding:12px 16px;border:1px solid #91b5e8;border-radius:14px;color:#124b92;background:#fff;font-size:17px;font-weight:800;text-align:center;cursor:pointer}
    .general-request-action{background:#eaf3ff;border:2px solid #0b5ed7}
    button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #216de0;outline-offset:3px}
    .followup-actions{grid-template-columns:1fr;gap:10px;margin:12px 0 18px}
    @media(max-width:820px){.selection-footer .continue-selection{min-height:54px;font-size:18px}.free-question-action,.general-request-action{min-height:54px}}
  `;
  document.head.appendChild(style);
});
