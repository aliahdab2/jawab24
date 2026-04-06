/**
 * IndexNow utility — instantly notifies search engines (Bing, Yandex, etc.)
 * when URLs are published or updated.
 *
 * Usage:
 *   import { submitToIndexNow } from './utils/indexnow';
 *   await submitToIndexNow(['https://jawab24.com/en/blog/my-new-post']);
 *
 * Requires the key verification file to be deployed at:
 *   https://jawab24.com/<INDEXNOW_KEY>.txt
 */

const INDEXNOW_KEY = 'd073137a2fccfe02f0a8a88ec96e3400';
const INDEXNOW_HOST = 'jawab24.com';
const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;
const INDEXNOW_API = 'https://api.indexnow.org/indexnow';

export interface IndexNowResult {
  success: boolean;
  status: number;
  urlCount: number;
  message: string;
}

/**
 * Submit one or more URLs to IndexNow (Bing, Yandex, Seznam, Naver).
 * The API accepts up to 10 000 URLs per request.
 *
 * HTTP response codes from the API:
 *   200 — URL submitted successfully
 *   202 — URL received, will be processed later
 *   400 — Invalid request
 *   403 — Key not valid (key file not found or mismatch)
 *   422 — URLs don't belong to the host
 *   429 — Too many requests
 */
export async function submitToIndexNow(
  urls: string[],
): Promise<IndexNowResult> {
  if (urls.length === 0) {
    return { success: false, status: 0, urlCount: 0, message: 'No URLs provided' };
  }

  const body = {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: urls,
  };

  const response = await fetch(INDEXNOW_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  const status = response.status;
  const success = status === 200 || status === 202;

  let message: string;
  if (status === 200) message = 'URLs submitted successfully';
  else if (status === 202) message = 'URLs received, will be processed later';
  else if (status === 403) message = 'Key not valid — ensure the key file is deployed at the keyLocation URL';
  else if (status === 422) message = 'URLs don\'t belong to the host';
  else if (status === 429) message = 'Too many requests — try again later';
  else message = `Unexpected response: ${status} ${response.statusText}`;

  return { success, status, urlCount: urls.length, message };
}

export { INDEXNOW_KEY, INDEXNOW_HOST, INDEXNOW_KEY_LOCATION };
