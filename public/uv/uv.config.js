/*global Ultraviolet*/
self.__uv$config = {
    prefix: '/uv/service/',
    bare: '/bare/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/uv-dist/uv.handler.js',
    client: '/uv-dist/uv.client.js',
    bundle: '/uv-dist/uv.bundle.js',
    config: '/uv/uv.config.js',
    sw: '/uv-dist/uv.sw.js',
    construct: (uv, type) => {
        const originalRewrite = uv.html.rewrite.bind(uv.html);
        uv.html.rewrite = function(html, options) {
            let rewritten = originalRewrite(html, options);
            if (options && options.document) {
                const injectHtml = `<style>
                    img, video, audio, picture, source, svg, canvas, object, embed, iframe[src*="youtube"], iframe[src*="vimeo"] {
                        display: none !important;
                        visibility: hidden !important;
                        opacity: 0 !important;
                        width: 0 !important;
                        height: 0 !important;
                    }
                    * {
                        background-image: none !important;
                    }
                </style>
                <script>
                    // Prevent dynamic image/video creation
                    const blockMedia = () => {
                        document.querySelectorAll('img, video, audio, picture, source, svg, canvas, object, embed').forEach(el => el.remove());
                        document.querySelectorAll('a[target="_blank"]').forEach(el => el.removeAttribute('target'));
                    };
                    const observer = new MutationObserver(blockMedia);
                    window.addEventListener('DOMContentLoaded', () => {
                        blockMedia();
                        observer.observe(document.body, { childList: true, subtree: true });
                    });
                </script>`;
                
                // Inject after <head> or before </body>
                const headIndex = rewritten.indexOf('<head>');
                if (headIndex !== -1) {
                    rewritten = rewritten.slice(0, headIndex + 6) + injectHtml + rewritten.slice(headIndex + 6);
                } else {
                    const htmlIndex = rewritten.indexOf('<html');
                    if (htmlIndex !== -1) {
                        const endHtmlIndex = rewritten.indexOf('>', htmlIndex);
                        if (endHtmlIndex !== -1) {
                            rewritten = rewritten.slice(0, endHtmlIndex + 1) + '<head>' + injectHtml + '</head>' + rewritten.slice(endHtmlIndex + 1);
                        }
                    }
                }
            }
            return rewritten;
        };
    }
};
