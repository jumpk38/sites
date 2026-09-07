/* ダイスタンブラー — オフライン用サービスワーカー
   更新を確実に配りたいときは CACHE の版数を上げてください。 */
const CACHE = "dice-tumbler-v1";
const SHELL = "./index.html";
const ASSETS = [
  "./",
  SHELL,
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if(url.origin !== location.origin && !isFont) return;

  /* ページ本体：ネット優先（更新をすぐ拾う）＋2.5秒で諦めてキャッシュ */
  if(req.mode === "navigate"){
    e.respondWith((async () => {
      try{
        const res = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))
        ]);
        if(res && res.ok){
          const c = await caches.open(CACHE);
          c.put(SHELL, res.clone()).catch(() => {});
          c.put("./", res.clone()).catch(() => {});
        }
        return res;
      }catch(err){
        return (await caches.match(SHELL)) || Response.error();
      }
    })());
    return;
  }

  /* それ以外（アイコン・フォント）：キャッシュ優先 */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => Response.error()))
  );
});
