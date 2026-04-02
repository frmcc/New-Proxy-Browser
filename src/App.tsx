/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Search, ArrowLeft, ArrowRight, RotateCw, Home } from 'lucide-react';

declare global {
  interface Window {
    __uv$config: {
      prefix: string;
      encodeUrl: (url: string) => string;
    };
  }
}

export default function App() {
  const [url, setUrl] = useState('');
  const [iframeSrc, setIframeSrc] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let targetUrl = url.trim();
    if (!targetUrl) return;

    if (!/^https?:\/\//i.test(targetUrl)) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = 'https://' + targetUrl;
      } else {
        targetUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(targetUrl);
      }
    }

    if (window.__uv$config) {
      const encoded = window.__uv$config.encodeUrl(targetUrl);
      setIframeSrc(window.__uv$config.prefix + encoded);
    } else {
      alert('Ultraviolet is not initialized yet.');
    }
  };

  const goBack = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.history.back();
    }
  };

  const goForward = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.history.forward();
    }
  };

  const reload = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.location.reload();
    }
  };

  const goHome = () => {
    setIframeSrc('');
    setUrl('');
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Browser Chrome */}
      <div className="flex items-center p-2 bg-white border-b border-gray-300 shadow-sm gap-2">
        <div className="flex items-center gap-1">
          <button onClick={goBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600" title="Back">
            <ArrowLeft size={18} />
          </button>
          <button onClick={goForward} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600" title="Forward">
            <ArrowRight size={18} />
          </button>
          <button onClick={reload} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600" title="Reload">
            <RotateCw size={18} />
          </button>
          <button onClick={goHome} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600" title="Home">
            <Home size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex items-center bg-gray-100 rounded-full px-4 py-1.5 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white transition-all">
          <Search size={16} className="text-gray-400 mr-2" />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Search or enter website name"
            className="flex-1 bg-transparent border-none outline-none text-sm text-gray-800"
          />
        </form>
      </div>

      {/* Browser Content */}
      <div className="flex-1 bg-white relative">
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="w-full h-full border-none"
            title="Focus Browser View"
            sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <h1 className="text-4xl font-light mb-4 text-gray-800">Focus Browser</h1>
            <p className="text-lg mb-8">Browse the web without visual distractions.</p>
            <div className="max-w-md w-full px-6">
              <form onSubmit={handleSubmit} className="flex items-center bg-white border border-gray-300 rounded-full px-4 py-3 shadow-sm hover:shadow-md transition-shadow focus-within:shadow-md focus-within:border-blue-400">
                <Search size={20} className="text-gray-400 mr-3" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Search the web..."
                  className="flex-1 bg-transparent border-none outline-none text-base text-gray-800"
                />
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
