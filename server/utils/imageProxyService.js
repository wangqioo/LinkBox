const WECHAT_IMAGE_PATTERN = /(qpic\.cn|weixin|mmbiz)/i;

export function isWeChatImageUrl(url = '') {
  return WECHAT_IMAGE_PATTERN.test(url);
}

export function imageProxyHeaders(url) {
  const isWeChat = isWeChatImageUrl(url);
  const referer = isWeChat ? 'https://mp.weixin.qq.com/' : new URL(url).origin + '/';

  return {
    'User-Agent': isWeChat
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20G75 MicroMessenger/8.0.40'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': referer,
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

export async function fetchProxiedImage(url, {
  fetchImpl = fetch,
  timeoutMs = 12000,
} = {}) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    const error = new Error('Invalid image URL');
    error.status = 400;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: imageProxyHeaders(url),
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        shouldRedirect: !isWeChatImageUrl(url),
        status: response.status,
      };
    }

    return {
      ok: true,
      contentType: response.headers.get('content-type') || 'image/jpeg',
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  } catch (error) {
    return {
      ok: false,
      shouldRedirect: !isWeChatImageUrl(url),
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleImageProxyRequest(req, res) {
  const { url } = req.query;
  if (!url || !String(url).startsWith('http')) return res.status(400).end();

  const result = await fetchProxiedImage(String(url));
  if (!result.ok) {
    if (result.shouldRedirect) return res.redirect(302, String(url));
    if (result.error) {
      console.error('image-proxy error:', result.error.message, 'url:', String(url).slice(0, 80));
    }
    return res.status(502).end();
  }

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.end(result.buffer);
}
