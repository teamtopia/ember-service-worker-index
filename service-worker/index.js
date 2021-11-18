import {
  INDEX_HTML_PATH,
  ENVIRONMENT,
  VERSION,
  INDEX_EXCLUDE_SCOPE,
  INDEX_INCLUDE_SCOPE,
  STRATEGY,
  TIMEOUT,
} from 'ember-service-worker-index/service-worker/config';

import {urlMatchesAnyPattern} from 'ember-service-worker/service-worker/url-utils';
import cleanupCaches from 'ember-service-worker/service-worker/cleanup-caches';

const CACHE_KEY_PREFIX = 'esw-index';
const CACHE_NAME = `${CACHE_KEY_PREFIX}-${VERSION}`;

// Capacitor expects the index request to come from the origin URL with
// no additions to the path. The following would obviously be a breaking
// change and needs to be refactored before making a PR.
const INDEX_HTML_URL = new URL('', self.location.origin).toString();

self.addEventListener('install', event => {
  event.waitUntil(
    fetch(INDEX_HTML_URL, {credentials: 'include'}).then(response => {
      return caches
        .open(CACHE_NAME)
        .then(cache => cache.put(INDEX_HTML_URL, response));
    }),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(cleanupCaches(CACHE_KEY_PREFIX, CACHE_NAME));
});

self.addEventListener('fetch', event => {
  let request = event.request;
  let url = new URL(request.url);
  let isGETRequest = request.method === 'GET';
  let acceptHeader =
    request.headers !== null ? request.headers.get('accept') : null;
  let isHTMLRequest =
    acceptHeader !== null ? acceptHeader.indexOf('text/html') !== -1 : true;
  let isLocal = url.origin === location.origin;
  let scopeExcluded = urlMatchesAnyPattern(request.url, INDEX_EXCLUDE_SCOPE);
  let scopeIncluded =
    !INDEX_INCLUDE_SCOPE.length ||
    urlMatchesAnyPattern(request.url, INDEX_INCLUDE_SCOPE);
  let isTests = url.pathname === '/tests' && ENVIRONMENT === 'development';

  if (
    !isTests &&
    isGETRequest &&
    isHTMLRequest &&
    isLocal &&
    scopeIncluded &&
    !scopeExcluded
  ) {
    if (STRATEGY === 'fallback') {
      event.respondWith(cacheFallbackFetch());
    } else {
      return cacheFirstFetch(event);
    }
  }
});

function cacheFirstFetch(event) {
  return event.respondWith(
    caches.match(INDEX_HTML_URL, {cacheName: CACHE_NAME}).then(response => {
      if (response) {
        return response;
      }

      /**
          Re-fetch the resource in the event that the cache had been cleared
          (mostly an issue with Safari 11.1 where clearing the cache causes
          the browser to throw a non-descriptive blank error page).
        */
      return fetch(INDEX_HTML_URL, {credentials: 'include'}).then(
        fetchedResponse => {
          caches.open(CACHE_NAME).then(cache => {
            return cache.put(INDEX_HTML_URL, fetchedResponse);
          });
          return fetchedResponse.clone();
        },
      );
    }),
  );
}

function readFromCache() {
  console.log('ember-service-worker-index: readFromCache');
  return caches.match(INDEX_HTML_URL, {cacheName: CACHE_NAME});
}

async function cacheFallbackFetch() {
  console.log('ember-service-worker-index: cacheFallbackFetch');
  // Race a timeout and fetch request
  let timeoutPromise = new Promise(res =>
    setTimeout(() => res('timeout'), TIMEOUT),
  );

  // The default Accept header is often '*/*'. There are however some use cases
  // where a more strict header is required. Specifically Capacitor needs
  // the more specific header to know it is allowed to inject the native bridge
  // code for Android devices.
  // Perhaps this shold be made a configuration option?
  let fetchPromise = fetch(INDEX_HTML_URL, {
    credentials: 'include',
    headers: {Accept: 'text/html'},
  });

  try {
    let result = await Promise.race([timeoutPromise, fetchPromise]);

    // If the timeout won, fallback to the cache
    if (result === 'timeout') {
      console.log(
        'ember-service-worker-index: cacheFallbackFetch -- timed out',
      );
      let cacheValue = await readFromCache();

      // If the cache was empty, respond with the original fetchPromise
      if (cacheValue) {
        console.log(
          'ember-service-worker-index: cacheFallbackFetch -- returning cached value',
        );
        return cacheValue;
      } else {
        console.log(
          'ember-service-worker-index: cacheFallbackFetch -- returning original promise',
        );
        return fetchPromise;
      }
    }

    // Clean up timeout
    clearTimeout(timeoutPromise);

    // Update the cache
    console.log('ember-service-worker-index: update cache');
    let cache = await caches.open(CACHE_NAME);
    cache.put(INDEX_HTML_URL, result.clone());

    // Respond with result
    return result;
  } catch (e) {
    console.warn(
      'ember-service-worker-index: cacheFallbackFetch -- failed for:',
      e,
    );

    // if the promise rejects, fallback to the cache
    return readFromCache();
  }
}
