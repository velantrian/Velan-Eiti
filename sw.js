// sw.js — Velan Eiti Service Worker v1.6.0
const CACHE_NAME = 'velan-eiti-v1.6.0';
const OFFLINE_URL = '/offline.html';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  OFFLINE_URL,
];

// ── Install: кэшируем статику ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: удаляем старые кэши ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-first для статики, Network-first для API ─────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API-запросы к внешним провайдерам — только через сеть
  const apiHosts = ['api.deepseek.com', 'api.anthropic.com', 'api.openai.com',
                    'api.groq.com', 'openrouter.ai'];
  if (apiHosts.some(h => url.hostname.includes(h))) {
    return; // не перехватываем
  }

  // Ollama localhost — прямой проход (офлайн-режим)
  if (url.hostname === 'localhost' && url.port === '11434') {
    return;
  }

  // Streamlit dev-сервер — network first
  if (url.hostname === 'localhost' && (url.port === '8501' || url.port === '8502')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Статика — cache first, fallback network
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') return caches.match(OFFLINE_URL);
      });
    })
  );
});

// ── Background Sync — агент уведомляет о завершении задачи ────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'agent-task-complete') {
    event.waitUntil(notifyAgentComplete());
  }
});

async function notifyAgentComplete() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'AGENT_COMPLETE' }));
}

// ── Push Notifications ────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || '⚡ Velan Eiti', {
      body: data.body || 'Агент завершил задачу',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      vibrate: [200, 100, 200],
      tag: 'agent-notification',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
