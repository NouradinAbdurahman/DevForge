// mapWithConcurrency(items, limit, fn) -> Promise<result[]>, preserving
// input order. Every registry-wide scan here (component status, doctor's
// diagnostics) shells out at least one live command per package - running
// 261 of them one at a time is the dominant cost measured in both
// callers; a small worker pool cuts that down without the resource
// contention a fully unbounded Promise.all over 261 concurrent child
// processes would risk.
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
