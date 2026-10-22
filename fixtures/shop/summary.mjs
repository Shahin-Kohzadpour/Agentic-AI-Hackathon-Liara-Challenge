export function summarizeOrder(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0 ||
      order.items.some(item => item == null || !Number.isSafeInteger(item.price) || item.price < 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        !Number.isSafeInteger(item.price * item.quantity))) {
    return { status: 400, body: { error: 'INVALID_ITEMS' } };
  }
  if (order.discounts !== undefined && (!Array.isArray(order.discounts) || order.discounts.some(value => !Number.isSafeInteger(value) || value < 0 || value > 50))) {
    return { status: 400, body: { error: 'INVALID_DISCOUNTS' } };
  }
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!Number.isSafeInteger(subtotal)) {
    return { status: 400, body: { error: 'INVALID_ITEMS' } };
  }
  const discount = order.discounts.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(discount)) {
    return { status: 400, body: { error: 'INVALID_DISCOUNTS' } };
  }
  return { status: 200, body: { subtotal, discount, total: Math.max(0, subtotal - discount) } };
}
