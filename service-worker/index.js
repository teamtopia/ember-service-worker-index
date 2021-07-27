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

const INDEX_HTML_URL = new URL(INDEX_HTML_PATH, self.location).toString();

console.log(VERSION, 'what is self?', self);

self.addEventListener('install', event => {
  console.log(VERSION, 'self.addEventListener install', INDEX_HTML_URL);
  event.waitUntil(
    fetch(INDEX_HTML_URL, {credentials: 'include'}).then(response => {
      return caches
        .open(CACHE_NAME)
        .then(cache => cache.put(INDEX_HTML_URL, response));
    }),
  );
});

self.addEventListener('activate', event => {
  console.log(VERSION, 'self.addEventListener activate');
  event.waitUntil(cleanupCaches(CACHE_KEY_PREFIX, CACHE_NAME));
});

self.addEventListener('fetch', event => {
  console.log(VERSION, 'addEventListener fetch');
  let request = event.request;
  let url = new URL(request.url);
  console.log(VERSION, 'addEventListener fetch - URL', url.href);
  let isGETRequest = request.method === 'GET';
  let acceptHeader =
    request.headers !== null ? request.headers.get('accept') : null;
  console.log(VERSION, 'addEventListener fetch - accept header', acceptHeader);
  let isHTMLRequest =
    acceptHeader !== null ? acceptHeader.indexOf('text/html') !== -1 : true;
  let isLocal = url.origin === location.origin;
  let scopeExcluded = urlMatchesAnyPattern(request.url, INDEX_EXCLUDE_SCOPE);
  console.log(VERSION, 'addEventListener fetch - scopeExcluded', scopeExcluded);
  let scopeIncluded =
    !INDEX_INCLUDE_SCOPE.length ||
    urlMatchesAnyPattern(request.url, INDEX_INCLUDE_SCOPE);
  let isTests = url.pathname === '/tests' && ENVIRONMENT === 'development';

  console.log(
    VERSION,
    'addEventListener fetch conditions',
    '!isTests',
    !isTests,
    'isGETRequest',
    isGETRequest,
    'isHTMLRequest',
    isHTMLRequest,
    'isLocal',
    isLocal,
    'scopeIncluded',
    scopeIncluded,
    '!scopeExcluded',
    !scopeExcluded,
  );
  if (
    !isTests &&
    isGETRequest &&
    isHTMLRequest &&
    isLocal &&
    scopeIncluded &&
    !scopeExcluded
  ) {
    console.log(VERSION, 'addEventListener passed conditions');
    if (STRATEGY === 'fallback') {
      cacheFallbackFetch(event, TIMEOUT);
    } else {
      return cacheFirstFetch(event);
    }
  }
});

function cacheFirstFetch(event) {
  console.log(VERSION, 'cacheFirstFetch INDEX_HTML_URL', INDEX_HTML_URL);
  console.log(VERSION, 'cacheFirstFetch CACHE_NAME', CACHE_NAME);
  return event.respondWith(
    caches.match(INDEX_HTML_URL, {cacheName: CACHE_NAME}).then(response => {
      console.log(
        VERSION,
        'cacheFirstFetch -- looked up in cache and found:',
        response,
      );
      if (response) {
        console.log(VERSION, 'cacheFirstFetch hit');
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
            console.log(
              VERSION,
              '--------- cacheFirstFetch cache.put',
              INDEX_HTML_URL,
              fetchedResponse,
            );
            return cache.put(INDEX_HTML_URL, fetchedResponse);
          });
          return fetchedResponse.clone();
        },
      );
    }),
  );
}

function cacheFallbackFetch(event, fetchTimeout) {
  try {
    const FETCH_TIMEOUT = fetchTimeout;
    console.log(VERSION, 'cacheFallbackFetch timeout', FETCH_TIMEOUT);
    let didTimeOut = false;
    new Promise(function (_resolve, reject) {
      const timeout = setTimeout(function () {
        didTimeOut = true;
        reject(new Error('Request timed out'));
      }, FETCH_TIMEOUT);

      return fetch(INDEX_HTML_URL, {credentials: 'include'})
        .then(function (response) {
          /**
        Clear the timeout as cleanup
      */
          clearTimeout(timeout);
          console.log(VERSION, 'cacheFallbackFetch in fetch.then', response);
          if (!didTimeOut) {
            console.log(VERSION, '-------- inserting into cache', CACHE_NAME);
            caches
              .open(CACHE_NAME)
              .then(cache => cache.put(INDEX_HTML_URL, response));
            return response.clone();
          }
        })
        .catch(function (err) {
          console.log(VERSION, 'cacheFallbackFetch first catch', e);
          reject(err);
        });
    }).catch(function (err) {
      console.log(VERSION, 'cacheFallbackFetch final catch');
      return cacheFirstFetch(event);
    });
  } catch (e) {
    console.log(VERSION, 'cacheFallbackFetch error:', e);
    throw e;
  }
}
