export async function registerSW() {
  if (!navigator.serviceWorker) {
    if (location.protocol !== 'https:')
      throw new Error('Service workers cannot be registered without https.');
    throw new Error("Your browser doesn't support service workers.");
  }

  await navigator.serviceWorker.register('/uv/sw.js', {
    scope: '/uv/service/',
  });
}
