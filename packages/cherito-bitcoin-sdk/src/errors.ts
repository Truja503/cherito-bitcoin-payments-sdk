export type LightningErrorCode='NODE_OFFLINE'|'AUTHENTICATION_FAILED'|'TLS_ERROR'|'TLS_HOSTNAME_MISMATCH'|'INVALID_RESPONSE'|'TIMEOUT'|'CONFIGURATION_ERROR'|'PROVIDER_UNAVAILABLE'
export class LightningError extends Error{constructor(public readonly code:LightningErrorCode,message:string,options?:{cause?:unknown}){super(message,options);this.name='LightningError'}}
