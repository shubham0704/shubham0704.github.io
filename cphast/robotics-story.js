(() => {
  const root = document.querySelector('#robot-story');
  if (!root) return;
  const chapters = [...root.querySelectorAll('[data-chapter]')];
  const links = [...root.querySelectorAll('[data-study]')];
  const next = root.querySelector('#robot-story-next');
  const back = root.querySelector('#robot-story-back');
  const outcomes = ['See the arm predictions', 'See the transfer result', 'Skip to the study results', 'Compare with the measurements'];
  const transitions = ['Next: a different robot', 'Next: choose a response', 'Next: real measurements', 'Continue to the theory'];
  let chapter = 0, result = false;

  function render(focus = false) {
    root.querySelectorAll('video').forEach(v => v.pause());
    chapters.forEach((node, i) => {
      node.hidden = i !== chapter;
      node.dataset.view = result && i === chapter ? 'result' : 'setup';
      node.querySelector('[data-result]').hidden = !result || i !== chapter;
    });
    links.forEach((link, i) => {
      if (i === chapter) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
    back.disabled = chapter === 0 && !result;
    root.querySelector('#robot-story-position').textContent = `${chapter + 1} of 4 / ${result ? 'What the results show' : 'What we are testing'}`;
    next.innerHTML = `${(result ? transitions : outcomes)[chapter]}<i data-lucide="arrow-right" aria-hidden="true"></i>`;
    next.classList.toggle('primary', chapter !== 2 || result);
    window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
    if (focus) {
      chapters[chapter].querySelector('h3').focus({ preventScroll: true });
      root.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }
  function route(hash, focus = true) {
    const target = hash === '#robotics' ? 0 : chapters.findIndex(node => `#${node.id}` === hash);
    if (target < 0) return;
    chapter = target; result = false; render(focus);
  }
  // Keep normal anchors usable for direct links, browser history, and no-JS readers.
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    if (link.hash !== '#robotics' && !chapters.some(node => link.hash === `#${node.id}`)) return;
    link.addEventListener('click', e => {
      e.preventDefault(); history.pushState(null, '', link.hash); route(link.hash);
    });
  });
  window.addEventListener('hashchange', () => route(location.hash));
  next.addEventListener('click', () => {
    if (!result) result = true;
    else if (chapter < chapters.length - 1) { chapter++; result = false; }
    else { location.hash = '#emergence'; return; }
    history.replaceState(null, '', `#${chapters[chapter].id}`); render(true);
  });
  back.addEventListener('click', () => {
    if (result) result = false;
    else if (chapter > 0) { chapter--; result = true; }
    history.replaceState(null, '', `#${chapters[chapter].id}`); render(true);
  });
  root.classList.add('robot-story-enhanced');
  root.querySelector('.robot-story-controls').hidden = false;
  render(); route(location.hash, false);
})();
