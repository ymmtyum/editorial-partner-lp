const menu = document.getElementById('site-menu');
const menuToggle = document.querySelector('.menu-toggle');
const deck = document.querySelector('main');
const hero = document.getElementById('top');
const cardStack = document.querySelector('.card-stack');
const chapters = [...cardStack.querySelectorAll(':scope > .chapter')];
const indexLinks = [...menu.querySelectorAll('a[href^="#"]')];
const tileToggle = document.querySelector('.tile-toggle');
const backTop = document.querySelector('.back-top');
const tileView = document.getElementById('card-list');
const tileClose = document.querySelector('.tile-close');
const tileGrid = document.querySelector('.tile-grid');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const stackLooks = [
  { x: -7, y: 4, angle: -1.15 },
  { x: 6, y: 1, angle: .72 },
  { x: -3, y: 5, angle: -.42 },
  { x: 8, y: 3, angle: 1.02 },
  { x: -6, y: 1, angle: -.78 },
  { x: 4, y: 5, angle: .48 },
  { x: -8, y: 2, angle: -.94 },
  { x: 3, y: 3, angle: .28 },
];

let view = 'top';
let activeIndex = -1;
let stashSide = 0;
let transitioning = false;
let transitionVersion = 0;
let runningAnimations = [];
let transitionTimer;
let preview = null;
let pose = { x: 0, y: 0 };
let poseSamples = [];
let springFrame = 0;
let tracking = false;
let shownNext = -1;
let wheelGesture = null;
let wheelIdleTimer;
let touchGesture = null;
let pointerGesture = null;
let suppressClickUntil = 0;
let movingBundle = false;
let stashPoint = null;

function lookFor(index) {
  return stackLooks[index % stackLooks.length];
}

chapters.forEach((chapter, index) => {
  const look = lookFor(index);
  chapter.style.setProperty('--stack-level', String(index + 1));
  chapter.style.setProperty('--stack-x', `${look.x}px`);
  chapter.style.setProperty('--stack-y', `${look.y}px`);
  chapter.style.setProperty('--stack-angle', `${look.angle}deg`);

  const title = chapter.querySelector('h2')?.textContent.trim() || '';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-card';
  button.dataset.index = String(index);
  const face = chapter.querySelector('.story-card').cloneNode(true);
  face.classList.add('tile-face');
  face.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  button.append(face);
  button.setAttribute('aria-label', `${String(index + 1).padStart(2, '0')} ${title}へ移動`);
  tileGrid?.append(button);
});

function bundleDistance() {
  return deck.clientWidth + Math.min(1100, deck.clientWidth * .8);
}

function cardFor(index) {
  return chapters[index]?.querySelector('.story-card');
}

function cardScrollFor(index) {
  return chapters[index]?.querySelector('.card-copy');
}

function stackTransform(index, extraY = 0) {
  const look = lookFor(index);
  return `translate(${look.x}px, ${look.y + extraY}px) rotate(${look.angle}deg)`;
}

function isNeat(index) {
  return Boolean(chapters[index]?.classList.contains('is-neat'));
}

function restingTransform(index, extraY = 0) {
  if (isNeat(index)) return `translate(0, ${extraY}px) rotate(0deg)`;
  return stackTransform(index, extraY);
}

function restingAngle(index) {
  return isNeat(index) ? 0 : lookFor(index).angle;
}

function setHash(id) {
  const hash = `#${id}`;
  if (location.hash !== hash) history.pushState(null, '', hash);
}

function updateCurrentLinks() {
  const currentHash = view === 'top' || activeIndex < 0 ? '#top' : `#${chapters[activeIndex].id}`;
  indexLinks.forEach((link) => {
    if (link.hash === currentHash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  [...(tileGrid?.querySelectorAll('.tile-card') || [])].forEach((button, index) => {
    if (index === activeIndex) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
}

function updateControls(nextView) {
  view = nextView;
  document.body.dataset.view = nextView;
  const onTop = nextView === 'top';
  menuToggle.hidden = false;
  const showClose = nextView === 'card';
  backTop.classList.toggle('is-shown', showClose);
  backTop.setAttribute('aria-hidden', showClose ? 'false' : 'true');
  backTop.tabIndex = showClose ? 0 : -1;
  if (tileToggle) {
    tileToggle.hidden = nextView !== 'card';
    tileToggle.setAttribute('aria-expanded', nextView === 'tiles' ? 'true' : 'false');
  }
  hero.inert = !onTop;
  hero.toggleAttribute('aria-hidden', !onTop);
  chapters.forEach((chapter, index) => {
    const isCurrent = index === activeIndex && nextView === 'card';
    chapter.inert = !isCurrent;
    chapter.toggleAttribute('aria-hidden', !isCurrent);
  });
  updateCurrentLinks();
}

function hideChapter(index) {
  const chapter = chapters[index];
  if (!chapter) return;
  chapter.classList.remove('is-active', 'is-stacked', 'is-preview', 'is-leaving');
  chapter.inert = true;
  chapter.setAttribute('aria-hidden', 'true');
  const card = cardFor(index);
  card.getAnimations().forEach((animation) => animation.cancel());
  card.style.removeProperty('transform');
}

function renderStack(index) {
  chapters.forEach((chapter, chapterIndex) => {
    chapter.classList.remove('is-active', 'is-stacked', 'is-preview', 'is-leaving');
    clearCardDrag(chapterIndex);
    cardFor(chapterIndex)?.style.removeProperty('transform');
    if (chapterIndex === index) chapter.classList.add('is-active');
    else if (chapterIndex < index) chapter.classList.add('is-stacked');
    chapter.inert = true;
    chapter.setAttribute('aria-hidden', 'true');
  });
}

function cancelAllAnimations() {
  stopSpring();
  clearTimeout(transitionTimer);
  runningAnimations.forEach((animation) => animation.cancel());
  runningAnimations = [];
  cardStack.classList.remove('is-morph-source');
  tileView?.classList.remove('is-morphing');
  tileGrid?.querySelectorAll('.is-morphing').forEach((button) => button.classList.remove('is-morphing'));
  deck.classList.remove('is-settling');
  transitionVersion += 1;
  transitioning = false;
}

function cancelTransition() {
  cancelAllAnimations();
}

function playTransition(animations, duration, finish) {
  const version = ++transitionVersion;
  transitioning = true;
  runningAnimations = animations;
  let done = false;
  const complete = () => {
    if (done || version !== transitionVersion) return;
    done = true;
    clearTimeout(transitionTimer);
    runningAnimations.forEach((animation) => animation.cancel());
    runningAnimations = [];
    transitioning = false;
    finish();
  };
  Promise.allSettled(animations.map((animation) => animation.finished)).then(complete);
  transitionTimer = setTimeout(complete, duration + 120);
}

function cardTravel() {
  const index = activeIndex >= 0 ? activeIndex : 0;
  return cardFor(index)?.offsetHeight || deck.clientHeight * .7;
}

function rubber(value, min, max) {
  if (value < min) return min + (value - min) / (1 + Math.abs(value - min) / 220);
  if (value > max) return max + (value - max) / (1 + Math.abs(value - max) / 220);
  return value;
}

function dragLimits() {
  return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
}

let dragIntent = 'idle';

function fingerIntent() {
  const up = Math.max(-pose.y, 0);
  const down = Math.max(pose.y, 0);
  if (up > 8 && up >= down) return 'forward';
  if (down > 8) return 'back';
  return 'idle';
}

function notePose() {
  const now = performance.now();
  poseSamples.push({ t: now, x: pose.x, y: pose.y });
  while (poseSamples.length > 1 && now - poseSamples[0].t > 100) poseSamples.shift();
}

function poseVelocity() {
  if (poseSamples.length < 2) return { x: 0, y: 0 };
  const last = poseSamples.at(-1);
  let first = poseSamples[0];
  for (const sample of poseSamples) {
    if (last.t - sample.t <= 80) {
      first = sample;
      break;
    }
  }
  const dt = last.t - first.t;
  if (dt < 12) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

function risingCard() {
  return chapters[0].querySelector('.story-card') || deck.querySelector('.rising-slot .story-card');
}

function placeRisingCard(y) {
  const card = risingCard();
  if (!card) return;
  const look = lookFor(0);
  card.style.setProperty('--rest-x', `${look.x}px`);
  card.style.setProperty('--rest-y', `${look.y}px`);
  card.style.setProperty('--rest-angle', `${look.angle}deg`);
  let slot = deck.querySelector(':scope > .rising-slot');
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'rising-slot';
    deck.append(slot);
  }
  if (card.parentElement !== slot) slot.append(card);
  card.classList.add('is-rising');
  card.style.setProperty('--drag-y', `${cardTravel() + y}px`);
}

function clearRisingCard() {
  const slot = deck.querySelector(':scope > .rising-slot');
  const card = slot?.querySelector('.story-card');
  if (card) {
    card.classList.remove('is-rising');
    card.style.removeProperty('--drag-y');
    card.style.removeProperty('--rest-x');
    card.style.removeProperty('--rest-y');
    card.style.removeProperty('--rest-angle');
    chapters[0].append(card);
  }
  slot?.remove();
}

function clearCardDrag(index) {
  const card = cardFor(index);
  if (!card) return;
  card.style.removeProperty('--drag-x');
  card.style.removeProperty('--drag-y');
  card.classList.remove('is-held');
}

function applyPose() {
  cardStack.style.removeProperty('transform');
  cardStack.style.setProperty('--bundle-x', '0px');
  cardStack.style.setProperty('--bundle-y', '0px');
  cardStack.style.setProperty('--bundle-rot', '0deg');
  deck.classList.toggle('is-dragging', tracking);
  dragIntent = fingerIntent();
  // Elevate the shadow only while the finger is moving the card.
  // During spring settle, keep the final shadow so it does not change after the slide lands.
  const liftShadow = tracking && !springFrame && !deck.classList.contains('is-settling');
  const travel = cardTravel();
  const nextIndex = activeIndex + 1;
  if (dragIntent === 'forward' && nextIndex >= 0 && nextIndex < chapters.length) {
    const chapter = chapters[nextIndex];
    chapter.classList.add('is-preview');
    chapter.inert = true;
    chapter.setAttribute('aria-hidden', 'true');
    const card = cardFor(nextIndex);
    card.style.setProperty('--drag-x', '0px');
    card.style.setProperty('--drag-y', `${travel + Math.min(pose.y, 0)}px`);
    card.classList.toggle('is-held', liftShadow);
    shownNext = nextIndex;
    if (activeIndex >= 0) clearCardDrag(activeIndex);
  } else if (shownNext >= 0) {
    clearCardDrag(shownNext);
    hideChapter(shownNext);
    shownNext = -1;
  }
  if (dragIntent === 'back' && activeIndex >= 0) {
    const card = cardFor(activeIndex);
    card.style.setProperty('--drag-x', '0px');
    card.style.setProperty('--drag-y', `${Math.max(pose.y, 0)}px`);
    card.classList.toggle('is-held', liftShadow);
  } else if (activeIndex >= 0 && dragIntent !== 'forward') {
    clearCardDrag(activeIndex);
  }
}

function stopSpring() {
  if (springFrame) cancelAnimationFrame(springFrame);
  springFrame = 0;
}

function captureLivePose() {
  if (springFrame || runningAnimations.length) {
    const stack = new DOMMatrix(getComputedStyle(cardStack).transform);
    pose.x = stack.m41;
    if (activeIndex >= 0) {
      const card = cardFor(activeIndex);
      const matrix = new DOMMatrix(getComputedStyle(card).transform);
      const restY = isNeat(activeIndex) ? 0 : lookFor(activeIndex).y;
      pose.y = matrix.m42 - restY;
    }
    cancelAllAnimations();
    chapters.forEach((_, index) => cardFor(index)?.style.removeProperty('transform'));
    cardStack.style.removeProperty('transform');
  } else if (view === 'top' && stashSide && Math.abs(pose.x) < 1) {
    pose.x = stashSide * bundleDistance();
    pose.y = 0;
    cardStack.style.removeProperty('transform');
  }
  poseSamples = [{ t: performance.now(), x: pose.x, y: pose.y }];
  applyPose();
}

function springPose(targetX, targetY, velocity, done) {
  stopSpring();
  const version = ++transitionVersion;
  transitioning = true;
  tracking = true;
  deck.classList.add('is-settling');
  // Drop the held shadow before the settle so the landing pose matches the rest state.
  if (shownNext >= 0) cardFor(shownNext)?.classList.remove('is-held');
  if (activeIndex >= 0) cardFor(activeIndex)?.classList.remove('is-held');
  if (reduceMotion.matches) {
    pose.x = targetX;
    pose.y = targetY;
    applyPose();
    tracking = false;
    transitioning = false;
    deck.classList.remove('is-settling');
    done();
    return;
  }
  let x = pose.x;
  let y = pose.y;
  let vx = velocity.x * 1000;
  let vy = velocity.y * 1000;
  let last = performance.now();
  const step = (now) => {
    if (version !== transitionVersion) return;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    vx += (-220 * (x - targetX) - 26 * vx) * dt;
    vy += (-220 * (y - targetY) - 26 * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    pose.x = x;
    pose.y = y;
    applyPose();
    if (Math.hypot(x - targetX, y - targetY) < 0.8 && Math.hypot(vx, vy) < 30) {
      pose.x = targetX;
      pose.y = targetY;
      applyPose();
      springFrame = 0;
      tracking = false;
      transitioning = false;
      deck.classList.remove('is-settling');
      done();
      return;
    }
    springFrame = requestAnimationFrame(step);
  };
  springFrame = requestAnimationFrame(step);
}

function shouldCommit(delta, velocity, span) {
  if (!delta) return false;
  if (Math.sign(velocity) === -Math.sign(delta) && Math.abs(velocity) > 0.35) return false;
  if (Math.abs(delta) > span / 3) return true;
  return Math.sign(velocity) === Math.sign(delta) && Math.abs(velocity) > 0.55;
}

function releasePose(velocity = poseVelocity()) {
  tracking = false;
  deck.classList.remove('is-dragging');
  const travel = cardTravel();
  const intent = dragIntent;
  pose.x = 0;
  const forwardPull = Math.min(pose.y, 0);
  if (intent === 'forward' && activeIndex + 1 < chapters.length && shouldCommit(forwardPull, velocity.y, travel)) {
    springPose(0, -travel, { x: 0, y: velocity.y }, () => { dragIntent = 'idle'; commitNextCard(); });
    return;
  }
  const backPull = Math.max(pose.y, 0);
  if (intent === 'back' && activeIndex >= 0 && shouldCommit(backPull, velocity.y, travel)) {
    springPose(0, travel, velocity, () => {
      dragIntent = 'idle';
      if (activeIndex > 0) commitPreviousCard();
      else if (location.hash !== '#top') location.hash = '#top';
    });
    return;
  }
  dragIntent = 'idle';
  springPose(0, 0, velocity, () => {
    if (shownNext >= 0) {
      clearCardDrag(shownNext);
      hideChapter(shownNext);
      shownNext = -1;
    }
    if (activeIndex > 0) clearCardDrag(activeIndex - 1);
    clearCardDrag(activeIndex);
  });
}

function finishPose(action, targetX) {
  tracking = false;
  deck.classList.remove('is-dragging');
  cardStack.classList.remove('is-held');
  if (action === 'enter' || action === 'restart') commitEnteredCard();
  else if (action === 'next') commitNextCard();
  else if (action === 'prev') commitPreviousCard();
  else if (action === 'stash') commitStash(Math.sign(targetX) || 1);
  else if (action === 'restore') commitRestore();
  else {
    pose = (view === 'top' && stashSide) ? { x: stashSide * bundleDistance(), y: 0 } : { x: 0, y: 0 };
    if (shownNext >= 0) {
      clearCardDrag(shownNext);
      hideChapter(shownNext);
      shownNext = -1;
    }
    if (activeIndex >= 0) clearCardDrag(activeIndex);
    clearRisingCard();
    applyPose();
    deck.classList.remove('is-dragging');
    cardStack.classList.remove('is-held');
    if (view === 'top' && !stashSide) hero.style.opacity = '1';
    if (view === 'card') hero.style.opacity = '1';
  }
}

function commitEnteredCard() {
  pose = { x: 0, y: 0 };
  cardStack.style.visibility = 'hidden';
  cardStack.style.removeProperty('--bundle-x');
  cardStack.style.removeProperty('--bundle-rot');
  cardStack.style.removeProperty('transform');
  cardStack.classList.remove('is-held');
  chapters.forEach((chapter) => chapter.classList.remove('is-neat'));
  clearRisingCard();
  cardStack.style.visibility = '';
  clearCardDrag(0);
  shownNext = -1;
  activeIndex = 0;
  stashSide = 0;
  renderStack(0);
  hero.style.opacity = '1';
  setHash(chapters[0].id);
  updateControls('card');
  chapters[0].focus({ preventScroll: true });
}

function commitNextCard() {
  const index = activeIndex + 1;
  if (index >= chapters.length) return;
  if (activeIndex < 0) {
    clearCardDrag(index);
    shownNext = -1;
    activeIndex = index;
    pose = { x: 0, y: 0 };
    renderStack(index);
    hero.style.opacity = '1';
    setHash(chapters[index].id);
    updateControls('card');
    chapters[index].focus({ preventScroll: true });
    return;
  }
  const incoming = chapters[index];
  clearCardDrag(activeIndex);
  clearCardDrag(index);
  shownNext = -1;
  chapters[activeIndex].classList.remove('is-active');
  chapters[activeIndex].classList.add('is-stacked');
  incoming.classList.remove('is-neat');
  incoming.classList.remove('is-preview');
  incoming.classList.add('is-active');
  cardScrollFor(index).scrollTop = 0;
  activeIndex = index;
  pose = { x: 0, y: 0 };
  cardStack.style.removeProperty('--bundle-x');
  cardStack.style.removeProperty('--bundle-rot');
  hero.style.opacity = '1';
  setHash(incoming.id);
  updateControls('card');
  incoming.focus({ preventScroll: true });
}

function commitPreviousCard() {
  const outgoingIndex = activeIndex;
  const nextIndex = activeIndex - 1;
  clearCardDrag(outgoingIndex);
  chapters[outgoingIndex].classList.remove('is-neat');
  hideChapter(outgoingIndex);
  chapters[nextIndex].classList.remove('is-stacked');
  chapters[nextIndex].classList.add('is-active');
  activeIndex = nextIndex;
  pose = { x: 0, y: 0 };
  cardStack.style.removeProperty('--bundle-x');
  cardStack.style.removeProperty('--bundle-rot');
  hero.style.opacity = '1';
  setHash(chapters[nextIndex].id);
  updateControls('card');
  chapters[nextIndex].focus({ preventScroll: true });
}

function commitPeel() {
  const peeled = activeIndex;
  if (peeled < 0) return;
  hideChapter(peeled);
  clearCardDrag(peeled);
  pose = { x: 0, y: 0 };
  movingBundle = false;
  const next = peeled + 1;
  if (next >= chapters.length) {
    activeIndex = -1;
    stashPoint = null;
    stashSide = 0;
    hero.style.opacity = '1';
    setHash('top');
    updateControls('top');
    hero.focus({ preventScroll: true });
    return;
  }
  activeIndex = next;
  renderStack(next);
  hero.style.opacity = '1';
  setHash(chapters[next].id);
  updateControls('card');
  chapters[next].focus({ preventScroll: true });
}

function commitStash(x, y = 0) {
  if (Math.abs(x) <= 1 && !y) {
    const side = x || 1;
    x = side * bundleDistance();
    y = 0;
  }
  if (activeIndex >= 0) clearCardDrag(activeIndex);
  stashPoint = { x, y };
  stashSide = Math.sign(x) || (Math.sign(y) || 1);
  pose = { x, y };
  movingBundle = false;
  applyPose();
  hero.style.opacity = '1';
  setHash('top');
  updateControls('top');
  hero.focus({ preventScroll: true });
}

function commitRestore() {
  stashSide = 0;
  stashPoint = null;
  pose = { x: 0, y: 0 };
  movingBundle = false;
  renderStack(activeIndex);
  cardStack.style.removeProperty('--bundle-x');
  cardStack.style.removeProperty('--bundle-y');
  cardStack.style.removeProperty('--bundle-rot');
  cardStack.style.removeProperty('transform');
  hero.style.opacity = '1';
  setHash(chapters[activeIndex].id);
  updateControls('card');
  chapters[activeIndex].focus({ preventScroll: true });
}

function clearPreviewInstant() {
  if (springFrame || runningAnimations.length) {
    cancelAllAnimations();
  }
  tracking = false;
  preview = null;
  if (shownNext >= 0) {
    clearCardDrag(shownNext);
    hideChapter(shownNext);
    shownNext = -1;
  }
  if (activeIndex >= 0) clearCardDrag(activeIndex);
  pose = (view === 'top' && stashSide) ? { x: stashSide * bundleDistance(), y: 0 } : { x: 0, y: 0 };
  deck.classList.remove('is-dragging');
  cardStack.classList.remove('is-held');
  cardStack.style.removeProperty('transform');
  if (pose.x) {
    cardStack.style.setProperty('--bundle-x', `${pose.x}px`);
    cardStack.style.setProperty('--bundle-rot', `${Math.sign(pose.x) * 2}deg`);
  } else {
    cardStack.style.removeProperty('--bundle-x');
    cardStack.style.removeProperty('--bundle-rot');
  }
  hero.style.opacity = '1';
}

function enterStack(index = 0, { animate = true, focus = true } = {}) {
  if (springFrame || runningAnimations.length) cancelAllAnimations();
  if (index < 0 || index >= chapters.length || transitioning) return;
  clearPreviewInstant();
  activeIndex = index;
  stashSide = 0;
  renderStack(index);
  const card = cardFor(index);
  card.style.transform = restingTransform(index, deck.clientHeight + 60);
  cardStack.style.transform = 'none';
  document.body.dataset.view = 'transition';
  menuToggle.hidden = false;
  if (tileToggle) tileToggle.hidden = true;
  hero.inert = true;
  setHash(chapters[index].id);
  const finish = () => {
    card.style.removeProperty('transform');
    hero.style.opacity = '1';
    updateControls('card');
    if (focus) chapters[index].focus({ preventScroll: true });
  };
  if (!animate || reduceMotion.matches) {
    finish();
    return;
  }
  const duration = 250;
  playTransition([
    card.animate(
      [{ transform: restingTransform(index, deck.clientHeight + 60) }, { transform: restingTransform(index) }],
      { duration, easing: 'ease-in-out', fill: 'both' },
    ),
  ], duration, finish);
}

function addCard({ focus = true } = {}) {
  if (springFrame || runningAnimations.length) cancelAllAnimations();
  const index = activeIndex + 1;
  if (index >= chapters.length || transitioning) return;
  const incoming = chapters[index];
  const card = cardFor(index);
  const start = preview?.kind === 'next' ? getComputedStyle(card).transform : restingTransform(index, deck.clientHeight + 60);
  preview?.card?.classList.remove('is-held');
  preview = null;
  deck.classList.remove('is-dragging');
  chapters[activeIndex].classList.remove('is-active');
  chapters[activeIndex].classList.add('is-stacked');
  chapters[activeIndex].inert = true;
  chapters[activeIndex].setAttribute('aria-hidden', 'true');
  incoming.classList.remove('is-preview');
  incoming.classList.add('is-active');
  cardScrollFor(index).scrollTop = 0;
  activeIndex = index;
  setHash(incoming.id);
  updateCurrentLinks();
  const finish = () => {
    card.style.removeProperty('transform');
    updateControls('card');
    if (focus) incoming.focus({ preventScroll: true });
  };
  if (reduceMotion.matches) {
    finish();
    return;
  }
  const duration = 210;
  playTransition([
    card.animate(
      [{ transform: start }, { transform: restingTransform(index) }],
      { duration, easing: 'ease-in-out', fill: 'both' },
    ),
  ], duration, finish);
}

function removeCard({ focus = true } = {}) {
  if (springFrame || runningAnimations.length) cancelAllAnimations();
  if (activeIndex <= 0 || transitioning) return;
  const outgoingIndex = activeIndex;
  const nextIndex = activeIndex - 1;
  const outgoing = chapters[outgoingIndex];
  const outgoingCard = cardFor(outgoingIndex);
  const start = preview?.kind === 'previous' ? getComputedStyle(outgoingCard).transform : restingTransform(outgoingIndex);
  preview?.card?.classList.remove('is-held');
  preview = null;
  deck.classList.remove('is-dragging');
  outgoing.classList.remove('is-active');
  outgoing.classList.add('is-leaving');
  chapters[nextIndex].classList.remove('is-stacked');
  chapters[nextIndex].classList.add('is-active');
  activeIndex = nextIndex;
  setHash(chapters[nextIndex].id);
  updateCurrentLinks();
  const finish = () => {
    hideChapter(outgoingIndex);
    updateControls('card');
    if (focus) chapters[nextIndex].focus({ preventScroll: true });
  };
  if (reduceMotion.matches) {
    finish();
    return;
  }
  const duration = 210;
  playTransition([
    outgoingCard.animate(
      [{ transform: start }, { transform: restingTransform(outgoingIndex, deck.clientHeight + 70) }],
      { duration, easing: 'ease-in-out', fill: 'both' },
    ),
  ], duration, finish);
}

function stashBundle(side, { focus = true } = {}) {
  if (springFrame || runningAnimations.length) cancelAllAnimations();
  if (view !== 'card' || activeIndex < 0 || transitioning) return;
  const direction = side || 1;
  const start = getComputedStyle(cardStack).transform;
  preview = null;
  cardStack.classList.remove('is-held');
  deck.classList.remove('is-dragging');
  stashSide = direction;
  document.body.dataset.view = 'transition';
  menuToggle.hidden = false;
  if (tileToggle) tileToggle.hidden = true;
  hero.removeAttribute('aria-hidden');
  setHash('top');
  const target = `translateX(${direction * bundleDistance()}px) rotate(${direction * 2}deg)`;
  const finish = () => {
    commitStash(direction * bundleDistance(), 0);
    if (focus) hero.focus({ preventScroll: true });
  };
  if (reduceMotion.matches) {
    finish();
    return;
  }
  const duration = 230;
  playTransition([
    cardStack.animate(
      [{ transform: start }, { transform: target }],
      { duration, easing: 'ease-in-out', fill: 'both' },
    ),
    hero.animate(
      [{ opacity: getComputedStyle(hero).opacity }, { opacity: 1 }],
      { duration, easing: 'ease-in-out', fill: 'both' },
    ),
  ], duration, finish);
}

function restoreBundle({ focus = true } = {}) {
  if (springFrame || runningAnimations.length) cancelAllAnimations();
  if (view !== 'top' || activeIndex < 0 || !stashSide || transitioning) return;
  const start = getComputedStyle(cardStack).transform;
  preview = null;
  cardStack.classList.remove('is-held');
  deck.classList.remove('is-dragging');
  document.body.dataset.view = 'transition';
  menuToggle.hidden = false;
  if (tileToggle) tileToggle.hidden = true;
  setHash(chapters[activeIndex].id);
  const finish = () => {
    stashPoint = null;
    stashSide = 0;
    pose = { x: 0, y: 0 };
    cardStack.style.transform = 'none';
    cardStack.style.removeProperty('--bundle-x');
    cardStack.style.removeProperty('--bundle-y');
    cardStack.style.removeProperty('--bundle-rot');
    hero.style.opacity = '1';
    updateControls('card');
    if (focus) chapters[activeIndex].focus({ preventScroll: true });
  };
  if (reduceMotion.matches) {
    finish();
    return;
  }
  const duration = 230;
  playTransition([
    cardStack.animate(
      [{ transform: start }, { transform: 'translateX(0) rotate(0deg)' }],
      { duration, easing: 'ease-in-out', fill: 'both' },
    ),
  ], duration, finish);
}

function jumpToCard(index) {
  if (index < 0 || index >= chapters.length) return;
  activeIndex = index;
  renderStack(index);
  cardStack.style.transform = 'none';
  stashSide = 0;
  setHash(chapters[index].id);
  updateCurrentLinks();
}

function canReadFurther(direction) {
  if (view !== 'card' || activeIndex < 0) return false;
  const scroller = cardScrollFor(activeIndex);
  return direction > 0
    ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2
    : scroller.scrollTop > 2;
}

function scrollCurrentCard(delta) {
  if (activeIndex >= 0) cardScrollFor(activeIndex).scrollTop += delta;
}

function alignStack() {
  if (view !== 'card' || activeIndex < 1 || transitioning) return;
  chapters.slice(0, activeIndex + 1).forEach((chapter) => chapter.classList.add('is-neat'));
  if (reduceMotion.matches) return;
  const version = ++transitionVersion;
  transitioning = true;
  const cards = chapters.slice(0, activeIndex + 1).map((_, index) => cardFor(index));
  const starts = cards.map((card) => getComputedStyle(card).transform);
  const animations = cards.map((card, index) => card.animate([
    { transform: starts[index] },
    { transform: 'translate(-3px, 1px) rotate(-.18deg)', offset: .45 },
    { transform: 'translate(2px, -1px) rotate(.12deg)', offset: .72 },
    { transform: 'translate(0, 0) rotate(0deg)' },
  ], {
    duration: 250,
    delay: (cards.length - index - 1) * 28,
    easing: 'ease-in-out',
    fill: 'both',
  }));
  runningAnimations = animations;
  Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    if (version !== transitionVersion) return;
    animations.forEach((animation) => animation.cancel());
    runningAnimations = [];
    transitioning = false;
  });
}

let knockAt = 0;
let tileOpenTimer = 0;

function nudgeStack() {
  if (view !== 'card' || activeIndex < 0 || reduceMotion.matches) return;
  chapters.slice(0, activeIndex + 1).forEach((_, index) => {
    const card = cardFor(index);
    const look = lookFor(index);
    const neat = isNeat(index);
    const rest = neat ? 'translate(0px, 0px) rotate(0deg)' : `translate(${look.x}px, ${look.y}px) rotate(${look.angle}deg)`;
    const shaken = neat
      ? 'translate(4px, -2px) rotate(.7deg)'
      : `translate(${look.x + 5}px, ${look.y - 2}px) rotate(${look.angle + .8}deg)`;
    card.animate([
      { transform: rest },
      { transform: shaken, offset: .42 },
      { transform: rest },
    ], { duration: 240, delay: (activeIndex - index) * 16, easing: 'ease-in-out' });
  });
}

function nudgeTiles() {
  if (reduceMotion.matches) return;
  [...tileGrid.children].forEach((button, index) => {
    const angle = button.style.getPropertyValue('--tile-angle') || '0deg';
    button.animate([
      { transform: `rotate(${angle})` },
      { transform: 'rotate(1.6deg)', offset: .45 },
      { transform: `rotate(${angle})` },
    ], { duration: 200, delay: index * 10, easing: 'ease-in-out' });
  });
}

function alignTiles() {
  [...tileGrid.children].forEach((button, index) => {
    const angle = button.style.getPropertyValue('--tile-angle') || '0deg';
    button.style.setProperty('--tile-angle', '0deg');
    if (reduceMotion.matches) return;
    button.animate([
      { transform: `rotate(${angle})` },
      { transform: 'rotate(-.8deg)', offset: .4 },
      { transform: 'rotate(0deg)' },
    ], { duration: 260, delay: index * 12, easing: 'ease-in-out' });
  });
}

function registerKnock() {
  const now = performance.now();
  if (now - knockAt < 420) {
    knockAt = 0;
    if (view === 'tiles') alignTiles();
    else alignStack();
    return true;
  }
  knockAt = now;
  if (view === 'tiles') nudgeTiles();
  else nudgeStack();
  return false;
}

function randomTileAngles() {
  [...tileGrid.children].forEach((button) => {
    const angle = reduceMotion.matches ? '0.00' : (Math.random() * 4.2 - 2.1).toFixed(2);
    button.style.setProperty('--tile-angle', `${angle}deg`);
  });
}

function cardMorphBounds(index) {
  const card = cardFor(index);
  const rect = card.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

function lockTileFaces() {
  const sample = cardFor(Math.max(activeIndex, 0));
  if (!sample) return;
  const width = `${sample.offsetWidth}px`;
  const height = `${sample.offsetHeight}px`;
  tileGrid.querySelectorAll('.tile-face').forEach((face) => {
    face.style.setProperty('--face-w', width);
    face.style.setProperty('--face-h', height);
  });
}

function morphTransform(dx, dy, sx, sy, angle) {
  return {
    button: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy}) rotate(${angle}deg)`,
    face: `translateX(-50%) scale(${1 / sx}, ${1 / sy})`,
  };
}

function openTiles() {
  if (view !== 'card' || transitioning || activeIndex < 0) return;
  const version = ++transitionVersion;
  transitioning = true;
  resetWheel(false);
  randomTileAngles();
  const sourceBounds = chapters.map((_, index) => index <= activeIndex ? cardMorphBounds(index) : null);
  cardStack.classList.add('is-morph-source');
  tileView.hidden = false;
  tileView.classList.add('is-active', 'is-morphing');
  tileView.setAttribute('aria-hidden', 'false');
  updateControls('tiles');
  lockTileFaces();
  const buttons = [...tileGrid.children];
  const animations = [];
  buttons.forEach((button, index) => {
    button.getAnimations().forEach((animation) => animation.cancel());
    const angle = parseFloat(button.style.getPropertyValue('--tile-angle')) || 0;
    if (reduceMotion.matches) return;
    if (index > activeIndex) {
      animations.push(button.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: 90, easing: 'ease-out', fill: 'both' }));
      return;
    }
    button.classList.add('is-morphing');
    const source = sourceBounds[index];
    const target = button.getBoundingClientRect();
    const sx = source.width / target.width;
    const sy = source.height / target.height;
    const dx = (source.left + source.width / 2) - (target.left + target.width / 2);
    const dy = (source.top + source.height / 2) - (target.top + target.height / 2);
    const face = button.querySelector('.tile-face');
    const from = morphTransform(dx, dy, sx, sy, restingAngle(index));
    const to = morphTransform(0, 0, 1, 1, angle);
    const timing = { duration: 460 + index * 24, delay: index * 16, easing: 'cubic-bezier(.22,.72,.2,1)', fill: 'both' };
    animations.push(button.animate([{ transform: from.button }, { transform: to.button }], timing));
    animations.push(face.animate([{ transform: from.face }, { transform: to.face }], timing));
  });
  runningAnimations = animations;
  Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    if (version !== transitionVersion) return;
    animations.forEach((animation) => animation.cancel());
    runningAnimations = [];
    tileGrid.querySelectorAll('.is-morphing').forEach((node) => node.classList.remove('is-morphing'));
    tileView.classList.remove('is-morphing');
    cardStack.classList.remove('is-morph-source');
    transitioning = false;
    tileGrid.querySelector('.tile-card[aria-current="true"]')?.focus({ preventScroll: true });
  });
}

function closeTiles(targetIndex = activeIndex, { focus = true } = {}) {
  if (view !== 'tiles' || transitioning) return;
  const version = ++transitionVersion;
  transitioning = true;
  const buttons = [...tileGrid.children];
  const tileBounds = buttons.map((button) => button.getBoundingClientRect());
  jumpToCard(targetIndex);
  cardStack.classList.add('is-morph-source');
  tileView.classList.add('is-morphing');
  lockTileFaces();
  const animations = [];
  if (!reduceMotion.matches) {
    buttons.forEach((button, index) => {
      const angle = parseFloat(button.style.getPropertyValue('--tile-angle')) || 0;
      if (index <= targetIndex) {
        button.classList.add('is-morphing');
        const source = tileBounds[index];
        const target = cardMorphBounds(index);
        const sx = target.width / source.width;
        const sy = target.height / source.height;
        const dx = (target.left + target.width / 2) - (source.left + source.width / 2);
        const dy = (target.top + target.height / 2) - (source.top + source.height / 2);
        const face = button.querySelector('.tile-face');
        const from = morphTransform(0, 0, 1, 1, angle);
        const to = morphTransform(dx, dy, sx, sy, restingAngle(index));
        const timing = { duration: 420 + (targetIndex - index) * 20, delay: (targetIndex - index) * 12, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' };
        animations.push(button.animate([{ transform: from.button }, { transform: to.button }], timing));
        animations.push(face.animate([{ transform: from.face }, { transform: to.face }], timing));
      } else {
        animations.push(button.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: 'ease-in-out', fill: 'both' }));
      }
    });
  }
  runningAnimations = animations;
  const finish = () => {
    if (version !== transitionVersion) return;
    animations.forEach((animation) => animation.cancel());
    runningAnimations = [];
    buttons.forEach((button) => button.classList.remove('is-morphing'));
    tileView.classList.remove('is-morphing');
    cardStack.classList.remove('is-morph-source');
    tileView.classList.remove('is-active');
    tileView.hidden = true;
    tileView.setAttribute('aria-hidden', 'true');
    transitioning = false;
    updateControls('card');
    if (focus) tileToggle.focus({ preventScroll: true });
    else chapters[targetIndex].focus({ preventScroll: true });
  };
  if (!animations.length) finish();
  else Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
}

tileToggle?.addEventListener('click', openTiles);
tileClose?.addEventListener('click', () => closeTiles());
tileGrid?.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil) return;
  const button = event.target.closest('.tile-card');
  if (registerKnock()) {
    clearTimeout(tileOpenTimer);
    return;
  }
  if (!button) return;
  const index = Number(button.dataset.index);
  clearTimeout(tileOpenTimer);
  tileOpenTimer = setTimeout(() => {
    if (view === 'tiles') closeTiles(index, { focus: false });
  }, 340);
});

const faqItems = [...document.querySelectorAll('.faq-item')];
faqItems.forEach((item) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    faqItems.forEach((other) => {
      if (other !== item && other.open) other.open = false;
    });
  });
});

function dismissCardUp() {
  resetWheel(false);
  if (view !== 'card' || activeIndex < 0 || transitioning) {
    if (location.hash !== '#top') location.hash = '#top';
    return;
  }
  const index = activeIndex;
  chapters.forEach((_, chapterIndex) => {
    if (chapterIndex !== index) hideChapter(chapterIndex);
  });
  const card = cardFor(index);
  const distance = window.innerHeight * 0.92;
  transitioning = true;
  hero.style.opacity = '1';
  const animation = card.animate(
    [
      { transform: getComputedStyle(card).transform, offset: 0 },
      { transform: `translate3d(0, ${distance * 0.12}px, 0)`, offset: 0.22 },
      { transform: `translate3d(0, ${distance}px, 0)`, offset: 1 },
    ],
    { duration: reduceMotion.matches ? 1 : 420, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'forwards' },
  );
  animation.finished.then(() => {
    transitioning = false;
    if (location.hash !== '#top') location.hash = '#top';
  }).catch(() => { transitioning = false; });
}

backTop.addEventListener('click', dismissCardUp);
menuToggle.addEventListener('click', () => {
  resetWheel(false);
  menu.showModal();
  menuToggle.setAttribute('aria-expanded', 'true');
});
menu.addEventListener('close', () => menuToggle.setAttribute('aria-expanded', 'false'));
let menuPointerOutside = false;
function isOutsideMenu(event) {
  const rect = menu.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}
menu.addEventListener('pointerdown', (event) => {
  menuPointerOutside = event.target === menu && isOutsideMenu(event);
});
menu.addEventListener('click', (event) => {
  if (menuPointerOutside && event.target === menu && isOutsideMenu(event)) menu.close();
  menuPointerOutside = false;
});
indexLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    menu.close();
    if (link.hash === '#top') {
      if (location.hash !== '#top') location.hash = '#top';
      return;
    }
    const index = chapters.findIndex((chapter) => `#${chapter.id}` === link.hash);
    if (index < 0) return;
    if (activeIndex >= 0 && stashSide) {
      const side = stashSide;
      jumpToCard(index);
      stashSide = side;
      cardStack.style.transform = `translateX(${side * bundleDistance()}px) rotate(${side * 2}deg)`;
      restoreBundle();
    } else enterStack(index);
  });
});

function finishWheel(commit = true) {
  clearTimeout(wheelIdleTimer);
  const gesture = wheelGesture;
  wheelGesture = null;
  if (!gesture || gesture.mode === 'read' || !commit) return;
  if (!gesture.moved) return;
  releasePose();
}

function resetWheel(commit = true) {
  finishWheel(commit);
}

window.addEventListener('wheel', (event) => {
  if (menu.open || view === 'tiles' || event.ctrlKey) return;
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? deck.clientHeight : 1;
  const dx = event.deltaX * factor;
  const dy = event.deltaY * factor;
  if (!dx && !dy) return;
  event.preventDefault();
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const direction = Math.sign(dy);
  if (!wheelGesture) {
    const reading = vertical && view === 'card' && canReadFurther(direction);
    if (!reading) captureLivePose();
    wheelGesture = { lastAt: performance.now(), mode: reading ? 'read' : 'drag', moved: false };
    tracking = !reading;
  }
  const gesture = wheelGesture;
  gesture.lastAt = performance.now();
  gesture.sumX = (gesture.sumX || 0) + dx;
  gesture.sumY = (gesture.sumY || 0) + dy;
  clearTimeout(wheelIdleTimer);
  wheelIdleTimer = setTimeout(() => finishWheel(true), 180);
  if (gesture.mode === 'read') {
    scrollCurrentCard(dy);
    if (direction && !canReadFurther(direction)) {
      gesture.mode = 'drag';
      gesture.axis = 'y';
      gesture.lockedApplied = true;
      captureLivePose();
      tracking = true;
      return;
    } else return;
  }
  if (!gesture.axis) {
    if (Math.hypot(gesture.sumX, gesture.sumY) < 8) return;
    if (Math.abs(gesture.sumX) >= Math.abs(gesture.sumY)) {
      gesture.axis = 'x';
      return;
    }
    gesture.axis = 'y';
  }
  if (gesture.axis !== 'y') return;
  const limits = dragLimits();
  const stepY = gesture.lockedApplied ? dy : gesture.sumY;
  gesture.lockedApplied = true;
  pose.x = 0;
  pose.y = rubber(pose.y - stepY, limits.minY, limits.maxY);
  gesture.moved = true;
  tracking = true;
  notePose();
  applyPose();
}, { passive: false, capture: true });

function startDrag(x, y, interactive, source) {
  resetWheel(false);
  captureLivePose();
  return {
    originX: x, originY: y, lastY: y, baseY: pose.y,
    mode: null, axis: null, source, interactive,
  };
}

function moveDrag(gesture, x, y) {
  if (!gesture) return;
  const step = gesture.lastY - y;
  gesture.lastY = y;
  const rawX = x - gesture.originX;
  const rawY = y - gesture.originY;
  if (gesture.mode === 'boundary') {
    const continued = Math.sign(-rawY);
    if (continued && continued === gesture.boundaryDirection) {
      gesture.mode = 'nav';
      gesture.axis = 'y';
      gesture.originX = x;
      gesture.originY = y;
      gesture.baseY = pose.y;
    } else if (continued) {
      gesture.mode = 'read';
      gesture.originX = x;
      gesture.originY = y;
    }
  }
  if (!gesture.mode && Math.hypot(rawX, rawY) > 8) {
    if (Math.abs(rawX) >= Math.abs(rawY)) {
      gesture.mode = 'ignore';
    } else {
      const readDirection = rawY < 0 ? 1 : -1;
      gesture.mode = view === 'card' && canReadFurther(readDirection) ? 'read' : 'nav';
      if (gesture.mode === 'nav') tracking = true;
    }
  }
  if (gesture.mode === 'read') {
    const direction = Math.sign(step);
    if (gesture.source !== 'touch') scrollCurrentCard(step);
    if (direction && !canReadFurther(direction)) {
      gesture.mode = 'boundary';
      gesture.boundaryDirection = direction;
      gesture.originX = x;
      gesture.originY = y;
      gesture.baseX = pose.x;
      gesture.baseY = pose.y;
    }
    return;
  }
  if (gesture.mode !== 'nav') return;
  const limits = dragLimits();
  pose.x = 0;
  pose.y = rubber(y - gesture.originY, limits.minY, limits.maxY);
  tracking = true;
  notePose();
  applyPose();
}

function endDrag(gesture) {
  if (!gesture) return;
  clearTimeout(gesture.holdTimer);
  if (gesture.mode === 'nav' || gesture.mode === 'drag') {
    suppressClickUntil = performance.now() + 340;
    releasePose();
    return;
  }
  tracking = false;
  deck.classList.remove('is-dragging');
}

deck.addEventListener('touchstart', (event) => {
  if (menu.open || view === 'tiles' || event.touches.length !== 1) return;
  const touch = event.touches[0];
  touchGesture = startDrag(touch.clientX, touch.clientY, Boolean(event.target.closest('a, button, summary')), 'touch');
}, { passive: true });
deck.addEventListener('touchmove', (event) => {
  if (!touchGesture || event.touches.length !== 1) return;
  const touch = event.touches[0];
  moveDrag(touchGesture, touch.clientX, touch.clientY);
  if (touchGesture.mode && touchGesture.mode !== 'read' && event.cancelable) event.preventDefault();
}, { passive: false });
deck.addEventListener('touchend', (event) => {
  if (touchGesture && event.changedTouches[0]) {
    const touch = event.changedTouches[0];
    moveDrag(touchGesture, touch.clientX, touch.clientY);
  }
  endDrag(touchGesture);
  touchGesture = null;
}, { passive: false });
deck.addEventListener('touchcancel', () => {
  clearTimeout(touchGesture?.holdTimer);
  if (touchGesture && touchGesture.mode !== 'read') releasePose();
  touchGesture = null;
}, { passive: true });

deck.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' || event.button !== 0 || menu.open || view === 'tiles' ||
      event.target.closest('a, button, summary, input, textarea, select')) return;
  pointerGesture = startDrag(event.clientX, event.clientY, false, 'pointer');
  deck.setPointerCapture(event.pointerId);
});
deck.addEventListener('pointermove', (event) => {
  if (!pointerGesture || event.pointerType === 'touch') return;
  moveDrag(pointerGesture, event.clientX, event.clientY);
});
deck.addEventListener('pointerup', (event) => {
  if (!pointerGesture || event.pointerType === 'touch') return;
  moveDrag(pointerGesture, event.clientX, event.clientY);
  endDrag(pointerGesture);
  pointerGesture = null;
  if (deck.hasPointerCapture(event.pointerId)) deck.releasePointerCapture(event.pointerId);
});
deck.addEventListener('pointercancel', () => {
  clearTimeout(pointerGesture?.holdTimer);
  if (pointerGesture && pointerGesture.mode !== 'read') releasePose();
  pointerGesture = null;
});
deck.addEventListener('lostpointercapture', () => {
  const gesture = pointerGesture;
  if (!gesture) return;
  pointerGesture = null;
  clearTimeout(gesture.holdTimer);
  if (gesture.mode === 'nav' || gesture.mode === 'drag') releasePose();
});
deck.addEventListener('contextmenu', (event) => {
  if (deck.classList.contains('is-dragging')) event.preventDefault();
});
deck.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
deck.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil || view !== 'card' || menu.open) return;
  if (event.target.closest('a, button, summary, input, textarea, select')) return;
  registerKnock();
});

window.addEventListener('keydown', (event) => {
  if (menu.open || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (view === 'tiles') {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTiles();
    }
    return;
  }
  if (event.target.closest('a, button, summary') && event.key !== 'Escape') return;
  if (view === 'top') return;
  if (view !== 'card') return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (location.hash !== '#top') location.hash = '#top';
    return;
  }
  const forward = ['ArrowUp', 'PageDown', ' '].includes(event.key);
  const back = ['ArrowDown', 'PageUp'].includes(event.key);
  if (!forward && !back) return;
  event.preventDefault();
  if (forward && canReadFurther(1) && ['PageDown', ' '].includes(event.key)) {
    scrollCurrentCard(event.key === ' ' ? deck.clientHeight * .72 : 48);
  } else if (!event.repeat && forward && activeIndex + 1 < chapters.length) commitNextCard();
  else if (!event.repeat && back && activeIndex > 0) commitPreviousCard();
  else if (!event.repeat && back && activeIndex === 0 && location.hash !== '#top') location.hash = '#top';
});

function syncFromHash() {
  cancelAllAnimations();
  preview = null;
  if (tileView) {
    tileView.hidden = true;
    tileView.classList.remove('is-active');
    tileView.setAttribute('aria-hidden', 'true');
  }
  const index = chapters.findIndex((chapter) => `#${chapter.id}` === location.hash);
  stashPoint = null;
  stashSide = 0;
  movingBundle = false;
  pose = { x: 0, y: 0 };
  cardStack.style.transform = 'none';
  if (location.hash === '#top') {
    activeIndex = -1;
    chapters.forEach((_, chapterIndex) => hideChapter(chapterIndex));
    hero.style.opacity = '1';
    updateControls('top');
  } else if (index >= 0) {
    activeIndex = index;
    renderStack(index);
    hero.style.opacity = '1';
    updateControls('card');
  } else {
    activeIndex = 0;
    renderStack(0);
    hero.style.opacity = '1';
    updateControls('card');
  }
}

window.addEventListener('hashchange', syncFromHash);
window.addEventListener('blur', () => {
  resetWheel(false);
  if (tracking) releasePose();
  touchGesture = null;
  pointerGesture = null;
});
syncFromHash();
