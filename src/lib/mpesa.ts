// CARMAZE: Safaricom Daraja (M-Pesa) server-side integration.
//
// STATUS: Integration interface is fully implemented. Live/sandbox calls
// require credentials that are NOT configured on this deployment:
//   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE (or MPESA_BUSINESS_SHORTCODE),
//   MPESA_PASSKEY, MPESA_ENV (sandbox|production), MPESA_CALLBACK_URL, optional MPESA_BASE_URL.
// Without credentials every attempt fails honestly with MPESA_NOT_CONFIGURED:
// we never simulate a successful payment.

export type MpesaConfig = {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  shortcode: string
  passkey: string
  callbackUrl: string
}

export class MpesaNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`M-Pesa Daraja is not configured on this deployment. Missing environment variables: ${missing.join(', ')}`)
    this.name = 'MpesaNotConfiguredError'
  }
}

export function getMpesaConfig(): MpesaConfig {
  const required = {
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
    MPESA_PASSKEY: process.env.MPESA_PASSKEY,
    MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL,
  }
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0) throw new MpesaNotConfiguredError(missing)
  const env = (process.env.MPESA_ENV || 'sandbox').toLowerCase()
  const baseUrl = process.env.MPESA_BASE_URL || (env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke')
  return {
    baseUrl,
    consumerKey: required.MPESA_CONSUMER_KEY!,
    consumerSecret: required.MPESA_CONSUMER_SECRET!,
    shortcode: required.MPESA_SHORTCODE!,
    passkey: required.MPESA_PASSKEY!,
    callbackUrl: required.MPESA_CALLBACK_URL!,
  }
}

export function mpesaConfigured(): boolean {
  try {
    getMpesaConfig()
    return true
  } catch {
    return false
  }
}

/** Names of the missing base STK variables (for health checks / errors). */
export function mpesaMissingVars(): string[] {
  const required = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL']
  return required.filter((k) => !process.env[k])
}

/** Names of the missing B2C payout variables. */
export function mpesaB2cMissingVars(): string[] {
  const required = ['MPESA_INITIATOR_NAME', 'MPESA_SECURITY_CREDENTIAL', 'MPESA_B2C_RESULT_URL']
  return required.filter((k) => !process.env[k]).concat(mpesaMissingVars())
}

export function mpesaB2cConfigured(): boolean {
  return mpesaB2cMissingVars().length === 0
}

async function getAccessToken(cfg: MpesaConfig): Promise<string> {
  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64')
  const res = await fetch(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) throw new Error(`Daraja auth failed (${res.status})`)
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export type StkPushResult = {
  merchantRequestId: string
  checkoutRequestId: string
  customerMessage: string
}

/** Initiate STK push (Lipa na M-Pesa Online). Amount in minor units. */
export async function stkPush(params: { phone: string; amountMinor: number; accountReference: string; description: string }): Promise<StkPushResult> {
  const cfg = getMpesaConfig()
  const token = await getAccessToken(cfg)
  const amount = Math.max(1, Math.round(params.amountMinor / 100))
  const phone = params.phone.replace(/[^0-9]/g, '').replace(/^0/, '254')
  const ts = timestamp()
  const password = Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString('base64')
  const res = await fetch(`${cfg.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: cfg.shortcode,
      PhoneNumber: phone,
      CallBackURL: cfg.callbackUrl,
      AccountReference: params.accountReference.slice(0, 12),
      TransactionDesc: params.description.slice(0, 40),
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(`Daraja STK push rejected: ${String(data.errorMessage ?? data.ResponseDescription ?? res.status)}`)
  }
  return {
    merchantRequestId: String(data.MerchantRequestID),
    checkoutRequestId: String(data.CheckoutRequestID),
    customerMessage: String(data.CustomerMessage ?? 'Check your phone to complete payment'),
  }
}

export type DarajaCallback = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string
      CheckoutRequestID?: string
      ResultCode?: number
      ResultDesc?: string
      CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] }
    }
  }
}

export function parseCallback(payload: DarajaCallback) {
  const cb = payload.Body?.stkCallback
  if (!cb?.CheckoutRequestID) return null
  const amount = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'Amount')?.Value
  const receipt = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: cb.MerchantRequestID ?? null,
    resultCode: cb.ResultCode ?? null,
    resultDesc: cb.ResultDesc ?? null,
    amount: typeof amount === 'number' ? amount : null,
    receipt: receipt ? String(receipt) : null,
  }
}

export type StkQueryResult = {
  resultCode: number | null
  resultDesc: string | null
  receipt: string | null
  amount: number | null
}

/**
 * Query the status of a previously initiated STK push (Daraja
 * /mpesa/stkpushquery/v2/query). Used by FINANCE for reconciliation when a
 * callback was missed: the provider's own answer is the only source of truth.
 */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  const cfg = getMpesaConfig()
  const token = await getAccessToken(cfg)
  const ts = timestamp()
  const password = Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString('base64')
  const res = await fetch(`${cfg.baseUrl}/mpesa/stkpushquery/v2/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Daraja query failed: ${String(data.errorMessage ?? data.ResponseDescription ?? res.status)}`)
  const items = (data.CallbackMetadata as { Item?: { Name: string; Value?: string | number }[] } | undefined)?.Item
  const receipt = items?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value
  const amount = items?.find((i) => i.Name === 'Amount')?.Value
  return {
    resultCode: typeof data.ResultCode === 'number' ? data.ResultCode : null,
    resultDesc: data.ResultDesc ? String(data.ResultDesc) : null,
    receipt: receipt != null ? String(receipt) : null,
    amount: typeof amount === 'number' ? amount : null,
  }
}

export type B2cPayoutResult = {
  conversationId: string
  originatorConversationId: string
  responseDescription: string
}

/**
 * Business-to-Customer (B2C) payout via Daraja /mpesa/b2c/v3/paymentrequest.
 * Used by the supplier settlement process to actually transfer owed money.
 *
 * REAL INTEGRATION: requires MPESA_INITIATOR_NAME, MPESA_SECURITY_CREDENTIAL
 * (the initiator password encrypted with the Daraja public certificate),
 * MPESA_B2C_RESULT_URL plus the base STK credential set. Without them this
 * throws and callers must keep the settlement in PENDING — a payout is never
 * recorded as settled from this call alone; final confirmation arrives on the
 * B2C Result URL callback.
 */
export async function b2cPayout(params: {
  phone: string
  amountMinor: number
  remarks: string
  originatorConversationId: string
}): Promise<B2cPayoutResult> {
  const missing = mpesaB2cMissingVars()
  if (missing.length > 0) throw new MpesaNotConfiguredError(missing)
  const cfg = getMpesaConfig()
  const token = await getAccessToken(cfg)
  const amount = Math.max(1, Math.round(params.amountMinor / 100))
  const phone = params.phone.replace(/[^0-9]/g, '').replace(/^0/, '254')
  const res = await fetch(`${cfg.baseUrl}/mpesa/b2c/v3/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      OriginatorConversationID: params.originatorConversationId,
      InitiatorName: process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID: 'BusinessPayment',
      Amount: amount,
      PartyA: phone,
      PartyB: cfg.shortcode,
      Remarks: params.remarks.slice(0, 100),
      QueueTimeOutURL: process.env.MPESA_B2C_RESULT_URL,
      ResultURL: process.env.MPESA_B2C_RESULT_URL,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(`Daraja B2C rejected: ${String(data.errorMessage ?? data.ResponseDescription ?? res.status)}`)
  }
  return {
    conversationId: String(data.ConversationID ?? ''),
    originatorConversationId: String(data.OriginatorConversationID ?? params.originatorConversationId),
    responseDescription: String(data.ResponseDescription ?? 'Accepted'),
  }
}

export type B2cResultCallback = {
  Result?: {
    ConversationID?: string
    OriginatorConversationID?: string
    ResultType?: number
    ResultCode?: number
    ResultDesc?: string
    TransactionID?: string
    TransactionAmount?: number
  }
}

export function parseB2cResult(payload: B2cResultCallback) {
  const r = payload.Result
  if (!r) return null
  return {
    conversationId: r.ConversationID ?? null,
    originatorConversationId: r.OriginatorConversationID ?? null,
    resultCode: typeof r.ResultCode === 'number' ? r.ResultCode : null,
    resultDesc: r.ResultDesc ?? null,
    transactionId: r.TransactionID ?? null,
    amount: typeof r.TransactionAmount === 'number' ? r.TransactionAmount : null,
  }
}
