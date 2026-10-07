export function emptyIntegrationMetrics() {
  return Object.fromEntries(['api', 'widget', 'unknown'].map(source => [source, { carts: 0, converted: 0, productionOrders: 0 }]));
}

export function integrationUsage(integrations) {
  if (!integrations) return { kind: 'unavailable', label: 'Source unavailable' };
  const used = source => (integrations[source]?.carts || 0) + (integrations[source]?.productionOrders || 0) > 0;
  if (used('api') && used('widget')) return { kind: 'both', label: 'Both' };
  if (used('api')) return { kind: 'api', label: 'API' };
  if (used('widget')) return { kind: 'widget', label: 'Widget' };
  if (used('unknown')) return { kind: 'unknown', label: 'Unknown' };
  return { kind: 'none', label: 'No activity' };
}

export function partnerActivity(analytics, partnerId, blankActivity) {
  if (!analytics) return null;
  return analytics.partners[partnerId] || { ...blankActivity, integrations: analytics.total.integrations ? emptyIntegrationMetrics() : undefined };
}
