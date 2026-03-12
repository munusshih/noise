export function initOverlayPanels(): void {
    const overlays = Array.from(document.querySelectorAll<HTMLElement>('.overlay-panel'));
    if (overlays.length === 0) return;

    const setOpen = (targetId: string | null): void => {
        const isOpen = targetId !== null;
        document.body.classList.toggle('overlay-open', isOpen);

        for (const overlay of overlays) {
            const active = overlay.id === targetId;
            overlay.classList.toggle('is-open', active);
            overlay.setAttribute('aria-hidden', String(!active));
        }
    };

    const openButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-open]'));
    for (const button of openButtons) {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-overlay-open');
            if (!targetId) return;
            setOpen(targetId);
        });
    }

    const closeButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-close]'));
    for (const button of closeButtons) {
        button.addEventListener('click', () => setOpen(null));
    }

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') setOpen(null);
    });
}
