import type { Mailbox } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { classifyDeliveryIssue } from "@/lib/mail/deliverySignals";
import { sendViaMailbox, stableOutboundMessageId } from "@/lib/mail/transport";
import type {
  ChannelOperationalPolicy,
  OutboundChannelAdapter,
} from "./contracts";

export type EmailDeliveryPayload = {
  to: string;
  toName?: string | null;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
};

export const EMAIL_CHANNEL_POLICY: ChannelOperationalPolicy = {
  channel: "EMAIL",
  recipientIdentity: "EMAIL_ADDRESS",
  senderIdentity: "MAILBOX",
  reputationScope: ["mailbox", "domain"],
  warmupStrategy: "MAILBOX_RAMP",
  conversationAffinity: "SENDER_PER_CAMPAIGN_RECIPIENT",
  capabilities: {
    subjects: true,
    html: true,
    nativeThreading: true,
    deliveryReceipts: true,
    inboundPolling: true,
  },
};

/** Email transport adapter. Все SMTP-детали заканчиваются в этом файле. */
export const emailOutboundChannel: OutboundChannelAdapter<
  Mailbox,
  EmailDeliveryPayload
> = {
  channel: "EMAIL",
  policy: EMAIL_CHANNEL_POLICY,
  idempotencyKey({ deliveryId, kind, sender }) {
    return stableOutboundMessageId(
      kind === "CAMPAIGN" || kind === "FOLLOW_UP" ? "campaign" : "reply",
      deliveryId,
      sender.email,
    );
  },
  async deliver({ idempotencyKey, sender, payload }) {
    const result = await sendViaMailbox(
      sender,
      decryptSecret(sender.smtpPasswordEnc),
      { ...payload, messageId: idempotencyKey },
    );
    if (result.ok) {
      return {
        outcome: "ACCEPTED",
        providerDeliveryId: result.messageId,
        evidence: {
          response: result.response,
          accepted: result.accepted,
          rejected: result.rejected,
        },
      };
    }
    if (result.kind === "auth") {
      return {
        outcome: "REJECTED",
        reason: result.error,
        failureKind: "AUTH",
        evidence: {
          responseCode: result.responseCode,
          response: result.response,
          command: result.command,
        },
      };
    }
    if (
      result.responseCode &&
      result.responseCode >= 400 &&
      result.responseCode < 600
    ) {
      const issue = classifyDeliveryIssue(result.error);
      return {
        outcome: "REJECTED",
        reason: result.error,
        failureKind:
          issue === "SPAM_REJECTED"
            ? "POLICY"
            : issue === "INVALID_RECIPIENT"
              ? "RECIPIENT"
              : "CONFIGURATION",
        evidence: {
          responseCode: result.responseCode,
          response: result.response,
          command: result.command,
        },
      };
    }
    // По тексту ошибки Nodemailer нельзя доказать, произошла ли она до или
    // после SMTP DATA. Консервативно оставляем попытку на сверку.
    return {
      outcome: "UNKNOWN",
      reason: result.error,
      failureKind: result.kind === "network" ? "NETWORK" : "PROVIDER",
      evidence: {
        responseCode: result.responseCode,
        response: result.response,
        command: result.command,
      },
    };
  },
};
