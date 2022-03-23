<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@microsoft/teamsfx](./teamsfx.md) &gt; [ConversationBot](./teamsfx.conversationbot.md) &gt; [installations](./teamsfx.conversationbot.installations.md)

## ConversationBot.installations() method

> This API is provided as a preview for developers and may change based on feedback that we receive. Do not use this API in a production environment.
> 

Get all targets where the bot is installed.

<b>Signature:</b>

```typescript
static installations(): Promise<TeamsBotInstallation[]>;
```
<b>Returns:</b>

Promise&lt;[TeamsBotInstallation](./teamsfx.teamsbotinstallation.md)<!-- -->\[\]&gt;

- an array of [TeamsBotInstallation](./teamsfx.teamsbotinstallation.md)<!-- -->.

## Remarks

The result is retrieving from the persisted storage.
