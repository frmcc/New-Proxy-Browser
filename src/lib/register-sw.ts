export async function registerSW() {
  if (!navigator.serviceWorker) {
    if (location.protocol !== 'https:')
      throw new Error('Service workers cannot be registered without https.');
    throw new Error("Your browser doesn't support service workers.");
  }

  const reg = await navigator.serviceWorker.register('/uv/sw.js', {
    scope: '/uv/service/',
  });

  // Wait for the service worker to become active before allowing navigation
  if (reg.installing || reg.waiting) {
    const sw = reg.installing || reg.waiting!;
    await new Promise<void>((resolve) => {
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') resolve();
      });
    });
  }

  await navigator.serviceWorker.ready;
}
