/**
 * SSE (Server-Sent Events) service for real-time calendar updates.
 * 
 * Manages connections per business_id. When a booking is created, moved,
 * deleted, or status-changed, we broadcast to all connected clients
 * of that business so their calendar refreshes instantly.
 */

// Map<businessId, Set<response>>
const connections = new Map();

/**
 * Register a new SSE client connection
 */
function addClient(businessId, res) {
  if (!connections.has(businessId)) {
    connections.set(businessId, new Set());
  }
  connections.get(businessId).add(res);

  // Cleanup on disconnect
  res.on('close', () => {
    const clients = connections.get(businessId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) connections.delete(businessId);
    }
  });
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

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (e) {
      // Connection broken, remove it
      clients.delete(res);
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
