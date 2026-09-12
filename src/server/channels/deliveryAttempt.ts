import type {
  ChannelAccepted,
  ChannelRejected,
  ChannelUnknown,
  DeliveryKind,
  OutboundChannelAdapter,
} from "./contracts";

export type DeliveryAttemptResult =
  | { status: "NOT_CLAIMED"; idempotencyKey: string }
  | { status: "ACCEPTED"; idempotencyKey: string; result: ChannelAccepted }
  | { status: "REJECTED"; idempotencyKey: string; result: ChannelRejected }
  | { status: "UNKNOWN"; idempotencyKey: string; result: ChannelUnknown };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Общая граница необратимого внешнего эффекта для любого канала.
 *
 * Конкретные Prisma-операции передаются callbacks: coordinator не знает ни о
 * Message, ни о ReplyMessage, ни о Telegram. Главное правило общее — после
 * успешного claim любой недоказанный исход остаётся UNKNOWN/SENDING и не
 * возвращается в очередь автоматически.
 */
export async function executeClaimedDelivery<TSender, TPayload>(input: {
  adapter: OutboundChannelAdapter<TSender, TPayload>;
  deliveryId: string;
  kind: DeliveryKind;
  sender: TSender;
  payload: TPayload;
  claim: (idempotencyKey: string) => Promise<boolean>;
  onAccepted: (result: ChannelAccepted) => Promise<void>;
  onRejected: (result: ChannelRejected) => Promise<void>;
  onUnknown: (result: ChannelUnknown) => Promise<void>;
}): Promise<DeliveryAttemptResult> {
  const idempotencyKey = input.adapter.idempotencyKey({
    deliveryId: input.deliveryId,
    kind: input.kind,
    sender: input.sender,
  });
  if (!(await input.claim(idempotencyKey))) {
    return { status: "NOT_CLAIMED", idempotencyKey };
  }

  let result;
  try {
    result = await input.adapter.deliver({
      idempotencyKey,
      sender: input.sender,
      payload: input.payload,
    });
  } catch (error) {
    result = {
      outcome: "UNKNOWN" as const,
      reason: errorText(error).slice(0, 1_000),
      failureKind: "INTERNAL" as const,
    };
  }

  if (result.outcome === "ACCEPTED") {
    await input.onAccepted(result);
    return { status: "ACCEPTED", idempotencyKey, result };
  }
  if (result.outcome === "REJECTED") {
    await input.onRejected(result);
    return { status: "REJECTED", idempotencyKey, result };
  }
  await input.onUnknown(result);
  return { status: "UNKNOWN", idempotencyKey, result };
}
