export interface LightningCapabilities{bolt11Receive:boolean;bolt12Receive:boolean;invoiceStreaming:boolean;provider:'lnd'|'lndk'|'cln'|'unknown'}
export interface PublicNodeInfo{alias?:string;identityPubkey?:string;network:'mainnet'|'testnet'|'signet'|'regtest';syncedToChain?:boolean;syncedToGraph?:boolean}
export type InvoiceState='pending'|'accepted'|'settled'|'expired'|'canceled'|'unknown'
export interface CreateInvoiceInput{orderId:string;amountSats:bigint;memo:string;expirySeconds:number}
export interface CreatedInvoice{providerInvoiceId:string;paymentHash:string;paymentRequest:string;amountSats:bigint;expiresAt:string;state:InvoiceState;providerAddIndex?:string;providerSettleIndex?:string}
export interface LightningInvoice extends CreatedInvoice{settledAt?:string;amountPaidSats?:bigint}
export interface CreateOfferInput{productId:string;amountSats:bigint;description:string;issuer?:string;expirySeconds?:number}
export interface CreatedOffer{offerId:string;offer:string;amountSats:bigint}
