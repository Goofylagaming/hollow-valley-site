(() => {
  const hds = window.HDS;
  if (!hds || typeof hds.api !== 'function') return;

  const originalApi = hds.api.bind(hds);
  const terminal = new Set(['accepted', 'failed', 'unknown']);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isDinoStorageWrite(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'POST') return false;
    return path === '/api/mydinos/park-active' ||
      /^\/api\/mydinos\/stored\/[^/]+\/redeem$/.test(String(path || ''));
  }

  function requestIdFrom(response) {
    return response?.result?.requestId || response?.request?.id || response?.requestId || null;
  }

  async function pollRequest(response) {
    const requestId = requestIdFrom(response);
    if (!requestId) return response;

    const deadline = Date.now() + 45000;
    let latest = null;

    while (Date.now() <= deadline) {
      try {
        const payload = await originalApi(`/api/mydinos/requests/${encodeURIComponent(requestId)}`);
        latest = payload?.request || null;
      } catch (error) {
        return {
          ...response,
          requestId,
          requestStatus: 'status_error',
          message: `Request ${requestId} was accepted, but its status could not be checked: ${error.message}. Do not retry automatically.`,
        };
      }

      if (latest && terminal.has(latest.status)) break;
      await sleep(1000);
    }

    if (!latest) {
      return {
        ...response,
        requestId,
        requestStatus: 'pending',
        message: `Request ${requestId} was accepted and is still processing. Do not retry automatically.`,
      };
    }

    return {
      ...response,
      requestId,
      requestStatus: latest.status,
      request: latest,
      message: latest.error || latest.message || `Request ${requestId} is ${latest.status}.`,
    };
  }

  hds.api = async function myDinosAutomationApi(path, options = {}) {
    const response = await originalApi(path, options);
    if (!isDinoStorageWrite(path, options)) return response;
    return pollRequest(response);
  };
})();
