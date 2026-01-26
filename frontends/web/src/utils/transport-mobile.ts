// SPDX-License-Identifier: Apache-2.0

import { TMsgCallback, TPayload, TQueryPromiseMap } from './transport-common';
import { runningInAndroid, runningInIOS, runningOnMobile } from './env';

let queryID: number = 0;
const queryPromises: TQueryPromiseMap = {};
const currentListeners: TMsgCallback[] = [];
const debugEndpoints = new Set(['accounts', 'devices/registered', 'keystores']);
const debugSubjects = new Set(['accounts', 'devices/registered', 'keystores', 'bluetooth/state']);
const debugCalls: Record<number, { endpoint: string; method: string; started: number }> = {};

const debugLog = (message: string) => {
  if (runningInIOS()) {
    console.log(`[iOSDebug] ${message}`);
  }
};

export const mobileCall = (query: string): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    if (runningOnMobile()) {
      if (typeof window.onMobileCallResponse === 'undefined') {
        window.onMobileCallResponse = (
          queryID: number,
          response: unknown,
        ) => {
          const info = debugCalls[queryID];
          if (info) {
            const ms = Date.now() - info.started;
            debugLog(`response id=${queryID} ${info.method} ${info.endpoint} ${ms}ms`);
            delete debugCalls[queryID];
          }
          queryPromises[queryID]?.resolve(response);
          delete queryPromises[queryID];
        };
      }
      queryID++;
      queryPromises[queryID] = { resolve, reject };
      if (runningInIOS()) {
        try {
          const parsed = JSON.parse(query) as { endpoint?: string; method?: string };
          const endpoint = parsed.endpoint || '';
          const method = parsed.method || '';
          if (debugEndpoints.has(endpoint)) {
            debugCalls[queryID] = { endpoint, method, started: Date.now() };
            debugLog(`call id=${queryID} ${method} ${endpoint}`);
          }
        } catch (e) {
          // ignore JSON parse errors in debug logging
        }
      }
      if (runningInAndroid()) {
        window.android!.call(queryID, query);
      } else {
        // iOS
        window.webkit!.messageHandlers.goCall.postMessage({ queryID, query });
      }
    } else {
      reject();
    }
  });
};

export const mobileSubscribePushNotifications = (msgCallback: TMsgCallback) => {
  if (typeof window.onMobilePushNotification === 'undefined') {
    window.onMobilePushNotification = (msg: TPayload) => {
      if (runningInIOS() && msg && typeof msg === 'object' && 'subject' in msg) {
        const subject = String((msg as { subject?: string }).subject || '');
        if (debugSubjects.has(subject)) {
          const action = String((msg as { action?: string }).action || 'unknown');
          debugLog(`push subject=${subject} action=${action}`);
        }
      }
      currentListeners.forEach(listener => listener(msg));
    };
  }

  currentListeners.push(msgCallback);
  return () => {
    if (!currentListeners.includes(msgCallback)) {
      console.warn('!currentListeners.includes(msgCallback)');
    }
    const index = currentListeners.indexOf(msgCallback);
    currentListeners.splice(index, 1);
    if (currentListeners.includes(msgCallback)) {
      console.warn('currentListeners.includes(msgCallback)');
    }
  };
};

/**
 * triggers haptic feedback on iOS devices.
 * noop on other platforms.
 */
export const triggerHapticFeedback = () => {
  if (runningInIOS() && window.webkit?.messageHandlers.hapticFeedback) {
    window.webkit.messageHandlers.hapticFeedback.postMessage({});
  }
};
