import type { OutreachChannel } from "@prisma/client";

export type DeliveryKind = "CAMPAIGN" | "FOLLOW_UP" | "REPLY" | "AUTO_PING";

export type ChannelCapabilities = {
  subjects: boolean;
  html: boolean;
  nativeThreading: boolean;
  deliveryReceipts: boolean;
  inboundPolling: boolean;
};

/**
 * Репутация и ёмкость намеренно принадлежат каналу. Email ограничивает ящик и
 * домен и требует ramp; Telegram будет оперировать аккаунтом, peer/flood wait
 * и своими правилами поведения. Campaign core видит только этот контракт.
 */
export type ChannelOperationalPolicy = {
  channel: OutreachChannel;
  recipientIdentity: "EMAIL_ADDRESS" | "TELEGRAM_PEER";
  senderIdentity: "MAILBOX" | "TELEGRAM_ACCOUNT";
  reputationScope: readonly string[];
  warmupStrategy: "MAILBOX_RAMP" | "CHANNEL_NATIVE";
  conversationAffinity: "SENDER_PER_CAMPAIGN_RECIPIENT" | "SENDER_PER_PEER";
  capabilities: ChannelCapabilities;
};

export type ChannelAccepted = {
  outcome: "ACCEPTED";
  providerDeliveryId: string;
};

export type ChannelRejected = {
  outcome: "REJECTED";
  reason: string;
  failureKind: "AUTH" | "RECIPIENT" | "POLICY" | "CONFIGURATION";
};

export type ChannelUnknown = {
  outcome: "UNKNOWN";
  reason: string;
  failureKind: "NETWORK" | "PROVIDER" | "INTERNAL";
};

export type ChannelDeliveryResult =
  | ChannelAccepted
  | ChannelRejected
  | ChannelUnknown;

export interface OutboundChannelAdapter<TSender, TPayload> {
  readonly channel: OutreachChannel;
  readonly policy: ChannelOperationalPolicy;
  idempotencyKey(input: {
    deliveryId: string;
    kind: DeliveryKind;
    sender: TSender;
  }): string;
  deliver(input: {
    idempotencyKey: string;
    sender: TSender;
    payload: TPayload;
  }): Promise<ChannelDeliveryResult>;
}
