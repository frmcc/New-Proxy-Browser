export async function registerSW() {
  if (!navigator.serviceWorker) {
    if (location.protocol !== 'https:')
      throw new Error('Service workers cannot be registered without https.');
    throw new Error("Your browser doesn't support service workers.");
  }

  await navigator.serviceWorker.register('/uv/sw.js', {
    scope: '/uv/service/',
  });

  // Wait for any SW controlling this scope to be ready
  await navigator.serviceWorker.ready;
}
