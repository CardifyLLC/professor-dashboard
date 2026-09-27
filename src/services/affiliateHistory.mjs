export function mergeAffiliateHistory(liveOrders, archivedOrders) {
    const byId = new Map();
    for (const row of archivedOrders) {
        byId.set(row.order_id, {
            ...row,
            id: row.order_id,
            created_at: row.order_created_at,
            isArchived: true,
        });
    }
    // A live record takes precedence if it also exists in the archive.
    for (const row of liveOrders) byId.set(row.id, { ...row, isArchived: false });
    return [...byId.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
