// حالة مشتركة بين الوحدات — جلسات الانتظار
module.exports = {
  pendingBroadcast: new Map(), // userId -> { step, text }
  pendingRestore:   new Map(), // userId -> true
};
