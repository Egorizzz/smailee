import type { OutreachChannel } from "@prisma/client";
import { emailOutboundChannel } from "./email";

/**
 * Реестр поддерживаемых delivery runtime. TELEGRAM уже существует в доменной
 * модели, но намеренно не регистрируется до появления реального адаптера,
 * sender-account repository и проверенных channel policy.
 */
export const campaignChannelRegistry = {
  EMAIL: emailOutboundChannel,
} as const;

export const readyCampaignChannels = Object.keys(
  campaignChannelRegistry,
) as Array<keyof typeof campaignChannelRegistry>;

export function getCampaignChannelRuntime(channel: OutreachChannel) {
  return isCampaignChannelReady(channel)
    ? campaignChannelRegistry[channel]
    : null;
}

export function isCampaignChannelReady(
  channel: OutreachChannel,
): channel is keyof typeof campaignChannelRegistry {
  return channel in campaignChannelRegistry;
}
