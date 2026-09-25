export async function completeOlderOrders(endpoint, headers, request = fetch) {
    const response = await request(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not complete older orders.');
    return result.count;
}
