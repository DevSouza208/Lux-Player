(() => {
  'use strict';

  function isStandalone(){
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function applyLegacyCleanup(){
    const panel=document.getElementById('debugPanel');
    if(panel){panel.style.display='none';panel.setAttribute('aria-hidden','true')}

    const browserContinue=document.getElementById('installGuideBrowser');
    if(browserContinue)browserContinue.remove();

    if(!isStandalone()){
      const join=document.getElementById('joinScreen');
      const controller=document.getElementById('controllerScreen');
      if(join){join.classList.remove('active');join.style.pointerEvents='none';join.setAttribute('aria-hidden','true')}
      if(controller){controller.classList.remove('active');controller.style.pointerEvents='none';controller.setAttribute('aria-hidden','true')}
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLegacyCleanup,{once:true});
  else applyLegacyCleanup();
})();
