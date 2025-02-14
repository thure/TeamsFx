<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@microsoft/teamsfx](./teamsfx.md) &gt; [TeamsUserCredential](./teamsfx.teamsusercredential.md)

## TeamsUserCredential class

> This API is provided as a preview for developers and may change based on feedback that we receive. Do not use this API in a production environment.
> 

Represent Teams current user's identity, and it is used within Teams client applications.

<b>Signature:</b>

```typescript
export declare class TeamsUserCredential implements TokenCredential 
```
<b>Implements:</b> TokenCredential

## Remarks

Can only be used within Teams.

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)(authConfig)](./teamsfx.teamsusercredential._constructor_.md) |  | <b><i>(BETA)</i></b> Constructor of TeamsUserCredential. |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [getToken(scopes, options)](./teamsfx.teamsusercredential.gettoken.md) |  | <b><i>(BETA)</i></b> Get access token from credential. |
|  [getUserInfo()](./teamsfx.teamsusercredential.getuserinfo.md) |  | <b><i>(BETA)</i></b> Get basic user info from SSO token |
|  [login(scopes)](./teamsfx.teamsusercredential.login.md) |  | <b><i>(BETA)</i></b> Popup login page to get user's access token with specific scopes. |

