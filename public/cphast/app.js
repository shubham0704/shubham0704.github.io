const $ = selector => document.querySelector(selector);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
const lessons = {
  electrical: [
    { image:'component-detail.png', title:'Learn one unit, reuse its law.', text:'Learn how one power unit stores and dissipates energy. Every unit of that type reuses the law; the line physics is supplied.', scope:'Learning changes model parameters. Later candidate queries keep them fixed.', alt:'A power unit studied in isolation before connection.' },
    { image:'connections-detail.png', title:'Change where the new unit attaches.', text:'The port map says where an input acts. Wiring says which ports connect. Moving one line endpoint changes the assembled dynamics.', scope:'The backbone, component laws, and supplied starting states stay fixed. This is a prospective connection, not a live switching transient.', alt:'New DGU attached to a selected receiving bus on the fixed backbone.' },
    { image:'forecast-detail.png', title:'A small current error can change the decision.', text:'Evolve the connected states, then check whether an attachment exceeds an operating limit. The frozen stress study compares C-PHAST, cPHNN and N-PHDAE with an independent simulation.', scope:'The image illustrates composition; the interactive stress study contains the new recorded predictions. Twelve scenarios, five fits, all failures retained. Separate from the headline voltage benchmark.', alt:'Illustration of composed forecasts with physical traces, from the earlier walkthrough.' },
  ],
  robotics: [
    { image:'transfer.png', title:'Learn repeated leg dynamics.', text:'A leg model is learned from ANYmal-D trajectories. Copies share the learned law rather than fitting an unrelated model for every leg.', scope:'This is a joint-position dynamics predictor. Floating-base dynamics and locomotion-controller transfer are not part of this transfer test.', alt:'ANYmal-D, Go2, and predicted robot motions from the transfer study.' },
    { image:'transfer.png', title:'Assemble the same four leg blocks for Go2.', text:'Reuse the learned local laws and coupling in the same four-leg layout. The target robot has different mass, leg lengths, and motors, but its morphology is not supplied to the predictor.', scope:'Body change and topology change are different tests. Here the layout stays fixed; the arm study below separately changes the component count.', alt:'ANYmal-D and Go2 retain a four-leg layout while the target embodiment changes.' },
    { image:'transfer.png', title:'Predict the target body from its history.', text:'Five frames of Go2 joint positions set the starting state. The unchanged model then forecasts fifty steps without receiving more observations.', scope:'The GRU fits the source better; C-PHAST has lower target error. The same-layout embodiment test is separate from arm count transfer.', alt:'Robot source and target comparison in the recorded Isaac Lab study.' },
  ],
};
let domain = 'electrical';
let step = 0;
function renderLesson() {
  const data = lessons[domain][step];
  const img = document.createElement('img');
  img.src = `assets/${data.image}`; img.alt = data.alt;
  $('#lesson-media').replaceChildren(img);
  $('#lesson-title').textContent = data.title;
  $('#lesson-copy').textContent = data.text;
  $('#lesson-scope').textContent = data.scope;
  $('#lesson-panel').setAttribute('aria-labelledby', `step-${step}`);
  document.querySelectorAll('[data-domain]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.domain === domain)));
  document.querySelectorAll('[data-step]').forEach(button => {
    const active = Number(button.dataset.step) === step;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
}
document.querySelectorAll('[data-domain]').forEach(button => button.addEventListener('click', () => { domain = button.dataset.domain; renderLesson(); }));
const steps = [...document.querySelectorAll('[data-step]')];
steps.forEach((button, index) => {
  button.addEventListener('click', () => { step = index; renderLesson(); });
  button.addEventListener('keydown', event => {
    const next = ({ArrowRight:(index+1)%3, ArrowLeft:(index+2)%3, Home:0, End:2})[event.key];
    if (next === undefined) return;
    event.preventDefault(); step = next; renderLesson(); steps[next].focus();
  });
});
renderLesson();

fetch('abstract.json').then(response => { if (!response.ok) throw new Error('Abstract unavailable'); return response.json(); }).then(paragraphs => {
  $('#abstract-text').replaceChildren(...paragraphs.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
}).catch(() => { /* The static link remains available when the source cannot load. */ });
document.querySelectorAll('a[href="#abstract"]').forEach(link => link.addEventListener('click', () => { $('#abstract details').open = true; }));
if (location.hash === '#abstract') $('#abstract details').open = true;

const theory = [
  { number:'Theorem 3.1', title:'Power-preserving interconnection', status:'Classical identity + implementation checks', claim:'With collocated ports and skew pairing, the internal connection supplies zero net power. It redistributes energy; it does not create it.', evidence:'The paper gives the algebraic argument. Finite-step behavior is covered separately by the energy-defect analysis below; a rendered connection animation is not an empirical proof.', links:[['paper.pdf#page=8','Identity and port assumptions']], gap:false },
  { number:'Theorem 3.2', title:'When composition increases expected dissipation', status:'Learned-law rewiring benefit not shown', claim:'Under the stated known linear-quadratic conditions and initial-state comparison, coupling can route energy into existing damping. The paper also gives counterexamples to universal improvement.', evidence:'A saved one-checkpoint audit certifies local decay, but all three tested alternative attachments have negative leading-order benefit against its baseline. A positive learned-law rewiring demonstration has not been established by that audit.', links:[['paper.pdf#page=17','Theorem and conditions'],['sources/local-decay-audit.txt','Local decay certificate'],['sources/dissipation-audit.txt','All tested alternative attachments']], gap:true },
  { number:'Theorem 3.4', title:'When a connection reveals a hidden initial state', status:'Proof + known-law sampled-noise evidence', claim:'Known linear dynamics and Gaussian observation assumptions allow comparison of initial-state estimation risk. Benefit depends on whether the sampled observations reveal the target; arbitrary coupling is insufficient.', evidence:'The saved triangle-to-parallel-line study retains the same sensors and predeclared initial-current target. It reports 20.8-31.1% lower expected risk, positive paired empirical MSE contrasts, and independent checking. Full-state observability and learned nonlinear inference are not established.', links:[['paper.pdf#page=18','Theorem, sampling, and prior assumptions'],['sources/inference-audit.txt','Saved protocol and numerical verification']], gap:false },
  { number:'Theorem D.1', title:'Finite-step energy-balance defect', status:'Measured check on a known oscillator', claim:'For the specified second-order regime and trapezoidal boundary accounting, the one-step energy residual is O(dt^3), under smoothness and no-switch conditions. This is not exact energy conservation.', evidence:'The paper reports slopes 2.99 (conservative), 1.98 (first-order boundary rule), and approximately 3.0-3.4 (trapezoidal driven/damped). The fixture is an untrained known harmonic oscillator, not a general learned nonlinear or switching validation.', links:[['paper.pdf#page=62','Theorem and measured scaling'],['sources/energy-balance.tex','Electrical solver-error extension and assumptions']], gap:false },
  { number:'Proposition D.2', title:'Electrical balance with an approximate solver', status:'Frozen-code refinement audit', claim:'Electrical midpoint composition has a finite-step defect and an additional solver-error contribution. Continuous power cancellation does not make the explicit-midpoint coupling step exactly energy preserving.', evidence:'The saved audit retains 1,920 learned-model rollouts and 30 known-law conditions. Tightening the solve barely changes the tested DGU predictions, while phase and unequal-storage controls expose finite-step limitations. These finite diagnostics do not establish universal convergence, safety, or exact nonlinear energy balance.', links:[['paper.pdf#page=63','Electrical solver-error proposition'],['sources/integrator-audit.md','Solver, phase, energy, and peak-resolution findings']], gap:false },
  { number:'Theorems E.2, E.4', title:'State-error transfer under observation', status:'Known-system check; learned coverage open', claim:'Valid local error and contraction assumptions propagate prediction errors; refreshed observations permit a probabilistic statement under the specified noise conditions.', evidence:'A known affine oscillator has 3,000 rollouts of horizon 200. Coverage is 1.000 in the reported cases, but bounds are conservative: about 17-18 times the empirical quantile, or 6-7 times with the independent-refresh refinement. This is a finite numerical check, not learned-model certification.', links:[['paper.pdf#page=67','Transfer theorems and certified assumptions'],['sources/transfer-check.tex','Coverage study and bound widths']], gap:true },
  { number:'Theorem F.2 + corollaries', title:'Decision margins, feasibility, and regret', status:'Known-law interval construction + checks', claim:'Valid prediction-error envelopes imply candidate-ordering and operating-limit statements. Unresolved is distinct from infeasible; sampled-time guarantees do not cover every instant.', evidence:'Nine source-voltage commands on a fixed three-DGU graph illustrate how uncertainty and resistance mismatch affect informativeness. An independent ODE comparison and 11,529 candidate-vertex diagnostics accompany the interval construction, which establishes the box-wide result.', links:[['paper.pdf#page=71','Margin statements and assumptions'],['sources/decision-check.tex','Known-law certificate and finite checks']], gap:false },
  { number:'Appendix F.4', title:'Shared-uncertainty candidate comparisons', status:'Known-law rewiring check', claim:'For known affine dynamics, affine assignments, and quadratic scores, paired bounds retain the shared uncertain starting state instead of treating candidates independently.', evidence:'At radius 0.05 with the same 2 A screen, paired bounds certify 74/81 cross-graph orderings versus 62/81 separate polynomial bounds. The study includes 12 exact-rational regression tests and 756 finite reference paths. Learned-law remainder bounds remain to be established.', links:[['paper.pdf#page=79','Proposition, full table, and counterfactual wiring'],['sources/paired-bounds.tex','Retained derivation and validation']], gap:false },
];
$('#theorem-list').innerHTML = theory.map(row => `<details class="theorem-item"><summary><span class="theorem-number">${row.number}</span><span class="theorem-title">${row.title}</span><span class="evidence-status${row.gap?' gap':''}">${row.status}</span>${icon('plus')}</summary><div class="theorem-body"><div><h4>What it says</h4><p>${row.claim}</p></div><div><h4>What supports it</h4><p>${row.evidence}</p>${row.links.map(([href,label]) => `<a class="source" href="${href}" target="_blank" rel="noopener">${label}${icon('arrow-up-right')}</a>`).join('')}</div></div></details>`).join('');

const titles = { attachment:'Would you connect the new unit?', microgrid:'Legacy source-network-calibrated walkthrough', go2:'After the push: which response would you try?', bounds:'Known-law decision certificates' };
let timer, generation = 0, returnFocus;
function pauseMedia() { document.querySelectorAll('video').forEach(video => video.pause()); }
function openExplorer(route) {
  if (!titles[route] || $('#experience').open) return;
  pauseMedia(); returnFocus = document.activeElement;
  const current = ++generation;
  $('#experience-title').textContent = titles[route];
  $('#standalone-explorer').href = `explorer/index.html#${route}`;
  const frame = document.createElement('iframe'); frame.src = `explorer/index.html#${route}`; frame.title = titles[route];
  $('#experience-frame').replaceChildren(frame);
  const status = $('#experience-status'); status.hidden = false; status.textContent = 'Loading the saved research artifact...';
  $('#experience').showModal(); document.body.classList.add('modal-open'); $('#close-experience').focus();
  const deadline = performance.now() + 35000; let launched = false;
  const failed = () => {
    status.replaceChildren(document.createTextNode('The saved artifact could not load. Retry or open it in a new tab.'));
    const retry = document.createElement('button'); retry.textContent = 'Retry';
    retry.addEventListener('click', () => { $('#experience').close(); setTimeout(() => openExplorer(route), 0); }, { once:true });
    status.append(retry);
  };
  const ready = () => {
    if (current !== generation || !$('#experience').open) return;
    let doc;
    try { doc = frame.contentDocument; } catch { failed(); return; }
    if (doc?.querySelector('.error-state,.case-failed,.go2-error,.robotics-error') || performance.now() > deadline) {
      failed(); return;
    }
    const selector = { attachment:'.attachment-view', microgrid:'.science-experiment', go2:'.robotics-guide,.go2-content:not([hidden])', bounds:'.bounds-controls' }[route];
    if (doc?.querySelector(selector)) { status.hidden = true; return; }
    if (!launched && route === 'microgrid' && doc?.querySelector('#play:not(:disabled)')) {
      const start = doc.querySelector('#start-experiment:not(:disabled)');
      if (start) { launched = true; start.click(); }
    }
    timer = setTimeout(ready, 120);
  };
  timer = setTimeout(ready,120);
}
document.querySelectorAll('[data-explorer]').forEach(button => button.addEventListener('click', () => openExplorer(button.dataset.explorer)));
$('#close-experience').addEventListener('click', () => $('#experience').close());
$('#experience').addEventListener('close', () => {
  generation++; clearTimeout(timer); $('#experience-frame').replaceChildren(); document.body.classList.remove('modal-open');
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll:true });
});
$('#experience').addEventListener('click', event => {
  if (event.target !== $('#experience')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
document.querySelectorAll('video').forEach(video => {
  video.addEventListener('play', () => document.querySelectorAll('video').forEach(other => { if (other !== video) other.pause(); }));
  video.addEventListener('error', () => {
    if (video.nextElementSibling?.classList.contains('media-error')) return;
    const p = document.createElement('p'); p.className = 'scope media-error';
    p.textContent = 'This recording could not load. The linked study and retained results remain available.'; video.after(p);
  });
});
document.querySelectorAll('details').forEach(detail => detail.addEventListener('toggle', () => { if (!detail.open) detail.querySelectorAll('video').forEach(video => video.pause()); }));
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseMedia(); });
icons();
