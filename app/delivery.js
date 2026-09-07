/** 同じ回の再納品を、次の月の納品として数えない。 */
export function hasCurrentDelivery(job) {
  const round = Number(job.round || 1);
  return (job.deliveries || []).some((entry) => Number(entry.round) === round);
}

export function deliveryStatus(job) {
  const round = Number(job.round || 1);
  if (hasCurrentDelivery(job)) {
    return `第${round}ヶ月目 ${job.generation?.needs_redelivery ? '修正済み・再納品待ち' : '納品済み'}`;
  }
  return `第${round}ヶ月目 ${job.generation?.built_at ? '生成済み' : '作成中'}`;
}
