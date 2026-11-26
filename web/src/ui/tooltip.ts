// One tooltip for the whole app. Any element with a `data-tip` text shows it on hover and on
// keyboard focus. Escape, scrolling and leaving hide it. A tooltip only repeats the name of
// a control: nothing that the user needs is kept in one alone.

export function startTooltips(): void {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("aria-hidden", "true"); // the control already has the same text as its name
  tip.hidden = true;
  let owner: Element | null = null;

  const hide = () => {
    owner = null;
    tip.hidden = true;
  };
  const show = (element: Element) => {
    if (owner === element) return;
    owner = element;
    tip.textContent = element.getAttribute("data-tip");
    // inside an open dialog the tooltip must be in the dialog, or it would be drawn under it
    (element.closest("dialog") ?? document.body).append(tip);
    tip.hidden = false;
    const box = element.getBoundingClientRect(), gap = 6, width = tip.offsetWidth, height = tip.offsetHeight;
    const above = box.top - height - gap;
    tip.style.top = `${above >= gap ? above : box.bottom + gap}px`;
    tip.style.left = `${Math.max(gap, Math.min(box.left + box.width / 2 - width / 2, document.documentElement.clientWidth - width - gap))}px`;
  };
  const tipped = (target: EventTarget | null) => (target instanceof Element ? target.closest("[data-tip]") : null);

  document.addEventListener("pointerover", (event) => {
    const element = tipped(event.target);
    if (element) show(element);
    else if (!(event.target instanceof Node && tip.contains(event.target))) hide();
  });
  document.addEventListener("focusin", (event) => {
    const element = tipped(event.target);
    if (element && event.target instanceof Element && event.target.matches(":focus-visible")) show(element);
    else hide();
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => event.key === "Escape" && hide());
  document.addEventListener("pointerdown", hide);
  document.addEventListener("scroll", hide, true);
}
