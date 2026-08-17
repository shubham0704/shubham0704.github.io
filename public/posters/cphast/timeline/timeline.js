const workstreams = [...document.querySelectorAll(".workstream")];
let printState = [];
let protocolPrintState = [];
let printMode = false;

function openHashTarget() {
  if (!window.location.hash) {
    return;
  }
  const target = document.querySelector(window.location.hash);
  if (target?.matches(".workstream")) {
    target.open = true;
  }
}

workstreams.forEach((workstream) => {
  workstream.addEventListener("toggle", () => {
    const action = workstream.querySelector(".workstream-action");
    action.textContent = workstream.open ? "Close study" : "Open study";

    if (printMode || !workstream.open) {
      return;
    }

    workstreams.forEach((other) => {
      if (other !== workstream) {
        other.open = false;
      }
    });
    window.history.replaceState(null, "", `#${workstream.id}`);
  });
});

window.addEventListener("hashchange", openHashTarget);
window.addEventListener("beforeprint", () => {
  printMode = true;
  printState = workstreams.map((workstream) => workstream.open);
  protocolPrintState = [...document.querySelectorAll(".protocol-details")].map((details) => details.open);
  workstreams.forEach((workstream) => {
    workstream.open = true;
  });
  document.querySelectorAll(".protocol-details").forEach((details) => {
    details.open = true;
  });
});
window.addEventListener("afterprint", () => {
  workstreams.forEach((workstream, index) => {
    workstream.open = printState[index];
  });
  document.querySelectorAll(".protocol-details").forEach((details, index) => {
    details.open = protocolPrintState[index];
  });
  window.setTimeout(() => {
    printMode = false;
  }, 0);
});

openHashTarget();
