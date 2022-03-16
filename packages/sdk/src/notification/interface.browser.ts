// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The target type where the notification will be sent to.
 *
 * @remarks
 * Only work on server side.
 * - "Channel" means to a team channel. (By default, notification to a team will be sent to its "General" channel.)
 * - "Group" means to a group chat.
 * - "Person" means to a personal chat.
 *
 * @beta
 */
export type NotificationTargetType = "Channel" | "Group" | "Person";

/**
 * Represent a notification target.
 *
 * @remarks
 * Only work on server side.
 *
 * @beta
 */
export interface NotificationTarget {
  /**
   * The type of target, could be "Channel" or "Group" or "Person".
   *
   * @remarks
   * Only work on server side.
   *
   * @beta
   */
  readonly type?: NotificationTargetType;

  /**
   * Send a plain text message.
   *
   * @remarks
   * Only work on server side.
   *
   * @param text - the plain text message.
   *
   * @beta
   */
  sendMessage(text: string): Promise<void>;

  /**
   * Send an adaptive card message.
   *
   * @remarks
   * Only work on server side.
   *
   * @param card - the adaptive card raw JSON.
   *
   * @beta
   */
  sendAdaptiveCard(card: unknown): Promise<void>;
}
