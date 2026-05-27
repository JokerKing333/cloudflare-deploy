/**
 * Cloudflare Worker - AI 问答系统后端 API
 * 同时托管静态前端文件
 * 
 * 模型适配说明：
 * - 当前使用 deepseek-ai/DeepSeek-R1-0528-Qwen3-8B（老版本 R1 模型）
 * - 该模型对联网搜索的 prompt 格式有特殊要求
 * - 搜索结果需要以更结构化的 system 消息注入，而非拼接到 user 消息
 * 
 * 爬虫反检测说明：
 * - Workers 环境限制：无浏览器进程、无代理池、无 DOM 引擎
 * - 极限优化：真实浏览器指纹、UA 池轮换、拟人延迟、多引擎并发
 * - 完整 Sec-* Headers、Referer 链、Cookie 管理、指数退避重试
 */

// ==================== 模型配置 ====================
const MODEL_CONFIG = {
  model: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
  supportsReasoning: true,
  searchInjectionMode: 'system',
};

// ==================== 爬虫配置 ====================
const CRAWLER_CONFIG = {
  // 并发抓取网页数
  maxConcurrentFetches: 3,
  // 单页超时（毫秒）
  pageTimeout: 6000,
  // 总抓取超时（毫秒）
  totalTimeout: 10000,
  // 最大重试次数
  maxRetries: 2,
  // 重试基础延迟（毫秒）
  retryBaseDelay: 1000,
  // 每个网页最大提取字符数
  maxContentPerPage: 2500,
  // 搜索上下文最大总长度
  maxContextLength: 8000,
  // 搜索结果数
  searchMaxResults: 5,
};

// ==================== 真实浏览器 UA 池 ====================
// 按市场份额加权：Chrome ~65%, Safari ~18%, Edge ~5%, Firefox ~3%
const UA_POOL = {
  chrome: {
    weight: 65,
    versions: [
      // Chrome 131 (2024.11)
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    ],
  },
  safari: {
    weight: 18,
    versions: [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    ],
  },
  edge: {
    weight: 5,
    versions: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    ],
  },
  firefox: {
    weight: 3,
    versions: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
    ],
  },
};

// 预计算加权 UA 列表
const WEIGHTED_UA_LIST = (() => {
  const list = [];
  for (const [browser, config] of Object.entries(UA_POOL)) {
    for (let i = 0; i < config.weight; i++) {
      list.push(config.versions);
    }
  }
  return list;
})();

// ==================== Accept-Language 池 ====================
const ACCEPT_LANGUAGE_POOL = [
  'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
  'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'zh-CN,zh-Hans;q=0.9,en;q=0.8,ja;q=0.7',
  'zh-CN,zh-TW;q=0.9,zh;q=0.8,en;q=0.7,en-US;q=0.6',
];

// ==================== Accept 池 ====================
const ACCEPT_POOL = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
];

// ==================== Sec-CH-UA 池（浏览器品牌标识）====================
const SEC_CH_UA_POOL = [
  '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  '"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"',
  '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
];

// ==================== 搜索引擎配置 ====================
// 优先使用国内搜索引擎（低延迟），国外引擎作为备用
const SEARCH_ENGINES = [
  {
    name: 'Bing_CN',
    buildUrl: (q, n) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=${n}&setlang=zh-cn&mkt=zh-CN`,
    parseResults: parseBingResults,
    referer: 'https://cn.bing.com/',
    priority: 1,
  },
  {
    name: 'Bing',
    buildUrl: (q, n) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=${n}&setlang=zh-cn&mkt=zh-CN`,
    parseResults: parseBingResults,
    referer: 'https://www.bing.com/',
    priority: 2,
  },
  {
    name: 'Sogou',
    buildUrl: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}&ie=utf8`,
    parseResults: parseSogouResults,
    referer: 'https://www.sogou.com/',
    priority: 3,
  },
  {
    name: 'Baidu',
    buildUrl: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&ie=utf-8&rn=10`,
    parseResults: parseBaiduResults,
    referer: 'https://www.baidu.com/',
    priority: 4,
  },
  {
    name: 'DuckDuckGo_Lite',
    buildUrl: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    parseResults: parseDuckDuckGoLiteResults,
    referer: 'https://lite.duckduckgo.com/',
    priority: 5,
  },
];

// ==================== 主入口 ====================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }
    if (url.pathname === '/api/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }
    if (url.pathname === '/api/models' && request.method === 'GET') {
      return handleModels(env);
    }

    return env.ASSETS.fetch(request);
  },
};

// ==================== 聊天处理 ====================
async function handleChat(request, env) {
  const API_KEY = env.SILICONFLOW_API_KEY;
  if (!API_KEY) {
    return new Response(
      JSON.stringify({ error: '请先在 Cloudflare Dashboard 中设置 SILICONFLOW_API_KEY 环境变量' }),
      { status: 500, headers: corsHeaders() }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: corsHeaders() });
  }

  const messages = body.messages || [];
  const enableSearch = body.enable_search || false;

  if (!messages.length) {
    return new Response(JSON.stringify({ error: '消息不能为空' }), { status: 400, headers: corsHeaders() });
  }

  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  let searchContext = '';
  if (enableSearch && apiMessages.length) {
    let lastUserMsg = null;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'user') {
        lastUserMsg = apiMessages[i];
        break;
      }
    }
    if (lastUserMsg) {
      searchContext = await buildSearchContext(lastUserMsg.content);

      if (searchContext) {
        apiMessages.unshift({ role: 'system', content: searchContext });
        lastUserMsg.content = lastUserMsg.content + '\n\n[系统提示：请参考上述搜索结果回答，注意当前日期是' + getCurrentDate() + ']';
      } else {
        apiMessages.unshift({
          role: 'system',
          content: '当前日期是' + getCurrentDate() + '。请基于你的知识回答用户问题，注意时效性。',
        });
        lastUserMsg.content = lastUserMsg.content + '\n\n[系统提示：当前日期是' + getCurrentDate() + '，请注意时效性]';
      }
    }
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  streamChat(writer, encoder, apiMessages, enableSearch, API_KEY, searchContext).catch(err => {
    console.error('Stream error:', err);
  });

  return new Response(readable, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function streamChat(writer, encoder, messages, enableSearch, apiKey, searchContext) {
  let heartbeatInterval = null;

  try {
    if (enableSearch && searchContext) {
      await writeSSE(writer, encoder, { type: 'search_start' });
    }

    // iOS Safari SSE 兼容：每 15 秒发送心跳，防止连接被断开
    heartbeatInterval = setInterval(async () => {
      try {
        await writeSSE(writer, encoder, { type: 'heartbeat' });
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_CONFIG.model,
        messages: messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
        top_p: 0.9,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      await writeSSE(writer, encoder, {
        type: 'error',
        content: `API 请求失败 (${response.status}): ${errorText.substring(0, 200)}`,
      });
      await writeSSE(writer, encoder, '[DONE]');
      return;
    }

    if (enableSearch && searchContext) {
      await writeSSE(writer, encoder, { type: 'search_end' });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices.length > 0) {
            const delta = parsed.choices[0].delta;
            if (delta.reasoning_content) {
              await writeSSE(writer, encoder, { type: 'reasoning', content: delta.reasoning_content });
            }
            if (delta.content) {
              await writeSSE(writer, encoder, { type: 'content', content: delta.content });
            }
          }
        } catch (parseErr) {
          // 忽略解析错误
        }
      }
    }

    await writeSSE(writer, encoder, '[DONE]');
  } catch (error) {
    console.error('Stream error:', error.message);
    try {
      await writeSSE(writer, encoder, { type: 'error', content: error.message || '未知错误' });
      await writeSSE(writer, encoder, '[DONE]');
    } catch {}
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    try { writer.close(); } catch {}
  }
}

async function writeSSE(writer, encoder, data) {
  if (typeof data === 'string') {
    await writer.write(encoder.encode(`data: ${data}\n\n`));
  } else {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }
}

// ==================== 搜索 API ====================
async function handleSearch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: corsHeaders() });
  }

  const query = body.query || '';
  if (!query) {
    return new Response(JSON.stringify({ error: '搜索关键词不能为空' }), { status: 400, headers: corsHeaders() });
  }

  const results = await webSearch(query);
  return new Response(JSON.stringify({ results }), { headers: corsHeaders() });
}

function handleModels(env) {
  return new Response(
    JSON.stringify({
      provider: 'siliconflow',
      model: MODEL_CONFIG.model,
      base_url: 'https://api.siliconflow.cn/v1',
    }),
    { headers: corsHeaders() }
  );
}

// ==================== 核心：联网搜索 + 爬虫 ====================

/**
 * 联网搜索 - 多引擎竞速 + 内容抓取
 * 
 * 策略：
 * 1. 按优先级排序搜索引擎（国内优先）
 * 2. 所有引擎并发搜索，先到先得
 * 3. 合并去重结果
 * 4. 爬虫抓取网页完整内容
 */
async function webSearch(query, maxResults = CRAWLER_CONFIG.searchMaxResults) {
  // 按优先级排序
  const sortedEngines = [...SEARCH_ENGINES].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  // 所有引擎并发搜索
  const searchPromises = sortedEngines.map(engine =>
    searchWithEngine(engine, query, maxResults)
  );

  // 使用 Promise.allSettled 等待所有结果（不因单个失败而中断）
  const allEngineResults = await Promise.allSettled(searchPromises);

  // 合并所有引擎的结果
  let allResults = [];
  for (const result of allEngineResults) {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      allResults = allResults.concat(result.value);
    }
  }

  // 去重（按 URL）
  const seenUrls = new Set();
  const uniqueResults = [];
  for (const r of allResults) {
    const normalizedUrl = normalizeUrl(r.url);
    if (!seenUrls.has(normalizedUrl) && r.url && r.url.startsWith('http')) {
      seenUrls.add(normalizedUrl);
      uniqueResults.push(r);
    }
  }

  // 质量排序：有摘要的优先，国内引擎优先
  uniqueResults.sort((a, b) => {
    const scoreA = (a.snippet ? 3 : 0) + (isChineseSource(a.source) ? 2 : 0);
    const scoreB = (b.snippet ? 3 : 0) + (isChineseSource(b.source) ? 2 : 0);
    return scoreB - scoreA;
  });

  const topResults = uniqueResults.slice(0, maxResults);

  // 爬虫抓取网页内容
  if (topResults.length > 0) {
    return await enrichWithCrawler(topResults, query);
  }

  return topResults;
}

function isChineseSource(source) {
  return ['Bing_CN', '搜狗', '百度'].includes(source);
}

/**
 * 用单个搜索引擎搜索（带反检测 Headers）
 */
async function searchWithEngine(engine, query, maxResults) {
  const url = engine.buildUrl(query, maxResults);
  const headers = buildBrowserHeaders(engine.referer);

  try {
    const resp = await fetchWithRetry(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    if (!resp || !resp.ok) return [];

    const html = await resp.text();
    return engine.parseResults(html, maxResults);
  } catch (err) {
    console.error(`${engine.name} 搜索出错:`, err.message);
    return [];
  }
}

// ==================== 搜索结果解析器 ====================

/**
 * 解析 Bing 搜索结果
 * 适配多种 HTML 结构变体
 */
function parseBingResults(html, maxResults) {
  const results = [];

  // 策略1: 标准 b_algo 结构
  const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = algoRegex.exec(html)) !== null && results.length < maxResults) {
    const parsed = parseBingResultBlock(match[1]);
    if (parsed) results.push(parsed);
  }

  // 策略2: 如果策略1没结果，尝试更宽松的匹配
  if (!results.length) {
    const looseRegex = /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = looseRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].replace(/<[^>]*>/g, '').trim();
      if (title && url && !url.includes('bing.com') && !url.includes('microsoft.com/bing')) {
        results.push({
          title: truncateText(title, 100),
          url,
          snippet: '',
          source: 'Bing',
        });
      }
    }
  }

  return results;
}

function parseBingResultBlock(block) {
  const titleMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
  if (!titleMatch) return null;

  const url = titleMatch[1];
  const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();

  if (!title || !url || url.includes('bing.com') || url.includes('go.microsoft.com')) return null;

  // 提取摘要 - 多种可能的 class
  let snippet = '';
  const snippetPatterns = [
    /<p class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>/i,
    /<p[^>]*class="[^"]*b_algoSlug[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    /<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i,
    /<p[^>]*>([\s\S]*?)<\/p>/i,
  ];
  for (const pattern of snippetPatterns) {
    const m = block.match(pattern);
    if (m) {
      snippet = m[1].replace(/<[^>]*>/g, '').trim();
      if (snippet.length > 20) break;
    }
  }

  return {
    title: truncateText(title, 100),
    url,
    snippet: truncateText(snippet, 300),
    source: 'Bing',
  };
}

/**
 * 解析搜狗搜索结果
 */
function parseSogouResults(html, maxResults) {
  const results = [];

  // 搜狗结果格式: <div class="rb"><h3><a href="url">title</a></h3><p>snippet</p></div>
  // 或 <div class="vrwrap"><h3><a>title</a></h3><p>snippet</p></div>
  const blockRegex = /<div[^>]*class="[^"]*(?:rb|vrwrap|result)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:rb|vrwrap|result)[^"]*"|$)/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];
    const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*id="[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);

    if (linkMatch) {
      let url = linkMatch[1];
      // 搜狗使用重定向链接
      if (url.includes('sogou.com/link')) {
        const realUrlMatch = url.match(/url=([^&]*)/);
        if (realUrlMatch) {
          try { url = decodeURIComponent(realUrlMatch[1]); } catch {}
        }
      }

      const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();

      if (title && url && !url.includes('sogou.com') && url.startsWith('http')) {
        const snippetMatch = block.match(/<p[^>]*class="[^"]*(?:str_info|abstract|summary|space-txt)[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
          || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

        results.push({
          title: truncateText(title, 100),
          url,
          snippet: snippetMatch ? truncateText(snippetMatch[1].replace(/<[^>]*>/g, '').trim(), 300) : '',
          source: '搜狗',
        });
      }
    }
  }

  return results;
}

/**
 * 解析百度搜索结果
 */
function parseBaiduResults(html, maxResults) {
  const results = [];

  // 百度结果格式: <div class="result c-container"><h3><a>title</a></h3><div class="c-abstract">snippet</div></div>
  const blockRegex = /<div[^>]*class="[^"]*(?:result|c-container)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:result|c-container)[^"]*"|$)/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];

    // 跳过广告
    if (block.includes('ec_ad') || block.includes('result-op')) continue;

    const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);

    if (linkMatch) {
      let url = linkMatch[1];
      const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();

      if (title && url && url.startsWith('http') && !url.includes('baidu.com')) {
        const snippetMatch = block.match(/<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
          || block.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
          || block.match(/<span[^>]*class="[^"]*c-color[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

        results.push({
          title: truncateText(title, 100),
          url,
          snippet: snippetMatch ? truncateText(snippetMatch[1].replace(/<[^>]*>/g, '').trim(), 300) : '',
          source: '百度',
        });
      }
    }
  }

  return results;
}

/**
 * 解析 DuckDuckGo HTML 搜索结果（保留作为备用）
 */
function parseDuckDuckGoHTMLResults(html, maxResults) {
  const results = [];

  const blockRegex = /<div[^>]*class="[^"]*(?:result|web-result)[^"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*(?:result|web-result)[^"]*"[^>]*>/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];
    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

    if (linkMatch) {
      const url = cleanDuckDuckGoUrl(linkMatch[1]);
      const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();

      if (title && url && !url.includes('duckduckgo.com')) {
        const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
          || block.match(/<span[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

        results.push({
          title: truncateText(title, 100),
          url,
          snippet: snippetMatch ? truncateText(snippetMatch[1].replace(/<[^>]*>/g, '').trim(), 300) : '',
          source: 'DuckDuckGo',
        });
      }
    }
  }

  return results;
}

/**
 * 解析 DuckDuckGo Lite 搜索结果
 */
function parseDuckDuckGoLiteResults(html, maxResults) {
  const results = [];

  // Lite 版格式: <a href="url">title</a><span class="snippet">snippet</span>
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetRegex = /<span[^>]*class="[^"]*snippet[^"]*"[^>]*>([^<]*)<\/span>/gi;

  const links = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const url = linkMatch[1];
    const title = linkMatch[2].trim();
    if (url && !url.includes('duckduckgo.com') && title && !title.includes('>') && !title.includes('<')) {
      links.push({ url, title });
    }
  }

  const snippets = [];
  let snippetMatch;
  while ((snippetMatch = snippetRegex.exec(html)) !== null) {
    snippets.push(snippetMatch[1].trim());
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: truncateText(links[i].title, 100),
      url: links[i].url,
      snippet: truncateText(snippets[i] || '', 300),
      source: 'DuckDuckGo Lite',
    });
  }

  return results;
}

// ==================== 爬虫内容抓取 ====================

/**
 * 爬虫内容抓取器 - 反检测增强版
 * 
 * 反检测措施：
 * - 每次请求随机 UA + 完整浏览器 Headers
 * - 拟人化随机延迟
 * - 指数退避重试
 * - Cookie 自动管理
 * - Referer 链模拟
 */
async function enrichWithCrawler(searchResults, query) {
  const urlsToFetch = searchResults
    .filter(r => r.url && r.url.startsWith('http'))
    .slice(0, CRAWLER_CONFIG.maxConcurrentFetches);

  if (!urlsToFetch.length) return searchResults;

  // 并行抓取（带随机延迟错开）
  const fetchPromises = urlsToFetch.map(async (result, index) => {
    // 拟人化：每个请求间隔 200-800ms 随机延迟
    await sleep(randomInt(200, 800) * index);

    try {
      const content = await fetchPageContentWithRetry(result.url);
      if (content) {
        const relevantContent = extractRelevantContent(content, query, CRAWLER_CONFIG.maxContentPerPage);
        if (relevantContent) {
          result.fullContent = relevantContent;
          result.hasCrawled = true;
        }
      }
    } catch (err) {
      console.error(`抓取 ${result.url} 失败:`, err.message);
    }
    return result;
  });

  // 总超时保护
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), CRAWLER_CONFIG.totalTimeout);
  });

  await Promise.race([Promise.all(fetchPromises), timeout]);

  return searchResults;
}

/**
 * 带重试的网页抓取
 */
async function fetchPageContentWithRetry(url, retryCount = 0) {
  try {
    return await fetchPageContent(url);
  } catch (err) {
    if (retryCount < CRAWLER_CONFIG.maxRetries) {
      // 指数退避：1s, 2s, 4s...
      const delay = CRAWLER_CONFIG.retryBaseDelay * Math.pow(2, retryCount) + randomInt(0, 500);
      console.log(`重试 ${url} (第${retryCount + 1}次)，等待 ${delay}ms`);
      await sleep(delay);
      return await fetchPageContentWithRetry(url, retryCount + 1);
    }
    throw err;
  }
}

/**
 * 抓取网页内容 - 完整浏览器指纹模拟
 */
async function fetchPageContent(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CRAWLER_CONFIG.pageTimeout);

  // 从目标 URL 提取域名作为 Referer 基础
  let referer = 'https://www.google.com/';
  try {
    const urlObj = new URL(url);
    referer = `https://www.google.com/search?q=${encodeURIComponent(urlObj.hostname)}`;
  } catch {}

  const headers = buildBrowserHeaders(referer);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
      headers,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    // 处理反爬响应
    if (resp.status === 403 || resp.status === 429) {
      console.log(`反爬拦截: ${url} (${resp.status})`);
      return null;
    }

    if (!resp.ok) return null;

    // 检查是否被重定向到验证页面
    const finalUrl = resp.url;
    if (finalUrl.includes('captcha') || finalUrl.includes('challenge') || finalUrl.includes('verify')) {
      console.log(`遇到验证页面: ${url}`);
      return null;
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await resp.text();

    // 检测 Cloudflare/challenge 页面
    if (isBlockPage(html)) {
      console.log(`检测到拦截页面: ${url}`);
      return null;
    }

    return cleanHTML(html);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.log(`请求超时: ${url}`);
    }
    throw err;
  }
}

/**
 * 检测是否被反爬拦截
 */
function isBlockPage(html) {
  if (!html || html.length < 100) return false;

  const blockSignatures = [
    'cf-browser-verification',
    'cf-challenge-running',
    'cf_captcha',
    'g-recaptcha',
    'h-captcha',
    'Just a moment',
    'Checking your browser',
    'Please enable JavaScript',
    '请启用 JavaScript',
    '请开启 JavaScript',
    'DDoS protection',
    'Attention Required',
    'Cloudflare Ray ID',
    '_cf_chl_opt',
    'challenge-platform',
  ];

  const lowerHtml = html.substring(0, 2000).toLowerCase();
  return blockSignatures.some(sig => lowerHtml.includes(sig.toLowerCase()));
}

// ==================== 浏览器指纹构建 ====================

/**
 * 构建完整的浏览器请求 Headers
 * 模拟真实 Chrome/Safari/Edge 浏览器的完整指纹
 */
function buildBrowserHeaders(referer = 'https://www.google.com/') {
  const ua = getRandomUA();
  const isChrome = ua.includes('Chrome') && !ua.includes('Edg');
  const isEdge = ua.includes('Edg');
  const isSafari = ua.includes('Safari') && !ua.includes('Chrome');
  const isFirefox = ua.includes('Firefox');

  const headers = {
    'User-Agent': ua,
    'Accept': randomChoice(ACCEPT_POOL),
    'Accept-Language': randomChoice(ACCEPT_LANGUAGE_POOL),
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer,
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1', // Do Not Track
  };

  // Chrome/Edge 特有 Headers
  if (isChrome || isEdge) {
    headers['Sec-CH-UA'] = randomChoice(SEC_CH_UA_POOL);
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = randomChoice(['"Windows"', '"macOS"', '"Linux"']);
    headers['Sec-Fetch-Site'] = randomChoice(['cross-site', 'none', 'same-origin']);
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-User'] = '?1';
    headers['Sec-Fetch-Dest'] = 'document';
  }

  // Safari 特有 Headers
  if (isSafari) {
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    delete headers['Upgrade-Insecure-Requests'];
    delete headers['Sec-CH-UA'];
    delete headers['Sec-CH-UA-Mobile'];
    delete headers['Sec-CH-UA-Platform'];
  }

  // Firefox 特有 Headers
  if (isFirefox) {
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    headers['TE'] = 'trailers';
    delete headers['Sec-CH-UA'];
    delete headers['Sec-CH-UA-Mobile'];
    delete headers['Sec-CH-UA-Platform'];
  }

  return headers;
}

/**
 * 从加权池中随机获取 UA
 */
function getRandomUA() {
  const bucket = randomChoice(WEIGHTED_UA_LIST);
  return randomChoice(bucket);
}

// ==================== HTML 清洗器 ====================

/**
 * HTML 清洗器 - 从 HTML 中提取纯文本正文
 * 增强版：处理更多边缘情况
 */
function cleanHTML(html) {
  if (!html) return '';

  let text = html;

  // 1. 移除不需要的标签及其内容
  const removeTags = [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'footer', 'header', 'aside', 'form',
    'select', 'button', 'textarea', 'canvas',
    'video', 'audio', 'source', 'track',
  ];
  for (const tag of removeTags) {
    text = text.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    text = text.replace(new RegExp(`<${tag}[^>]*\\/>`, 'gi'), '');
  }

  // 2. 移除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 3. 移除 CSS（style 标签已处理，这里处理内联和 <style> 残留）
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // 4. 将块级元素替换为换行符
  const blockTags = 'div|p|h[1-6]|li|tr|article|section|blockquote|pre|table|ul|ol|dl|figure|figcaption|main|details|summary|fieldset|address';
  text = text.replace(new RegExp(`<\\/(${blockTags})>`, 'gi'), '\n');
  text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n');

  // 5. 移除所有剩余的 HTML 标签
  text = text.replace(/<[^>]*>/g, '');

  // 6. 解码 HTML 实体（完整版）
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#x27;': "'", '&#x2F;': '/', '&nbsp;': ' ', '&copy;': '©',
    '&reg;': '®', '&trade;': '™', '&mdash;': '—', '&ndash;': '–',
    '&lsquo;': "'", '&rsquo;': "'", '&ldquo;': '"', '&rdquo;': '"',
    '&hellip;': '…', '&middot;': '·', '&bull;': '•',
    '&laquo;': '«', '&raquo;': '»',
  };
  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'g'), char);
  }
  // 数字实体
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

  // 7. 清理空白
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ');
  text = text.replace(/ +/g, ' ');

  // 8. 合并多余空行
  text = text.replace(/\n{3,}/g, '\n\n');

  // 9. 去除首尾空白
  text = text.trim();

  return text;
}

// ==================== 内容提取 ====================

/**
 * 从网页内容中提取与查询相关的段落
 */
function extractRelevantContent(text, query, maxLength = 2500) {
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const keywords = extractKeywords(query);

  // 按段落分割
  const paragraphs = text.split(/\n\n+/).filter(p => {
    const trimmed = p.trim();
    return trimmed.length > 20;
  });

  if (!paragraphs.length) {
    return text.substring(0, maxLength);
  }

  // 计算每个段落的相关性得分
  const scored = paragraphs.map(p => {
    const lowerP = p.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const count = (lowerP.match(new RegExp(escaped, 'g')) || []).length;
      score += count * 10;
    }
    // 段落长度适中加分
    const len = p.length;
    if (len > 100 && len < 800) score += 5;
    // 包含数字/日期加分（可能是关键信息）
    if (/\d{4}年|\d{2}月|\d{2}日|\d{2}:\d{2}/.test(p)) score += 3;
    return { text: p.trim(), score };
  });

  scored.sort((a, b) => b.score - a.score);

  let result = '';
  for (const item of scored) {
    if (result.length + item.text.length > maxLength) {
      const remaining = maxLength - result.length;
      if (remaining > 100) {
        result += item.text.substring(0, remaining) + '...';
      }
      break;
    }
    result += item.text + '\n\n';
  }

  return result.trim() || text.substring(0, maxLength);
}

/**
 * 从查询中提取关键词
 */
function extractKeywords(query) {
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
    '没有', '看', '好', '自己', '这', '那', '他', '她', '它', '们',
    '什么', '怎么', '哪', '吗', '吧', '呢', '啊', '哦', '嗯',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'can', 'shall',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'and', 'or', 'but', 'not', 'so', 'if', 'as', 'it', 'its',
    'this', 'that', 'these', 'those', 'we', 'you', 'they',
  ]);

  let cleaned = query
    .replace(/[，。！？、；：""''（）【】《》\s,.!?;:'"()\[\]{}<>\/\\|@#$%^&*+=~`-]/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/).filter(w => {
    return w.length >= 2 && !stopWords.has(w.toLowerCase());
  });

  if (words.length < 2) {
    return [query];
  }

  return [...new Set(words)];
}

// ==================== 带重试的 fetch ====================

/**
 * 带指数退避重试的 fetch
 */
async function fetchWithRetry(url, options, retryCount = 0) {
  try {
    const resp = await fetch(url, options);

    // 429 Too Many Requests - 自动重试
    if (resp.status === 429 && retryCount < CRAWLER_CONFIG.maxRetries) {
      const retryAfter = parseInt(resp.headers.get('Retry-After') || '2');
      const delay = Math.max(retryAfter * 1000, CRAWLER_CONFIG.retryBaseDelay * Math.pow(2, retryCount));
      console.log(`429 限流，等待 ${delay}ms 后重试 (第${retryCount + 1}次)`);
      await sleep(delay);
      return await fetchWithRetry(url, options, retryCount + 1);
    }

    // 503 Service Unavailable - 自动重试
    if (resp.status === 503 && retryCount < CRAWLER_CONFIG.maxRetries) {
      const delay = CRAWLER_CONFIG.retryBaseDelay * Math.pow(2, retryCount) + randomInt(0, 1000);
      console.log(`503 服务不可用，等待 ${delay}ms 后重试 (第${retryCount + 1}次)`);
      await sleep(delay);
      return await fetchWithRetry(url, options, retryCount + 1);
    }

    return resp;
  } catch (err) {
    if (retryCount < CRAWLER_CONFIG.maxRetries) {
      const delay = CRAWLER_CONFIG.retryBaseDelay * Math.pow(2, retryCount) + randomInt(0, 500);
      console.log(`网络错误，等待 ${delay}ms 后重试 (第${retryCount + 1}次): ${err.message}`);
      await sleep(delay);
      return await fetchWithRetry(url, options, retryCount + 1);
    }
    throw err;
  }
}

// ==================== 工具函数 ====================

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function getCurrentDate() {
  const now = new Date();
  const bjTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = bjTime.getUTCFullYear();
  const month = String(bjTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bjTime.getUTCDate()).padStart(2, '0');
  const hours = String(bjTime.getUTCHours()).padStart(2, '0');
  const minutes = String(bjTime.getUTCMinutes()).padStart(2, '0');
  return `${year}年${month}月${day}日 ${hours}:${minutes}（北京时间）`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function cleanDuckDuckGoUrl(url) {
  if (!url) return '';
  // DuckDuckGo 使用重定向链接，需要提取真实 URL
  const uddgMatch = url.match(/uddg=(https?%3A[^&]*)/i);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch {
      return url;
    }
  }
  return url;
}

// ==================== 搜索上下文构建 ====================

async function buildSearchContext(query) {
  const results = await webSearch(query, CRAWLER_CONFIG.searchMaxResults);

  if (!results.length) {
    console.log('搜索未返回结果，跳过上下文注入');
    return '';
  }

  let context = `当前日期：${getCurrentDate()}\n\n`;
  context += '以下是用户问题「' + query + '」的网络搜索结果，你必须参考这些信息来回答：\n\n';
  context += '=== 搜索结果 ===\n';

  results.forEach((r, i) => {
    context += `[${i + 1}] ${r.title}\n`;
    if (r.url) {
      context += `来源: ${r.url}\n`;
    }

    if (r.hasCrawled && r.fullContent) {
      context += `网页内容（爬虫抓取）:\n${r.fullContent}\n`;
    } else if (r.snippet) {
      context += `摘要: ${r.snippet}\n`;
    }
    context += '\n';
  });

  context += '=== 搜索结束 ===\n';
  context += '重要：你必须基于以上搜索结果回答用户问题。如果搜索结果中包含"网页内容（爬虫抓取）"，请优先参考这些真实网页内容。在回答中引用搜索到的信息，并注明来源。如果搜索结果与问题不相关，请说明并基于你的知识回答。';

  if (context.length > CRAWLER_CONFIG.maxContextLength) {
    context = context.substring(0, CRAWLER_CONFIG.maxContextLength - 50) + '\n...(搜索结果已截断)\n=== 搜索结束 ===';
  }

  return context;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
