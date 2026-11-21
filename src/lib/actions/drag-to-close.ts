const CLAIM_DISTANCE = 10;
const COMMIT_RATIO = 0.35;
const COMMIT_VELOCITY = 0.5;
const SETTLE_MS = 260;
const CLICK_GUARD_MS = 400;

interface DragToCloseOptions {
	axis: 'x' | 'y';
	/** The direction the panel leaves in: -1 is left/up, 1 is right/down. */
	direction: -1 | 1;
	onClose: () => void;
	/** Fraction of the panel size that commits a close. */
	threshold?: number;
}

/**
 * Lets a sheet or drawer be dragged toward its exit edge and released.
 * Tracks the pointer 1:1, rubber-bands the opposite way, and closes on
 * distance or velocity. Plain variables keep this off Svelte's render path.
 */
export function attachDragToClose(node: HTMLElement, options: DragToCloseOptions) {
	const threshold = options.threshold ?? COMMIT_RATIO;

	let pointerId: number | null = null;
	let claimed = false;
	let start = 0;
	let startCross = 0;
	let last = 0;
	let lastTime = 0;
	let velocity = 0;
	let offset = 0;
	let suppressClickUntil = 0;
	let finishing = false;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const primary = (event: PointerEvent) =>
		options.axis === 'x' ? event.clientX : event.clientY;
	const cross = (event: PointerEvent) => (options.axis === 'x' ? event.clientY : event.clientX);
	const size = () => (options.axis === 'x' ? node.offsetWidth : node.offsetHeight);

	function transform(value: number) {
		offset = value;
		node.style.transform =
			options.axis === 'x' ? `translateX(${value}px)` : `translateY(${value}px)`;
	}

	function releasePointer() {
		if (pointerId !== null && node.hasPointerCapture(pointerId)) {
			node.releasePointerCapture(pointerId);
		}
		pointerId = null;
		claimed = false;
	}

	function resetStyles() {
		node.style.transition = '';
		node.style.animation = '';
		node.style.willChange = '';
		node.style.userSelect = '';
	}

	function onPointerDown(event: PointerEvent) {
		if (finishing || pointerId !== null) return;
		if (event.pointerType === 'mouse') return;

		if (settleTimer) {
			clearTimeout(settleTimer);
			settleTimer = undefined;
		}

		pointerId = event.pointerId;
		start = last = primary(event);
		startCross = cross(event);
		lastTime = event.timeStamp;
		velocity = 0;
		offset = 0;
	}

	function onPointerMove(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;

		const delta = primary(event) - start;
		const crossDelta = cross(event) - startCross;

		if (!claimed) {
			if (Math.abs(delta) < CLAIM_DISTANCE && Math.abs(crossDelta) < CLAIM_DISTANCE) return;

			// Let the browser keep vertical scrolls; only claim the panel's axis.
			if (Math.abs(crossDelta) > Math.abs(delta)) {
				pointerId = null;
				return;
			}

			claimed = true;
			node.setPointerCapture(event.pointerId);
			node.style.transition = 'none';
			node.style.animation = 'none';
			node.style.willChange = 'transform';
			node.style.userSelect = 'none';
		}

		velocity = (primary(event) - last) / Math.max(1, event.timeStamp - lastTime);
		last = primary(event);
		lastTime = event.timeStamp;

		const toward = options.direction === 1 ? Math.max(0, delta) : Math.min(0, delta);
		const away = delta - toward;
		transform(toward + away * 0.2);
	}

	function finish(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;

		const wasClaimed = claimed;
		const distance = Math.abs(offset);
		const velocityToward = options.direction === 1 ? velocity : -velocity;
		releasePointer();

		if (!wasClaimed) return;

		suppressClickUntil = performance.now() + CLICK_GUARD_MS;

		const movedTowardExit = offset * options.direction > 0;
		const shouldClose =
			(movedTowardExit && distance >= size() * threshold) ||
			velocityToward > COMMIT_VELOCITY;

		if (shouldClose) {
			finishing = true;
			const end = options.direction * (size() + 48);
			node.style.transition = 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)';
			transform(end);

			const close = () => {
				if (!finishing) return;
				finishing = false;
				if (closeTimer) {
					clearTimeout(closeTimer);
					closeTimer = undefined;
				}
				options.onClose();
			};

			node.addEventListener('transitionend', close, { once: true });
			closeTimer = setTimeout(close, SETTLE_MS);
			return;
		}

		node.style.transition = 'transform 250ms cubic-bezier(0.32, 0.72, 0, 1)';
		transform(0);
		settleTimer = setTimeout(() => {
			resetStyles();
			transform(0);
		}, SETTLE_MS);
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		const wasClaimed = claimed;
		releasePointer();
		if (!wasClaimed) return;

		node.style.transition = 'transform 250ms cubic-bezier(0.32, 0.72, 0, 1)';
		transform(0);
		settleTimer = setTimeout(() => {
			resetStyles();
			transform(0);
		}, SETTLE_MS);
	}

	function onClick(event: MouseEvent) {
		if (performance.now() < suppressClickUntil) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	node.style.touchAction = options.axis === 'x' ? 'pan-y' : 'none';
	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', finish);
	node.addEventListener('pointercancel', onPointerCancel);
	node.addEventListener('click', onClick, true);

	return () => {
		releasePointer();
		if (settleTimer) clearTimeout(settleTimer);
		if (closeTimer) clearTimeout(closeTimer);
		node.removeEventListener('pointerdown', onPointerDown);
		node.removeEventListener('pointermove', onPointerMove);
		node.removeEventListener('pointerup', finish);
		node.removeEventListener('pointercancel', onPointerCancel);
		node.removeEventListener('click', onClick, true);
		node.style.touchAction = '';
		resetStyles();
	};
}
