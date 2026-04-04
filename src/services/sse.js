/**
 * SSE (Server-Sent Events) service for real-time calendar updates.
 * 
 * Manages connections per business_id. When a booking is created, moved,
 * deleted, or status-changed, we broadcast to all connected clients
 * of that business so their calendar refreshes instantly.
 */

// Map<businessId, Set<response>>
const connections = new Map();

// Connection limits to prevent DoS
const MAX_PER_BUSINESS = 50;
const MAX_GLOBAL = 500;
let globalCount = 0;

/**
 * Register a new SSE client connection
 * Returns false if limits exceeded
 */
function addClient(businessId, res) {
  // Global limit
  if (globalCount >= MAX_GLOBAL) {
    return false;
  }

  if (!connections.has(businessId)) {
    connections.set(businessId, new Set());
  }

  // Per-business limit
  const clients = connections.get(businessId);
  if (clients.size >= MAX_PER_BUSINESS) {
    return false;
  }

  clients.add(res);
  globalCount++;

  // Cleanup on disconnect
  res.on('close', () => {
    const clients = connections.get(businessId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) connections.delete(businessId);
    }
    globalCount = Math.max(0, globalCount - 1);
  });

  return true;
}

/**
 * Broadcast an event to all clients of a business
 * @param {string} businessId
 * @param {string} event - event name (e.g. 'booking_update')
 * @param {object} data - payload
 */
function broadcast(businessId, event, data = {}) {
  const clients = connections.get(businessId);
  if (!clients || clients.size === 0) return;

  // M14: Sanitize event name — strip newlines to prevent SSE injection
  const safeEvent = String(event).replace(/[\r\n]/g, '');
  const payload = `event: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (e) {
      // Connection broken, remove it
      clients.delete(res);
      globalCount = Math.max(0, globalCount - 1);
    }
  }
}

/**
 * Get connected client count for a business (for monitoring)
 */
function clientCount(businessId) {
  return connections.get(businessId)?.size || 0;
}

module.exports = { addClient, broadcast, clientCount };
