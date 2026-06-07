/**
 * 腾讯云实时语音识别 (v2) 签名
 *
 * 官方文档: https://cloud.tencent.com/document/api/1093/48982
 *
 * 签名规则:
 *   1. 对除 signature 之外的所有参数按字典序排序
 *   2. 拼接 asr.cloud.tencent.com/asr/v2/<appid>?<queryString> 作为签名原文
 *   3. 使用 SecretKey 进行 HMAC-SHA1 加密
 *   4. 对结果进行 Base64 编码
 *   5. URL 编码后作为 signature 参数附加
 */
import crypto from 'node:crypto';
import log from 'electron-log/main';

export interface SignedUrlParams {
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType: string; // 引擎模型类型 (16k_zh / 16k_zh_en / 16k_zh-PY 等)
  voiceId: string;
  voiceFormat?: number; // 默认 1 = pcm
  sampleRate?: number; // 默认 16000
  needvad?: number; // 0 / 1
  timestamp?: number; // 秒
  expire?: number; // 秒，默认 5 分钟
  nonce?: number; // 随机正整数，最长10位
}

export function signTencentASR(params: SignedUrlParams): string {
  const {
    appId,
    secretId,
    secretKey,
    engineModelType,
    voiceId,
    voiceFormat = 1,
    sampleRate = 16000,
    needvad = 1,
    timestamp = Math.floor(Date.now() / 1000),
    expire = 300,
    nonce = Math.floor(Math.random() * 1000000000),
  } = params;

  const host = 'asr.cloud.tencent.com';
  const path = `/asr/v2/${appId}`;

  // 全部参数
  const queryParams: Record<string, string> = {
    engine_model_type: engineModelType,
    voice_format: String(voiceFormat),
    sample_rate: String(sampleRate),
    voice_id: voiceId,
    secretid: secretId,
    timestamp: String(timestamp),
    expired: String(timestamp + expire),
    nonce: String(nonce),
    needvad: String(needvad),
  };

  // 排序
  const sortedKeys = Object.keys(queryParams).sort();
  const queryString = sortedKeys
    .map((k) => `${k}=${tencentEncode(queryParams[k])}`)
    .join('&');

  // 签名原文：不包含协议头 wss://
  const signSource = `${host}${path}?${queryString}`;

  // HMAC-SHA1 + Base64
  const signature = crypto
    .createHmac('sha1', secretKey)
    .update(signSource)
    .digest('base64');

  log.info('========== Tencent ASR Sign Debug ==========');
  log.info(`[Sign] appId=${appId} engineModelType=${engineModelType}`);
  log.info(`[Sign] timestamp=${timestamp} expired=${timestamp + expire} nonce=${nonce}`);
  log.info(`[Sign] queryString=${queryString.replace(/secretid=[^&]+/, 'secretid=***')}`);
  log.info(`[Sign] signSource=${signSource.replace(/secretid=[^&]+/, 'secretid=***')}`);
  log.info(`[Sign] signature=${signature}`);
  log.info('========== End Sign Debug ==========');

  // 拼装最终 URL
  const finalQuery = `${queryString}&signature=${tencentEncode(signature)}`;
  return `wss://${host}${path}?${finalQuery}`;
}

/**
 * 腾讯云 URL 编码
 * 严格按腾讯云要求：必须支持 + = 等特殊字符编码
 */
function tencentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}
